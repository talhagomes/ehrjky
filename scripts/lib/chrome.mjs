// Поиск Chrome/Chromium для браузерных проверок: переменная CHROME или стандартные пути Windows, Linux, macOS.
import fs from 'node:fs';

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/local/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

export function findChrome() {
  const found = [process.env.CHROME, ...CANDIDATES].find((path) => path && fs.existsSync(path));
  if (!found) throw new Error('Не найден Chrome/Chromium. Укажите путь к нему в переменной окружения CHROME.');
  return found;
}
