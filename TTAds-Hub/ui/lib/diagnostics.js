// Диагностический пакет без секретов: что происходило в расширении, без cookies, токенов, карт и полных ID.
// Нужен разработчику, когда TikTok меняет интерфейс или внутренние запросы (см. docs/research-2026-10-28/…HANDOFF).
import * as bus from './bus.js';
import { VERSION } from '../../background/lib/constants.js';
import { healthOf, countFlags } from '../../background/health/model.js';

const maskIds = (text) => String(text ?? '').replace(/\d{8,}/g, (match) => `…${match.slice(-4)}`);
const maskDeep = (value, depth = 0) => {
  if (depth > 8) return null;
  if (typeof value === 'string') return maskIds(value).slice(0, 400);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => maskDeep(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [maskIds(key), maskDeep(item, depth + 1)]));
  return value;
};

const pickJob = (job, fields) => (job ? maskDeep(Object.fromEntries(fields.map((field) => [field, job[field]]).filter(([, value]) => value !== undefined))) : null);

export async function buildDiagnostics(ctx) {
  const [journal, objects, health, accounts, pipeline, shareJob, accessJob, monitor] = await Promise.all([
    bus.journal.get().catch(() => []), bus.objects.diagnostics().catch((error) => ({ error: error.message })), bus.health.cached().catch(() => null),
    bus.accounts.cached().catch(() => null), bus.pipeline.status().catch(() => null), bus.share.status().catch(() => null), bus.access.status().catch(() => null), bus.monitor.status().catch(() => null)
  ]);
  const list = accounts?.accounts || [];
  const entries = health?.accounts || {};
  const healths = list.map((account) => healthOf(account, entries[account.id] ?? null));
  const settings = ctx.settings || {};
  return {
    kind: 'ttads-hub-diagnostics', generatedAt: new Date().toISOString(), version: VERSION, chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] || '',
    settings: {
      monitor: settings.monitor, health: settings.health, overview: settings.overview,
      automation: { mode: settings.automation?.mode, count: settings.automation?.count, linkPortfolio: settings.automation?.linkPortfolio, share: { enabled: settings.automation?.share?.enabled, permission: settings.automation?.share?.permission, targets: settings.automation?.share?.targets?.length || 0 }, transfer: { enabled: settings.automation?.transfer?.enabled }, presets: settings.automation?.presets?.length || 0 }
    },
    journal: (journal || []).slice(-80).map((entry) => ({ t: new Date(entry.t).toISOString(), level: entry.level, src: entry.src, msg: maskIds(entry.msg) })),
    objects: maskDeep(objects),
    health: {
      accounts: list.length, checked: countFlags(healths),
      errors: [...new Set(healths.map((item) => item.error).filter(Boolean))].map(maskIds).slice(0, 10),
      businessCenters: Object.values(health?.bcs || {}).map((bc) => ({ ok: bc.ok, source: bc.source, paymentTimeout: bc.paymentTimeout, financeAccessRequired: bc.financeAccessRequired, error: maskIds(bc.error), count: bc.count }))
    },
    jobs: {
      pipeline: pickJob(pipeline, ['state', 'stopReason', 'plan', 'items']),
      share: pickJob(shareJob, ['state', 'error', 'warnings', 'results']),
      access: pickJob(accessJob, ['type', 'state', 'error', 'results'])
    },
    monitor: monitor?.state ? { at: monitor.state.at, ok: monitor.state.ok, error: maskIds(monitor.state.error), problems: monitor.state.problems?.length || 0 } : null
  };
}
