import { runCli } from './commands';

// Headless GLEECH: the same project model, command history and CPU renderer as
// the desktop app, driven from a terminal. See docs/CLI.md.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0); // e.g. `gleech effects | head`
  throw error;
});

// `pnpm cli …` runs from the workspace root; resolve paths where the user typed them.
if (process.env['npm_lifecycle_event'] === 'cli' && process.env['INIT_CWD'])
  process.chdir(process.env['INIT_CWD']);

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
