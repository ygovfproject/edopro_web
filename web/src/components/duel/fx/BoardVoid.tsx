"use client";

import { useEffect, useRef } from "react";
import { cardRect } from "../../CardImage";

/**
 * The Xyz "void" (after reactbits' Light Tunnel) in the cell the monster is summoned to:
 * a vortex of violet cables spiralling from the cell's edge into its centre and turning
 * (faster near the middle), with pulses of `color` travelling inwards along them. Drawn behind the field and cut to that cell, so it
 * is the cell's background and the card stays on top.
 */
export function BoardVoid({ cardId, color, end, yellowAt }: { cardId: number; color: string; end: number; yellowAt: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const board = canvas?.parentElement;
    if (!canvas || !board) return;
    const box = board.getBoundingClientRect();
    const w = box.width;
    const h = box.height;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    // Only the cell the monster is summoned to shows the tunnel, centred on it.
    const zone = cardRect(cardId);
    const zx = zone ? zone.left + zone.width / 2 : box.left + w / 2;
    const zy = zone ? zone.top + zone.height / 2 : box.top + h / 2;
    const cells = [...board.querySelectorAll<HTMLElement>("[data-cell]")]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => zx >= r.left && zx <= r.right && zy >= r.top && zy <= r.bottom)
      .map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }));
    if (!cells.length) return;
    const cell = cells[0];
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;
    const R = Math.hypot(cell.w, cell.h) / 2;
    // Fewer, wider lines so the spiral arms read clearly.
    const cables = 32;
    const CABLE_W = 2.8;
    const PULSE_W = 4;
    const speed = 0.55;
    const pulseLength = 0.26;
    const waviness = 0.13;
    // Vortex: each cable bends into a spiral (TWIST radians from edge to centre) and the
    // whole void turns, the inside faster than the edge, like water going down a drain.
    const TWIST = 2.8;
    const SPIN = 1.6;
    const STEPS = 28;
    // Where cable `a` is at radius fraction r (1 = edge, 0 = centre), at time t.
    const at = (a: number, r: number, t: number) => {
      const inner = 1 - r;
      const th = a + TWIST * Math.pow(inner, 1.4) + SPIN * t * (0.55 + 1.6 * inner);
      return [cx + Math.cos(th) * R * r, cy + Math.sin(th) * R * r] as const;
    };
    const trace = (a: number, from: number, to: number, t: number) => {
      const n = Math.max(2, Math.ceil(STEPS * Math.abs(from - to)));
      ctx.beginPath();
      for (let s = 0; s <= n; s++) {
        const [x, y] = at(a, from + ((to - from) * s) / n, t);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,.67)";
      ctx.fillRect(0, 0, w, h);
      // The eye of the vortex: darker towards the centre.
      const eye = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      eye.addColorStop(0, "rgba(0,0,0,.85)");
      eye.addColorStop(0.35, "rgba(20,0,40,.45)");
      eye.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eye;
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Cables fade towards the centre (radial, so it follows the curves).
      const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      fade.addColorStop(0, "rgba(124,58,237,0)");
      fade.addColorStop(0.4, "rgba(124,58,237,.35)");
      fade.addColorStop(1, "rgba(124,58,237,.95)");
      for (let i = 0; i < cables; i++) {
        const a = (i / cables) * Math.PI * 2 + waviness * Math.sin(t * 1.3 + i * 0.7);
        ctx.strokeStyle = fade;
        ctx.lineWidth = CABLE_W;
        trace(a, 1, 0, t);
        // Pulse spiralling inwards along the cable.
        const p = (t * speed + i * 0.618) % 1;
        const r1 = 1 - p;
        const r2 = Math.max(0, r1 - pulseLength);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85 * (1 - p * 0.6);
        ctx.lineWidth = PULSE_W;
        trace(a, r1, r2, t);
        ctx.globalAlpha = 1;
      }
      // After the last sphere hits, the cell's background turns yellow.
      const k = Math.min(1, Math.max(0, (now - t0 - yellowAt) / 200));
      if (k > 0) {
        ctx.fillStyle = `rgba(255,213,79,${k})`;
        ctx.fillRect(0, 0, w, h);
      }
      // Keep only what falls inside the cells.
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      for (const c of cells) ctx.rect(c.x, c.y, c.w, c.h);
      ctx.fill();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [cardId, color, yellowAt]);
  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: 0,
        animation: `voidIn 250ms ease-out forwards, voidOut 400ms ease-in ${end}ms forwards`,
      }}
    />
  );
}
