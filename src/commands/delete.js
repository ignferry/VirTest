import { Command } from 'commander';
import { getCurrentPath } from '../utils/path.js';
import { getConfiguredManifestsMap, readAppConfig, retrieveComponentsFromManifest } from '../utils/config.js';
import { deleteManifest } from '../utils/kubernetes.js';

export const deleteCommand = new Command()
    .name('delete')
    .description('deletes an application deployment in Kubernetes based on config file and manifests (auto-generated manifest will be used first)')
    .argument('[configPath]', 'config file path')
    .action(async (configPath = 'config.yaml') => {
        try {
            try {
                const components = new Map();
                retrieveComponentsFromManifest(join(getCurrentPath(), 'virtest', 'manifest.yaml'), components);
                deleteDeployment(components);
            } catch (err) {
                const config = await readAppConfig(configPath);
                deleteDeployment(await getConfiguredManifestsMap(config));
            }
        } catch (err) {
            console.log('Error deleting deployment', err);
            process.exit(); 
        }
    });

export async function deleteDeployment(components) {
    try {
        for (let [_, componentMap] of components) {
            for (let [_, manifest] of componentMap) {
                await deleteManifest(manifest);
            }
        }

        console.log('Manifest delete commands have been sent.')
    } catch (err) {
        console.log('Error deleting deployment', err);
        process.exit();
    }
}