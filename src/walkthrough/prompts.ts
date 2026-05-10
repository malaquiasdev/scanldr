// Thin adapter over @inquirer/prompts.
// Steps import from here (not directly from @inquirer/prompts) so tests can
// mock this module via mock.module() without touching the real terminal.

export { checkbox, confirm, editor, input, select } from "@inquirer/prompts";
