/* SQL 实训场
 *
 * ── 布局：左 schema / 中编辑器 / 下结果 ─────────────────────────
 * 这是 SQL 工具的通用布局，学生一看就知道怎么用：
 *   左边是「有哪些表和列」（写查询时的最大障碍是记不住列名）
 *   中间是「写在哪」
 *   下面是「跑出来什么」
 * 三者同屏，不需要切换标签页 —— 切换是打断。
 *
 * ── 一个刻意的设计：数据集切换会清空编辑器 ──────────────────────
 * 因为不同数据集的表完全不同。留着上一条 SQL 只会让学生
 * 跑出一条"表不存在"的错误，然后困惑。清空 + 明确提示更好。
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Database, Play, Table2, History, Clock, AlertTriangle,
} from 'lucide-react';
import { Card, Badge, Button, Empty, Select, Callout, SplitSkeleton } from '@/components/ui/Primitives';
import { SqlEditor } from '@/components/sql/SqlEditor';
import { ResultTable, SchemaBrowser, RunMeta, DdlView } from '@/components/sql/SqlParts';
import { Modal } from '@/components/ui/Modal';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { cn, formatDate } from '@/lib/utils';

interface Dataset {
  id: string; name: string; title: string; description: string; scenario: string;
  tables: { name: string; comment: string; rows: number; columns: any[] }[];
}

interface RunResult {
  ok: boolean;
  /** 失败发生在哪一阶段：guard | dataset | sql | timeout | worker | overload */
  phase?: string;
  error: string;
  warnings: string[];
  ms: number;
  results: any[];
}

export default function SqlLab() {
  const [sp] = useSearchParams();
  const { toast } = useApp();

  const [datasetId, setDatasetId] = useState(sp.get('dataset') || 'school');
  const [sql, setSql] = useState(sp.get('sql') || '-- 试着查一下学生表\nSELECT * FROM student LIMIT 5;');
  const [res, setRes] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [showDdl, setShowDdl] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: dsData, loading: dsLoading } = useAsync<{ datasets: Dataset[] }>(
    'catalog:datasets',
    () => api.get('/api/catalog/datasets'),
    { ttl: 600000 },
  );

  const { data: ddlData } = useAsync<{ ddl: string }>(
    `catalog:dataset:${datasetId}:ddl`,
    () => api.get(`/api/catalog/datasets/${datasetId}/ddl`),
    { ttl: 600000 },
  );

  const { data: history, reload: reloadHistory } = useAsync<{ runs: any[] }>(
    'sql:history',
    () => api.get('/api/sql/history?limit=40'),
    { ttl: 0 },
  );

  const datasets = dsData?.datasets || [];
  const current = useMemo(() => datasets.find((d) => d.id === datasetId), [datasets, datasetId]);

  // URL 里带了 sql 参数（从知识点页"拿去跑"进来的）
  useEffect(() => {
    const s = sp.get('sql');
    if (s) setSql(s);
  }, [sp]);

  const run = async () => {
    if (!sql.trim()) { toast('warn', '先写点 SQL 再运行'); return; }
    setRunning(true);
    try {
      const r = await api.post<RunResult>('/api/sql/run', { datasetId, sql });
      setRes(r);
      reloadHistory();
      if (!r.ok) {
        toast('error', r.phase === 'timeout' ? '执行超时' : '执行出错', r.error);
      } else if (r.warnings?.length) {
        toast('warn', `${r.warnings.length} 条提醒`, r.warnings.join('\n'));
      }
    } catch (e: any) {
      toast('error', '请求失败', e.message);
    } finally {
      setRunning(false);
    }
  };

  const switchDataset = (id: string) => {
    if (id === datasetId) return;
    setDatasetId(id);
    setRes(null);
    // 数据集换了，表结构完全不同，留着旧 SQL 只会报"表不存在"
    setSql(`-- 已切到「${datasets.find((d) => d.id === id)?.title || id}」\n-- 表结构见左侧\nSELECT * FROM ${datasets.find((d) => d.id === id)?.tables[0]?.name || '表名'} LIMIT 5;`);
  };

  const insertText = (text: string) => {
    setSql((v) => (v.endsWith('\n') || !v ? `${v}${text}` : `${v}\n${text}`));
  };

  if (dsLoading && !datasets.length) {
    return <SplitSkeleton mainHeight={320} />;
  }

  return (
    <div className="space-y-3">
      {/* ---------- 顶部：数据集选择 ---------- */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-cyan/30 bg-cyan/10 text-cyan">
              <Database size={16} />
            </span>
            <div>
              <div className="text-[14.5px] font-semibold text-fg">SQL 实训场</div>
              <div className="text-[11px] text-fg-faint">
                写查询、立刻执行、看真实结果。数据是你的私有副本，随便改。
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={datasetId} onChange={(e) => switchDataset(e.target.value)}>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowDdl(true)}>
              <Table2 size={13} />建表语句
            </Button>
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
              <History size={13} />运行历史
            </Button>
          </div>
        </div>

        {current && (
          <div className="mt-3 rounded-lg border border-hairline bg-veil/3 p-3">
            <p className="text-[12.5px] leading-relaxed text-fg-soft">{current.scenario}</p>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        {/* ---------- 左：表结构 ---------- */}
        <div className="space-y-3">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
                <Table2 size={13} className="text-cyan" />
                表结构
              </div>
              <p className="mt-0.5 text-[10.5px] text-fg-faint">
                点表名或列名可以插入到编辑器
              </p>
            </div>
            <div className="max-h-[calc(100dvh-320px)] overflow-y-auto p-2.5">
              <SchemaBrowser tables={current?.tables || []} onInsert={insertText} />
            </div>
          </Card>

          <Callout tone="info" title="沙箱说明">
            每次运行都在一个全新的内存库里跑，你改的数据不会留到下一次。
            所以 INSERT / UPDATE / DELETE / CREATE 可以放心试。
            <br />
            <span className="text-fg-mute">
              单条语句超过 4 秒会被中断（多半是连接条件写漏了产生笛卡尔积）。
            </span>
          </Callout>
        </div>

        {/* ---------- 右：编辑器 + 结果 ---------- */}
        <div className="space-y-3">
          <SqlEditor
            value={sql}
            onChange={setSql}
            onRun={run}
            running={running}
            minRows={8}
            maxRows={20}
          />

          {res && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <RunMeta ms={res.ms} warnCount={res.warnings?.length} />
                {!res.ok && res.phase === 'timeout' && <Badge tone="warn">已超时中断</Badge>}
              </div>

              {res.warnings?.length > 0 && (
                <Callout tone="warn" title="提醒">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {res.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </Callout>
              )}

              {/* 多语句脚本：逐条给结果 */}
              {res.results?.map((r, i) => (
                <div key={i} className="space-y-1.5">
                  {res.results.length > 1 && (
                    <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                      <span className="rounded bg-veil/8 px-1.5 py-0.5 font-mono">第 {i + 1} 条</span>
                      <code className="truncate font-mono">{r.sql}</code>
                    </div>
                  )}
                  <ResultTable rs={r} />
                </div>
              ))}

              {!res.results?.length && (
                <Callout tone="bad">{res.error || '没有产生结果'}</Callout>
              )}
            </div>
          )}

          {!res && (
            <Card>
              <Empty
                icon={<Play size={24} />}
                title="按 Ctrl/⌘ + Enter 运行"
                desc="左边是表结构，上面是编辑器，这里是结果。试试把 SQL 里的 LIMIT 改大一点，看看完整数据。"
              />
            </Card>
          )}
        </div>
      </div>

      {/* ---------- 建表语句弹窗 ---------- */}
      <Modal
        open={showDdl}
        onClose={() => setShowDdl(false)}
        title={`${current?.title || ''} · 建表语句`}
        width="lg"
      >
        <DdlView ddl={ddlData?.ddl || ''} />
      </Modal>

      {/* ---------- 运行历史 ---------- */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="运行历史"
        width="lg"
        footer={<Button variant="outline" size="sm" onClick={() => setHistoryOpen(false)}>关闭</Button>}
      >
        {history?.runs.length ? (
          <div className="space-y-1.5">
            {history.runs.map((r) => (
              <div
                key={r.id}
                className={cn(
                  'rounded-lg border p-2.5',
                  r.ok ? 'border-hairline bg-veil/2' : 'border-bad/25 bg-bad-soft',
                )}
              >
                <div className="flex items-center gap-2 text-[10.5px] text-fg-faint">
                  {r.ok ? <Clock size={11} /> : <AlertTriangle size={11} className="text-bad" />}
                  <span>{formatDate(r.ts)}</span>
                  <span className="text-fg-mute">{r.datasetId}</span>
                  {r.ok && <span>{r.ms} ms · {r.rowCount} 行</span>}
                </div>
                <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[11.5px] text-fg-soft">
                  {r.sql}
                </pre>
                {r.error && <div className="mt-1 text-[11.5px] text-bad">{r.error}</div>}
                <button
                  onClick={() => { setSql(r.sql); setHistoryOpen(false); }}
                  className="mt-1.5 text-[11.5px] text-cyan hover:underline"
                >
                  放回编辑器
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="还没有运行记录" desc="在实训场里跑一条查询，这里就会记下来" />
        )}
      </Modal>
    </div>
  );
}
