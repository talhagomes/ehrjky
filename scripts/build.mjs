// Собирает zip для установки: папка TTAds-Hub целиком (manifest.json внутри). Перед сборкой — проверка модулей.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
execFileSync(process.execPath, [resolve(root, 'scripts/check.mjs')], { stdio: 'inherit' });
const { version } = JSON.parse(readFileSync(resolve(root, 'TTAds-Hub/manifest.json'), 'utf8'));
const out = resolve(root, 'dist', `TTAds-Hub-${version}-complete-${new Date().toISOString().slice(0, 10)}.zip`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-q', out, 'TTAds-Hub', '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(out);
