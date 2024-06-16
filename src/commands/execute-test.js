import { Command } from 'commander';

export const executeTestCommand = new Command()
    .name('execute-test')
    .description('executes K6 test scenario script')
    .argument('<scriptPath>', 'test script path')
    .action(executeTestScript);

export async function executeTestScript(scriptPath) {
    try {
        console.log('Execute test script - UNIMPLEMENTED');
    } catch (err) {
        console.log('Error executing test script', err);
        process.exit();
    }
}