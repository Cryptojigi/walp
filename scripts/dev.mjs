import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteCli = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

const procs = [
  spawn(process.execPath, [tsxCli, 'watch', 'server/index.ts'], {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
  }),
  spawn(process.execPath, [viteCli], {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: false,
  }),
];

function shutdown(signal) {
  for (const p of procs) {
    if (!p.killed) {
      p.kill(signal);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const p of procs) {
  p.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown('SIGTERM');
    }
  });
}
