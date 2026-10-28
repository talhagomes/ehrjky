// Обмен сообщениями интерфейс → сервис-воркер.
export async function call(ns, type, payload = {}) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ ns, type, ...payload });
  } catch {
    throw new Error('Фоновый процесс расширения недоступен. Перезагрузите расширение в chrome://extensions.');
  }
  if (!response) throw new Error('Нет ответа от расширения. Повторите действие.');
  if (!response.ok) {
    const error = new Error(response.error || 'Неизвестная ошибка');
    error.code = response.code;
    throw error;
  }
  return response.data;
}

export const manual = {
  status: (tabId) => call('manual', 'status', { tabId }),
  activate: (tabId, account) => call('manual', 'activate', { tabId, account }),
  timezone: (tabId) => call('manual', 'timezone', { tabId }),
  cancel: (tabId) => call('manual', 'cancel', { tabId }),
  interceptor: (tabId, enabled) => call('manual', 'interceptor', { tabId, enabled })
};

export const overview = {
  scan: (tabId, { period = '7d', force = false } = {}) => call('overview', 'scan', { tabId, period, force }),
  cached: () => call('overview', 'cached')
};

export const accounts = {
  list: (tabId, force = false) => call('accounts', 'list', { tabId, force }),
  cached: () => call('accounts', 'cached')
};

export const explorer = { load: (tabId, account, level, period) => call('explorer', 'load', { tabId, account, level, period }) };

export const monitor = { status: () => call('monitor', 'status'), run: (tabId) => call('monitor', 'run', { tabId }) };

export const billing = {
  inspect: (tabId, accountId) => call('billing', 'inspect', { tabId, accountId }),
  probe: (accountId, bcId = '') => call('billing', 'probe', { accountId, bcId }),
  open: (accountId, bcId = '') => call('billing', 'open', { accountId, bcId }),
  start: (accountId, bcId = '') => call('billing', 'start', { accountId, bcId })
};

export const creation = {
  start: (input) => call('creation', 'start', { input }),
  quick: () => call('creation', 'quick'),
  prepare: (input) => call('creation', 'prepare', { input }),
  status: () => call('creation', 'status'),
  openLast: () => call('creation', 'openLast'),
  confirmPayment: () => call('creation', 'confirmPayment')
};

export const pipeline = {
  start: (input) => call('pipeline', 'start', { input }),
  status: () => call('pipeline', 'status'),
  cancel: () => call('pipeline', 'cancel'),
  resume: () => call('pipeline', 'resume'),
  openTab: (index) => call('pipeline', 'openTab', { index })
};

export const share = {
  start: (input) => call('share', 'start', { input }),
  status: () => call('share', 'status'),
  resume: () => call('share', 'resume'),
  openLast: () => call('share', 'openLast')
};

export const registry = {
  list: () => call('registry', 'list'),
  remove: (ids) => call('registry', 'remove', { ids }),
  clear: () => call('registry', 'clear')
};

// Живые обновления задач: сервис-воркер пишет прогресс в storage, интерфейс просто слушает изменения.
export function watch(keys, listener) {
  const wanted = new Set(keys);
  const handler = (changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) if (wanted.has(key)) listener(key, changes[key].newValue ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export const access = {
  inspect: (businessCenterId) => call('access', 'inspect', { businessCenterId }),
  request: (input) => call('access', 'request', { input }),
  transfer: (input) => call('access', 'transfer', { input }),
  linkPortfolio: (input) => call('access', 'linkPortfolio', { input }),
  batch: (input) => call('access', 'batch', { input }),
  status: () => call('access', 'status'),
  openLast: () => call('access', 'openLast')
};

export const context = { get: () => call('context', 'get') };

export const objects = {
  status: () => call('objects', 'status'),
  learnStart: (input) => call('objects', 'learnStart', { input }),
  learnStop: () => call('objects', 'learnStop'),
  plan: (input) => call('objects', 'plan', { input }),
  apply: (input) => call('objects', 'apply', { input }),
  rollback: () => call('objects', 'rollback'),
  cancel: () => call('objects', 'cancel'),
  diagnostics: () => call('objects', 'diagnostics'),
  reset: () => call('objects', 'reset')
};

export const health = {
  start: (input = {}) => call('health', 'start', { input }),
  status: () => call('health', 'status'),
  cancel: () => call('health', 'cancel'),
  cached: () => call('health', 'cached'),
  clear: () => call('health', 'clear')
};

export const appeals = {
  scan: (tabId) => call('appeals', 'scan', { tabId }),
  resolve: (tabId, account, rows) => call('appeals', 'resolve', { tabId, account, rows }),
  start: (payload) => call('appeals', 'start', payload),
  batch: () => call('appeals', 'batch'),
  cancel: () => call('appeals', 'cancel'),
  history: () => call('appeals', 'history'),
  unblock: (jobId) => call('appeals', 'unblock', { jobId }),
  clear: () => call('appeals', 'clear')
};

export const s2s = {
  test: (input) => call('s2s', 'test', { input }),
  pixel: (tabId, options) => call('s2s', 'pixel', { tabId, options })
};

export const journal = { get: () => call('journal', 'get'), clear: () => call('journal', 'clear') };

export const settings = {
  get: () => call('settings', 'get'),
  save: (value) => call('settings', 'save', { settings: value }),
  patch: (patch) => call('settings', 'patch', { patch })
};
