"use client";

import { useEffect, useRef } from "react";

/** Spiral arms, how tightly they wind (radians per e-fold of radius) and how fast they turn. */
export const VORTEX_ARMS = 5;
export const VORTEX_WIND = 3.6;
export const VORTEX_SPIN = 1.5;
const DOTS = 900;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A flat galaxy vortex in `color`, made of glowing dots: about a thousand points of light laid
 * along logarithmic spiral arms of different lengths (so the outline is ragged, not a disc),
 * turning faster towards the middle and drawn with additive blending (so dense parts glow),
 * around a dark hole with a white-hot core. `size` is the square it fills.
 */
export function Vortex({
  size,
  aspect = 1,
  color,
  charges = [],
  style,
}: {
  size: number;
  aspect?: number;
  color: string;
  /** Times (ms after it appears) when something hits its centre: the core glows brighter with each. */
  charges?: number[];
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = size * aspect;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);
    const cx = W / 2;
    const c = size / 2;
    const R = size / 2;
    // Fills its ellipse in proportion: more dots when it is wider.
    const count = Math.round(DOTS * aspect);
    const unit = R / 60;
    const [r0, g0, b0] = rgb(color);
    const tint = (k: number, a: number) => `rgba(${Math.round(r0 + (255 - r0) * k)},${Math.round(g0 + (255 - g0) * k)},${Math.round(b0 + (255 - b0) * k)},${a})`;
    // One glowing dot, pre-rendered: a white-hot centre fading through the colour.
    const sprite = (k: number) => {
      const s = document.createElement("canvas");
      s.width = s.height = 64;
      const g = s.getContext("2d")!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.1, tint(0.6 * k + 0.3, 0.9));
      grad.addColorStop(0.3, tint(k * 0.3, 0.3));
      grad.addColorStop(1, tint(0, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return s;
    };
    const sprites = [sprite(0), sprite(0.5), sprite(1)];
    // Arms of different lengths, so the outline is ragged.
    const reach = Array.from({ length: VORTEX_ARMS }, () => 0.7 + Math.random() * 0.3);
    const dots = Array.from({ length: count }, () => {
      const arm = Math.floor(Math.random() * VORTEX_ARMS);
      // Dense near the middle, thinning out along the arm towards its tip.
      const f = 0.14 + Math.pow(Math.random(), 1.3) * (reach[arm] - 0.14);
      const out = (f - 0.14) / (reach[arm] - 0.14);
      // Most dots hug their arm (tighter towards the tip); a few stray between arms near the middle.
      const stray = f < 0.5 && Math.random() < 0.18;
      const spread = stray ? 1.5 : 0.55 - 0.35 * out;
      // A few big bright stars, many small faint ones.
      const big = Math.random() < 0.05;
      return {
        f,
        arm,
        scatter: (Math.random() + Math.random() - 1) * spread,
        r: (big ? 2 + Math.random() * 1.4 : 0.6 + Math.random() * 1) * unit * (1 - 0.35 * out),
        a: (stray ? 0.25 + Math.random() * 0.3 : 0.4 + Math.random() * 0.6) * Math.max(0.2, 1 - out * out),
        sprite: sprites[big ? 2 : Math.floor(Math.random() * 2)],
        twinkle: Math.random() * Math.PI * 2,
      };
    });
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, size);
      // A haze of the colour, only around the middle (the arms make the outline). The haze and
      // the hole are drawn round and stretched sideways into the galaxy's ellipse.
      ctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.translate(cx, c);
      ctx.scale(aspect, 1);
      ctx.translate(-c, -c);
      const haze = ctx.createRadialGradient(c, c, R * 0.12, c, c, R * 0.6);
      haze.addColorStop(0, tint(0.1, 0.22));
      haze.addColorStop(0.6, tint(0, 0.1));
      haze.addColorStop(1, tint(0, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
      ctx.globalCompositeOperation = "lighter";
      for (const d of dots) {
        const ang = (d.arm / VORTEX_ARMS) * Math.PI * 2 + VORTEX_WIND * Math.log(d.f) + d.scatter + VORTEX_SPIN * t * (0.5 + 1.4 * (1 - d.f));
        const x = cx + Math.cos(ang) * d.f * R * aspect;
        const y = c + Math.sin(ang) * d.f * R;
        // Each dot's glow is 3x its core radius.
        const s = d.r * 3;
        ctx.globalAlpha = d.a * (0.75 + 0.25 * Math.sin(t * 5 + d.twinkle));
        ctx.drawImage(d.sprite, x - s, y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      // How charged the core is (see the core below).
      const ms = now - t0;
      let hit = 0;
      let flash = 0;
      for (const at of charges) {
        if (ms < at) continue;
        hit++;
        flash = Math.max(flash, Math.exp(-(ms - at) / 160));
      }
      const level = charges.length ? hit / charges.length : 0;
      // The dark hole...
      ctx.globalCompositeOperation = "source-over";
      ctx.save();
      ctx.translate(cx, c);
      ctx.scale(aspect, 1);
      ctx.translate(-c, -c);
      const hole = ctx.createRadialGradient(c, c, 0, c, c, R * 0.34);
      hole.addColorStop(0, "rgba(12,12,24,1)");
      hole.addColorStop(0.62, "rgba(18,18,30,.95)");
      hole.addColorStop(1, "rgba(18,18,30,0)");
      ctx.fillStyle = hole;
      // The charge fills the hole with light.
      ctx.globalAlpha = 1 - 0.85 * level;
      ctx.beginPath();
      ctx.arc(c, c, R * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      // ...with a white-hot core, softly pulsing, brighter and bigger with every hit (each
      // hit also flashes and fades back to the new level).
      ctx.globalCompositeOperation = "lighter";
      // Charge glow around the core, in the colour, growing with each hit.
      if (level > 0 || flash > 0) {
        const gR = R * (0.3 + 0.35 * level + 0.25 * flash);
        const g = ctx.createRadialGradient(cx, c, 0, cx, c, gR);
        g.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.5 * level + 0.6 * flash)})`);
        g.addColorStop(0.35, tint(0.4, Math.min(1, 0.55 * level + 0.5 * flash)));
        g.addColorStop(1, tint(0, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, c, gR, 0, Math.PI * 2);
        ctx.fill();
      }
      const coreR = R * 0.16 * (1 + 0.08 * Math.sin(t * 6)) * (1 + 0.55 * level + 0.4 * flash);
      const core = ctx.createRadialGradient(cx, c, 0, cx, c, coreR);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.45, "rgba(255,255,255,.95)");
      core.addColorStop(0.75, tint(0.6, 0.45));
      core.addColorStop(1, tint(0.6, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, c, coreR, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, aspect, color, charges.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} style={{ width: size * aspect, height: size, display: "block", ...style }} />;
}
