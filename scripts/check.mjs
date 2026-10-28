// Проверка без браузера: синтаксис JS, валидность JSON, связывание ES-модулей, соответствие вызовов UI обработчикам
// service worker и неизменность набора разрешений manifest. chrome.* и DOM подменяются заглушками —
// код верхнего уровня модулей только регистрирует слушателей.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../TTAds-Hub/', import.meta.url));
const rel = (file) => relative(ROOT, file).split(sep).join('/');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path); else files.push(path);
  }
};
walk(ROOT);
const js = files.filter((file) => file.endsWith('.js'));
const json = files.filter((file) => file.endsWith('.json'));

let failed = 0;
const fail = (message) => { failed += 1; console.error(message); };

for (const file of js) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { fail(`SYNTAX ${rel(file)}\n${String(error.stderr || error.message).trim()}`); }
}
for (const file of json) {
  try { JSON.parse(readFileSync(file, 'utf8')); } catch (error) { fail(`JSON ${rel(file)}: ${error.message}`); }
}

// Любое неизвестное свойство chrome.* — вызываемая заглушка, возвращающая Promise (addListener — пустая функция).
const deep = () => new Proxy(function stub() {}, {
  get: (target, key) => (key === 'then' ? undefined : deep()),
  apply: () => Promise.resolve(undefined)
});
const overrides = {
  runtime: { id: 'test', getManifest: () => ({ version: 'test' }), getURL: (p) => `chrome-extension://test/${p}` },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } }
};
const merge = (base) => new Proxy(base, { get: (target, key) => (key in target ? (typeof target[key] === 'object' && target[key] ? merge(target[key]) : target[key]) : deep()) });
globalThis.chrome = merge(overrides);
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });

const modules = js.filter((file) => !rel(file).startsWith('content/') && rel(file) !== 'ui/app.js');
for (const file of modules) {
  try { await import(pathToFileURL(file).href); }
  catch (error) { fail(`IMPORT ${rel(file)}: ${error.message}`); }
}

// Каждый вызов call('раздел', 'действие') в интерфейсе должен иметь обработчик 'раздел.действие' в service worker.
const worker = readFileSync(join(ROOT, 'background', 'service-worker.js'), 'utf8');
const handlers = new Set([...worker.matchAll(/['"]([\w-]+\.[\w-]+)['"]\s*:/g)].map((match) => match[1]));
const calls = new Map();
for (const file of js.filter((f) => rel(f).startsWith('ui/'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\bcall\(\s*['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]/g)) calls.set(`${match[1]}.${match[2]}`, rel(file));
}
for (const [call, file] of calls) if (!handlers.has(call)) fail(`RPC ${file}: в service worker нет обработчика ${call}`);

// Набор разрешений не должен расширяться случайно: любое изменение — осознанное решение с правкой этого списка.
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const same = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
if (!same(manifest.permissions || [], ['storage', 'tabs', 'scripting', 'webRequest', 'alarms'])) fail(`MANIFEST permissions изменились: ${manifest.permissions}`);
if (!same(manifest.host_permissions || [], ['https://ads.tiktok.com/*', 'https://business.tiktok.com/*', 'https://business-api.tiktok.com/*'])) fail(`MANIFEST host_permissions изменились: ${manifest.host_permissions}`);
if (!same(manifest.optional_permissions || [], ['notifications'])) fail(`MANIFEST optional_permissions изменились: ${manifest.optional_permissions}`);

console.log(`JS: ${js.length}, JSON: ${json.length}, модулей связано: ${modules.length}, RPC: ${calls.size} вызовов / ${handlers.size} обработчиков, ошибок: ${failed}`);
process.exit(failed ? 1 : 0);
