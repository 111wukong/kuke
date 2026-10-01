/* 背景特效：赛博网格地平线 + 星尘
 *
 * 两个都是自研、零依赖。为什么不引粒子库：tsparticles 是 60–200KB，
 * 而这里要的效果加起来不到 400 行。
 *
 * ── 2026-10-02 这一版做了什么（以及为什么）─────────────────────
 *
 * 上一版能用，但有四个真问题，都在"美感"和"流畅度"上：
 *
 * 1. **网格是硬边线，远处会闪**。原来是 `smoothstep(0.5, 0.5-w, f)`
 *    配一个固定的 w —— 那是"在网格坐标里量宽度"，而一个屏幕像素
 *    在不同深度对应的网格坐标宽度差了几十倍。结果：近处的线糊成一片，
 *    远处的线细到只有半个像素，**逐帧闪烁**（走样）。
 *    现在按**屏幕像素**反推线宽：`w = |dv/duv| / uRes.y`，
 *    线宽恒定在 1.5 像素左右，远近都不闪。
 *
 * 2. **没有开场**。原来一挂上就是全亮在跑，像"页面加载完了"而不是
 *    "场景打开了"。现在有 2.4 秒的入场：地平线先亮起来，网格从
 *    地平线向外铺开，星尘随后浮出。用的是 easeOutCubic + 分阶段延迟。
 *
 * 3. **每帧调 resize()**。`loop` 里读 `canvas.clientWidth` 会触发
 *    **强制同步布局**（forced reflow）—— 每帧一次。这是那种
 *    "代码看着没问题、Profiler 里一片紫"的典型。现在只在
 *    ResizeObserver 回调里做。
 *
 * 4. **没有帧率上限、页面隐藏不停**。120Hz 屏上白跑两倍帧数；
 *    切到别的标签页还在烧 GPU。现在统一到 60fps，隐藏时整体暂停。
 *
 * 另外星尘从"每帧 150 次 arc+fill+拼 rgba 字符串"改成
 * **预渲染 sprite + drawImage + globalAlpha** —— 字符串拼接和路径
 * 构建是这里的真正开销，不是画点本身。
 *
 * ── ★ 最容易出的问题是"没清理" ────────────────────────────────
 * WebGL 的 context 数量有硬上限（浏览器通常 8–16 个）。
 * 每次挂载都新建一个 context 而不 delete，来回切几次主题就会
 * 报 "Too many active WebGL contexts"，而且是**静默降级**成黑屏。
 * 所以卸载时一定要：
 *   · 退订共享的 rAF 调度
 *   · 移除 resize / visibilitychange 监听
 *   · gl.getExtension('WEBGL_lose_context')?.loseContext() 主动释放
 *
 * ── 颜色从哪来 ──────────────────────────────────────────────────
 * canvas / WebGL 里不能用 CSS 变量，必须读**计算后的真实值**。
 * 而且换主题时要重新读 —— 否则会出现"CSS 那一半变绿了、
 * 占满整屏的背景还是青蓝"这种半截生效的问题。
 */
import { useEffect, useRef } from 'react';
import { cssVar } from '@/lib/utils';

/* ============================================================
   共享的 rAF 调度
   ============================================================
   两层特效原来各自 requestAnimationFrame，各跑各的。合并成一个的好处：
     · 同一帧里两层的 uniform 更新挨在一起，浏览器合成一次就够
     · 帧率上限、页面隐藏暂停只需要实现一遍
     · 卸载时能保证没有游离的回调
   上限 60fps：这两层是**纯装饰**，跑 120fps 的收益是 0，
   而功耗是实打实的（笔记本上风扇会响）。 */
const FRAME_MS = 1000 / 60;
const subscribers = new Set<(t: number) => void>();
let rafId = 0;
let lastFrame = 0;

function tick(t: number) {
  rafId = 0;
  if (document.hidden) return;          // 切走了就整体停 —— 回来时 resume() 会重启
  if (t - lastFrame >= FRAME_MS - 1) {
    lastFrame = t;
    for (const fn of subscribers) fn(t);
  }
  if (subscribers.size) rafId = requestAnimationFrame(tick);
}

function subscribe(fn: (t: number) => void): () => void {
  subscribers.add(fn);
  if (!rafId) { lastFrame = 0; rafId = requestAnimationFrame(tick); }
  return () => { subscribers.delete(fn); };
}

/* 从隐藏切回可见时，把循环重新点起来（tick 在隐藏时直接 return 了）。 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && subscribers.size && !rafId) {
      lastFrame = 0;
      rafId = requestAnimationFrame(tick);
    }
  });
}

/** 监听主题变化。返回一个取消订阅函数。 */
function onThemeChange(cb: () => void): () => void {
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.attributeName === 'data-theme') { cb(); return; }
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** 把 CSS 颜色（可能是 #rrggbb 或 rgb()）解析成 [r,g,b] 0..1。 */
function parseColor(input: string, fallback: [number, number, number]): [number, number, number] {
  const s = (input || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    return [
      parseInt(s.slice(1, 3), 16) / 255,
      parseInt(s.slice(3, 5), 16) / 255,
      parseInt(s.slice(5, 7), 16) / 255,
    ];
  }
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return fallback;
}

/** 开场时长（秒）。两层共用，保证节奏一致。 */
const INTRO_S = 1.8;

/**
 * 开场要不要直接跳到结束？
 *
 * ★ 为什么需要这个开关：无头截图（`--screenshot` + `--virtual-time-budget`）
 *   只会渲染一两帧就出图，于是拍到的永远是"开场第一帧"——
 *   网格还没淡入，看起来像"特效坏了"。实测踩过：我一度以为着色器写错了，
 *   查了半天才发现是截图拍在了 0.05 秒。
 *
 *   所以给截图/回归留一个显式入口：`?fx=settled`。
 *   它**只影响开场进度**，不影响配色、密度、动画速度 ——
 *   截图仍然是"用户最终看到的那个画面"。
 *
 *   不加这个开关的话，就只能靠临时改 INTRO_S 再改回来，
 *   而那种做法会让人忘记改回去（而且截图和发布版本不一致，却看不出来）。
 */
const SETTLED = typeof location !== 'undefined'
  && /(?:^|[?&])fx=settled(?:&|$)/.test(location.search);

/** easeOutCubic：开头快、结尾稳。开场动画用它比线性"高级"得多。 */
const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/* ============================================================
   赛博网格地平线（WebGL）
   ============================================================ */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/* 片元着色器：画一个透视网格，向地平线收束。
 *
 * 原理：把屏幕坐标按 y 做透视除法，得到一个"越远越密"的网格。
 *   z = 1 / (y + 0.16)     —— y 越接近地平线，z 越大（越远）
 *   网格 = fract(uv * scale) 靠近 0 或 1 的地方亮
 * 再叠一层随时间的滚动，让它像在向前飞。
 *
 * ★ 抗锯齿的做法（这一版的关键改动）：
 *   线的半宽不能写死，要按**屏幕像素**反推：
 *     w = |dv/duv| / uRes.y
 *   因为 uv 是按 uRes.y 归一化的，一个像素对应 1/uRes.y 的 uv 距离；
 *   再乘上"这个网格坐标对 uv 的导数"，就得到"一个像素在网格坐标里
 *   有多宽"。这样无论远近，线在屏幕上都是恒定 ~1.5 像素 ——
 *   远处不再闪烁，近处不再糊成一片。 */
const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uIntro;   // 0 → 1 的开场进度
uniform vec3  uGrid;    // 网格线颜色
uniform vec3  uGlow;    // 地平线辉光颜色

/* GLSL 里没有 easeOutCubic，自己写一个。
 * 开场曲线必须是"开头快、结尾稳"—— 线性收尾会显得很机械。 */
float easeOut(float x) {
  float c = clamp(x, 0.0, 1.0);
  return 1.0 - pow(1.0 - c, 3.0);
}

/* 抗锯齿的网格线。w 是半宽（网格坐标单位）。
 *
 * ★ 极性（这一段原来写反了，2026-10-02 修）：
 *   f = |fract(v) - 0.5| 在**网格线上等于 0**（v 是半整数），
 *   在两条线正中间等于 0.5。所以"是线"对应 f 小，不是 f 大。
 *
 *   原来写的是 1 - smoothstep(0.5-w, 0.5, f)，那等于
 *   "f 小于 0.5-w 时全亮" —— 覆盖了 99% 的范围，
 *   于是整片地面被涂成一块均匀的蓝色，**看不见任何线条**。
 *   而它不会报错，画面只是"有一层蓝"，很容易被当成风格。
 *
 *   正确写法：f 从 0 涨到 w 的过程中从亮到灭。 */
float gridLine(float v, float w) {
  float f = abs(fract(v) - 0.5);
  return 1.0 - smoothstep(0.0, max(w, 1e-5), f);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float horizon = -0.06;

  /* 开场：地平线从下方升到位置，网格跟着亮起来。
   * 用两条不同节奏的曲线 —— 辉光先到，网格后到，
   * 有先后才有"展开"的感觉，一起亮就是"啪"地一下。 */
  float glowIn = easeOut(uIntro * 1.6);
  float gridIn = easeOut(max(0.0, uIntro - 0.18) * 1.45);

  /* ---- 地平线以上：天空 ---- */
  if (uv.y > horizon) {
    float up = (uv.y - horizon);
    // 天空垂直渐变：靠近地平线最亮，往上迅速变暗
    vec3 sky = uGlow * exp(-up * 4.2) * 0.34;
    // 再叠一层大范围的柔光，让天空不是纯黑
    sky += uGrid * exp(-up * 1.1) * 0.05;
    gl_FragColor = vec4(sky * glowIn, 1.0);
    return;
  }

  /* ---- 地平线以下：地面网格 ---- */
  float dy = horizon - uv.y;                 // 距地平线的距离，>0
  float depth = 1.0 / (dy + 0.16);

  // 一个屏幕像素在 uv 空间里的长度
  float px = 1.0 / uRes.y;

  // 横向线：随深度收缩 + 随时间向前滚动
  float vz = depth * 2.3 - uTime * 0.55;
  float wz = 2.3 * depth * depth * px * 0.75;      // |d(vz)/duv| / uRes.y
  float zLine = gridLine(vz, max(wz, px * 0.9));

  // 纵向线：按 x / depth 得到透视收敛
  float vx = uv.x * depth * 1.15;
  float wx = 1.15 * depth * px * 0.75;
  float xLine = gridLine(vx, max(wx, px * 0.9));

  float lines = max(zLine, xLine);

  /* 纵向衰减。
   *
   * ★ 这里踩过一个坑，值得留个记号：上一版多乘了一个
   *   (1 - smoothstep(0.55, 1.15, depth))，本意是"压一下极近处"，
   *   但**这个 depth 的取值范围是 1.67 ~ 6.25**（= 1/(dy+0.16)，dy∈[0,0.44]），
   *   永远大于 1.15 —— 于是那个因子恒等于 0，**整片网格全被乘没了**。
   *   而着色器不会报错，画面只是"少了点东西"，很容易以为是风格问题。
   *
   *   教训：着色器里写衰减因子，先把**变量的实际取值范围**算出来，
   *   别凭"看起来差不多"挑阈值。下面这两个阈值都是对着
   *   dy∈[0,0.44] → depth∈[1.67,6.25] 这个区间定的。
   *
   * ⚠️ 另：这段注释写在**模板字符串里面**，所以正文里不能出现反引号 ——
   *    一个反引号就会提前闭合字符串，剩下的内容被当成 JS 执行，
   *    报的是「smoothstep is not defined」这种和着色器八竿子打不着的错。
   *    （这个坑我在写上面这段注释时又踩了一次，写完立刻构建失败。）
   */
  float fade = smoothstep(0.0, 0.22, dy)            // 贴地平线处淡出（那里网格无限密，只会是摩尔纹）
             * (1.0 - smoothstep(3.8, 7.0, depth)); // 远处淡出，近处保留

  float alpha = lines * fade * 0.78 * gridIn;

  // 地平线附近的亮带（辉光）
  float band = exp(-abs(dy) * 26.0);
  // 一条随时间缓慢横扫的高光，让画面不是完全静止
  float sweep = exp(-pow((uv.x * 0.9 - sin(uTime * 0.13) * 1.3), 2.0) * 5.0);
  band *= 0.6 + sweep * 1.4;

  vec3 col = uGrid * alpha + uGlow * band * 0.42 * glowIn;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // 编译失败就把源码打出来 —— 否则只有一句"着色器编译失败"，无从下手
    console.warn('[CyberGrid] 着色器编译失败：', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function CyberGrid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    let unsubscribe = () => {};
    let cleanupTheme = () => {};
    let ro: ResizeObserver | null = null;
    let resize = () => {};

    const boot = () => {
      gl = canvas.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'low-power',
      }) as WebGLRenderingContext | null;

      if (!gl) {
        // 拿不到 WebGL 就静默退出 —— CSS 层的光晕会顶上来。
        return;
      }

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;

      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[CyberGrid] 着色器链接失败');
        return;
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(prog, 'uRes');
      const uTime = gl.getUniformLocation(prog, 'uTime');
      const uIntro = gl.getUniformLocation(prog, 'uIntro');
      const uGrid = gl.getUniformLocation(prog, 'uGrid');
      const uGlow = gl.getUniformLocation(prog, 'uGlow');

      const readTheme = () => {
        const [gr, gg, gb] = parseColor(cssVar('--fx-grid', ''), [0.13, 0.83, 0.93]);
        const [wr, wg, wb] = parseColor(cssVar('--fx-glow', ''), [0.66, 0.33, 0.97]);
        gl!.uniform3f(uGrid, gr, gg, gb);
        gl!.uniform3f(uGlow, wr, wg, wb);
      };
      readTheme();
      cleanupTheme = onThemeChange(readTheme);

      /* ★ resize 只在真正变化时做，而且不在渲染循环里调。
       *   原来 loop 里每帧读一次 clientWidth —— 那是强制同步布局，
       *   每帧一次 reflow，在 Profiler 里是很显眼的一块。 */
      resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width === w && canvas.height === h) return;
        canvas.width = w;
        canvas.height = h;
        gl!.viewport(0, 0, w, h);
        gl!.uniform2f(uRes, w, h);
      };
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(resize);
        ro.observe(canvas);
      } else {
        window.addEventListener('resize', resize);
      }

      const start = performance.now();
      unsubscribe = subscribe((t) => {
        const elapsed = (t - start) / 1000;
        gl!.uniform1f(uTime, elapsed);
        // 开场进度：截断到 1 之后就不再变，着色器里也不用再判断
        gl!.uniform1f(uIntro, SETTLED ? 1 : Math.min(1, elapsed / INTRO_S));
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      });

      // 记下清理要用的东西
      (canvas as any).__cleanup = () => {
        gl?.deleteBuffer(buf);
        gl?.deleteProgram(prog);
        gl?.deleteShader(vs);
        gl?.deleteShader(fs);
      };
    };

    boot();

    return () => {
      unsubscribe();
      cleanupTheme();
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      (canvas as any).__cleanup?.();
      /* ★ 主动释放 context。不释放的话，来回切几次主题就会
       * 撞上浏览器的 WebGL context 上限（通常 8–16 个），
       * 之后的 canvas 全部静默变黑。 */
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-20 h-full w-full"
    />
  );
}

/* ============================================================
   星尘（Canvas 2D）
   ============================================================ */

/** 预渲染一颗星。比每帧 arc()+fill() 快得多 ——
 *  路径构建和 fillStyle 字符串解析才是这里的开销。 */
function makeStarSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${color},1)`);
  grad.addColorStop(0.35, `rgba(${color},0.55)`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

interface Star {
  x: number; y: number; z: number;
  tw: number;      // 闪烁相位
  drift: number;   // 横向漂移
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let unsubscribe = () => {};
    let cleanupTheme = () => {};
    let ro: ResizeObserver | null = null;
    let stars: Star[] = [];
    let sprite: HTMLCanvasElement | null = null;
    let spriteRgb = '';
    let w = 0;
    let h = 0;

    const readTheme = () => {
      const [r, g, b] = parseColor(cssVar('--fx-star', ''), [0.85, 0.92, 1]);
      spriteRgb = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
      // 尺寸取 32：再大也看不出差别，白占内存
      sprite = makeStarSprite(spriteRgb, 32);
    };
    readTheme();
    cleanupTheme = onThemeChange(readTheme);

    /* ★ 同样不在循环里 resize。 */
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nw = Math.max(1, Math.floor(window.innerWidth * dpr));
      const nh = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (canvas.width === nw && canvas.height === nh) return;
      canvas.width = nw;
      canvas.height = nh;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      w = nw; h = nh;

      // 粒子数按面积算，但封顶 —— 4K 屏上不限量会掉帧
      const count = Math.min(170, Math.round((window.innerWidth * window.innerHeight) / 15000));
      stars = Array.from({ length: count }, () => {
        // z 是"深度"：越小越远。用平方分布让远处的星星更多，符合透视直觉
        const z = Math.pow(Math.random(), 1.7) * 0.92 + 0.08;
        return {
          x: Math.random() * nw,
          y: Math.random() * nh,
          z,
          tw: Math.random() * Math.PI * 2,
          drift: (Math.random() - 0.5) * 0.06,
        };
      });
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(document.documentElement);
    } else {
      window.addEventListener('resize', resize);
    }

    const start = performance.now();

    unsubscribe = subscribe((t) => {
      const elapsed = (t - start) / 1000;
      // 星尘比网格晚一点进场，画面才有层次
      const intro = SETTLED ? 1 : easeOut((elapsed - 0.35) / (INTRO_S - 0.35));
      if (intro <= 0) { ctx.clearRect(0, 0, w, h); return; }

      ctx.clearRect(0, 0, w, h);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (const s of stars) {
        // 缓慢向上飘，越"近"的越快 —— 制造视差
        s.y -= s.z * s.z * 0.5;
        s.x += s.drift;
        if (s.y < -20) { s.y = h + 20; s.x = Math.random() * w; }
        if (s.x < -20) s.x = w + 20;
        if (s.x > w + 20) s.x = -20;

        const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.0007 + s.tw));
        // 景深：近的更大更亮
        const size = (2.5 + s.z * 9) * dpr;
        const alpha = (0.10 + s.z * 0.55) * twinkle * intro;

        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite!, s.x - size / 2, s.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    });

    return () => {
      unsubscribe();
      cleanupTheme();
      ro?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
