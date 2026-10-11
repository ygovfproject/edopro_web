"use client";

import { useEffect, useRef } from "react";

/**
 * A small "light tunnel" for a zone cell (after reactbits' Light Tunnel background):
 * 49 violet cables run from the edge into the centre with a slight wave, over a dark
 * tunnel, and pulses of `pulseColor` travel inwards along them. Plain 2D canvas.
 */
export function LightTunnel({ width, height, pulseColor }: { width: number; height: number; pulseColor: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    const cables = 49;
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.hypot(cx, cy);
    const speed = 0.55;
    const pulseLength = 0.26;
    const waviness = 0.13;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(0,0,0,.67)";
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = "round";
      for (let i = 0; i < cables; i++) {
        const base = (i / cables) * Math.PI * 2;
        const a = base + waviness * Math.sin(t * 1.3 + i * 0.7);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        // The cable fades out towards the centre (far end of the tunnel).
        const g = ctx.createLinearGradient(cx + cos * R, cy + sin * R, cx, cy);
        g.addColorStop(0, "rgba(124,58,237,.95)");
        g.addColorStop(0.55, "rgba(124,58,237,.35)");
        g.addColorStop(1, "rgba(124,58,237,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + cos * R, cy + sin * R);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        // Pulse travelling inwards.
        const p = (t * speed + i * 0.618) % 1;
        const r1 = R * (1 - p);
        const r2 = Math.max(0, r1 - R * pulseLength);
        ctx.strokeStyle = pulseColor;
        ctx.globalAlpha = 0.85 * (1 - p * 0.6);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx + cos * r1, cy + sin * r1);
        ctx.lineTo(cx + cos * r2, cy + sin * r2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, pulseColor]);
  return <canvas ref={ref} style={{ width, height, display: "block", borderRadius: 3 }} />;
}
