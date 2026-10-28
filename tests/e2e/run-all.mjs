// Запускает все сквозные сценарии по очереди (каждый — отдельный браузер) и печатает итог.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenarios = ['overview-health', 'auto-health', 'objects-bulk', 'objects-learn-edge', 'objects-reliability', 'manual-flows'];
const only = process.argv.slice(2);
const summary = [];
for (const name of scenarios.filter((item) => !only.length || only.includes(item))) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(here, `${name}.mjs`)], { stdio: 'inherit' });
  summary.push([name, run.status === 0, Math.round((Date.now() - started) / 1000)]);
}
console.log(`\n${summary.map(([name, ok, seconds]) => `${ok ? 'PASS' : 'FAIL'} ${name} (${seconds} с)`).join('\n')}`);
process.exitCode = summary.every(([, ok]) => ok) ? 0 : 1;
