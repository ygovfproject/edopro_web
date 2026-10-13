"use client";

import { useEffect, useRef } from "react";
import { useApp } from "../../AppContext";
import { cardImage } from "@/lib/data/config";

export interface WarpCard {
  code: number;
  /** Centre, relative to the middle of the group's box (px). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Glow colour. */
  color: string;
  /** When it appears (ms after mount). */
  appearAt: number;
}

/** Mesh each card is cut into (columns x rows); finer bends more smoothly. */
const COLS = 6;
const ROWS = 44;

/**
 * Cards bent together into one whirlpool, drawn on canvases (one per card, so each glows in
 * its own colour). Each card is cut into a fine mesh and every mesh point is turned round the
 * group's centre: points at the cards' inner ends turn first and furthest, the outer ends
 * hold on, so the cards first bend into curved blades and then stretch out into long spiral
 * arms; meanwhile everything turns faster and sinks into the centre. The twist runs from
 * `delay` for `duration` ms.
 */
export function WarpCards({ size, cards, delay, duration }: { size: number; cards: WarpCard[]; delay: number; duration: number }) {
  const { config } = useApp();
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const half = size / 2;
    // The twist is full at the cards' inner edges and fades out to nothing at their outer
    // corners, so each card bends: its inner end swings round while its outer end holds.
    const reach = Math.max(...cards.map((c) => Math.hypot(Math.abs(c.x) + c.width / 2, Math.abs(c.y) + c.height / 2)), 1) * 1.02;
    const inner = Math.max(0, Math.min(...cards.map((c) => Math.hypot(c.x, c.y) - Math.max(c.width, c.height) / 2)) * 0.9);
    const items = cards.map((c, i) => {
      const canvas = refs.current[i];
      const ctx = canvas?.getContext("2d") ?? null;
      if (canvas) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      let img: HTMLImageElement | null = null;
      if (config) {
        // Unknown cards (no code) show their back.
        img = new Image();
        img.src = c.code ? cardImage(config, c.code) : config.cardBackUrl || `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/img/card-back.jpg`;
      }
      return { c, ctx, img };
    });
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const ms = now - t0;
      const t = Math.min(1, Math.max(0, (ms - delay) / duration));
      // Twist at the inner ends (radians, over two turns): a gentle bend first, then a hard
      // stretch into long arms winding round the centre in several coils. The group's own turn and how far it has sunk in speed up towards the end.
      const twist = -14 * Math.pow(t, 1.35);
      // One and a half turns (540°) in all.
      const spin = -3 * Math.PI * Math.pow(t, 1.8);
      const sink = 1 - 0.96 * Math.pow(t, 2);
      const fade = t > 0.86 ? 1 - (t - 0.86) / 0.14 : 1;
      const warp = (x: number, y: number): [number, number] => {
        const r = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const hold = Math.min(1, Math.max(0, (reach - r) / (reach - inner)));
        const a2 = a + spin + twist * Math.pow(hold, 1.6);
        // Inner points also sink faster, pulling the arms in towards the centre.
        const r2 = r * sink * (1 - 0.7 * Math.min(1, t * 1.5) * Math.pow(hold, 0.8));
        return [half + Math.cos(a2) * r2, half + Math.sin(a2) * r2];
      };
      for (const { c, ctx, img } of items) {
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        const appear = Math.min(1, Math.max(0, (ms - c.appearAt) / 250));
        if (appear <= 0) continue;
        ctx.globalAlpha = appear * fade;
        const ready = !!img && img.complete && img.naturalWidth > 0;
        const iw = ready ? img!.naturalWidth : 1;
        const ih = ready ? img!.naturalHeight : 1;
        // Mesh points: card space -> group space (scaled in a little while appearing) -> warped.
        const s = 0.8 + 0.2 * appear;
        const pts: [number, number][][] = [];
        for (let j = 0; j <= ROWS; j++) {
          const row: [number, number][] = [];
          for (let i = 0; i <= COLS; i++) {
            const x = c.x + (i / COLS - 0.5) * c.width * s;
            const y = c.y + (j / ROWS - 0.5) * c.height * s;
            row.push(warp(x, y));
          }
          pts.push(row);
        }
        if (ready) {
          for (let j = 0; j < ROWS; j++) {
            for (let i = 0; i < COLS; i++) {
              const u0 = (i / COLS) * iw;
              const u1 = ((i + 1) / COLS) * iw;
              const v0 = (j / ROWS) * ih;
              const v1 = ((j + 1) / ROWS) * ih;
              tri(ctx, img!, dpr, [u0, v0], [u1, v0], [u0, v1], pts[j][i], pts[j][i + 1], pts[j + 1][i]);
              tri(ctx, img!, dpr, [u1, v0], [u1, v1], [u0, v1], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]);
            }
          }
        } else {
          // No picture (yet): a plain card-coloured shape bent the same way (its outline).
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = "#3a3a44";
          ctx.beginPath();
          for (let i = 0; i <= COLS; i++) ctx.lineTo(...pts[0][i]);
          for (let j = 1; j <= ROWS; j++) ctx.lineTo(...pts[j][COLS]);
          for (let i = COLS - 1; i >= 0; i--) ctx.lineTo(...pts[ROWS][i]);
          for (let j = ROWS - 1; j > 0; j--) ctx.lineTo(...pts[j][0]);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {cards.map((c, i) => (
        <canvas
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: size,
            height: size,
            ["--c" as string]: c.color,
            animation: `fxFusionGlow ${delay + duration}ms ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Draws the image triangle s0-s1-s2 onto the canvas triangle d0-d1-d2 (an affine map),
 * grown by half a pixel so neighbouring triangles leave no seams.
 */
function tri(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dpr: number,
  s0: [number, number],
  s1: [number, number],
  s2: [number, number],
  d0: [number, number],
  d1: [number, number],
  d2: [number, number],
) {
  const cx = (d0[0] + d1[0] + d2[0]) / 3;
  const cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p: [number, number]): [number, number] => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / l) * 0.6, p[1] + (dy / l) * 0.6];
  };
  const [e0, e1, e2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.moveTo(...e0);
  ctx.lineTo(...e1);
  ctx.lineTo(...e2);
  ctx.closePath();
  ctx.clip();
  // Solve the affine map taking s0, s1, s2 to d0, d1, d2.
  const [x0, y0] = s0;
  const [x1, y1] = s1;
  const [x2, y2] = s2;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-9) {
    ctx.restore();
    return;
  }
  const a = (d0[0] * (y1 - y2) + d1[0] * (y2 - y0) + d2[0] * (y0 - y1)) / den;
  const b = (d0[1] * (y1 - y2) + d1[1] * (y2 - y0) + d2[1] * (y0 - y1)) / den;
  const c = (d0[0] * (x2 - x1) + d1[0] * (x0 - x2) + d2[0] * (x1 - x0)) / den;
  const d = (d0[1] * (x2 - x1) + d1[1] * (x0 - x2) + d2[1] * (x1 - x0)) / den;
  const e = (d0[0] * (x1 * y2 - x2 * y1) + d1[0] * (x2 * y0 - x0 * y2) + d2[0] * (x0 * y1 - x1 * y0)) / den;
  const f = (d0[1] * (x1 * y2 - x2 * y1) + d1[1] * (x2 * y0 - x0 * y2) + d2[1] * (x0 * y1 - x1 * y0)) / den;
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
