/* 配置读取
 *
 * 两层：
 *   app_settings      整套服务一份（老师配的全局 AI 配置）
 *   user_ai_settings  每人一份（个人覆盖）
 *
 * ══════════════════════════════════════════════════════════════
 * AI 配置的解析规则（这是这个模块的核心，别改错）
 * ══════════════════════════════════════════════════════════════
 *
 *   ┌ 自己配了 key ─────────────→ 用自己配的
 *   ├ 没配，且是老师建的账号 ───→ 用老师配的全局配置
 *   ├ 没配，且是自助注册的 ─────→ 没有可用配置（提示去配）
 *   └ 全局也没有 ───────────────→ 环境变量兜底
 *
 * ── 为什么「自助注册的学生」不继承全局配置 ──────────────────────
 * 全局配置用的是老师自己的 API Key，那是老师花钱买的额度。
 *   老师批量建号（created_by 有值）=「我请的学生，额度我出」
 *   陌生人自己注册进来 = 不该自动继承老师的额度
 * 后者不是功能，是漏算。
 *
 * 区分依据是 users.created_by —— 老师建号时写入教师 id，
 * 自助注册时留空。这个字段本来就存在（权限模型在用），不用新增。
 *
 * ── 优先级为什么是「数据库 > 环境变量」──────────────────────────
 * 环境变量是「部署时的默认值」，界面上的设置是「使用者当下想要的」。
 * 后者应该覆盖前者。
 * 界面上清空某项 = 落回环境变量 —— 这样「恢复默认」不用单独做功能。
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
   个人配置
   ══════════════════════════════════════════════════════════════ */

const AI_FIELDS = ['apiKey', 'baseUrl', 'model', 'timeout'];
const col = (f) => `ai.${f}`;

function loadUser(userId) {
  const rows = db.prepare('SELECT key, value FROM user_ai_settings WHERE user_id = ?').all(userId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setUserSetting(userId, key, value) {
  db.prepare(`
    INSERT INTO user_ai_settings (user_id, key, value, updated_at) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(userId, key, String(value ?? ''));
}

/** 这个人有没有自己配过 key（用来区分「用自己配的」和「用全局的」）。 */
export function userHasOwnAi(userId) {
  if (!userId) return false;
  const r = db.prepare(
    "SELECT COUNT(*) n FROM user_ai_settings WHERE user_id = ? AND key = 'ai.apiKey' AND value <> ''"
  ).get(userId);
  return r.n > 0;
}

/* ══════════════════════════════════════════════════════════════
   解析：这个人该用哪套配置
   ══════════════════════════════════════════════════════════════ */

function envDefaults() {
  return {
    apiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
    baseUrl: (process.env.DEEPSEEK_BASE || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    timeout: Number(process.env.DEEPSEEK_TIMEOUT) || 60000,
  };
}

/**
 * 这个账号能不能用全局配置。
 *
 * 能用的两种：
 *   · 教师 / 管理员本人
 *   · 由教师创建的账号（users.created_by 有值）
 * 不能用：自助注册的账号（created_by 为空）。
 */
export function canUseGlobalAi(userId) {
  if (!userId) return true;                    // 无用户上下文（系统内部调用）→ 允许
  const u = db.prepare('SELECT role, created_by FROM users WHERE id = ?').get(userId);
  if (!u) return true;
  if (u.role === 'teacher' || u.role === 'admin') return true;
  return u.created_by != null;
}

/** 这个人的账号是怎么来的（给界面显示说明用）。 */
export function accountOrigin(userId) {
  if (!userId) return 'system';
  const u = db.prepare('SELECT role, created_by FROM users WHERE id = ?').get(userId);
  if (!u) return 'system';
  if (u.role === 'teacher' || u.role === 'admin') return 'staff';
  return u.created_by != null ? 'teacher-created' : 'self-registered';
}

const clampTimeout = (t, fallback) => {
  const n = Number(t) || fallback;
  /* 兜底上下限：填 0 或负数会把请求变成「立刻超时」，
   * 而报错只会说「超时」，查不到是配置的问题。 */
  return Math.min(Math.max(n, 5000), 600000);
};

/**
 * 解析出某个用户实际生效的 AI 配置。
 *
 * 返回里带 `source` 和 `blocked`，让上层能给出对症的提示 ——
 * 「没配」和「配错了」是两件事，处理方式完全不同。
 */
export function resolveAiConfig(userId = null) {
  const d = envDefaults();

  /* ① 自己配了 → 用自己配的（没填的字段回落到全局/环境变量） */
  if (userId && userHasOwnAi(userId)) {
    const own = loadUser(userId);
    return {
      apiKey: own[col('apiKey')] || '',
      baseUrl: (own[col('baseUrl')] || getSetting('ai.baseUrl', d.baseUrl)).replace(/\/+$/, ''),
      model: own[col('model')] || getSetting('ai.model', d.model),
      timeout: clampTimeout(own[col('timeout')] || getSetting('ai.timeout', ''), d.timeout),
      source: 'personal',
      blocked: false,
    };
  }

  /* ② 没配，且不允许用全局 → 拦住，让界面提示去配 */
  if (userId && !canUseGlobalAi(userId)) {
    return {
      apiKey: '', baseUrl: d.baseUrl, model: d.model, timeout: d.timeout,
      source: 'none',
      blocked: true,
      reason: 'self-registered-no-key',
    };
  }

  /* ③ 用全局（老师建的账号 / 老师本人 / 系统内部调用） */
  const gKey = getSetting('ai.apiKey', d.apiKey);
  return {
    apiKey: gKey,
    baseUrl: getSetting('ai.baseUrl', d.baseUrl).replace(/\/+$/, ''),
    model: getSetting('ai.model', d.model),
    timeout: clampTimeout(getSetting('ai.timeout', ''), d.timeout),
    source: gKey ? (getSetting('ai.apiKey', '') ? 'global' : 'env') : 'none',
    blocked: !gKey,
    reason: gKey ? undefined : 'no-global-key',
  };
}

/** 不传 userId 就是全局视角（系统内部调用、健康检查）。 */
export function aiConfig(userId = null) {
  return resolveAiConfig(userId);
}

/* ══════════════════════════════════════════════════════════════
   打码与对外视图
   ══════════════════════════════════════════════════════════════ */

/** 前 4 后 4，中间用**固定长度**星号 ——
 *  不用真实长度：那会泄漏密钥长度，虽然价值不高，但没理由白送。 */
export function maskKey(k) {
  const s = String(k || '');
  if (!s) return '';
  if (s.length <= 12) return '*'.repeat(8);
  return `${s.slice(0, 4)}${'*'.repeat(8)}${s.slice(-4)}`;
}

/**
 * 给前端的配置视图。
 *
 * 包含四样东西，缺一不可：
 *   1. 当前生效的值（key 打码）
 *   2. 生效来源（personal / global / env / none）
 *   3. 这个账号的来历与权限 —— 界面靠它决定显示哪种表单和哪段说明
 *   4. 全局配置的状态（教师需要看到自己配的那套长什么样）
 */
export function aiConfigPublic(userId = null) {
  const c = resolveAiConfig(userId);
  const origin = accountOrigin(userId);
  const hasOwn = userId ? userHasOwnAi(userId) : false;

  return {
    baseUrl: c.baseUrl,
    model: c.model,
    timeout: c.timeout,
    hasKey: !!c.apiKey,
    keyMasked: maskKey(c.apiKey),
    effectiveSource: c.source,
    blocked: c.blocked,
    blockedReason: c.reason || null,

    accountOrigin: origin,
    canUseGlobal: canUseGlobalAi(userId),
    hasOwnConfig: hasOwn,
    isStaff: origin === 'staff',

    global: globalPublic(),
    personal: hasOwn ? personalPublic(userId) : undefined,
  };
}

function globalPublic() {
  const d = envDefaults();
  const key = getSetting('ai.apiKey', d.apiKey);
  return {
    baseUrl: getSetting('ai.baseUrl', d.baseUrl).replace(/\/+$/, ''),
    model: getSetting('ai.model', d.model),
    timeout: clampTimeout(getSetting('ai.timeout', ''), d.timeout),
    hasKey: !!key,
    keyMasked: maskKey(key),
    customized: aiConfigIsCustom(),
    sources: {
      apiKey: getSetting('ai.apiKey', '') ? 'database' : (d.apiKey ? 'env' : 'none'),
      baseUrl: getSetting('ai.baseUrl', '') ? 'database' : 'env',
      model: getSetting('ai.model', '') ? 'database' : 'env',
      timeout: getSetting('ai.timeout', '') ? 'database' : 'env',
    },
  };
}

function personalPublic(userId) {
  const own = loadUser(userId);
  const key = own[col('apiKey')] || '';
  return {
    baseUrl: own[col('baseUrl')] || '',
    model: own[col('model')] || '',
    timeout: own[col('timeout')] || '',
    hasKey: !!key,
    keyMasked: maskKey(key),
  };
}

/* ══════════════════════════════════════════════════════════════
   保存
   ══════════════════════════════════════════════════════════════ */

/** 保存全局配置（教师/管理员）。传空串 = 清除该项，落回环境变量。 */
export function saveAiConfig(patch, userId = null) {
  const map = { apiKey: 'ai.apiKey', baseUrl: 'ai.baseUrl', model: 'ai.model', timeout: 'ai.timeout' };
  const changed = [];
  for (const [field, key] of Object.entries(map)) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (v === undefined) continue;
    setSetting(key, v === null ? '' : String(v).trim(), userId);
    changed.push(field);
  }
  invalidateAppSettings();
  return changed;
}

/** 保存个人配置。传空串 = 清除该项（回落到全局）。 */
export function saveUserAiConfig(userId, patch) {
  const changed = [];
  for (const field of AI_FIELDS) {
    if (!(field in patch)) continue;
    const v = patch[field];
    if (v === undefined) continue;
    setUserSetting(userId, col(field), v === null ? '' : String(v).trim());
    changed.push(field);
  }
  return changed;
}

/** 数据库里有没有存过全局配置。 */
export function aiConfigIsCustom() {
  const row = db.prepare(
    "SELECT COUNT(*) n FROM app_settings WHERE key LIKE 'ai.%' AND value <> ''"
  ).get();
  return row.n > 0;
}
