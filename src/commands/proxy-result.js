import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { parseDocument} from 'yaml';
import axios from 'axios';
import { listPods, portForward, isNamespaceAvailable } from '../utils/kubernetes.js';
import { getCurrentPath } from '../utils/path.js';

export const proxyResultCommand = new Command()
    .name('proxy-result')
    .description('retrieves proxy result')
    .argument('[configPath]', 'config file path')
    .action(async (configPath = 'config.yaml') => {
        // Read config file
        try {
            const configFullPath = join(getCurrentPath(), configPath);
            const fileContent = await readFile(configFullPath, 'utf-8');
            const config = parseDocument(fileContent).toJSON();
    
            await retrieveProxyResult(config);
        } catch (err) {
            console.log('Error retrieving proxy result', err);
            process.exit();
        }
    });

export async function retrieveProxyResult(config) {
    // List services that require saving proxy result
    const toSaveProxyServices = [];

    for (const service in config.services) {
        const serviceConfigDetail = config.services[service];
        if (serviceConfigDetail['virtual-service']?.enabled
            && serviceConfigDetail['virtual-service']?.proxy?.['save-result']) {
            toSaveProxyServices.push({
                name: service,
                detail: serviceConfigDetail
            });
        }
    }

    if (toSaveProxyServices.length === 0) {
        console.log('No services require saving proxy result');
        return;
    }

    const namespace = config.manifests.namespace;
    if (!namespace) {
        throw new Error('Namespace name not specified');
    }
    if (!(await isNamespaceAvailable(namespace))) {
        throw new Error('Namespace does not exist in the cluster');
    }

    // Start port forwarding to mountebank service
    const pods = await listPods('app.kubernetes.io/name=mountebank', namespace);
    if (pods.length === 0) {
        throw new Error('Mountebank pods not found');
    }

    const pf = await portForward(pods.body.items[0].metadata.name, 2525, 2525, namespace);

    // Get proxy result of services and write to current directory
    for (const service of toSaveProxyServices) {
        const proxyResult = (await axios.get(`http://localhost:2525/imposters/${service.detail['virtual-service'].port}`)).data;

        if (proxyResult.numberOfRequests) {
            delete proxyResult.numberOfRequests;
        }

        if (proxyResult.requests) {
            delete proxyResult.requests;
        }

        if (proxyResult._links) {
            delete proxyResult._links;
        }
        
        if (service.detail['virtual-service'].proxy['auto-create']) {                                    
            proxyResult.recordRequests = false;
            proxyResult.stubs.shift();
        }

        if (service.detail['virtual-service'].grpc) {
            proxyResult.options = {
                protobufjs: {
                    includeDirs: ['/app/virtest'],
                }
            }

            proxyResult.services = {};
            proxyResult.services[`${service.detail['virtual-service'].grpc['proto-service-name']}`] = {
                file: `${service.name}.proto`
            }
        }

        service.proxyResult = proxyResult;
    }

    for (const service of toSaveProxyServices) {
        const filename = `${service.name}-proxy-result.json`;
        await writeFile(join(getCurrentPath(), filename), JSON.stringify(service.proxyResult, null, 2), 'utf-8');
        console.log(`Saved proxy result of ${service.name} service with filename ${filename}`);
    }

    // Turn off port forward
    pf.close();
}