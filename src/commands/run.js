import { Command } from 'commander';

export const runCommand = new Command()
    .name('run')
    .description('runs a complete test including deploying application, executing test scenarios, and deleting application')
    .argument('[configPath]', 'config file path')
    .action(runTest);

export async function runTest(configPath = 'config.yaml') {
    try {
        console.log('Run test - UNIMPLEMENTED');
    } catch (err) {
        console.log('Error running test', err);
        process.exit();
    }
}