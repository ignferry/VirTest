import { Command } from 'commander';

export const applyCommand = new Command()
    .name('apply')
    .description('deploys application to Kubernetes based on config file and manifests')
    .argument('[configPath]', 'config file path')
    .action(applyDeployment);

export async function applyDeployment(configPath = 'config.yaml') {
    try {
        console.log('Apply deployment - UNIMPLEMENTED');
    } catch (err) {
        console.log('Error applying deployment', err);
        process.exit();
    }
}