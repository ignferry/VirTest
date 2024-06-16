import { Command } from 'commander';
import { copyFile, mkdir } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { getCurrentPath, getToolPath } from '../utils/path.js';

export const initCommand = new Command()
    .name('init')
    .description('generate config template')
    .argument('[filepath]', 'generated config template file path')
    .action(initializeConfigFile);
    
export async function initializeConfigFile(filepath = 'config.yaml') {
    try {
        if (extname(filepath) !== '.yaml' && extname(filepath) !== '.yml') {
            filepath += '.yaml';
        }

        const configTemplatePath = join(getToolPath(), 'templates', 'config.template.yaml');
        const targetPath = join(getCurrentPath(), filepath);

        await mkdir(dirname(targetPath), { recursive: true });
        await copyFile(configTemplatePath, targetPath);

        console.log('Successfully generated config template at', targetPath);
    } catch (err) {
        if (err.code === 'EACCES') {
            console.log('Error: Permission denied');
        } else {
            console.log('Error creating config file', err);
        }
        process.exit();
    }
}
