/* AI 模型配置卡片
 *
 * 只有教师 / 管理员能看到（由调用方判断）。学生不该碰这个 ——
 * 那是别人的额度，而且改错了全班学生的 AI 课堂都用不了。
 *
 * ── 为什么要有「测试连接」 ──────────────────────────────────────
 * 填错 key 或地址时，症状是「AI 课堂打不开」，而具体原因是 401、
 * 余额不足还是地址写错，只有发一次真实请求才知道。
 * 让老师填完立刻能验证，比让他保存后再去猜要好得多。
 *
 * ★ 测试用的是**输入框里的值**，不是已保存的配置 ——
 *   否则就变成「先保存再测试」，一次填错会把正在用的配置也改坏。
 *
 * ── 为什么要有服务商预设 ────────────────────────────────────────
 * 大部分老师不知道「接口地址」该填什么。选一个服务商自动带出
 * 地址和模型名，剩下只需要粘 key —— 从「填三个字段」变成「填一个」。
 */
import { useEffect, useState } from 'react';
import { Cpu, KeyRound, Zap, Loader2, RotateCcw } from 'lucide-react';
import { Card, SectionTitle, Badge, Button, Field, Input, Select, Callout } from '@/components/ui/Primitives';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';

/* 预设。地址末尾不带 /v1 —— 服务端会自己拼 /v1/chat/completions。 */
const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' },
  { id: 'moonshot', name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  { id: 'dashscope', name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn', model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'local', name: '本地模型（Ollama / LM Studio）', baseUrl: 'http://127.0.0.1:1234', model: 'local-model' },
  { id: 'custom', name: '自定义 / 学校私有部署', baseUrl: '', model: '' },
];

interface AiConfig {
  baseUrl: string;
  model: string;
  timeout: number;
  hasKey: boolean;
  keyMasked: string;
  customized: boolean;
  sources: Record<string, 'database' | 'env' | 'none'>;
}

export function AiConfigCard() {
  const { toast } = useApp();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('custom');

  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('60');

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const load = async () => {
    try {
      const r: AiConfig = await api.get('/api/ai/config');
      setCfg(r);
      setBaseUrl(r.baseUrl);
      setModel(r.model);
      setTimeoutSec(String(Math.round(r.timeout / 1000)));
      setApiKey('');           // 打码值不回填到输入框，留空 = 不改
      /* 反查当前配置匹配哪个预设，让下拉显示得对 */
      const hit = PRESETS.find((p) => p.baseUrl && p.baseUrl === r.baseUrl);
      setPreset(hit ? hit.id : 'custom');
    } catch (e: any) {
      toast('error', '读取 AI 配置失败', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p && p.baseUrl) { setBaseUrl(p.baseUrl); setModel(p.model); }
    setTestResult(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      /* ★ apiKey 只在用户真填了才提交 ——
       *   留空表示「不改」，提交空串会被服务端理解成「清空」，
       *   那会把正在用的 key 删掉。 */
      const body: any = { baseUrl, model, timeout: timeoutSec };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await api.patch('/api/ai/config', body);
      toast('ok', 'AI 配置已保存', `更新了：${(r.changed || []).join('、') || '无变化'}`);
      setApiKey('');
      await load();
    } catch (e: any) {
      toast('error', '保存失败', e.message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body: any = { baseUrl, model };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await api.post('/api/ai/config/test', body);
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const resetToDefault = async () => {
    try {
      await api.patch('/api/ai/config', { apiKey: '', baseUrl: '', model: '', timeout: '' });
      toast('ok', '已恢复默认', '落回服务器环境变量里的值');
      await load();
    } catch (e: any) {
      toast('error', '恢复失败', e.message);
    }
  };

  if (loading) return <Card><SectionTitle title="AI 模型" icon={<Cpu size={15} className="text-violet" />} /><div className="py-6 text-center text-[12.5px] text-fg-mute">读取配置…</div></Card>;

  const srcLabel = (k: string) => {
    const s = cfg?.sources?.[k];
    if (s === 'database') return '界面设置';
    if (s === 'env') return '环境变量';
    return '未设置';
  };

  return (
    <Card>
      <SectionTitle
        title="AI 模型"
        desc="AI 课堂和智能出题用的模型。填自己的 API Key 就能用，不填则用服务器上配好的。"
        icon={<Cpu size={15} className="text-violet" />}
        right={cfg?.customized ? <Badge tone="info">已自定义</Badge> : <Badge tone="neutral">用服务器默认</Badge>}
      />

      <div className="space-y-3.5">
        {/* 服务商预设 */}
        <Field label="服务商" hint="选一个会自动带出接口地址和模型名">
          <Select value={preset} onChange={(e) => applyPreset(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="接口地址" hint="末尾不用带 /v1">
            <Input
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setPreset('custom'); setTestResult(null); }}
              placeholder="https://api.deepseek.com"
              spellCheck={false}
            />
          </Field>
          <Field label="模型名" hint={`当前来自：${srcLabel('model')}`}>
            <Input
              value={model}
              onChange={(e) => { setModel(e.target.value); setPreset('custom'); setTestResult(null); }}
              placeholder="deepseek-chat"
              spellCheck={false}
            />
          </Field>
        </div>

        <Field
          label="API Key"
          hint={cfg?.hasKey ? `当前已配置：${cfg.keyMasked}（来自${srcLabel('apiKey')}）—— 留空则不修改` : '还没有配置'}
        >
          <div className="relative">
            <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={cfg?.hasKey ? '留空表示不修改' : 'sk-...'}
              autoComplete="off"
              spellCheck={false}
              className="pl-9"
            />
          </div>
        </Field>

        <Field label="超时（秒）" hint={`当前来自：${srcLabel('timeout')}`}>
          <Input
            type="number"
            min={5}
            max={600}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            className="w-32"
          />
        </Field>

        {/* 测试结果 */}
        {testResult && (
          <Callout tone={testResult.ok ? 'ok' : 'bad'}>
            {testResult.ok ? (
              <span>
                连通正常（{testResult.ms}ms，模型 {testResult.model}）
                {testResult.reply ? ` · 模型回复：${testResult.reply}` : ''}
              </span>
            ) : (
              <span>
                <b>{testResult.message}</b>
                {testResult.hint ? <div className="mt-1 opacity-90">{testResult.hint}</div> : null}
              </span>
            )}
          </Callout>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" onClick={test} disabled={testing}>
            {testing ? <><Loader2 size={13} className="animate-spin" />测试中…</> : <><Zap size={13} />测试连接</>}
          </Button>
          <Button variant="accent" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
          {cfg?.customized && (
            <Button variant="ghost" onClick={resetToDefault} title="清空界面上的设置，落回环境变量">
              <RotateCcw size={13} />恢复默认
            </Button>
          )}
        </div>

        <p className="text-[11.5px] leading-relaxed text-fg-mute">
          测试用的是<b>输入框里的值</b>，不需要先保存 —— 填错了不会影响正在用的配置。
          保存后立即生效，不用重启服务。
        </p>
      </div>
    </Card>
  );
}
