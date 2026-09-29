/* 数据库路径
 *
 * 优先级：KUKE_DB 环境变量 > 默认路径。
 *
 * 默认落在 server/data/kuke.db。测试要用一次性库，就靠 KUKE_DB 指到临时目录 ——
 * 这样测试跑完不会污染真实数据。isTempDbPath 是给测试用的安全闸门：
 * 那些会「清库 / 重建」的脚本必须先过这一关，防止有人手滑对着真实库跑。
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveDbPath() {
  const fromEnv = (process.env.KUKE_DB || '').trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, '../../data/kuke.db');
}

/** 判断一个路径是不是「临时库」。用于测试脚本的自保。 */
export function isTempDbPath(p) {
  const abs = path.resolve(p || '');
  const tmp = os.tmpdir();
  return abs.startsWith(tmp) || abs.includes('kuke-test-') || abs.includes('/tmp/');
}
