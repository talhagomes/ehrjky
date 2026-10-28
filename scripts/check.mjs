// Проверка без браузера: синтаксис всех JS-файлов расширения и связывание ES-модулей (имена импортов/экспортов).
// chrome.* и DOM подменяются заглушками — код верхнего уровня модулей только регистрирует слушателей.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../TTAds-Hub/', import.meta.url).pathname;
const files = [];
const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
walk(ROOT);

let failed = 0;
for (const file of files) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (error) { failed += 1; console.error(`SYNTAX ${relative(ROOT, file)}\n${String(error.stderr || error.message).trim()}`); }
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

const modules = files.filter((f) => !/\/content\//.test(f) && !/ui\/app\.js$/.test(f));
for (const file of modules) {
  try { await import(pathToFileURL(file).href); }
  catch (error) { failed += 1; console.error(`IMPORT ${relative(ROOT, file)}: ${error.message}`); }
}
console.log(`${files.length} файлов, модулей связано: ${modules.length}, ошибок: ${failed}`);
process.exit(failed ? 1 : 0);
