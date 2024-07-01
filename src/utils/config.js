import { extname, join } from 'path';
import { parseAllDocuments, parseDocument } from 'yaml';
import { readdir, readFile, stat, } from 'fs/promises';
import { getCurrentPath, getToolPath } from './path.js';

export async function readAppConfig(path) {
    const configFullPath = join(getCurrentPath(), path);
    const fileContent = await readFile(configFullPath, 'utf-8');
    return parseDocument(fileContent).toJSON();
}

export async function getConfiguredManifestsMap(config) {
    // Retrieve components from manifest
    const components = new Map();
    if (!config.manifests.path) {
        throw new Error('Manifest file or folder not specified');
    }
    if (!config.manifests.namespace) {
        throw new Error('Namespace name not specified');
    }

    const manifestFullPath = join(getCurrentPath(), config.manifests.path);
    const manifestPathStats = await stat(manifestFullPath);

    if (!manifestPathStats.isFile() && !manifestPathStats.isDirectory()){
        throw new Error('Invalid manifest path')
    }
    await retrieveComponentsFromManifest(manifestFullPath, components);

    // Create modified manifest based on services config
    const virtualServicePortSet = new Set();

    if (config.services) {
        for (const service in config.services) {
            const serviceConfigDetail = config.services[service];
    
            // Deployment component setup
            if (serviceConfigDetail['deployment-component']) {
                if (components.has('Deployment')
                    && serviceConfigDetail['deployment-component']?.name
                    && components.get('Deployment').has(serviceConfigDetail['deployment-component'].name)
                ) {
                    if (!serviceConfigDetail['deployment-component'].enabled) {
                        components.get('Deployment').delete(serviceConfigDetail['deployment-component'].name);
                    }
                } else {
                    throw new Error(`invalid deployment component definition of ${service}`);
                }
            }
    
            // Service component setup
            if (serviceConfigDetail['virtual-service']?.enabled) {
                const serviceName = serviceConfigDetail['service-component'].name;
                if (serviceName) {
                    const serviceManifest = components.get('Service').get(serviceName);
    
                    if (!serviceManifest) {
                        throw new Error(`Service with name ${serviceName} not found`);
                    }
    
                    // Create service component with selector targeting mountebank
                    const virtualServicePort = serviceConfigDetail['virtual-service'].port;
                    if (!virtualServicePort) {
                        throw new Error(`Virtual service port not specified for service ${serviceName}`);
                    }
    
                    if (virtualServicePortSet.has(virtualServicePort)) {
                        throw new Error(`Duplicate virtual service port for service ${serviceName}. Please choose a different port.`);
                    }
                    virtualServicePortSet.add(virtualServicePort);
    
                    const serviceToMb = structuredClone(serviceManifest);
                    let portToMb = serviceManifest.spec.ports[0]?.port;
                    if (!portToMb) {
                        portToMb = virtualServicePort;
                    }
    
                    serviceToMb.spec = {
                        ports: [{
                            port: portToMb,
                            targetPort: virtualServicePort
                        }],
                        selector: {
                            'app.kubernetes.io/name': 'mountebank'
                        }
                    };
    
                    components.get('Service').set(serviceName, serviceToMb);
    
                    if (serviceConfigDetail['virtual-service'].proxy) {
                        // Create service component from mountebank to original service
                        if (serviceConfigDetail['virtual-service'].proxy['service-name'] === serviceConfigDetail['service-component'].name) {
                            throw new Error(`Service component name must be different from proxy service name for service ${serviceName}`);
                        }
    
                        const serviceFromMb = structuredClone(serviceManifest);
    
                        serviceFromMb.metadata.name = serviceConfigDetail['virtual-service'].proxy['service-name'];
                        serviceFromMb.spec = serviceManifest.spec;
    
                        components.get('Service').set(serviceConfigDetail['virtual-service'].proxy['service-name'], serviceFromMb);
                    }
                }
                else {
                    throw new Error(`No service component name defined for ${service}`);
                }
            }
        }
    
        // If virtual service required, add mountebank
        if (virtualServicePortSet.size !== 0) {
            const mbDeploymentManifestPath = join(getToolPath(), 'templates', 'mountebank-deployment.yaml');
            const deploymentFileContent = await readFile(mbDeploymentManifestPath, 'utf-8');
            const mbDeploymentManifest = parseDocument(deploymentFileContent).toJSON();
            components.get('Deployment').set('mountebank', mbDeploymentManifest);
    
            // Create mountebank configmap component with config file and protos
            const configMapManifest = {
                apiVersion: 'v1',
                kind: 'ConfigMap',
                metadata: {
                    name: 'mountebank'
                },
                data: {}
            };
            const imposters = [];
            for (const service in config.services) {
                const serviceConfigDetail = config.services[service];
                if (serviceConfigDetail['virtual-service']?.enabled) {
                    // Add proto files
                    if (serviceConfigDetail['virtual-service'].grpc) {
                        if (serviceConfigDetail['virtual-service'].grpc['protofile-path']
                            && serviceConfigDetail['virtual-service'].grpc['proto-service-name']
                        ) {
                            const protoPath = join(getCurrentPath(), serviceConfigDetail['virtual-service'].grpc['protofile-path']);
                            configMapManifest.data[`${service}.proto`] = await readFile(protoPath, 'utf-8');
                        } else {
                            throw new Error('For gRPC virtual services, protofile-path and proto-service-name must be defined');
                        }
                    }
                    
                    if (serviceConfigDetail['virtual-service'].path) {
                        // Create imposter based on file in path
                        const vsPath = join(getCurrentPath(), serviceConfigDetail['virtual-service'].path);
                        const vsFileContent = await readFile(vsPath, 'utf-8');
                        imposters.push(JSON.parse(vsFileContent));
                    } else if (serviceConfigDetail['virtual-service'].proxy?.['auto-create']) {
                        // Auto create proxy imposter
    
                        // Define URL to proxy to
                        let proxyUrl = '';
                        if (serviceConfigDetail['virtual-service'].protocol !== 'grpc') {
                            proxyUrl += `${serviceConfigDetail['virtual-service'].transport}://`
                        }
                        proxyUrl += serviceConfigDetail['virtual-service'].proxy['service-name'];
                        
                        const proxyServiceManifest = components.get('Service').get(serviceConfigDetail['virtual-service'].proxy['service-name']);
                        if (proxyServiceManifest.spec.ports) {
                            proxyUrl += `:${proxyServiceManifest.spec.ports[0].port}`;
                        }
    
                        const proxyImposter = {
                            protocol: serviceConfigDetail['virtual-service'].protocol || 'http',
                            port: serviceConfigDetail['virtual-service'].port,
                            recordRequests: true,
                            stubs: [{
                                responses: [{
                                    proxy: {
                                        to: proxyUrl,
                                        mode: 'proxyAlways',
                                        predicateGenerators: [{ matches: { path: true } }],
                                        addWaitBehavior: true
                                    }
                                }]
                            }]
                        }
                        if (serviceConfigDetail['virtual-service'].grpc) {
                            proxyImposter.services = {
                                [`${serviceConfigDetail['virtual-service'].grpc['proto-service-name']}`]: {
                                    file: `${service}.proto`
                                } 
                            }
                            proxyImposter.options = {
                                protobufjs: {
                                    includeDirs: ['/app/virtest']
                                }
                            }
                        }
                        imposters.push(proxyImposter);
                    }
                }
            }
            configMapManifest.data['mbconfig.json'] = JSON.stringify({ imposters }, null, 2);
    
            addToComponentsMap(components, configMapManifest);
        }
    }


    // If otel enabled, add otel manifest
    if (config.observability?.deploy) {
        const grafanaCloudCredentials = config.observability['grafana-cloud'];
        if (!(grafanaCloudCredentials?.username) || !(grafanaCloudCredentials?.password)) {
            throw new Error('Grafana Cloud username, password, and otlp endpoint is required for observability components to run');
        }
        if (!config.observability['test-id']) {
            throw new Error('Test ID needs to be specified for observability components to run');
        }

        const otelcolManifestPath = join(getToolPath(), 'templates', 'otelcol-agent.yaml');
        const otelcolManifestFileContent = await readFile(otelcolManifestPath, 'utf-8');
        const otelcolManifests = parseAllDocuments(otelcolManifestFileContent);

        for (let manifest of otelcolManifests) {
            manifest = manifest.toJSON();
            if (manifest.kind === 'Secret') {
                manifest.data.username = Buffer.from(grafanaCloudCredentials.username.toString()).toString('base64');
                manifest.data.password = Buffer.from(grafanaCloudCredentials.password).toString('base64');
                manifest.data['otlp-endpoint'] = Buffer.from(grafanaCloudCredentials['otlp-endpoint']).toString('base64');
            }

            if (manifest.kind === 'DaemonSet'){
                for (const env of  manifest.spec.template.spec.containers[0].env) {
                    if (env.name === 'TEST_RUN_ID') {
                        env.value = config.observability['test-id'];
                    }
                    if (env.name === 'NAMESPACE_NAME') {
                        env.value = config.manifests.namespace;
                    }
                }
               
            }

            if (manifest.kind === 'ClusterRoleBinding') {
                manifest.subjects[0].namespace = config.manifests.namespace;
            }

            addToComponentsMap(components, manifest);
        }
    }

    return components;
}

export async function retrieveComponentsFromManifest(path, componentsMap) {
    const manifestPathStats = await stat(path);

    if (manifestPathStats.isFile()) {
        const extension = extname(path);
        if (extension === '.yaml' || extension === '.yml') {
            const fileContent = await readFile(path, 'utf-8');
            parseAllDocuments(fileContent).forEach(rawdoc => {
                const manifest = rawdoc.toJSON();
                if (manifest) {
                    addToComponentsMap(componentsMap, manifest);
                }
            })
        }
    } else if (manifestPathStats.isDirectory()) {
        const promises = (await readdir(path)).map(async fileName => {
            const filePath = join(path, fileName);
            await retrieveComponentsFromManifest(filePath, componentsMap);
        });
        await Promise.all(promises);
    }
}

function addToComponentsMap(map, manifest) {
    if (!map.has(manifest.kind)) {
        map.set(manifest.kind, new Map([[manifest.metadata.name, manifest]]));
    } else {
        map.get(manifest.kind).set(manifest.metadata.name, manifest);
    }
}