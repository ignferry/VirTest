import { initCommand } from "./init.js";
import { applyCommand } from "./apply.js";
import { executeTestCommand } from "./execute-test.js";
import { deleteCommand } from "./delete.js";
import { runCommand } from "./run.js";
import { proxyResultCommand } from "./proxy-result.js";

export function loadCommands(program) {
    program.addCommand(initCommand);
    program.addCommand(applyCommand);
    program.addCommand(executeTestCommand);
    program.addCommand(proxyResultCommand);
    program.addCommand(deleteCommand);
    program.addCommand(runCommand);
}