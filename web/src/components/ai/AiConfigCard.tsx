/* AI 模型配置卡片
 *
 * ══════════════════════════════════════════════════════════════
 * 配置分两层，界面上要说清楚「谁配的、谁生效」
 * ══════════════════════════════════════════════════════════════
 *
 *   老师配的「全局配置」
 *     └→ 老师本人 + 老师创建的账号 自动使用
 *
 *   每个人自己的「个人配置」
 *     └→ 覆盖上面那层，只影响自己
 *
 *   自助注册的账号没有全局可用
 *     └→ 必须自己配（不继承老师的额度）
 *
 * 这三条规则必须写在界面上。老师最常问的两个问题是
 * 「我配了学生能用吗」和「为什么这个学生用不了」——
 * 与其让他去问，不如直接写在他看得见的地方。
 */
import { useEffect, useState } from 'react';
import {
  Cpu, KeyRound, Zap, Loader2, RotateCcw, Users, User, Info, ShieldAlert,
} from 'lucide-react';
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

interface AiConfigView {
  baseUrl: string;
  model: string;
  timeout: number;
  hasKey: boolean;
  keyMasked: string;
  effectiveSource: 'personal' | 'global' | 'env' | 'none';
  blocked: boolean;
  blockedReason: string | null;
  accountOrigin: 'staff' | 'teacher-created' | 'self-registered' | 'system';
  canUseGlobal: boolean;
  hasOwnConfig: boolean;
  isStaff: boolean;
  global: {
    baseUrl: string; model: string; timeout: number;
    hasKey: boolean; keyMasked: string; customized: boolean;
    sources: Record<string, string>;
  };
  personal?: {
    baseUrl: string; model: string; timeout: string;
    hasKey: boolean; keyMasked: string;
  };
}

const SOURCE_LABEL: Record<string, string> = {
  personal: '你自己的配置',
  global: '老师配的全局配置',
  env: '服务器环境变量',
  none: '未配置',
};

export function AiConfigCard() {
  const { toast } = useApp();
  const [cfg, setCfg] = useState<AiConfigView | null>(null);
  const [loading, setLoading] = useState(true);

  /* 编辑哪一层。老师默认编辑全局；学生只能编辑自己的。 */
  const [scope, setScope] = useState<'global' | 'personal'>('global');

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
      const r: AiConfigView = await api.get('/api/ai/config');
      setCfg(r);
      /* 默认编辑哪一层：老师 → 全局（他最常改的就是这个）；学生 → 自己的 */
      const s: 'global' | 'personal' = r.isStaff ? 'global' : 'personal';
      setScope(s);
      const src = s === 'global' ? r.global : (r.personal || r.global);
      setBaseUrl(src?.baseUrl || r.baseUrl);
      setModel(src?.model || r.model);
      setTimeoutSec(String(Math.round((Number(src?.timeout) || r.timeout) / 1000)));
      setApiKey('');            // 打码值不回填，留空 = 不改
      const hit = PRESETS.find((p) => p.baseUrl && p.baseUrl === (src?.baseUrl || r.baseUrl));
      setPreset(hit ? hit.id : 'custom');
    } catch (e: any) {
      toast('error', '读取 AI 配置失败', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /* 切换编辑层时把表单重填成那一层的值 */
  const switchScope = (s: 'global' | 'personal') => {
    if (!cfg) return;
    setScope(s);
    const src = s === 'global' ? cfg.global : (cfg.personal || cfg.global);
    setBaseUrl(src?.baseUrl || '');
    setModel(src?.model || '');
    setTimeoutSec(String(Math.round((Number(src?.timeout) || cfg.timeout) / 1000)));
    setApiKey('');
    setTestResult(null);
  };

  const applyPreset = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (p && p.baseUrl) { setBaseUrl(p.baseUrl); setModel(p.model); }
    setTestResult(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      /* ★ apiKey 只在真填了才提交 —— 留空表示「不改」。
       *   提交空串会被服务端理解成「清空」，那会把正在用的 key 删掉。 */
      const body: any = { scope, baseUrl, model, timeout: timeoutSec };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await api.patch('/api/ai/config', body);
      toast('ok', '已保存', `更新了：${(r.changed || []).join('、') || '无变化'}`);
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

  const clearScope = async () => {
    try {
      await api.patch('/api/ai/config', { scope, apiKey: '', baseUrl: '', model: '', timeout: '' });
      toast('ok', '已清空这一层', scope === 'global' ? '落回服务器环境变量' : '回落到老师配的全局配置');
      await load();
    } catch (e: any) {
      toast('error', '清空失败', e.message);
    }
  };

  if (loading) {
    return (
      <Card>
        <SectionTitle title="AI 模型" icon={<Cpu size={15} className="text-violet" />} />
        <div className="py-6 text-center text-[12.5px] text-fg-mute">读取配置…</div>
      </Card>
    );
  }
  if (!cfg) return null;

  const isStaff = cfg.isStaff;
  const selfRegistered = cfg.accountOrigin === 'self-registered';
  const editingGlobal = scope === 'global';

  return (
    <Card>
      <SectionTitle
        title="AI 模型"
        desc="AI 课堂和智能出题用的模型。填自己的 API Key 就能用。"
        icon={<Cpu size={15} className="text-violet" />}
        right={
          cfg.blocked
            ? <Badge tone="warn">未配置</Badge>
            : (
              <Badge tone={cfg.effectiveSource === 'personal' ? 'info' : 'neutral'}>
                生效中：{SOURCE_LABEL[cfg.effectiveSource]}
              </Badge>
            )
        }
      />

      {/* ══════ 配置规则说明 ══════
          这三条规则必须写在界面上。老师最常问的两个问题是
          「我配了学生能用吗」和「为什么这个学生用不了」。 */}
      <div className="mb-4 rounded-lg border border-hairline bg-veil/3 p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-fg-soft">
          <Info size={13} className="text-cyan" />
          API 是怎么生效的
        </div>
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-fg-mute">
          <li className="flex gap-2">
            <Users size={12} className="mt-[3px] shrink-0 text-cyan" />
            <span>
              <b className="text-fg-soft">老师配的全局配置</b> ——
              老师本人、以及<b className="text-fg-soft">老师在「学生管理」里创建的账号</b>，都自动用它。
              配一次全班可用。
            </span>
          </li>
          <li className="flex gap-2">
            <User size={12} className="mt-[3px] shrink-0 text-violet" />
            <span>
              <b className="text-fg-soft">每个人自己的配置</b> ——
              会覆盖全局配置，且只影响自己。
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldAlert size={12} className="mt-[3px] shrink-0 text-warn" />
            <span>
              <b className="text-fg-soft">自助注册的账号不继承全局配置</b> ——
              全局配置用的是老师的额度，自己注册进来的同学需要自己填一个 Key
              （或者让老师给你建号）。
            </span>
          </li>
        </ul>
      </div>

      {/* ══════ 当前状态 ══════ */}
      {cfg.blocked && (
        <Callout tone={selfRegistered ? 'warn' : 'bad'} className="mb-4">
          {selfRegistered
            ? '你这个账号是自助注册的，还没有可用的 AI 配置 —— 在下面填一个 API Key 就能用了。'
            : '还没有可用的 AI 配置。老师在下面配一次，他创建的账号就都能用了。'}
        </Callout>
      )}

      {!cfg.blocked && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-mute">
          <span>
            当前生效：<span className="font-mono text-fg-soft">{cfg.keyMasked || '（未设置）'}</span>
            <span className="ml-1.5 text-fg-faint">· {SOURCE_LABEL[cfg.effectiveSource]}</span>
          </span>
          <span>模型 <span className="font-mono text-fg-soft">{cfg.model}</span></span>
        </div>
      )}

      {/* ══════ 编辑层切换（老师才有得选）══════ */}
      {isStaff && (
        <div className="mb-4 flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-hairline bg-veil/3 p-0.5">
            <button
              type="button"
              onClick={() => switchScope('global')}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                editingGlobal ? 'bg-cyan/15 text-cyan' : 'text-fg-mute hover:text-fg'
              }`}
            >
              <Users size={11} className="mr-1 inline" />
              全局配置（给全班）
            </button>
            <button
              type="button"
              onClick={() => switchScope('personal')}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                !editingGlobal ? 'bg-violet/15 text-violet' : 'text-fg-mute hover:text-fg'
              }`}
            >
              <User size={11} className="mr-1 inline" />
              我自己的
            </button>
          </div>
          {cfg.global.customized && editingGlobal && <Badge tone="info">已自定义</Badge>}
        </div>
      )}

      {/* ══════ 表单 ══════ */}
      <div className="space-y-3.5">
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
          <Field label="模型名">
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
          hint={
            (editingGlobal ? cfg.global.hasKey : cfg.personal?.hasKey)
              ? `已配置：${editingGlobal ? cfg.global.keyMasked : cfg.personal?.keyMasked} —— 留空则不修改`
              : '还没有配置'
          }
        >
          <div className="relative">
            <KeyRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={(editingGlobal ? cfg.global.hasKey : cfg.personal?.hasKey) ? '留空表示不修改' : 'sk-...'}
              autoComplete="off"
              spellCheck={false}
              className="pl-9"
            />
          </div>
        </Field>

        <Field label="超时（秒）" hint="模型响应慢时可以调大">
          <Input
            type="number" min={5} max={600}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            className="w-32"
          />
        </Field>

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
            {saving ? '保存中…' : editingGlobal ? '保存全局配置' : '保存我的配置'}
          </Button>
          {((editingGlobal && cfg.global.customized) || (!editingGlobal && cfg.personal?.hasKey)) && (
            <Button variant="ghost" onClick={clearScope}>
              <RotateCcw size={13} />清空这一层
            </Button>
          )}
        </div>

        <p className="text-[12px] leading-relaxed text-fg-mute">
          {editingGlobal
            ? '这是全局配置 —— 保存后，你创建的账号会自动使用它，不需要重启服务。'
            : '这是你自己的配置 —— 会覆盖全局配置，只影响你自己的 AI 课堂。'}
          {' '}测试用的是<b>输入框里的值</b>，不需要先保存，填错了不会影响正在用的配置。
        </p>
        {!editingGlobal && (
          <p className="text-[12px] leading-relaxed text-fg-faint">
            ★ <b className="text-fg-mute">只有填了 API Key 才算「配置了自己的」</b> ——
            只改模型名不填 Key 的话，用的还是全局那把 Key，系统会认为你在用全局配置。
            （Key 是「谁付钱」的标志。）
          </p>
        )}
      </div>
    </Card>
  );
}
