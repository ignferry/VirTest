import { fileURLToPath } from 'url';
import { resolve } from 'path';

export function getToolPath() {
    const currentFilePath = fileURLToPath(import.meta.url);
    const rootProjectPath = resolve(currentFilePath, '..', '..', '..');

    return rootProjectPath;
}

export function getCurrentPath() {
    return process.cwd();
}