import { Command } from 'commander';
import { getCurrentPath } from '../utils/path.js';
import { getConfiguredManifestsMap, readAppConfig, retrieveComponentsFromManifest } from '../utils/config.js';
import { deleteManifest, isNamespaceAvailable } from '../utils/kubernetes.js';

export const deleteCommand = new Command()
    .name('delete')
    .description('deletes an application deployment in Kubernetes based on config file and manifests (auto-generated manifest will be used first)')
    .argument('[configPath]', 'config file path')
    .action(async (configPath = 'config.yaml') => {
        try {
            const config = await readAppConfig(configPath);
            // Check if namespace is available
            const namespace = config.manifests.namespace;
            if (!namespace) {
                throw new Error('Namespace name not specified');
            }
            if (!(await isNamespaceAvailable(namespace))) {
                throw new Error('Namespace does not exist in the cluster');
            }

            try {
                const components = new Map();
                retrieveComponentsFromManifest(join(getCurrentPath(), 'virtest', 'manifest.yaml'), components);
                deleteDeployment(components, namespace);
            } catch (err) {
                console.log('Error deleting from previously generated manifest. Generating new manifest from config file');
                deleteDeployment(await getConfiguredManifestsMap(config), namespace);
            }
        } catch (err) {
            console.log('Error deleting deployment', err);
            process.exit(); 
        }
    });

export async function deleteDeployment(components, namespace) {
    for (let [kind, componentMap] of components) {
        for (let [_, manifest] of componentMap) {
            try {
                await deleteManifest(manifest, namespace);
                console.log(`Deleted ${kind}: ${manifest?.metadata?.name}`);
            } catch (err) {
                console.log(`Error deleting manifest ${manifest?.metadata?.name}`, err.message);
            }
        }
    }

    console.log('Manifest delete commands have been sent.');
}