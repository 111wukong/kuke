/* SQL 执行池
 *
 * 维护 N 个常驻 worker，任务排队。超时就 terminate 掉那个 worker 并补一个新的。
 *
 * ── 为什么是池而不是「一次任务一个 worker」─────────────────────────
 * worker 启动时要 require better-sqlite3（原生模块，约 40–90ms）。
 * 学生按 Ctrl+Enter 的体感预算是 100ms 级，每次现起一个 worker 就吃掉一半。
 * 常驻池把这份开销压到进程启动时一次性付出。
 *
 * ── 为什么超时必须换掉 worker 而不是继续用 ────────────────────────
 * terminate 是强杀：worker 可能死在任意一行，它那份内存库的状态不可信。
 * 复用一个刚被强杀的 worker，下一题可能读到上一题的残留表。
 * 所以 terminate 之后一律销毁重建 —— 成本 50ms，换的是「不会串题」。
 */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.resolve(__dirname, '../workers/sqlWorker.js');

const DEFAULT_TIMEOUT = 4000;   // 单次执行上限。教学库上是几百行的量级，4 秒已经很宽裕
const QUEUE_LIMIT = 200;        // 排队上限，防止有人刷接口把内存堆爆

class SqlPool {
  constructor(size = Math.max(2, Math.min(4, os.cpus().length - 1))) {
    this.size = size;
    this.workers = [];
    this.queue = [];
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, timer, worker }
  }

  _spawn() {
    const w = new Worker(WORKER_PATH);
    w.busy = false;
    w.on('message', (msg) => this._settle(w, msg));
    w.on('error', (err) => this._fail(w, err));
    w.on('exit', (code) => {
      if (code !== 0 && this.pending.size) this._fail(w, new Error(`worker 异常退出（code ${code}）`));
    });
    this.workers.push(w);
    return w;
  }

  init() {
    for (let i = 0; i < this.size; i++) this._spawn();
    return this;
  }

  /** 杀掉一个 worker 并补一个新的（超时 / 崩溃后调用）。 */
  _replace(w) {
    const i = this.workers.indexOf(w);
    if (i >= 0) this.workers.splice(i, 1);
    w.removeAllListeners();
    w.terminate().catch(() => {});
    if (this.workers.length < this.size) this._spawn();
  }

  _settle(w, msg) {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    w.busy = false;
    entry.resolve(msg.payload);
    this._drain();
  }

  _fail(w, err) {
    // 该 worker 上所有在飞的任务一起失败
    for (const [id, entry] of this.pending) {
      if (entry.worker !== w) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({ ok: false, phase: 'worker', error: `执行器异常：${err.message}`, ms: 0 });
    }
    this._replace(w);
    this._drain();
  }

  _drain() {
    if (!this.queue.length) return;
    const free = this.workers.find((w) => !w.busy);
    if (!free) return;
    const { task, resolve, timeout } = this.queue.shift();
    this._dispatch(free, task, resolve, timeout);
  }

  _dispatch(w, task, resolve, timeout) {
    const id = ++this.seq;
    w.busy = true;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      resolve({
        ok: false,
        phase: 'timeout',
        error: `执行超过 ${timeout} 毫秒被中断。多半是连接条件写漏了，产生了笛卡尔积 —— 检查 JOIN / WHERE 里的关联字段。`,
        ms: timeout,
      });
      this._replace(w);
      this._drain();
    }, timeout);
    this.pending.set(id, { resolve, timer, worker: w });
    w.postMessage({ id, task });
  }

  run(task, { timeout = DEFAULT_TIMEOUT } = {}) {
    if (this.queue.length >= QUEUE_LIMIT) {
      return Promise.resolve({ ok: false, phase: 'overload', error: '服务器繁忙，请稍后再试', ms: 0 });
    }
    return new Promise((resolve) => {
      const free = this.workers.find((w) => !w.busy);
      if (free) this._dispatch(free, task, resolve, timeout);
      else this.queue.push({ task, resolve, timeout });
    });
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate().catch(() => {})));
    this.workers = [];
  }
}

export const sqlPool = new SqlPool().init();
export { SqlPool, DEFAULT_TIMEOUT };
