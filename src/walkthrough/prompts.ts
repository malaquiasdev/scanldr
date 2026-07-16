// Steps import from here, not @inquirer/prompts directly, so tests can mock.module() this
// without touching the real terminal.
export { checkbox, confirm, editor, input, select } from "@inquirer/prompts";
