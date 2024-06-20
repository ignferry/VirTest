import { Command } from 'commander';
import { extname, join } from 'path';
import { parseAllDocuments, parseDocument, stringify } from 'yaml';
import { access, constants, mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { getCurrentPath, getToolPath } from '../utils/path.js';
import { applyManifest } from '../utils/kubernetes.js';
import { error } from 'console';

export const applyCommand = new Command()
    .name('apply')
    .description('deploys application to Kubernetes based on config file and manifests')
    .argument('[configPath]', 'config file path')
    .action(async (configPath = 'config.yaml') => {
        // Read config file
        try {
            const configFullPath = join(getCurrentPath(), configPath);
            const fileContent = await readFile(configFullPath, 'utf-8');
            const config = parseDocument(fileContent).toJSON();
    
            await applyDeployment(config);
        } catch (err) {
            console.log('Error applying deployment', err);
            process.exit();
        }
    });

export async function applyDeployment(config) { 
    // Create a directory for files needed for deployment
    try {
        await access(join(getCurrentPath(), 'virtest'), constants.F_OK);
        await rm(join(getCurrentPath(), 'virtest'), { recursive: true });
    } catch (err) {
        if (err.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
            throw err;
        }
    }
    await mkdir(join(getCurrentPath(), 'virtest'));

    // Retrieve components from manifest
    const components = new Map();
    if (!config.manifests.path) {
        throw new Error('Manifest file or folder not specified');
    }
    
    const manifestFullPath = join(getCurrentPath(), config.manifests.path);
    const manifestPathStats = await stat(manifestFullPath);

    if (!manifestPathStats.isFile() && !manifestPathStats.isDirectory()){
        throw new Error('Invalid manifest path')
    }
    await retrieveComponentsFromManifest(manifestFullPath, components);

    // Create modified manifest based on services config
    const virtualServicePortSet = new Set();

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

                serviceToMb.spec.ports = [{
                    port: serviceManifest.spec.ports[0].port,
                    targetPort: virtualServicePort
                }];

                serviceToMb.spec.selector = {
                    'app.kubernetes.io/name': 'mountebank'
                };

                components.get('Service').set(serviceName, serviceToMb);

                if (serviceConfigDetail['virtual-service'].proxy) {
                    // Create service component from mountebank to original service
                    if (serviceConfigDetail['virtual-service'].proxy['service-name'] === serviceConfigDetail['service-component'].name) {
                        throw new Error(`Service component name must be different from proxy service name for service ${serviceName}`);
                    }

                    const serviceFromMb = structuredClone(serviceManifest);

                    serviceFromMb.metadata.name = serviceConfigDetail['virtual-service'].proxy['service-name'];
                    serviceFromMb.spec.ports = [{
                        port: virtualServicePort,
                        targetPort: serviceManifest.spec.ports[0]['targetPort']
                    }];

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
                    const proxyImposter = {
                        protocol: serviceConfigDetail['virtual-service'].protocol || 'http',
                        port: serviceConfigDetail['virtual-service'].port,
                        recordRequests: true,
                        stubs: [{
                            responses: [{
                                proxy: {
                                    to: `${serviceConfigDetail['virtual-service'].proxy['service-name']}:${serviceConfigDetail['virtual-service'].port}`,
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
        
        if (components.has('ConfigMap')) {
            components.get('ConfigMap').set('mountebank', configMapManifest);
        } else {
            components.set('ConfigMap', new Map([configMapManifest]));
        }
    
        await writeFile(join(getCurrentPath(), 'virtest/mbconfig.json'), JSON.stringify({ imposters }, null, 2), 'utf-8');
    }

    // If otel enabled, add otel manifest
    // UNIMPLEMENTED

    // 
    for (let [_, componentMap] of components) {
        for (let [_, manifest] of componentMap) {
            await applyManifest(manifest);
        }
    }


    // Create yaml on user directory
    let fileContent = '';
    for (let [_, componentMap] of components) {
        for (let [_, manifest] of componentMap) {
            fileContent += stringify(manifest) + '\n---\n';
        }
    }

    await writeFile(join(getCurrentPath(), 'virtest/manifest.yaml'), fileContent, 'utf-8');
}

async function retrieveComponentsFromManifest(path, componentsMap) {
    const manifestPathStats = await stat(path);

    if (manifestPathStats.isFile()) {
        const extension = extname(path);
        if (extension === '.yaml' || extension === '.yml') {
            const fileContent = await readFile(path, 'utf-8');
            parseAllDocuments(fileContent).forEach(rawdoc => {
                const doc = rawdoc.toJSON();
                if (doc) {
                    const kind = doc.kind;

                    if (!componentsMap.has(kind)) {
                        componentsMap.set(kind, new Map([[doc.metadata.name, doc]]));
                    } else {
                        componentsMap.get(kind).set(doc.metadata.name, doc);
                    }
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