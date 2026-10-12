"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cardRect } from "../../CardImage";

/** Field cells have 4 px rounded corners (MUI borderRadius 1). */
const CELL_RADIUS = 4;

/**
 * The Xyz "void" in the cell the monster is summoned to: a flat yellow galaxy vortex, its
 * spiral arms swirling into a dark hole with a glowing white core, in the cell's shape
 * with a glowing yellow border. Drawn behind the field cells, so it is the cell's
 * background and the card stays on top. After the last sphere hits, the cell turns yellow.
 */
export function BoardVoid({ cardId, end, yellowAt }: { cardId: number; color: string; end: number; yellowAt: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const board = ref.current?.parentElement;
    if (!board) return;
    const box = board.getBoundingClientRect();
    // The cell the monster is summoned to.
    const zone = cardRect(cardId);
    const zx = zone ? zone.left + zone.width / 2 : box.left + box.width / 2;
    const zy = zone ? zone.top + zone.height / 2 : box.top + box.height / 2;
    const r = [...board.querySelectorAll<HTMLElement>("[data-cell]")]
      .map((el) => el.getBoundingClientRect())
      .find((c) => zx >= c.left && zx <= c.right && zy >= c.top && zy <= c.bottom);
    if (r) setCell({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height });
  }, [cardId]);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <style>{KEYFRAMES}</style>
      {cell && (
        <div
          style={{
            position: "absolute",
            ...cell,
            borderRadius: CELL_RADIUS,
            border: "2px solid #ffd54f",
            boxSizing: "border-box",
            overflow: "hidden",
            background: "#05060f",
            opacity: 0,
            animation: `voidIn 250ms ease-out forwards, xyzVoidGlow 1200ms ease-in-out infinite alternate, voidOut 400ms ease-in ${end}ms forwards`,
          }}
        >
          <Vortex width={cell.width - 4} height={cell.height - 4} />
          {/* After the last sphere hits, the cell turns yellow. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#ffd54f",
              opacity: 0,
              animation: `xyzVoidYellow 200ms ease-out ${yellowAt}ms forwards`,
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Spiral arms, how tightly they wind (radians per e-fold of radius) and how fast they turn. */
const ARMS = 5;
const WIND = 3.6;
const SPIN = 1.5;
const STREAKS = 950;

/**
 * The flat galaxy vortex: hundreds of short yellow streaks laid along logarithmic spiral
 * arms, turning faster towards the middle and drawn with additive blending (so dense
 * parts glow), around a dark hole with a white-hot core.
 */
function Vortex({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const cx = width / 2;
    const cy = height / 2;
    // Reaches the corners, so the arms fill the whole cell.
    const R = Math.hypot(width, height) / 2;
    const unit = R / 60;
    // Streaks: more of them towards the middle, each on an arm with a little scatter.
    const streaks = Array.from({ length: STREAKS }, () => {
      const f = 0.16 + Math.pow(Math.random(), 0.8) * 0.95; // radius as a fraction of R
      // Most streaks hug their arm; a few stray between arms.
      const stray = Math.random() < 0.18;
      return {
        f,
        arm: Math.floor(Math.random() * ARMS),
        scatter: (Math.random() - 0.5) * (stray ? 1.6 : 0.7),
        len: 0.25 + Math.random() * 0.5,
        w: (0.35 + Math.random() * 0.8) * unit,
        a: stray ? 0.1 + Math.random() * 0.2 : 0.2 + Math.random() * 0.45,
        hue: Math.random(),
      };
    });
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#05060f";
      ctx.fillRect(0, 0, width, height);
      // A faint yellow haze where the arms are.
      const haze = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
      haze.addColorStop(0, "rgba(255,230,80,.28)");
      haze.addColorStop(0.5, "rgba(255,220,60,.14)");
      haze.addColorStop(1, "rgba(255,220,60,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      // Where a point at radius fraction f on `arm` is, at time t (logarithmic spiral,
      // turning faster towards the middle).
      const angleAt = (arm: number, f: number, offset: number) =>
        (arm / ARMS) * Math.PI * 2 + WIND * Math.log(f) + offset + SPIN * t * (0.5 + 1.4 * (1 - f));
      const trace = (arm: number, f0: number, f1: number, offset: number, steps: number) => {
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const f = f0 + ((f1 - f0) * i) / steps;
          const a = angleAt(arm, f, offset);
          const x = cx + Math.cos(a) * f * R;
          const y = cy + Math.sin(a) * f * R;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      // A broad soft glow along each arm...
      for (let arm = 0; arm < ARMS; arm++) {
        ctx.strokeStyle = "rgba(255,225,70,.10)";
        ctx.lineWidth = 9 * unit;
        trace(arm, 0.18, 1.15, 0, 40);
        ctx.strokeStyle = "rgba(255,235,110,.12)";
        ctx.lineWidth = 4 * unit;
        trace(arm, 0.18, 1.15, 0, 40);
      }
      // ...and the fine streaks that make it up, each a short piece of its arm's spiral.
      for (const s of streaks) {
        const g = Math.round(205 + 50 * s.hue);
        ctx.strokeStyle = `rgba(255,${g},${Math.round(40 + 90 * s.hue)},${s.a})`;
        ctx.lineWidth = s.w;
        // A streak runs outwards along the arm from its radius.
        trace(s.arm, s.f, Math.min(1.25, s.f * (1 + s.len)), s.scatter, 6);
      }
      // The dark hole...
      ctx.globalCompositeOperation = "source-over";
      const hole = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.34);
      hole.addColorStop(0, "rgba(12,12,24,1)");
      hole.addColorStop(0.62, "rgba(18,18,30,.95)");
      hole.addColorStop(1, "rgba(18,18,30,0)");
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2);
      ctx.fill();
      // ...with a white-hot core, softly pulsing.
      ctx.globalCompositeOperation = "lighter";
      const pulse = 1 + 0.08 * Math.sin(t * 6);
      const coreR = R * 0.16 * pulse;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(0.45, "rgba(255,255,255,.95)");
      core.addColorStop(0.75, "rgba(190,205,255,.45)");
      core.addColorStop(1, "rgba(160,180,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width, height, display: "block" }} />;
}

const KEYFRAMES = `
@keyframes xyzVoidGlow {
  from { box-shadow: 0 0 6px 1px rgba(255,213,79,.75), inset 0 0 6px rgba(255,213,79,.45); }
  to { box-shadow: 0 0 14px 3px rgba(255,213,79,1), inset 0 0 10px rgba(255,213,79,.6); }
}
@keyframes xyzVoidYellow { from { opacity: 0; } to { opacity: 1; } }
`;
