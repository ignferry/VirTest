#!/usr/bin/env node

import { Command } from 'commander';
import { loadCommands } from './commands/index.js';

const program = new Command();

program
    .name('virtest')
    .description('Performance testing tool for microservices deployed in Kubernetes, with support of Mountebank virtual service')
    .version('1.0.0');

loadCommands(program);

program.parse();