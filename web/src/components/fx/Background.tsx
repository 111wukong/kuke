/* 背景特效：赛博网格地平线 + 星尘
 *
 * 两个都是自研、零依赖。为什么不引粒子库：tsparticles 是 60–200KB，
 * 而这里要的效果加起来不到 200 行。
 *
 * ── ★ 这两个组件最容易出的问题是"没清理" ────────────────────────
 * WebGL 的 context 数量有硬上限（浏览器通常 8–16 个）。
 * 每次挂载都新建一个 context 而不 delete，来回切几次主题就会
 * 报 "Too many active WebGL contexts"，而且是**静默降级**成黑屏。
 * 所以卸载时一定要：
 *   · cancelAnimationFrame 停掉循环
 *   · 移除 resize 监听
 *   · gl.getExtension('WEBGL_lose_context')?.loseContext() 主动释放
 *
 * ── 颜色从哪来 ──────────────────────────────────────────────────
 * canvas / WebGL 里不能用 CSS 变量，必须读**计算后的真实值**。
 * 而且换主题时要重新读 —— 否则会出现"CSS 那一半变绿了，
 * 占满整屏的背景还是青蓝"这种半截生效的问题。
 * 所以两个组件都监听 data-theme 变化并重建。
 */
import { useEffect, useRef } from 'react';
import { cssVar } from '@/lib/utils';

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

/* ============================================================
   赛博网格地平线（WebGL2）
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
 * 再叠一层随时间的滚动，让它像在向前飞。 */
const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uGrid;
uniform vec3  uGlow;

float gridLine(float v, float w) {
  float f = abs(fract(v) - 0.5);
  return smoothstep(0.5, 0.5 - w, f);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float horizon = -0.06;

  // 地平线以上：天空，只有一点光晕
  if (uv.y > horizon) {
    float glow = smoothstep(0.5, 0.0, (uv.y - horizon) * 3.4);
    vec3 sky = uGlow * glow * 0.30;
    gl_FragColor = vec4(sky, 1.0);
    return;
  }

  // 地平线以下：地面网格
  float depth = 1.0 / (horizon - uv.y + 0.16);

  // 横向线：随深度收缩 + 随时间向前滚动
  float zLine = gridLine(depth * 1.5 - uTime * 0.55, 0.030 * clamp(depth, 0.4, 3.0));
  // 纵向线：按 x / depth 得到透视收敛
  float xLine = gridLine(uv.x * depth * 0.85, 0.028 * clamp(depth, 0.4, 3.0));

  float lines = max(zLine, xLine);
  // 越近越亮，越远越淡
  float fade = smoothstep(0.0, 0.42, horizon - uv.y) * smoothstep(26.0, 1.6, depth);
  float alpha = lines * fade * 0.72;

  // 地平线附近加一条亮带
  float band = smoothstep(0.030, 0.0, abs(uv.y - horizon));
  vec3 col = uGrid * alpha + uGlow * band * 0.34;

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
    let raf = 0;
    let disposed = false;
    let cleanupTheme = () => {};

    const boot = () => {
      gl = canvas.getContext('webgl', {
        alpha: false, antialias: false, depth: false, stencil: false,
        powerPreference: 'low-power',
      }) as WebGLRenderingContext | null;

      if (!gl) {
        // 拿不到 WebGL 就静默退出 —— CSS 层的光晕+细网格会顶上来。
        // 这条降级路径是刻意保留的（也是亮色主题的主力）。
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
      const uGrid = gl.getUniformLocation(prog, 'uGrid');
      const uGlow = gl.getUniformLocation(prog, 'uGlow');

      const readTheme = () => {
        const [gr, gg, gb] = parseColor(cssVar('--color-cyan', '#22d3ee'), [0.13, 0.83, 0.93]);
        const [wr, wg, wb] = parseColor(cssVar('--color-violet', '#a855f7'), [0.66, 0.33, 0.97]);
        gl!.uniform3f(uGrid, gr, gg, gb);
        gl!.uniform3f(uGlow, wr, wg, wb);
      };
      readTheme();
      cleanupTheme = onThemeChange(readTheme);

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(canvas.clientWidth * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl!.viewport(0, 0, w, h);
          gl!.uniform2f(uRes, w, h);
        }
      };
      resize();
      window.addEventListener('resize', resize);

      const start = performance.now();
      const loop = (t: number) => {
        if (disposed) return;
        resize();
        gl!.uniform1f(uTime, (t - start) / 1000);
        gl!.drawArrays(gl!.TRIANGLES, 0, 3);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // 记下清理要用的东西
      (canvas as any).__cleanup = () => {
        window.removeEventListener('resize', resize);
        gl?.deleteBuffer(buf);
        gl?.deleteProgram(prog);
        gl?.deleteShader(vs);
        gl?.deleteShader(fs);
      };
    };

    boot();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanupTheme();
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

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let stars: { x: number; y: number; z: number; r: number; tw: number }[] = [];
    let color = '255,255,255';
    let cleanupTheme = () => {};

    const readTheme = () => {
      const [r, g, b] = parseColor(cssVar('--color-cyan', '#22d3ee'), [0.13, 0.83, 0.93]);
      color = `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
    };
    readTheme();
    cleanupTheme = onThemeChange(readTheme);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;

      // 粒子数按面积算，但封顶 —— 4K 屏上不限量会掉帧
      const count = Math.min(150, Math.round((window.innerWidth * window.innerHeight) / 16000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.8 + 0.2,
        r: (Math.random() * 1.1 + 0.35) * dpr,
        tw: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      if (disposed) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const t = performance.now() / 1000;

      for (const s of stars) {
        // 缓慢向上飘，越"远"的越慢 —— 制造视差
        s.y -= s.z * 0.16;
        if (s.y < -4) { s.y = canvas.height + 4; s.x = Math.random() * canvas.width; }

        const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.7 + s.tw));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color},${(0.16 + s.z * 0.42) * twinkle})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      cleanupTheme();
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
