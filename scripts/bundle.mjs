import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const destination = 'apps/desktop/src-tauri/runtime';
mkdirSync(destination, { recursive: true });
await build({
  entryPoints: ['packages/core/src/desktop.ts'],
  outfile: destination + '/desktop.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: 'import { createRequire as runtimeRequire } from "node:module"; const require = runtimeRequire(import.meta.url);' },
});
copyFileSync('templates/da/retter.json', destination + '/retter.json');
for (const file of ['0001_init.sql', '0002_meal_plan.sql']) {
  copyFileSync('packages/core/migrations/' + file, destination + '/' + file);
}
copyFileSync('node_modules/better-sqlite3/prebuilds/' + process.platform + '-' + process.arch + '.node', destination + '/better_sqlite3.node');
if (process.platform === 'win32') {
  copyFileSync(process.execPath, destination + '/node.exe');
  if (process.argv.includes('--installer')) {
    execFileSync('pnpm.cmd', ['exec', 'tauri', 'build'], { cwd: 'apps/desktop', stdio: 'inherit', shell: true });
  }
}
