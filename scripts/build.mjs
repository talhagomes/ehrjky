// Собирает zip с проектом: расширение (папка TTAds-Hub, manifest.json внутри) и инструменты проверки.
// Работает на Windows, macOS и Linux без внешних утилит. Перед сборкой — проверка модулей.
// Не попадают: node_modules, dist, test-output, служебные папки git и платформы.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from '../TTAds-Hub/background/s2s/zip.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, [resolve(root, 'scripts', 'check.mjs')], { stdio: 'inherit' });

const SKIP = new Set(['node_modules', 'dist', 'test-output', '.git', '.hoplite', '.DS_Store']);
const INCLUDE = ['TTAds-Hub', 'scripts', 'tests', 'package.json', 'package-lock.json', 'README-DEV.md', '.gitignore'];
const entries = [];
const walk = (path) => {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info) return;
  if (info.isDirectory()) { for (const name of readdirSync(path).sort()) if (!SKIP.has(name)) walk(join(path, name)); }
  else entries.push({ name: relative(root, path).split(sep).join('/'), data: readFileSync(path) });
};
for (const item of INCLUDE) walk(join(root, item));

const { version } = JSON.parse(readFileSync(resolve(root, 'TTAds-Hub', 'manifest.json'), 'utf8'));
const out = resolve(root, 'dist', `TTAds-Hub-${version}-complete-${new Date().toISOString().slice(0, 10)}.zip`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(out, buildZip(entries));
console.log(`${out} (${entries.length} файлов)`);
