/* 参考答案结果缓存
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * 判题路径 ①（结果集比对）每次提交要跑**两遍** worker：
 * 一遍学生 SQL，一遍参考答案。
 *
 * 而参考答案的输入是彻底固定的 ——
 *   dataset.ddl + dataset.seed + level.reference_sql + allowWrite
 * 输出也完全确定（教学库没有任何随机性）。
 * 也就是说：300 个学生做同一道题 = 把同一个结果算 300 遍。
 * 在 worker 池只有 2~4 个线程的前提下，这等于把判题吞吐直接砍半。
 *
 * ── 键为什么用内容哈希而不是关卡 id ─────────────────────────────
 * 老师改了题、换了数据集，内容哈希自然就变了 ——
 * 不需要任何显式失效逻辑，也不会读到旧结果。
 * 这正是内容寻址相对「按 id 缓存」的好处：少一套失效机制，
 * 就少一类「题改了但学生还在拿旧答案判分」的静默 bug。
 * （sql_levels 表里没有 updated_at，靠时间戳失效本来也做不到。）
 *
 * ── 只缓存成功的 ────────────────────────────────────────────────
 * 参考答案本身跑挂（phase 是 internal / worker / timeout）时不缓存。
 * 那种情况下每次重算反而是对的：老师改完配置，下一个学生提交就生效，
 * 不用等缓存过期或重启服务。
 */
import crypto from 'node:crypto';

/* 45 个关卡 × 4 个数据集，实际条目数远小于这个上限。
 * 留 512 只是为了将来题库变大时不至于频繁淘汰。 */
const MAX_ENTRIES = 512;

/** key -> worker 返回的 payload */
const cache = new Map();

/** 命中率统计，给 /api/health 或管理台看。 */
export const refCacheStats = { hit: 0, miss: 0, evict: 0 };

/** 任务内容 → 缓存键。四个字段任一变化都会产生新键。 */
export function refCacheKey({ ddl = '', seed = '', sql = '', allowWrite = false }) {
  return crypto.createHash('sha256')
    .update(ddl).update('\u0000')
    .update(seed).update('\u0000')
    .update(sql).update('\u0000')
    .update(allowWrite ? '1' : '0')
    .digest('hex')
    .slice(0, 32);
}

/**
 * 取参考答案结果。未命中时用 compute() 现算，成功则写入缓存。
 *
 * compute 是「真的去跑一遍」的回调 —— 传函数而不是任务对象，
 * 是为了让调用方决定用哪个池、超时多久，这个模块不掺和。
 */
export async function cachedReference(key, compute) {
  const hit = cache.get(key);
  if (hit !== undefined) {
    refCacheStats.hit++;
    // LRU：命中后挪到末尾（Map 保证插入顺序）
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  refCacheStats.miss++;
  const res = await compute();

  /* 只缓存「跑通了」的结果。
   * phase === 'done' 表示 SQL 执行完且没有残留错误。
   * timeout / internal / worker 三类都不缓存 —— 见文件头。 */
  if (res && res.ok && res.phase === 'done') {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      refCacheStats.evict++;
    }
    cache.set(key, res);
  }
  return res;
}

/** 清空。管理员改题后可以手动调（虽然内容哈希已经能自愈）。 */
export function clearRefCache() {
  const n = cache.size;
  cache.clear();
  return n;
}

export function refCacheSize() {
  return cache.size;
}
