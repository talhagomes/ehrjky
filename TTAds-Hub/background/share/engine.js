// Шаринг РК в другой Business Center через раздел Partners и (по желанию) принятие приглашения получателем.
import { HubError, runInPage, runInPageGuarded } from '../lib/page.js';
import { log } from '../lib/storage.js';
import * as registry from '../lib/registry.js';
import { closeTab, focusTab, keepAlive, navigate, openTab } from '../lib/tabs.js';
import { partnerFlowInPage, showHintInPage } from './page-scripts.js';

const BC = 'https://business.tiktok.com';
const PARTNER_PREFIXES = [`${BC}/manage/company/partner`, `${BC}/manage/partner`];
const PARTNER_PREFIX = PARTNER_PREFIXES[0];
const KEY = 'shareLastJob';
const ID = /^\d{5,30}$/;

export const partnerUrl = (bcId) => `${PARTNER_PREFIX}?org_id=${encodeURIComponent(bcId)}`;

const idList = (values, max) => [...new Set((Array.isArray(values) ? values : String(values ?? '').split(/[^\d]+/))
  .map(String).filter((id) => ID.test(id)))].slice(0, max);

// Принимает либо одну пару «BC → РК», либо groups: [{ sourceBusinessCenterId, accountIds }] для РК из разных BC.
export function normalizeShare(input = {}) {
  const rawGroups = Array.isArray(input.groups) && input.groups.length
    ? input.groups
    : [{ sourceBusinessCenterId: input.sourceBusinessCenterId, accountIds: input.accountIds }];
  const groups = [];
  for (const group of rawGroups.slice(0, 20)) {
    const sourceBusinessCenterId = String(group?.sourceBusinessCenterId || '');
    const accountIds = idList(group?.accountIds, 50);
    if (!ID.test(sourceBusinessCenterId) || !accountIds.length) continue;
    const same = groups.find((item) => item.sourceBusinessCenterId === sourceBusinessCenterId);
    if (same) same.accountIds = [...new Set([...same.accountIds, ...accountIds])].slice(0, 50);
    else groups.push({ sourceBusinessCenterId, accountIds });
  }
  if (!groups.length) throw new HubError('Выберите РК и Business Center, которому они принадлежат.');
  const targets = idList(input.targets ?? input.targetBusinessCenterId, 10);
  if (!targets.length) throw new HubError('Укажите ID Business Center получателя.');
  if (groups.every((group) => targets.every((target) => target === group.sourceBusinessCenterId))) {
    throw new HubError('BC получателя совпадает с BC, которому принадлежат РК.');
  }
  const permission = ['Admin', 'Operator', 'Analyst'].includes(input.permission) ? input.permission : 'Admin';
  return { groups, targets, permission, autoAccept: input.autoAccept !== false };
}

const runFlow = async (tabId, task) => {
  const result = await runInPageGuarded(tabId, partnerFlowInPage, [task], { stayOn: PARTNER_PREFIXES, timeoutMs: 150000 });
  if (result?.lost) return { error: result.navigatedTo ? 'TikTok ушёл со страницы Partners — проверьте вкладку.' : (result.error || 'TikTok не вернул результат.'), step: 'inject', code: result.closed ? 'tab_closed' : undefined, navigatedTo: result.navigatedTo };
  return result;
};

export const hint = (tabId, text) => runInPage(tabId, showHintInPage, [text], 'ISOLATED').catch(() => false);

// Один проход по всем получателям в одной вкладке. Используется кнопкой «Расшарить» и конвейером.
export async function runShare(plan, { tabId: reuseTabId = null, onStep } = {}) {
  const results = [];
  let tabId = reuseTabId;
  let stopped = null;
  for (const [index, target] of plan.targets.entries()) {
    await onStep?.({ phase: 'share', current: index + 1, total: plan.targets.length, target });
    const task = { action: 'share', businessCenterId: plan.sourceBusinessCenterId, targetBusinessCenterId: target, accountIds: plan.accountIds, permission: plan.permission };
    const entry = { targetBusinessCenterId: target };
    try {
      if (tabId) await navigate(tabId, partnerUrl(plan.sourceBusinessCenterId), PARTNER_PREFIXES);
      else tabId = (await openTab(partnerUrl(plan.sourceBusinessCenterId), PARTNER_PREFIXES)).id;
      let share = await runFlow(tabId, task);
      // TikTok не даёт повторно «добавить» существующего партнёра — переходим к шарингу через его строку.
      if (share?.error && share.alreadyPartner && share.mode === 'new-partner') {
        await navigate(tabId, partnerUrl(plan.sourceBusinessCenterId), PARTNER_PREFIXES);
        share = await runFlow(tabId, { ...task, forceExisting: true });
      }
      entry.share = share || { error: 'TikTok не вернул результат.' };
      if (share?.success) {
        await registry.recordShare(share.selected, { targetBusinessCenterId: target, permission: plan.permission, state: share.invited ? 'invited' : 'shared' }, { businessCenterId: plan.sourceBusinessCenterId });
        if (plan.autoAccept && share.acceptanceRequired) {
          await onStep?.({ phase: 'accept', current: index + 1, total: plan.targets.length, target });
          try {
            await navigate(tabId, partnerUrl(target), PARTNER_PREFIXES);
            entry.accept = await runFlow(tabId, { action: 'accept', businessCenterId: target, fromBusinessCenterId: plan.sourceBusinessCenterId });
          } catch (error) {
            entry.accept = { error: String(error?.message || error).slice(0, 300) };
          }
          if (entry.accept?.success) {
            await registry.recordShare(share.selected, { targetBusinessCenterId: target, permission: plan.permission, state: 'accepted' });
          }
        }
      }
    } catch (error) {
      entry.share = { error: String(error?.message || error).slice(0, 300), code: error?.code };
    }
    results.push(entry);
    if (entry.share?.needsUser) { stopped = 'needs-user'; break; }
    if (entry.share?.error && ['login', 'tab_closed'].includes(entry.share.code)) { stopped = 'error'; break; }
  }
  const shared = results.filter((entry) => entry.share?.success);
  const acceptIssues = shared.filter((entry) => plan.autoAccept && entry.share.acceptanceRequired && !entry.accept?.success);
  const state = stopped === 'needs-user' ? 'needs-user'
    : shared.length === plan.targets.length ? (acceptIssues.length ? 'partial' : 'complete')
      : shared.length ? 'partial' : 'error';
  const warnings = acceptIssues.map((entry) => `BC ${entry.targetBusinessCenterId}: ${entry.accept?.hint || entry.accept?.error || 'примите приглашение партнёра вручную'}`);
  for (const entry of results) {
    if (entry.share?.missing?.length) warnings.push(`Не найдены для шаринга: ${entry.share.missing.join(', ')}`);
  }
  return { state, results, warnings, tabId };
}

async function save(job) {
  await chrome.storage.local.set({ [KEY]: job });
  return job;
}

function attentionText(job) {
  const last = job.results?.at(-1);
  return last?.share?.hint || last?.share?.error || job.warnings?.[0] || 'Завершите шаг во вкладке TikTok.';
}

let running = null;

async function execute(job) {
  const plan = job.plan;
  const release = keepAlive();
  try {
    job.results = []; job.warnings = [];
    let tabId = null, stoppedForUser = false;
    for (const [index, group] of plan.groups.entries()) {
      const targets = plan.targets.filter((target) => target !== group.sourceBusinessCenterId);
      if (!targets.length) continue;
      const outcome = await runShare({ ...group, targets, permission: plan.permission, autoAccept: plan.autoAccept }, {
        tabId,
        onStep: (step) => save({ ...job, progress: { ...step, group: index + 1, groups: plan.groups.length, sourceBusinessCenterId: group.sourceBusinessCenterId } })
      });
      tabId = outcome.tabId || tabId;
      job.results.push(...outcome.results.map((entry) => ({ ...entry, sourceBusinessCenterId: group.sourceBusinessCenterId, accountIds: group.accountIds })));
      job.warnings.push(...outcome.warnings);
      if (outcome.state === 'needs-user') { stoppedForUser = true; break; }
    }
    const expected = plan.groups.reduce((sum, group) => sum + plan.targets.filter((target) => target !== group.sourceBusinessCenterId).length, 0);
    const shared = job.results.filter((entry) => entry.share?.success).length;
    job.tabId = tabId;
    job.state = stoppedForUser ? 'needs-user' : shared === expected ? (job.warnings.length ? 'partial' : 'complete') : shared ? 'partial' : 'error';
    job.progress = null;
    job.completedAt = Date.now();
    await save(job);
    if (job.state === 'complete') await closeTab(tabId);
    else if (tabId) { await focusTab(tabId); await hint(tabId, attentionText(job)); }
    const accounts = plan.groups.reduce((sum, group) => sum + group.accountIds.length, 0);
    log(job.state === 'complete' ? 'info' : 'warn', 'share', `Шаринг ${accounts} РК → BC ${plan.targets.join(', ')} (${plan.permission}): ${shared}/${expected}, ${job.state}`);
  } catch (error) {
    job.state = 'error'; job.error = String(error?.message || error).slice(0, 300); job.completedAt = Date.now();
    await save(job);
  } finally {
    release();
  }
  return job;
}

// Возвращает задачу сразу: прогресс идёт в storage, popup можно закрыть.
export async function start(input) {
  if (running) throw new HubError('Шаринг уже выполняется — дождитесь окончания.');
  const plan = normalizeShare(input);
  const job = await save({ id: crypto.randomUUID(), type: 'share', plan, state: 'running', startedAt: Date.now(), results: [] });
  running = execute(job).finally(() => { running = null; });
  return job;
}

export async function status() {
  const job = (await chrome.storage.local.get(KEY))[KEY] ?? null;
  if (job?.state === 'running' && !running) return { ...job, state: 'interrupted' };
  return job;
}

// Повтор после ручного шага (проверка личности и т. п.): заново проходим только неуспешные пары «BC → получатель».
export async function resume() {
  const job = await status();
  if (!job?.plan?.groups) throw new HubError('Нет операции шаринга для продолжения.');
  if (running) throw new HubError('Шаринг уже выполняется.');
  const done = new Set((job.results || []).filter((entry) => entry.share?.success).map((entry) => `${entry.sourceBusinessCenterId}>${entry.targetBusinessCenterId}`));
  const groups = job.plan.groups.filter((group) => job.plan.targets.some((target) => target !== group.sourceBusinessCenterId && !done.has(`${group.sourceBusinessCenterId}>${target}`)));
  if (!groups.length) throw new HubError('Все получатели уже обработаны.');
  return start({ ...job.plan, groups });
}

export async function openLast() {
  const job = await status();
  const tab = job?.tabId ? await chrome.tabs.get(job.tabId).catch(() => null) : null;
  if (!tab) throw new HubError('Вкладка последнего шаринга уже закрыта.');
  await focusTab(tab.id);
  return { ok: true, tabId: tab.id };
}
