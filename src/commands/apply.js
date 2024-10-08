import { Command } from 'commander';
import { join } from 'path';
import { stringify } from 'yaml';
import { access, constants, mkdir, rm, writeFile } from 'fs/promises';
import { getCurrentPath } from '../utils/path.js';
import { applyManifest, isNamespaceAvailable } from '../utils/kubernetes.js';
import { error } from 'console';
import { getConfiguredManifestsMap, readAppConfig } from '../utils/config.js';

export const applyCommand = new Command()
    .name('apply')
    .description('deploys application to Kubernetes based on config file and manifests')
    .argument('[configPath]', 'config file path')
    .action(async (configPath = 'config.yaml') => {
        // Read config file
        try {
            const config = await readAppConfig(configPath);
    
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
    const components = await getConfiguredManifestsMap(config);
    
    // Save manifest and mbconfig file to user directory
    let fileContent = '';
    for (let [_, componentMap] of components) {
        for (let [_, manifest] of componentMap) {
            fileContent += stringify(manifest) + '\n---\n';
        }
    }

    await writeFile(join(getCurrentPath(), 'virtest/manifest.yaml'), fileContent, 'utf-8');
    if (components.get('ConfigMap').has('mountebank')) {
        await writeFile(join(getCurrentPath(), 'virtest/mbconfig.json'), components.get('ConfigMap').get('mountebank').data['mbconfig.json'], 'utf-8');
    }

    // Check if namespace is available
    const namespace = config.manifests.namespace;
    if (!namespace) {
        throw new Error('Namespace name not specified');
    }
    if (!(await isNamespaceAvailable(namespace))) {
        throw new Error('Namespace does not exist in the cluster');
    }

    // Apply manifest
    for (let [kind, componentMap] of components) {
        for (let [_, manifest] of componentMap) {
            try {
                await applyManifest(manifest, namespace);
                console.log(`Applied ${kind}: ${manifest?.metadata?.name}`);
            } catch (err) {
                console.log(`Error applying manifest ${manifest?.metadata?.name}`, err.message);
            }
        }
    }

    console.log('Manifest apply commands have been sent based on given config file. Please wait until all deployments are ready before running tests')
}