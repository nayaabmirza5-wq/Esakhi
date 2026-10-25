import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const services = [
  {
    name: 'backend',
    cwd: resolve(root, 'backend'),
    command: resolve(root, 'backend/node_modules/tsx/dist/cli.mjs'),
    args: ['watch', 'src/server.ts'],
    dependency: resolve(root, 'backend/node_modules/tsx/dist/cli.mjs'),
  },
  {
    name: 'frontend',
    cwd: resolve(root, 'frontend'),
    command: resolve(root, 'frontend/node_modules/vite/bin/vite.js'),
    args: ['--host', '0.0.0.0'],
    dependency: resolve(root, 'frontend/node_modules/vite/bin/vite.js'),
  },
];

const missing = services.filter(({ dependency }) => !existsSync(dependency));
if (missing.length > 0) {
  console.error('Install the project dependencies first:');
  for (const { name } of missing) {
    console.error(`  npm --prefix ${name} ci`);
  }
  process.exit(1);
}

let stopping = false;
const children = services.map(({ name, cwd, command, args }) => {
  console.log(`Starting ${name}...`);
  const child = spawn(process.execPath, [command, ...args], { cwd, stdio: 'inherit' });

  child.on('error', (error) => {
    console.error(`Could not start ${name}: ${error.message}`);
    process.exitCode = 1;
    stopAll();
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${name} stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.`);
    process.exitCode = code ?? 1;
    stopAll();
  });

  return child;
});

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
