/* 应用级配置
 *
 * 整套服务一份的配置（区别于 user_settings 那种「每人一份」）。
 * 目前只有 AI 模型接入这一组，但做成通用 key-value ——
 * 以后加「站点公告」「是否开放注册」这类全局开关时不用再建表。
 *
 * ── 优先级：数据库 > 环境变量 ────────────────────────────────────
 * 环境变量是「部署时的默认值」，界面上的设置是「使用者当下想要的」。
 * 后者应该覆盖前者。
 *
 * 界面上把某项清空 = 落回环境变量的值。这样「恢复默认」不需要
 * 单独做一个功能，清空就是恢复。
 *
 * ── 缓存 ────────────────────────────────────────────────────────
 * 每次 AI 请求都会读配置，而读库虽然快（better-sqlite3 同步，
 * 亚毫秒），但没必要每轮对话查一次。30 秒 TTL 足够 ——
 * 老师改完配置最多等半分钟生效，而且写入时会主动失效。
 */
import { db } from '../db/index.js';

const CACHE_TTL = 30_000;
let cache = null;
let cacheAt = 0;

/** 主动失效。写入配置后调用。 */
export function invalidateAppSettings() {
  cache = null;
  cacheAt = 0;
}

function loadAll() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL) return cache;
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  cache = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cacheAt = now;
  return cache;
}

export function getSetting(key, fallback = '') {
  const v = loadAll()[key];
  return v === undefined || v === '' ? fallback : v;
}

export function setSetting(key, value, userId = null) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?,?,datetime('now'),?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      updated_at = datetime('now'), updated_by = excluded.updated_by
  `).run(key, String(value ?? ''), userId);
  invalidateAppSettings();
}

/* ══════════════════════════════════════════════════════════════
   AI 模型接入
   ══════════════════════════════════════════════════════════════ */

/** 环境变量里的默认值。界面上清空某项时落回这里。 */
function envDefaults() {
  return {
    apiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
    baseUrl: (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    timeout: Number(process.env.DEEPSEEK_TIMEOUT) || 60000,
  };
}

/**
 * 完整配置（含明文 key）。**只给服务端内部用** ——
 * 任何返回给前端的路径都必须走 aiConfigPublic()。
 */
export function aiConfig() {
  const d = envDefaults();
  const t = Number(getSetting('ai.timeout', '')) || d.timeout;
  return {
    apiKey: getSetting('ai.apiKey', d.apiKey),
    baseUrl: getSetting('ai.baseUrl', d.baseUrl).replace(/\/+$/, ''),
    model: getSetting('ai.model', d.model),
    /* 兜底上下限：界面上填 0 或负数会把请求变成「立刻超时」，
     * 而报错信息只会说「超时」，查不到是配置的问题。 */
    timeout: Math.min(Math.max(t, 5000), 600000),
  };
}

/** API Key 打码。前 4 后 4，中间用固定长度的星号 ——
 *  ★ 用**固定**长度而不是真实长度：真实长度会泄漏密钥长度，
 *    虽然价值不高，但没有理由白送。 */
export function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  if (s.length <= 12) return '*'.repeat(8);
  return `${s.slice(0, 4)}${'*'.repeat(8)}${s.slice(-4)}`;
}

/** 给前端的版本：key 打码，其余原样。 */
export function aiConfigPublic() {
  const c = aiConfig();
  const d = envDefaults();
  return {
    baseUrl: c.baseUrl,
    model: c.model,
    timeout: c.timeout,
    hasKey: !!c.apiKey,
    keyMasked: maskKey(c.apiKey),
    /* 每一项分别说明「这个值是界面上设的还是环境变量给的」——
     * 老师改了没生效时，第一件想确认的就是「到底在用哪一个」。 */
    sources: {
      apiKey: getSetting('ai.apiKey', '') ? 'database' : (d.apiKey ? 'env' : 'none'),
      baseUrl: getSetting('ai.baseUrl', '') ? 'database' : 'env',
      model: getSetting('ai.model', '') ? 'database' : 'env',
      timeout: getSetting('ai.timeout', '') ? 'database' : 'env',
    },
  };
}

/**
 * 保存 AI 配置。
 *
 * 传空字符串 = 清除该项，落回环境变量默认值。
 * apiKey 有个特例：传 `undefined` 表示「不改」，传空串表示「清空」——
 * 因为前端拿到的 key 是打码的，用户不动它时不能把打码串存回去。
 */
export function saveAiConfig(patch, userId = null) {
  const map = {
    apiKey: 'ai.apiKey',
    baseUrl: 'ai.baseUrl',
    model: 'ai.model',
    timeout: 'ai.timeout',
  };
  const changed = [];
  for (const [field, key] of Object.entries(map)) {
    if (!(field in patch)) continue;            // 没传 = 不改
    const v = patch[field];
    if (v === undefined) continue;
    setSetting(key, v === null ? '' : String(v).trim(), userId);
    changed.push(field);
  }
  invalidateAppSettings();
  return changed;
}

/** 数据库里有没有存过（用来区分「界面设过」和「用的是默认」）。 */
export function aiConfigIsCustom() {
  const row = db.prepare(
    "SELECT COUNT(*) n FROM app_settings WHERE key LIKE 'ai.%' AND value <> ''"
  ).get();
  return row.n > 0;
}
