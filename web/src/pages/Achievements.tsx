/* 成就墙
 *
 * 成就的价值不在于"给个徽章"，而在于**把好习惯具体化**。
 * 所以每个成就下面都写明它的判定条件 ——
 * 学生知道"连续 7 天"是怎么算的，才会去追它。
 */
import { Trophy, Lock, Flame, Zap, Target, Terminal, Sigma, FlaskConical, Sparkles } from 'lucide-react';
import { Card, SectionTitle, Badge, CardGridSkeleton, Empty, Progress, Stat } from '@/components/ui/Primitives';
import { useAsync } from '@/lib/hooks';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

interface Achievement {
  id: string; name: string; desc: string; tier: 'bronze' | 'silver' | 'gold';
  date?: string;
}

const TIER: Record<string, { label: string; cls: string; icon: any }> = {
  bronze: { label: '铜', cls: 'border-amber/30 bg-warn-soft text-amber', icon: Target },
  silver: { label: '银', cls: 'border-hairline-strong bg-veil/8 text-fg-soft', icon: Zap },
  gold: { label: '金', cls: 'border-warn/40 bg-warn-soft text-warn', icon: Trophy },
};

export default function Achievements() {
  const { data, loading } = useAsync<{
    achievements: { owned: number; list: Achievement[] };
    stats: any;
  }>(
    'study:achievements',
    () => api.get('/api/study/achievements'),
    { ttl: 15000 },
  );

  const { data: meta } = useAsync<{ achievements: Achievement[] }>(
    'meta:all',
    () => api.get('/api/meta'),
    { ttl: 600000 },
  );

  if (loading && !data) return <CardGridSkeleton count={9} height={112} />;

  const owned = new Map((data?.achievements.list || []).map((a) => [a.id, a]));
  const all = meta?.achievements || [];
  const total = all.length || 1;
  const got = owned.size;

  const stats = data?.stats || {};
  /* 进度：把"还差多少"算出来。只显示"未解锁"没有行动指引，
   * 显示"当前 3/10"学生才知道要往哪使劲。 */
  const progressOf = (id: string): string | null => {
    const map: Record<string, string> = {
      sql_runner: `${Math.min(stats.sqlRuns || 0, 10)}/10 次成功运行`,
      level_10: `${Math.min(stats.levelsPassed || 0, 10)}/10 关`,
      key_hunter: `${Math.min(stats.keyStreak || 0, 5)}/5 道候选键`,
      bcnf_slayer: `${Math.min(stats.nfCorrect || 0, 10)}/10 道范式题`,
      streak_7: `${Math.min(stats.streak || 0, 7)}/7 天`,
      streak_30: `${Math.min(stats.streak || 0, 30)}/30 天`,
      normalize_master: `${Math.min(stats.normalizeDone || 0, stats.normalizeTotal || 0)}/${stats.normalizeTotal || 0} 道`,
      first_step: `${Math.min(stats.attempts || 0, 1)}/1 题`,
      no_hint: `${Math.min(stats.noHintLevels || 0, 5)}/5 关`,
      comeback: `${Math.min(stats.comebacks || 0, 5)}/5 个`,
    };
    return map[id] || null;
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-fg">
              <Trophy size={17} className="text-amber" />
              成就墙
            </h2>
            <p className="mt-1 text-[12.5px] text-fg-mute">
              已解锁 {got} / {all.length} 项
            </p>
          </div>
          <div className="min-w-[200px] flex-1 sm:max-w-xs">
            <Progress value={got / total} tone="warn" showLabel />
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="累计作答" value={stats.attempts ?? 0} sub="每一题都算" />
        <Stat label="连续学习" value={`${stats.streak ?? 0} 天`} tone="warn" icon={<Flame size={12} />} />
        <Stat label="SQL 关卡通过" value={stats.levelsPassed ?? 0} tone="ok" icon={<Terminal size={12} />} />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((a) => {
          const have = owned.get(a.id);
          const tier = TIER[a.tier] || TIER.bronze;
          const Icon = tier.icon;
          const prog = !have ? progressOf(a.id) : null;

          return (
            <Card
              key={a.id}
              className={cn(
                'transition-colors',
                have ? 'border-ok/25' : 'opacity-70',
              )}
            >
              <div className="flex items-start gap-3">
                <span className={cn(
                  'grid h-10 w-10 shrink-0 place-items-center rounded-lg border',
                  have ? tier.cls : 'border-hairline bg-veil/4 text-fg-faint',
                )}>
                  {have ? <Icon size={18} /> : <Lock size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={cn('text-[13.5px] font-semibold', have ? 'text-fg' : 'text-fg-soft')}>
                      {a.name}
                    </span>
                    <Badge tone={have ? 'ok' : 'neutral'}>{tier.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-fg-mute">{a.desc}</p>
                  {have ? (
                    <div className="mt-1 text-[12px] text-ok">
                      <Sparkles size={10} className="mr-0.5 inline" />
                      {have.date ? formatDate(have.date) : ''} 解锁
                    </div>
                  ) : prog ? (
                    <div className="mt-1 text-[12px] tabular-nums text-fg-faint">进度 {prog}</div>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!all.length && (
        <Card><Empty icon={<Trophy size={24} />} title="成就定义加载中" /></Card>
      )}

      <Card>
        <SectionTitle
          title="成就的判定口径"
          desc="有些成就是有门槛的，写清楚免得你猜"
          icon={<Sigma size={15} className="text-fg-mute" />}
        />
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-fg-soft">
          <li>· <b className="text-fg">SQL 关卡类</b>：只有「首次通过」才计数，重复刷同一关不算 —— 否则刷关就是刷成就。</li>
          <li>· <b className="text-fg">连击类</b>：统计的是连续<b>答对</b>，不是连续作答。答错一次清零。</li>
          <li>· <b className="text-fg">连续天数</b>：按本地日期算，同一天做多次只算一天。今天还没做题不会断签。</li>
          <li>· <b className="text-fg">错题清零</b>：需要错题本里曾经有 20 道以上、且全部答对过。</li>
          <li>· <b className="text-fg">翻身</b>：把曾经掌握度低于 40% 的知识点练到 80% 以上，5 个。</li>
        </ul>
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-fg-faint">
          <FlaskConical size={12} />
          所有判定都在服务端完成，前端只负责展示。
        </div>
      </Card>
    </div>
  );
}
