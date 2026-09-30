/* 环境变量装载
 *
 * ── 为什么库课需要这个（原来只有环境变量）────────────────────────
 * 原来的约定是「只读环境变量，.env.example 只是给你做记录用的」。
 * 那套约定对 PORT / KUKE_DB 这类配置没问题 —— 用错了当场就炸
 * （端口被占、库路径不对），一眼能看出来。
 *
 * 但**凭据不是这样**。真踩过：
 *
 *   用户把新 key 写进了 .env，本机 ~/.zshrc 里还导出着旧 key。
 *   /api/health 报「已配置、格式合法」，每条消息却 401，
 *   上游原话只有 `your api key: ****b605 is invalid` ——
 *   看上去像 key 失效，完全查不到「用错了哪一把」。
 *
 * 所以规则按「出错了会不会静默」分成两类：
 *
 *   凭据类（*_API_KEY / *_TOKEN / *_SECRET / *_PASSWORD）
 *     → **.env 为准**。用错了不报配置冲突，只报 401，最难查。
 *   其余（PORT / KUKE_DB / KUKE_RATE_LIMIT …）
 *     → 环境变量为准（保持库课原来的约定）。
 *
 * 两边不一致时启动日志**大声说**，并且 /api/health 会回 keySource，
 * 让「用错了哪一把」一眼可见。
 *
 * 想临时换 key 又不想改文件：KUKE_ENV_WINS=1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* server/src/lib → 仓库根 */
const ROOT = path.resolve(__dirname, '../../..');

export const ENV_FILE = process.env.KUKE_ENV_FILE || path.join(ROOT, '.env');

/** 名字看起来是凭据的键。用错了会静默失败，所以要特殊对待。 */
const SECRETISH = /(_API_KEY|_APIKEY|_TOKEN|_SECRET|_PASSWORD|_PASSWD)$/i;

/** 从文件里读到的键（用于判断 key 的来源）。 */
export const FROM_ENV_FILE = new Set();
/** 被 .env 顶掉的环境变量：[{ key, ambient }]。 */
export const SHADOWED = [];

/** 只给本机控制台看：首尾各留几个字符，中间打码。 */
export function mask(v) {
  const s = String(v || '');
  if (s.length <= 10) return '***';
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
}

export function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const forceEnvWins = String(process.env.KUKE_ENV_WINS || '') === '1';

  let raw;
  try { raw = fs.readFileSync(ENV_FILE, 'utf8'); } catch { return; }

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    /* 空值不算「配了」——复制 .env.example 之后不填，
     * 也不该把已有的环境变量顶成空串。 */
    if (!val) continue;

    const ambient = process.env[key];
    const fileWins = SECRETISH.test(key) && !forceEnvWins;

    if (fileWins) {
      if (ambient !== undefined && ambient !== '' && ambient !== val) {
        SHADOWED.push({ key, ambient });
      }
      process.env[key] = val;
      FROM_ENV_FILE.add(key);
    } else if (ambient === undefined || ambient === '') {
      process.env[key] = val;
      FROM_ENV_FILE.add(key);
    }
  }
}

loadEnv();

/** 这个键的值是从 .env 来的吗。 */
export function fromEnvFile(key) {
  return FROM_ENV_FILE.has(key);
}

/** 启动时打印遮蔽警告。**必须大声说**，静默用错 key 是最难查的一类问题。 */
export function warnShadowed(log = console.log) {
  for (const s of SHADOWED) {
    log(`⚠️  环境变量里的 ${s.key}（${mask(s.ambient)}）被 .env 里的值顶掉了。`);
    log('    当前用的是 .env 里那一把。想用环境变量那把，就加 KUKE_ENV_WINS=1 再启动。');
  }
  if (SHADOWED.length) log(`    来源文件：${ENV_FILE}`);
}
