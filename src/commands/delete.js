import { Command } from 'commander';

export const deleteCommand = new Command()
    .name('delete')
    .description('deletes an application deployment in Kubernetes based on config file and manifests')
    .argument('[configPath]', 'config file path')
    .action(deleteDeployment);

export async function deleteDeployment(configPath = 'config.yaml') {
    try {
        console.log('Delete deployment - UNIMPLEMENTED');

        // Read old generated manifest if exists
        // If does not exist, generate manifest

        // Kubectl delete
    } catch (err) {
        console.log('Error deleting deployment', err);
        process.exit();
    }
}