import { initCommand } from "./init.js";
import { applyCommand } from "./apply.js";
import { deleteCommand } from "./delete.js";
import { proxyResultCommand } from "./proxy-result.js";

export function loadCommands(program) {
    program.addCommand(initCommand);
    program.addCommand(applyCommand);
    program.addCommand(proxyResultCommand);
    program.addCommand(deleteCommand);
}