"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { CardImage, cardHeight, cardRect, forgetVanish, vanishRect } from "../CardImage";
import { useApp } from "../AppContext";
import type { Fx, FxCard } from "@/lib/game/duel";
import {
  BUMP_HIT,
  BUMP_MS,
  BUMP_WINDUP,
  LP_HIT_MS,
  SHUFFLE_MS,
  TO_PILE_MS,
  FADE_MS,
  FUSION_MERGE,
  FUSION_SWIRL_MS,
  LIFT,
  LINK_FRAME_IN,
  LINK_LEAD,
  LINK_SPEED,
  MATERIAL_HOLD,
  RITUAL_BLUE,
  RITUAL_RING_IN,
  XYZ_FLY_MS,
  XYZ_UP_MS,
  XYZ_VORTEX_IN,
  NEON_GREEN,
  attributeColor,
  summonTimeline,
  type SummonKind,
  type SummonTimeline,
} from "@/lib/game/motion";
import { LeavingForm, SynchroRing } from "./fx/MaterialForm";
import { Vortex } from "./fx/Vortex";

/** The ring fills 80% of its image (see public/fx/synchro-ring.svg). */
const RING_IMAGE_FILL = 0.8;
/** Plain-style version of shinyDot for elements outside MUI: white ball, green shine. */
const shinyDotStyle = {
  background: "radial-gradient(circle at 42% 38%, #ffffff 0%, #ffffff 50%, #f4fff2 70%, rgba(255,255,255,.9) 100%)",
  boxShadow: `0 0 3px 1px #ffffff, 0 0 8px 3px #39ff14, 0 0 18px 7px #39ff14aa, 0 0 32px 12px #39ff1455`,
};
import { Swirl } from "./fx/Swirl";
import { WarpCards } from "./fx/WarpCards";

/**
 * Board effects drawn on top of the page. When cards move, vanish or appear is decided
 * by the board model (lib/game/motion.ts); this draws what goes with it:
 *  - material:  a material leaving the field (Fusion swirl, Synchro rings/spheres,
 *               Xyz/Link spheres floating up)
 *  - fusion / synchro / xyz / link: step 5 of the summon, above the monster's zone
 *  - impact:    a summoned card landing in its zone: a ripple through the field cells
 *  - glow:      only timed here; the board draws it in the zone
 *  - destroy / battle: the card shattering / slashed in two
 */
export default function FxOverlay({ fx, me, onDone }: { fx: Fx[]; me: number; onDone: (id: number) => void }) {
  if (!fx.length) return null;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 45, overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>
      {fx.map((f) => (
        <FxItem key={f.id} fx={f} me={me} onDone={onDone} />
      ))}
    </div>
  );
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const isSummon = (k: Fx["kind"]): k is SummonKind => k === "fusion" || k === "synchro" || k === "xyz" || k === "link" || k === "ritual";

function popcount(n: number) {
  let c = 0;
  for (let x = n >>> 0; x; x &= x - 1) c++;
  return c;
}

/** Total time an effect stays mounted, ms. */
function lifetime(fx: Fx, tl: SummonTimeline | null): number {
  switch (fx.kind) {
    case "glow":
      return (fx.delay ?? 0) + 950;
    case "impact":
      return (fx.delay ?? 0) + 1300;
    case "material":
      // Shapes may first form (up to ~1.3 s), then leave one after another (~1 s).
      if (fx.form?.shape === "swirl") return MATERIAL_HOLD + 200;
      if (fx.form?.shape === "glow") return LINK_LEAD + 100;
      if (fx.form?.shape === "sphere") return (fx.previewed ? 0 : SPHERE_FORM_MS) + XYZ_UP_MS + 60;
      return (fx.previewed ? 0 : 1400) + 1200;
    case "destroy":
    case "battle":
      return 1000;
    case "bump":
      return BUMP_MS + 80;
    case "toPile":
      return TO_PILE_MS + 40;
    case "shuffle":
      return (fx.delay ?? 0) + SHUFFLE_MS + 40;
    default:
      return (tl?.impact ?? 1500) + 500;
  }
}

function FxItem({ fx, me, onDone }: { fx: Fx; me: number; onDone: (id: number) => void }) {
  const { res } = useApp();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tl = useMemo(
    () => (isSummon(fx.kind) ? summonTimeline(fx.kind, fx.kind === "link" ? Math.max(1, popcount(fx.linkMarker ?? 0)) : Math.max(1, fx.materials?.length ?? 0)) : null),
    [fx],
  );
  useEffect(() => {
    const finish = () => {
      forgetVanish(fx.cardId);
      onDone(fx.id);
    };
    if (fx.kind === "lp") {
      // Gone when the number hits the LP bar: the bar then shows the new LP.
      const t = setTimeout(finish, reducedMotion() ? 0 : LP_HIT_MS);
      return () => clearTimeout(t);
    }
    if (fx.kind === "shuffle") {
      // Shuffles the Deck pile itself.
      const t0 = setTimeout(() => shufflePile(fx.pile ?? ""), fx.delay ?? 0);
      const t1 = setTimeout(finish, lifetime(fx, null));
      return () => {
        clearTimeout(t0);
        clearTimeout(t1);
      };
    }
    if (fx.kind === "toPile" && document.querySelector(`[data-pile="${fx.pile}"] [data-card-id="${fx.cardId}"]`)) {
      // It is the pile's top card: it flies there by itself.
      finish();
      return;
    }
    if (fx.kind === "glow") {
      // Drawn by the board in the zone; this only times it out.
      const t = setTimeout(finish, lifetime(fx, null));
      return () => clearTimeout(t);
    }
    // Runs after the board's layout effects, so card positions are known: where the card
    // is (summons, impacts) or was (materials, destroyed cards).
    const leaving = fx.kind === "material" || fx.kind === "destroy" || fx.kind === "battle" || fx.kind === "toPile";
    const r = leaving
      ? vanishRect(fx.cardId)
      : cardRect(fx.cardId) ?? document.querySelector(`[data-card-id="${fx.cardId}"]`)?.getBoundingClientRect();
    if (!r || !r.width || reducedMotion()) {
      finish();
      return;
    }
    setRect(r);
    const timers = [setTimeout(finish, lifetime(fx, tl))];
    if (fx.kind === "impact") {
      // The landing sends a ripple through the field, like a stone dropped into water.
      timers.push(setTimeout(() => ripple(r, fx.tier ?? 1), fx.delay ?? 0));
    }
    if (fx.kind === "bump") bump(fx.cardId, fx.targetId, fx.toPlayer ?? 1 - fx.controller, fx.tier);
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (fx.kind === "lp") return reducedMotion() ? null : <LpChange player={fx.controller} amount={fx.amount ?? 0} />;
  if (!rect) return null;

  const flipped = fx.controller !== me;
  const box = boxOf(rect);
  const ghost = (c: FxCard, w: number) => (
    <CardImage code={c.faceDown ? 0 : c.code} faceDown={c.faceDown} width={w} sideways={c.sideways} flipped={c.controller !== me} />
  );

  switch (fx.kind) {
    case "glow":
      return null;
    case "impact":
      // Drawn by moving the field cells themselves (see ripple).
      return null;
    case "bump":
      // Moves the attacking card itself (see bump).
      return null;
    case "material":
      return <Material fx={fx} rect={rect} flipped={flipped} ghost={ghost(fx, fx.sideways ? rect.height : rect.width)} />;
    case "toPile":
      return <ToPile rect={rect} pile={fx.pile ?? ""} bottom={!!fx.bottom} ghost={ghost(fx, fx.sideways ? rect.height : rect.width)} />;
    case "shuffle":
      return null;
    case "destroy":
    case "battle": {
      const card = ghost(fx, fx.sideways ? rect.height : rect.width);
      return fx.kind === "battle" ? <BattleCut box={box} card={card} rect={rect} /> : <Shatter box={box} card={card} rect={rect} />;
    }
    default: {
      if (!tl) return null;
      const fp = fallPoint(rect, fx.dir ?? -1);
      const info = res?.cards.get(fx.code);
      switch (fx.kind) {
        case "fusion": {
          // Each material glows in its own Attribute's colour.
          const mats = fx.materials ?? [];
          const colors = mats.map((m) => attributeColor(res?.cards.get(m.code)?.attribute ?? 0));
          return <FusionIn fx={fx} fp={fp} tl={tl} flipped={flipped} materials={mats} colors={colors} />;
        }
        case "synchro": {
          let tuner = 0;
          let other = 0;
          for (const m of fx.materials ?? []) {
            const mi = res?.cards.get(m.code);
            const lv = Math.max(1, mi?.level ?? 1);
            if ((mi?.type ?? 0) & 0x1000) tuner += lv;
            else other += lv;
          }
          if (!tuner && !other) tuner = Math.max(1, info?.level ?? 1);
          return <SynchroIn fp={fp} tl={tl} tuner={tuner} other={other} />;
        }
        case "xyz": {
          // The vortex is in the summoned monster's Attribute colour; each sphere in its own
          // material's.
          const own = attributeColor(info?.attribute ?? 0);
          const mats = fx.materials ?? [];
          const colors = mats.map((m) => {
            const attr = res?.cards.get(m.code)?.attribute ?? 0;
            return attr ? attributeColor(attr) : own;
          });
          return <XyzIn fp={fp} tl={tl} color={own} colors={colors} />;
        }
        case "ritual":
          return <RitualIn fp={fp} tl={tl} />;
        case "link":
          return <LinkIn fp={fp} tl={tl} marker={fx.linkMarker ?? info?.linkMarker ?? 0} flipped={flipped} />;
      }
      return null;
    }
  }
}

const boxOf = (r: { left: number; top: number; width: number; height: number }): CSSProperties => ({
  position: "absolute",
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The spot above a zone where summoned cards wait before dropping (bigger, see LIFT). */
function fallPoint(zone: DOMRect, dir: 1 | -1) {
  const w = zone.width * LIFT.scale;
  const h = zone.height * LIFT.scale;
  const cx = zone.left + zone.width / 2;
  const cy = zone.top + zone.height / 2 + dir * LIFT.rise * zone.height;
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, cx, cy };
}
type FallPoint = ReturnType<typeof fallPoint>;

/* ---------- step 2: materials leave the field ---------- */

function Material({ fx, rect, flipped, ghost }: { fx: Fx; rect: DOMRect; flipped: boolean; ghost: ReactNode }) {
  const form = fx.form!;
  if (form.shape === "swirl") {
    // Fusion: the material twists away into a whirlpool.
    const w = fx.sideways ? rect.height : rect.width;
    const h = fx.sideways ? rect.width : rect.height;
    return (
      <div style={{ ...boxOf(rect), display: "grid", placeItems: "center" }}>
        <Swirl code={fx.code} width={w} height={h} from={0} to={1} fadeFrom={1} fadeTo={0} duration={MATERIAL_HOLD - 60} rotate={(fx.sideways ? 90 : 0) + (flipped ? 180 : 0)} />
      </div>
    );
  }
  if (form.shape === "glow") {
    // Link: the card, white and shining, flares and disappears where it is. If it wasn't
    // shown as picked (someone else's summon), it turns white first.
    const turn = fx.previewed ? 0 : 200;
    return (
      <div style={{ ...boxOf(rect), display: "grid", placeItems: "center" }}>
        <div
          style={{
            position: "relative",
            ["--c" as string]: form.color,
            animation: `${fx.previewed ? "" : `fxLinkWhiten ${turn}ms ease-out both, `}fxLinkVanish ${LINK_LEAD - turn - 40}ms cubic-bezier(.5,0,.8,.4) ${turn}ms both`,
          }}
        >
          {ghost}
          <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: "#fff", opacity: 0.72, animation: fx.previewed ? undefined : `fxIn ${turn}ms ease-out both` }} />
        </div>
      </div>
    );
  }
  if (form.shape === "sphere") {
    // Xyz: the sphere shoots up out of the field window (it comes back down onto the vortex
    // when the monster is summoned, see XyzIn). If it wasn't shown while picked, the card
    // turns into it first.
    return <SphereUp rect={rect} color={form.color} formed={!!fx.previewed} ghost={ghost} />;
  }
  // Synchro: the shapes float up and dissolve. If the card wasn't shown as
  // picked (opponent's summon), it turns into them first.
  const w = Math.min(rect.width, rect.height);
  const h = Math.max(rect.width, rect.height);
  return (
    <div style={boxOf(rect)}>
      {!fx.previewed && <div style={{ position: "absolute", inset: 0, animation: "fxFadeOut 200ms ease-in forwards" }}>{ghost}</div>}
      {/* Each shape leaves on its own, the top one first, accelerating: they string out. */}
      <LeavingForm form={form} width={w} height={h} formed={!!fx.previewed} />
    </div>
  );
}

/** How long a material card takes to turn into its Xyz sphere when it wasn't shown picked. */
const SPHERE_FORM_MS = 220;

/** How long a flying sphere's trail is, in ms of its recent path. */
const TRAIL_MS = 220;

/**
 * A glowing ball in `color` with a smooth trail. An invisible marker is animated (see
 * animateTrail; `place` positions it); every frame a canvas over the page reads where it is
 * and draws the ball there, with its recent path behind it as a tapering, fading ribbon
 * (softly glowing), added onto what is below.
 */
function TrailBall({ color, size, place, boxRef }: { color: string; size: number; place: CSSProperties; boxRef: Ref<HTMLDivElement> }) {
  const ball = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.scale(dpr, dpr);
    const h = color.replace("#", "");
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6), 16);
    const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    const path: { x: number; y: number; r: number; t: number; a: number }[] = [];
    let raf = 0;
    const frame = (now: number) => {
      const el = ball.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const a = Number(getComputedStyle(el.parentElement!).opacity) || 0;
        path.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width, t: now, a });
      }
      while (path.length && now - path[0].t > TRAIL_MS) path.shift();
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const m = path.length;
      if (m > 1) {
        // Each point's sideways direction (normal to the path), for a ribbon without joints.
        const nx: number[] = [];
        const ny: number[] = [];
        for (let i = 0; i < m; i++) {
          const p = path[Math.max(0, i - 1)];
          const q = path[Math.min(m - 1, i + 1)];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const len = Math.hypot(dx, dy) || 1;
          nx.push(-dy / len);
          ny.push(dx / len);
        }
        // Outer glow, body, white-hot core: tapering from the ball's width to nothing, fading.
        for (const [wide, strength, white, blur] of [[1.6, 0.3, false, size * 0.5], [0.8, 0.5, false, 0], [0.3, 0.45, true, 0]] as const) {
          ctx.filter = blur ? `blur(${blur}px)` : "none";
          for (let i = 1; i < m; i++) {
            const p = path[i - 1];
            const q = path[i];
            const fp = Math.max(0, 1 - (now - p.t) / TRAIL_MS);
            const fq = Math.max(0, 1 - (now - q.t) / TRAIL_MS);
            const alpha = strength * fq * fq * Math.min(p.a, q.a);
            if (alpha <= 0.01) continue;
            const wp = (size * wide * fp) / 2;
            const wq = (size * wide * fq) / 2;
            ctx.fillStyle = white ? `rgba(255,255,255,${alpha})` : `rgba(${rgb},${alpha})`;
            ctx.beginPath();
            ctx.moveTo(p.x + nx[i - 1] * wp, p.y + ny[i - 1] * wp);
            ctx.lineTo(q.x + nx[i] * wq, q.y + ny[i] * wq);
            ctx.lineTo(q.x - nx[i] * wq, q.y - ny[i] * wq);
            ctx.lineTo(p.x - nx[i - 1] * wp, p.y - ny[i - 1] * wp);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.filter = "none";
      }
      // The ball itself, drawn here too so it is always exactly at the head of its trail.
      const head = path[path.length - 1];
      if (head && head.a > 0.01) {
        const R = head.r / 2;
        ctx.globalAlpha = head.a;
        const glow = ctx.createRadialGradient(head.x, head.y, R * 0.6, head.x, head.y, R * 2.6);
        glow.addColorStop(0, `rgba(${rgb},.7)`);
        glow.addColorStop(0.4, `rgba(${rgb},.25)`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(head.x, head.y, R * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        const body = ctx.createRadialGradient(head.x - R * 0.24, head.y - R * 0.32, 0, head.x, head.y, R);
        body.addColorStop(0, "#fff");
        body.addColorStop(0.38, color);
        body.addColorStop(0.7, color);
        body.addColorStop(1, `rgba(${rgb},.85)`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(head.x, head.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [color, size]);
  return (
    <div ref={boxRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvas} style={{ position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh", pointerEvents: "none" }} />
      <div data-trail style={{ ...place, width: size, height: size }}>
        <div
          ref={ball}
          // Only marks where the ball is; the canvas draws it (with its trail).
          style={{ width: "100%", height: "100%", visibility: "hidden" }}
        />
      </div>
    </div>
  );
}

/** Runs `frames` on a TrailBall's ball (the trail follows on its own). */
function animateTrail(box: HTMLElement | null, frames: Keyframe[], duration: number): Animation[] {
  const el = box?.querySelector<HTMLElement>("[data-trail]");
  return el ? [el.animate(frames, { duration, fill: "both", easing: "linear" })] : [];
}

/** Fades a sphere out as its centre `y` passes the top edge `top` of the field window. */
const edgeFade = (y: number, top: number, d: number) => Math.max(0, Math.min(1, (y - top) / d + 0.5));

/** An Xyz material's sphere shooting up from its cell, out of the top of the field window. */
function SphereUp({ rect, color, formed, ghost }: { rect: DOMRect; color: string; formed: boolean; ghost: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Same size as the sphere shown while picked (MaterialForm).
  const d = Math.min(Math.min(rect.width, rect.height) * 0.45, 26);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = document.querySelector("[data-field-window]")?.getBoundingClientRect().top ?? 0;
    const cy = rect.top + rect.height / 2;
    const up = cy - top + d * 2;
    const form = formed ? 0 : SPHERE_FORM_MS;
    const total = form + XYZ_UP_MS;
    const o = (t: number) => t / total;
    const at = (dy: number, scale: number, opacity = 1, offset?: number): Keyframe => ({
      transform: `translate(-50%, -50%) translateY(${dy}px) scale(${scale})`,
      opacity,
      ...(offset !== undefined ? { offset } : {}),
    });
    const frames: Keyframe[] = formed ? [at(0, 1, 1, 0)] : [at(0, 0.3, 0, 0), at(0, 1.1, 1, o(form * 0.7)), at(0, 1, 1, o(form))];
    // A little dip, then up, speeding away.
    frames.push(at(4, 1, 1, o(form + XYZ_UP_MS * 0.12)));
    for (let j = 1; j <= 12; j++) {
      const u = j / 12;
      const dy = -up * u * u;
      frames.push(at(dy, 1 - 0.15 * u, edgeFade(cy + dy, top, d), o(form + XYZ_UP_MS * (0.12 + 0.88 * u))));
    }
    const anims = animateTrail(el, frames, total);
    return () => anims.forEach((a) => a.cancel());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={boxOf(rect)}>
      {!formed && <div style={{ position: "absolute", inset: 0, animation: `fxFadeOut ${SPHERE_FORM_MS}ms ease-in forwards` }}>{ghost}</div>}
      <TrailBall
        color={color}
        size={d}
        boxRef={ref}
        place={{ position: "absolute", left: "50%", top: "50%", opacity: formed ? 1 : 0, transform: "translate(-50%, -50%)" }}
      />
    </div>
  );
}

/* ---------- step 5: Extra Deck summons ---------- */

/** Fusion: how long the materials take to appear on their circle. */
const FUSION_GATHER = 300;

/**
 * Fusion: the materials' cards appear on a circle above the zone, glowing in their
 * Attribute's colours, then are bent all together into a whirlpool (inner ends first:
 * curved blades, then long spiral arms) that turns and sinks into its centre (see WarpCards). When they all
 * reach it, they become a light, out of which the Fusion Monster swirls in (then the card
 * drops, see LandPlan).
 */
function FusionIn({
  fx,
  fp,
  tl,
  flipped,
  materials,
  colors,
}: {
  fx: Fx;
  fp: FallPoint;
  tl: SummonTimeline;
  flipped: boolean;
  materials: FxCard[];
  colors: string[];
}) {
  // Up to 8 on the circle. Without a material list only the light and the card show.
  const mats = materials.slice(0, 8);
  const n = Math.max(1, mats.length);
  const cardW = fp.width / LIFT.scale * 0.8;
  const cardH = cardHeight(cardW);
  const R = Math.max(fp.width, fp.height) * 0.95;
  // The group's box: the circle with the cards on it, plus room for their glow.
  const S = 2 * (R + cardH / 2) + 30;
  const light = colors.length ? "#e7d6ff" : "#ffffff";
  return (
    <>
      <div style={{ position: "absolute", left: fp.cx, top: fp.cy, width: 0, height: 0 }}>
        {/* The light in the middle, growing as the materials come in. */}
        <div
          style={{
            position: "absolute",
            left: -R * 0.6,
            top: -R * 0.6,
            width: R * 1.2,
            height: R * 1.2,
            borderRadius: "50%",
            background: `radial-gradient(circle, #fff 0%, ${light} 25%, #b58cff88 50%, #b58cff00 72%)`,
            mixBlendMode: "screen",
            opacity: 0,
            animation: `fxFusionLight ${FUSION_MERGE}ms ease-in forwards, fxOut 450ms ease-out ${FUSION_MERGE + 100}ms forwards`,
          }}
        />
        {/* The cards on their circle, bent all together into a whirlpool. */}
        <div style={{ position: "absolute", left: -S / 2, top: -S / 2 }}>
          <WarpCards
            size={S}
            delay={FUSION_GATHER + 40 * (n - 1)}
            duration={FUSION_MERGE - FUSION_GATHER - 40 * (n - 1)}
            cards={mats.map((m, i) => {
              // Evenly round the circle; two materials sit left and right (the first on the left).
              const a = (n === 2 ? Math.PI : -Math.PI / 2) + (i / n) * Math.PI * 2;
              return {
                code: m.faceDown ? 0 : m.code,
                x: Math.cos(a) * R,
                y: Math.sin(a) * R,
                width: cardW,
                height: cardH,
                color: colors[i] || "#b58cff",
                appearAt: i * 40,
              };
            })}
          />
        </div>
        {/* They become one flash of light... */}
        <Burst size={R * 2} color="#d9b8ffee" at={FUSION_MERGE - 60} />
      </div>
      {/* ...out of which the Fusion Monster swirls in. */}
      {/* Stays a moment past the reveal: it ends as the card itself in the same place, and the
          board's card (shown from the reveal) takes over without a blank frame between them. */}
      <div style={{ ...boxOf(fp), animation: `fxHide 1ms linear ${tl.reveal + 150}ms forwards` }}>
        <Swirl
          code={fx.code}
          width={fp.width}
          height={fp.height}
          from={-1}
          to={0}
          fadeFrom={0}
          fadeTo={1}
          duration={FUSION_SWIRL_MS}
          delay={FUSION_MERGE}
          rotate={flipped ? 180 : 0}
        />
      </div>
    </>
  );
}

/**
 * Synchro: rings (Tuner Levels) appear above the zone, spheres (other Levels) fall into
 * them, everything glows into the silhouette of a card, the card appears, then drops.
 */
function SynchroIn({ fp, tl, tuner, other }: { fp: FallPoint; tl: SummonTimeline; tuner: number; other: number }) {
  // One ring per Tuner Level, one sphere per Level of the other materials.
  const rings = Math.min(12, tuner);
  const spheres = Math.min(12, other);
  // A bit smaller than a field cell (the fall point is the card scaled by LIFT.scale).
  const ringD = (fp.height / LIFT.scale + 6) * 0.88;
  // Rings stacked with clear gaps so each one can be told apart (column at most ~2.4 cards tall).
  const gap = rings > 1 ? Math.min(ringD * 0.42, (fp.height * 2.4) / (rings - 1)) : 0;
  const colH = Math.max(ringD * 0.5, gap * (rings - 1));
  const glowAt = tl.reveal - 350;
  const local = (y: number): CSSProperties => ({ position: "absolute", left: fp.width / 2, top: y });
  // Spheres fall one after another in single file, accelerating, so they spread apart as
  // they go; the first one goes to the lowest slot.
  const fall = 380;
  const stagger = spheres > 1 ? Math.min(160, (glowAt - 300 - fall) / (spheres - 1)) : 0;
  return (
    <div style={boxOf(fp)}>
      {Array.from({ length: rings }, (_, i) => {
        const y = fp.height / 2 + (i - (rings - 1) / 2) * gap;
        return (
          <div
            key={`r${i}`}
            style={{
              ...local(y),
              width: ringD / RING_IMAGE_FILL,
              height: ringD / RING_IMAGE_FILL,
              marginLeft: -ringD / RING_IMAGE_FILL / 2,
              marginTop: -ringD / RING_IMAGE_FILL / 2,
              opacity: 0,
              ["--y" as string]: `${fp.height / 2 - y}px`,
              animation: `fxSyncRing ${tl.reveal}ms linear ${i * 40}ms forwards`,
            }}
          >
            <SynchroRing size={ringD} />
          </div>
        );
      })}
      {Array.from({ length: spheres }, (_, j) => {
        const slot = spheres === 1 ? fp.height / 2 : fp.height / 2 + colH / 2 - (j * colH) / (spheres - 1);
        const d = Math.max(6, Math.min(fp.width * 0.18, 16));
        const start = 300 + j * stagger;
        return (
          <div
            key={`s${j}`}
            style={{
              ...local(slot),
              width: d,
              height: d,
              marginLeft: -d / 2,
              marginTop: -d / 2,
              borderRadius: "50%",
              ...(shinyDotStyle as CSSProperties),
              opacity: 0,
              ["--from" as string]: `${-(fp.top + slot + 40)}px`,
              ["--y" as string]: `${fp.height / 2 - slot}px`,
              animation: `fxFallIn ${fall}ms cubic-bezier(.55,0,.9,.4) ${start}ms both, fxConverge 320ms ease-in ${glowAt}ms forwards`,
            }}
          />
        );
      })}
      {/* Everything turns into a glowing card silhouette, which fades as the card appears
          (quickly, before the card winds up for its drop). */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 6,
          background: `radial-gradient(ellipse at center, #f4fff0 0%, ${NEON_GREEN} 55%, ${NEON_GREEN}aa 100%)`,
          boxShadow: `0 0 18px 6px ${NEON_GREEN}, 0 0 40px 10px ${NEON_GREEN}66`,
          opacity: 0,
          animation: `fxInScale 300ms ease-out ${glowAt}ms forwards, fxOut 130ms ease-in ${tl.reveal}ms forwards`,
        }}
      />
    </div>
  );
}

/** The Xyz galaxy's width : height. */
const GALAXY_ASPECT = 1.7;

/**
 * Xyz: a galaxy vortex in the monster's Attribute colour appears above the zone. The
 * materials' spheres (which shot up out of the field when they were used) fall back from
 * the top of the field window one by one, circling an imaginary line that runs straight up
 * from the vortex's centre, closer and closer to it as they fall (a V), and drop into the
 * centre. When the last one gets there it explodes, the card appears out of the explosion
 * in the Attribute's light, and then drops.
 */
function XyzIn({ fp, tl, color, colors }: { fp: FallPoint; tl: SummonTimeline; color: string; colors: string[] }) {
  // The galaxy: GALAXY_ASPECT times as wide as it is tall.
  const D = Math.max(fp.width, fp.height) * 2.1;
  const Rv = D / 2;
  const Rw = (D * GALAXY_ASPECT) / 2;
  const last = tl.hits[tl.hits.length - 1];
  const dot = Math.max(10, Math.min(fp.width * 0.26, 20));
  const sphereRefs = useRef<(HTMLDivElement | null)[]>([]);
  // From the explosion on, the collapsing galaxy only adds light (dark parts must not dim it).
  const [blast, setBlast] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBlast(true), last - 20);
    return () => clearTimeout(t);
  }, [last]);
  useEffect(() => {
    // The line: from the vortex's centre straight up to just past the top of the field window.
    const top = document.querySelector("[data-field-window]")?.getBoundingClientRect().top ?? 0;
    const sky = Math.min(top - dot * 2, fp.cy - Rv * 2);
    // Widest circle at the top, closing in to nothing at the centre; this many turns on the way.
    const R0 = Rw * 0.8;
    const TURNS = 1.5;
    const anims: Animation[] = [];
    tl.hits.forEach((hit, i) => {
      const el = sphereRefs.current[i];
      if (!el) return;
      const launch = hit - XYZ_FLY_MS;
      const k = (t: number) => Math.min(1, t / hit);
      const pos = (x: number, y: number, scale = 1, opacity = 1, offset?: number): Keyframe => ({
        transform: `translate(${x - dot / 2}px, ${y - dot / 2}px) scale(${scale})`,
        opacity,
        ...(offset !== undefined ? { offset } : {}),
      });
      const frames: Keyframe[] = [pos(fp.cx, sky, 1, 0, 0), pos(fp.cx, sky, 1, 0, k(launch))];
      // Falling, speeding up a little; every sphere takes the same path.
      const steps = 60;
      for (let j = 1; j <= steps; j++) {
        const u = j / steps;
        const h = 1 - Math.pow(u, 1.35); // height left, 1 at the top, 0 at the centre
        const y = fp.cy + (sky - fp.cy) * h;
        const phase = TURNS * 2 * Math.PI * u;
        const x = fp.cx + R0 * h * Math.sin(phase);
        // Nearer when on the front of the circle: a touch bigger.
        const scale = (1 + 0.15 * Math.cos(phase)) * (0.55 + 0.45 * Math.sqrt(h));
        frames.push(pos(x, y, scale, j === steps ? 0 : edgeFade(y, top, dot), k(launch + XYZ_FLY_MS * u)));
      }
      anims.push(...animateTrail(el, frames, hit));
    });
    return () => anims.forEach((a) => a.cancel());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const center = { left: fp.cx - 1, top: fp.cy - 1, width: 2, height: 2 };
  return (
    <>
      {/* The vortex: grows in, turns, and collapses into the explosion. */}
      <div
        style={{
          position: "absolute",
          left: fp.cx - Rw,
          top: fp.cy - Rv,
          width: Rw * 2,
          height: D,
          mixBlendMode: blast ? "screen" : undefined,
          opacity: 0,
          animation: `fxXyzVortexIn ${XYZ_VORTEX_IN}ms ease-out forwards, fxXyzVortexOut 260ms ease-in ${last}ms forwards`,
        }}
      >
        <Vortex size={D} aspect={GALAXY_ASPECT} color={color} charges={tl.hits} />
      </div>
      {/* The material spheres (each in its Attribute's colour), with their trails. */}
      {tl.hits.map((hit, i) => {
        const c = colors[i % Math.max(1, colors.length)] ?? color;
        return (
          <TrailBall
            key={i}
            color={c}
            size={dot}
            boxRef={(el) => {
              sphereRefs.current[i] = el;
            }}
            place={{ position: "absolute", left: 0, top: 0, opacity: 0 }}
          />
        );
      })}
      {/* Each sphere flashes as it reaches the core... */}
      {tl.hits.slice(0, -1).map((hit, i) => (
        <div key={`f${i}`} style={boxOf(center)}>
          <Burst size={Rv * 0.9} color={`${colors[i % Math.max(1, colors.length)] ?? color}cc`} at={hit - 10} />
        </div>
      ))}
      {/* ...and the last one sets off the explosion. */}
      <div style={boxOf(center)}>
        <Burst size={D * 1.7} color={`${color}ee`} at={last - 10} />
        <div
          style={{
            position: "absolute",
            left: -D * 0.75,
            top: -D * 0.75,
            width: D * 1.5,
            height: D * 1.5,
            borderRadius: "50%",
            border: `3px solid ${color}`,
            boxShadow: `0 0 16px 4px ${color}`,
            opacity: 0,
            animation: `fxBlast 420ms ease-out ${last}ms forwards`,
          }}
        />
      </div>
      <Sparks rect={{ left: fp.cx - Rv / 2, top: fp.cy - Rv / 2, width: Rv, height: Rv }} color={color} at={last} count={22} />
      {/* The card then appears out of the explosion shining in the Attribute's colour: that
          light is part of the card's own animation (LandPlan.glow), so it stays on it. */}
    </>
  );
}

/**
 * Ritual: a ring of blue fire appears above the zone, the card appears inside it in a
 * burst of blue light, the fire dies down and the card drops (the cell then glows blue).
 */
function RitualIn({ fp, tl }: { fp: FallPoint; tl: SummonTimeline }) {
  // Ring a little bigger than the card; the canvas leaves room for the flames above it.
  const R = Math.max(fp.width, fp.height) * 0.68;
  const S = R * 3.2;
  const out = tl.drop - 160;
  return (
    <div style={{ position: "absolute", left: fp.cx - S / 2, top: fp.cy - S / 2, width: S, height: S }}>
      <RitualFire size={S} radius={R} stopAt={out} endAt={tl.drop + 200} />
      {/* The card's blue light is part of its own animation (LandPlan.glow). */}
    </div>
  );
}

/**
 * A ring of blue fire: tongues of flame rise from every point of the circle, flicker and
 * cool from white to blue as they fade; overlapping flames add up (additive blending), so
 * the ring burns brightest where they are densest. It grows in, burns, and dies down from
 * `stopAt` (ms).
 */
function RitualFire({ size, radius, stopAt, endAt }: { size: number; radius: number; stopAt: number; endAt: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);
    const c = size / 2;
    const unit = radius / 60; // scale everything with the ring
    type P = { x: number; y: number; vx: number; vy: number; life: number; age: number; r: number; seed: number };
    const ps: P[] = [];
    const t0 = performance.now();
    let last = t0;
    let raf = 0;
    const frame = (now: number) => {
      const t = now - t0;
      const dt = Math.min(48, now - last);
      last = now;
      // The ring grows in over RITUAL_RING_IN, burns, then stops feeding at stopAt.
      const grow = Math.min(1, t / RITUAL_RING_IN);
      const ringR = radius * (0.55 + 0.45 * (1 - Math.pow(1 - grow, 3)));
      if (t < stopAt) {
        const n = Math.round((dt / 1000) * 1100 * (0.4 + 0.6 * grow));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const jitter = (Math.random() - 0.5) * 4 * unit;
          ps.push({
            x: c + Math.cos(a) * (ringR + jitter),
            y: c + Math.sin(a) * (ringR + jitter),
            // Fire rises, with a little push outwards from the ring.
            vx: Math.cos(a) * 6 * unit + (Math.random() - 0.5) * 8 * unit,
            vy: -(30 + Math.random() * 40) * unit + Math.sin(a) * 4 * unit,
            life: 260 + Math.random() * 360,
            age: 0,
            r: (2.4 + Math.random() * 3.2) * unit,
            seed: Math.random() * 1000,
          });
        }
      }
      // Fade the last frame instead of clearing it: each flame leaves a streak as it rises,
      // which is what makes it read as fire rather than dots.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, 0.3 * (dt / 16))})`;
      ctx.fillRect(0, 0, size, size);
      // A soft glow where the fire burns.
      const fade = t < stopAt ? grow : Math.max(0, 1 - (t - stopAt) / 220);
      if (fade > 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.save();
        ctx.strokeStyle = `rgba(90,170,255,${0.22 * fade})`;
        ctx.shadowColor = RITUAL_BLUE;
        ctx.shadowBlur = 18 * unit;
        ctx.lineWidth = 5 * unit;
        ctx.beginPath();
        ctx.arc(c, c, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalCompositeOperation = "lighter";
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) {
          ps.splice(i, 1);
          continue;
        }
        // Flicker sideways as it rises; flames speed up and narrow towards their tips.
        p.x += (p.vx + Math.sin((p.age + p.seed) / 70) * 10 * unit) * (dt / 1000);
        p.y += p.vy * (1 + 1.6 * k) * (dt / 1000);
        const r = p.r * (1 - k * 0.75);
        // White-hot at the base, cooling to blue, then to a faint deep blue.
        const [cr, cg, cb] = k < 0.18 ? [230, 245, 255] : k < 0.5 ? [110, 185, 255] : [40, 110, 255];
        const alpha = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) * 0.8;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`);
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t < endAt || ps.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, radius, stopAt, endAt]);
  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: size, height: size }} />;
}

/** Link Arrow bits clockwise from the top, with the picture of each (public/fx/link). */
const LINK_ARROWS: { bit: number; file: string }[] = [
  { bit: 0x080, file: "t" },
  { bit: 0x100, file: "tr" },
  { bit: 0x020, file: "r" },
  { bit: 0x004, file: "br" },
  { bit: 0x002, file: "b" },
  { bit: 0x001, file: "bl" },
  { bit: 0x008, file: "l" },
  { bit: 0x040, file: "tl" },
];

/**
 * Where the Link frame pictures live (public/fx/link): frame.svg plus one SVG per arrow in
 * dark/ (unlit) and light/ (lit). All are 2000x2000 and stack on top of each other, so
 * any of them can be replaced.
 */
const LINK_FX = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fx/link`;
/** How much of the 2000-unit picture the card's height takes in the middle of the frame. */
const LINK_CARD_UNITS = 600;

/**
 * Link: after the materials vanish, the Link frame appears above the zone (bigger than a
 * cell) with every arrow dark. The monster's arrows light up one by one, the card appears
 * in the middle, the frame goes, and the card falls into its zone.
 */
function LinkIn({
  fp,
  tl,
  marker,
  flipped,
}: {
  fp: FallPoint;
  tl: SummonTimeline;
  marker: number;
  flipped: boolean;
}) {
  // The pictures are square; the card fills LINK_CARD_UNITS of their 2000 units.
  const S = (fp.height * 2000) / LINK_CARD_UNITS;
  const frame = { left: fp.cx - S / 2, top: fp.cy - S / 2, width: S, height: S };
  const lit = LINK_ARROWS.filter((a) => marker & a.bit);
  // The frame clears just before the card falls (the card itself is drawn by the board).
  const grow = Math.round(FADE_MS * LINK_SPEED);
  const out = Math.max(tl.reveal + grow, tl.drop - 180);
  const layer: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" };
  return (
    <>
      <div
        style={{
          ...boxOf(frame),
          // Arrows point the way the monster faces: the opponent's are turned around.
          ["--rot" as string]: flipped ? "rotate(180deg)" : "rotate(0deg)",
          transform: "var(--rot)",
          opacity: 0,
          animation: `fxLinkFrameIn ${LINK_FRAME_IN}ms ease-out ${LINK_LEAD}ms forwards, fxOut ${tl.drop - out}ms ease-in ${out}ms forwards`,
        }}
      >
        <img src={`${LINK_FX}/frame.svg`} alt="" draggable={false} style={layer} />
        {LINK_ARROWS.map((a) => (
          <img key={`d${a.bit}`} src={`${LINK_FX}/dark/${a.file}.svg`} alt="" draggable={false} style={layer} />
        ))}
        {lit.map((a, i) => (
          // The lit arrow fades in over the dark one with a flash.
          <img
            key={`l${a.bit}`}
            src={`${LINK_FX}/light/${a.file}.svg`}
            alt=""
            draggable={false}
            style={{ ...layer, opacity: 0, animation: `fxLinkArrow ${Math.round(420 * LINK_SPEED)}ms ease-out ${tl.hits[i] ?? 0}ms forwards` }}
          />
        ))}
      </div>
      {/* The card grows in in the middle of the frame: that is the board's own card (enter
          "grow"), drawn above these effects, so it winds up and falls as one. */}
    </>
  );
}

/* ---------- battle ---------- */

/**
 * The attacker rushes into its target (or towards the opponent's LP bar for a direct
 * attack), knocks it back a little, and returns to its zone. Uses the card's `translate`
 * property, so its own rotation (defence position, the opponent's side) is kept.
 */
function bump(cardId: number, targetId: number | undefined, toPlayer: number, tier?: 1 | 2 | 3) {
  const el = document.querySelector<HTMLElement>(`[data-board] [data-card-id="${cardId}"]`);
  const target =
    targetId !== undefined
      ? document.querySelector<HTMLElement>(`[data-board] [data-card-id="${targetId}"]`)
      : document.querySelector<HTMLElement>(`[data-lp="${toPlayer}"]`);
  if (!el || !target) return;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  // A card: aim at its centre. The LP bar: the point of it straight across from the attacker.
  const bx = targetId !== undefined ? b.left + b.width / 2 : Math.min(b.right, Math.max(b.left, ax));
  const by = b.top + b.height / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 1;
  // Stop where the two meet (edges touching, a little overlap for the hit).
  const reach = targetId !== undefined ? (Math.min(a.width, a.height) + Math.min(b.width, b.height)) * 0.42 : a.height * 0.45 + b.height / 2;
  const travel = Math.max(0, dist - reach);
  const tx = (dx / dist) * travel;
  const ty = (dy / dist) * travel;
  // The step back before the rush: away from the target, over half a card.
  const back = Math.min(a.width, a.height) * 0.65;
  const bx0 = (dx / dist) * back;
  const by0 = (dy / dist) * back;
  // Above the other cells while it moves.
  const cell = el.closest<HTMLElement>("[data-cell]");
  const z = cell?.style.zIndex ?? "";
  if (cell) cell.style.zIndex = "30";
  const anim = el.animate(
    [
      // A few steps back first, gathering speed (a little crouched)...
      { translate: "0px 0px", scale: "1", easing: "ease-out" },
      { translate: `${-bx0}px ${-by0}px`, scale: "0.93", offset: BUMP_WINDUP * 0.8, easing: "ease-in-out" },
      { translate: `${-bx0 * 0.9}px ${-by0 * 0.9}px`, scale: "0.95", offset: BUMP_WINDUP, easing: "cubic-bezier(.55,0,1,.45)" },
      // ...then the rush.
      { translate: `${tx}px ${ty}px`, scale: "1.08", offset: BUMP_HIT, easing: "ease-out" },
      { translate: `${tx * 0.9}px ${ty * 0.9}px`, scale: "1.04", offset: BUMP_HIT + 0.1, easing: "ease-in-out" },
      { translate: "0px 0px", scale: "1" },
    ],
    { duration: BUMP_MS },
  );
  anim.onfinish = anim.oncancel = () => {
    if (cell) cell.style.zIndex = z;
  };
  // The hit sends a wave through the field from where they meet (by the attacker's ATK).
  if (tier) {
    const hx = ax + tx;
    const hy = ay + ty;
    const at = new DOMRect(hx - a.width / 2, hy - a.height / 2, a.width, a.height);
    setTimeout(() => ripple(at, tier), BUMP_MS * BUMP_HIT);
  }
  // The target is knocked back a little when it is hit.
  if (targetId !== undefined) {
    const kx = (dx / dist) * 8;
    const ky = (dy / dist) * 8;
    target.animate(
      [
        { translate: "0px 0px" },
        { translate: `${kx}px ${ky}px`, offset: 0.35 },
        { translate: `${-kx * 0.3}px ${-ky * 0.3}px`, offset: 0.7 },
        { translate: "0px 0px" },
      ],
      { duration: 260, delay: BUMP_MS * BUMP_HIT, easing: "ease-out" },
    );
  }
}

/* ---------- into a pile ---------- */

/**
 * A card going into a pile it isn't drawn on top of (the bottom of the Deck, shuffled in,
 * several at once): a copy flies from where it was onto the pile and sinks into it (to the
 * bottom of the Deck: it slides in underneath).
 */
function ToPile({ rect, pile, bottom, ghost }: { rect: DOMRect; pile: string; bottom: boolean; ghost: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const target = document.querySelector<HTMLElement>(`[data-pile="${pile}"]`)?.getBoundingClientRect();
    if (!el || !target) return;
    const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
    const dy = target.top + target.height / 2 - (rect.top + rect.height / 2);
    // Ends about the size of a card in the pile.
    const s = Math.min(1, (target.height - 6) / Math.max(rect.width, rect.height));
    const under = bottom ? 0.22 * target.height : 0;
    const a = el.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1, offset: 0.72, easing: "ease-in" },
        { transform: `translate(${dx}px, ${dy + under}px) scale(${s * 0.96})`, opacity: 0, offset: 1 },
      ],
      { duration: TO_PILE_MS, easing: "cubic-bezier(.3,.6,.3,1)", fill: "forwards" },
    );
    return () => a.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    // Under the pile when it slides to the bottom; over it otherwise.
    <div ref={ref} style={{ ...boxOf(rect), display: "grid", placeItems: "center", zIndex: bottom ? 0 : 1 }}>
      {ghost}
    </div>
  );
}

/** A Deck pile being shuffled: its card shifts left and right a few times. */
function shufflePile(pile: string) {
  const el = document.querySelector<HTMLElement>(`[data-pile="${pile}"] [data-card-id]`);
  if (!el) return;
  el.animate(
    [
      { translate: "0px 0px", rotate: "0deg" },
      { translate: "-9px -2px", rotate: "-6deg", offset: 0.15 },
      { translate: "8px 1px", rotate: "5deg", offset: 0.35 },
      { translate: "-7px 0px", rotate: "-4deg", offset: 0.55 },
      { translate: "5px -1px", rotate: "3deg", offset: 0.75 },
      { translate: "0px 0px", rotate: "0deg" },
    ],
    { duration: SHUFFLE_MS, easing: "ease-in-out" },
  );
}

/* ---------- LP changes ---------- */

/** When the LP number has popped up, and when it starts flying to the bar (ms). */
const LP_SHOWN = 250;
const LP_FLY_AT = 620;

/**
 * An LP change: the amount pops up over that player's side of the field (red when LP is lost,
 * green when gained), waits a moment, then flies into the LP value on their bar. A loss hits
 * it: the bar is knocked in the direction it came from and flashes red, with a burst. A gain
 * just lands there with a green glow. The bar shows the new LP once it has arrived (the fx
 * ends at LP_HIT_MS).
 */
function LpChange({ player, amount }: { player: number; amount: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const loss = amount < 0;
  const color = loss ? "#ff3b3b" : "#3ddc84";
  useLayoutEffect(() => {
    const el = ref.current;
    const bar = document.querySelector<HTMLElement>(`[data-lp="${player}"]`);
    const value = document.querySelector<HTMLElement>(`[data-lp-value="${player}"]`) ?? bar;
    const board = document.querySelector<HTMLElement>("[data-board]");
    if (!el || !bar || !value || !board) return;
    // Over that player's half of the field (the half next to their LP bar).
    const b = board.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const below = barRect.top > b.top + b.height / 2;
    const sx = b.left + b.width / 2;
    const sy = b.top + b.height * (below ? 0.72 : 0.28);
    const v = value.getBoundingClientRect();
    const ex = v.left + v.width / 2;
    const ey = v.top + v.height / 2;
    const at = (x: number, y: number) => `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    const o = (t: number) => t / LP_HIT_MS;
    el.animate(
      [
        { transform: `${at(sx, sy)} scale(.3)`, opacity: 0 },
        { transform: `${at(sx, sy)} scale(1.15)`, opacity: 1, offset: o(LP_SHOWN * 0.7) },
        { transform: `${at(sx, sy)} scale(1)`, opacity: 1, offset: o(LP_SHOWN) },
        { transform: `${at(sx, sy)} scale(1)`, opacity: 1, offset: o(LP_FLY_AT), easing: loss ? "cubic-bezier(.6,0,1,.6)" : "cubic-bezier(.4,0,.6,1)" },
        { transform: `${at(ex, ey)} scale(${loss ? 0.9 : 0.6})`, opacity: loss ? 1 : 0.2 },
      ],
      { duration: LP_HIT_MS, fill: "forwards" },
    );
    const t = setTimeout(() => {
      if (loss) {
        // A red burst where it hits. On the page itself: this effect ends right now (the bar
        // then shows the new LP), the burst plays on a little.
        const burst = document.createElement("div");
        Object.assign(burst.style, {
          position: "fixed",
          left: `${ex - 60}px`,
          top: `${ey - 60}px`,
          width: "120px",
          height: "120px",
          borderRadius: "50%",
          background: "radial-gradient(circle, #fff 0%, #ff3b3bee 35%, rgba(0,0,0,0) 70%)",
          mixBlendMode: "screen",
          pointerEvents: "none",
          zIndex: "60",
        });
        document.body.appendChild(burst);
        burst
          .animate(
            [
              { opacity: 0.95, transform: "scale(.3)" },
              { opacity: 0, transform: "scale(1.4)" },
            ],
            { duration: 420, easing: "ease-out" },
          )
          .finished.finally(() => burst.remove());
        // Knocked the way the number was going, and a red flash.
        const dir = Math.sign(ey - sy) || 1;
        bar.animate(
          [
            { translate: "0px 0px", boxShadow: "0 0 0 2px #ff3b3b, 0 0 22px 6px rgba(255,59,59,.85)" },
            { translate: `0px ${dir * 7}px`, offset: 0.2 },
            { translate: `0px ${-dir * 3}px`, offset: 0.45 },
            { translate: `0px ${dir * 1.5}px`, offset: 0.7 },
            { translate: "0px 0px", boxShadow: "0 0 0 0 rgba(255,59,59,0)" },
          ],
          { duration: 480, easing: "ease-out" },
        );
      } else {
        bar.animate(
          [
            { boxShadow: "0 0 0 1px #3ddc84, 0 0 18px 5px rgba(61,220,132,.7)" },
            { boxShadow: "0 0 0 0 rgba(61,220,132,0)" },
          ],
          { duration: 600, easing: "ease-out" },
        );
      }
    }, LP_HIT_MS - 10);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        opacity: 0,
        fontSize: 34,
        fontWeight: 900,
        letterSpacing: 1,
        fontVariantNumeric: "tabular-nums",
        color,
        WebkitTextStroke: "1px rgba(0,0,0,.6)",
        textShadow: `0 0 6px ${color}, 0 0 16px ${color}aa, 0 2px 4px rgba(0,0,0,.8)`,
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {loss ? `−${-amount}` : `+${amount}`}
    </div>
  );
}

/* ---------- landing ---------- */

/**
 * A summoned card hits its zone: the cell dips and bounces back, and the cells around it
 * follow one after another with less and less force, like rings on water. Level 7+
 * hits harder and the wave travels further; tier 3 (an attack with 4000+ ATK) reaches the
 * whole field, hits hardest and shakes the field.
 * Also used for attacks, by the attacker's ATK (see bump).
 */
function ripple(at: DOMRect, tier: 1 | 2 | 3) {
  const cells = document.querySelectorAll<HTMLElement>("[data-board] [data-cell]");
  const cx = at.left + at.width / 2;
  const cy = at.top + at.height / 2;
  const unit = Math.max(at.width, at.height) + 6;
  // 1 normal, 2 strong (Level 7+ landing), 3 strongest (4000+ ATK hit): the whole field.
  const reach = [0, 3, 5, 9][tier];
  const force = [0, 0.11, 0.17, 0.24][tier];
  const duration = [0, 640, 820, 1000][tier];
  if (tier === 3) {
    // The strongest also shakes the whole field.
    const board = document.querySelector<HTMLElement>("[data-board]");
    board?.animate(
      [
        { translate: "0px 0px" },
        { translate: "-7px 4px" },
        { translate: "6px -5px" },
        { translate: "-5px -3px" },
        { translate: "4px 4px" },
        { translate: "-2px 1px" },
        { translate: "0px 0px" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }
  cells.forEach((el) => {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const d = Math.hypot(dx, dy) / unit;
    if (d > reach) return;
    const amp = force * Math.exp(-d * 0.6);
    // Neighbours are pushed outwards a little as the wave passes.
    const len = Math.hypot(dx, dy) || 1;
    const push = d < 0.3 ? 0 : amp * unit * 0.35;
    const ux = (dx / len) * push;
    const uy = (dy / len) * push;
    el.animate(
      [
        { transform: "none", filter: "none" },
        { transform: `translate(${ux}px, ${uy}px) scale(${1 - amp})`, filter: `brightness(${1 + amp * 2.5})`, offset: 0.28 },
        { transform: `translate(${-ux * 0.45}px, ${-uy * 0.45}px) scale(${1 + amp * 0.5})`, filter: "brightness(1)", offset: 0.58 },
        { transform: `translate(${ux * 0.15}px, ${uy * 0.15}px) scale(${1 - amp * 0.18})`, offset: 0.82 },
        { transform: "none", filter: "none" },
      ],
      { duration, delay: d * [0, 65, 75, 85][tier], easing: "ease-out" },
    );
  });
}

/** Small particles bursting out of a rect's centre. */
function Sparks({ rect, color, at, count, dust }: { rect: { width: number; height: number; left: number; top: number }; color: string; at: number; count: number; dust?: boolean }) {
  const size = Math.max(rect.width, rect.height);
  return (
    <div style={boxOf(rect)}>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 2) * 0.2;
        const dist = size * (dust ? 0.7 : 0.9) * (0.75 + ((i * 37) % 25) / 100);
        const s = dust ? 4 + (i % 3) : 3 + (i % 2);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: dust ? "85%" : "50%",
              width: s,
              height: s,
              marginLeft: -s / 2,
              borderRadius: "50%",
              background: color,
              boxShadow: dust ? undefined : `0 0 6px 2px ${color}`,
              opacity: 0,
              ["--dx" as string]: `${Math.cos(a) * dist}px`,
              ["--dy" as string]: `${Math.sin(a) * dist * (dust ? 0.35 : 1)}px`,
              animation: `fxEmber ${dust ? 550 : 600}ms ease-out ${at + (i % 3) * 25}ms forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/** A flash where something hits. */
function Burst({ size, color, at }: { size: number; color: string; at: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: "50%",
        background: `radial-gradient(circle, #fff 0%, ${color} 35%, rgba(0,0,0,0) 70%)`,
        mixBlendMode: "screen",
        opacity: 0,
        animation: `fxBurst 420ms ease-out ${at}ms forwards`,
      }}
    />
  );
}

/* ---------- destroyed by an effect / by battle ---------- */

const SHARDS: { clip: string; dx: number; dy: number; rot: number }[] = [
  { clip: "0 0, 55% 0, 42% 44%, 0 34%", dx: -0.7, dy: -0.6, rot: -40 },
  { clip: "55% 0, 100% 0, 100% 40%, 42% 44%", dx: 0.7, dy: -0.7, rot: 35 },
  { clip: "0 34%, 42% 44%, 30% 100%, 0 100%", dx: -0.8, dy: 0.6, rot: 30 },
  { clip: "42% 44%, 100% 40%, 100% 100%, 66% 100%", dx: 0.8, dy: 0.7, rot: -30 },
  { clip: "42% 44%, 66% 100%, 30% 100%", dx: 0.05, dy: 1, rot: 60 },
];

function Shatter({ box, card, rect }: { box: CSSProperties; card: React.ReactNode; rect: DOMRect }) {
  const size = Math.max(rect.width, rect.height);
  return (
    <div style={box}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: size * 1.6,
          height: size * 1.6,
          marginLeft: -size * 0.8,
          marginTop: -size * 0.8,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,170,60,.85), rgba(255,90,30,.35) 45%, rgba(255,60,0,0) 70%)",
          opacity: 0,
          animation: "fxBurst 650ms ease-out 140ms forwards",
        }}
      />
      {SHARDS.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `polygon(${s.clip})`,
            ["--dx" as string]: `${s.dx * size * 0.9}px`,
            ["--dy" as string]: `${s.dy * size * 0.9}px`,
            ["--rot" as string]: `${s.rot}deg`,
            animation: "fxHeat 180ms ease-in forwards, fxShard 700ms cubic-bezier(.2,.6,.3,1) 170ms forwards",
          }}
        >
          {card}
        </div>
      ))}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#ffb347",
              boxShadow: "0 0 6px 2px rgba(255,120,30,.9)",
              opacity: 0,
              ["--dx" as string]: `${Math.cos(a) * size * 0.8}px`,
              ["--dy" as string]: `${Math.sin(a) * size * 0.8}px`,
              animation: `fxEmber 600ms ease-out ${170 + (i % 3) * 40}ms forwards`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- destroyed by battle: slashed in two ---------- */

function BattleCut({ box, card, rect }: { box: CSSProperties; card: React.ReactNode; rect: DOMRect }) {
  const size = Math.max(rect.width, rect.height);
  // The cut runs from the top-right to the bottom-left; halves fly apart across it.
  const angle = (Math.atan2(rect.height * 0.4, rect.width) * 180) / Math.PI;
  const halves = [
    { clip: "0 0, 100% 0, 100% 30%, 0 70%", dx: -0.25, dy: -0.35, rot: -12 },
    { clip: "0 70%, 100% 30%, 100% 100%, 0 100%", dx: 0.25, dy: 0.35, rot: 12 },
  ];
  return (
    <div style={box}>
      {halves.map((h, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `polygon(${h.clip})`,
            ["--dx" as string]: `${h.dx * size}px`,
            ["--dy" as string]: `${h.dy * size}px`,
            ["--rot" as string]: `${h.rot}deg`,
            animation: "fxHit 200ms ease-in forwards, fxHalf 650ms cubic-bezier(.3,.6,.3,1) 220ms forwards",
          }}
        >
          {card}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: size * 1.7,
          height: 4,
          marginLeft: -size * 0.85,
          marginTop: -2,
          borderRadius: 2,
          background: "linear-gradient(90deg, rgba(255,255,255,0), #fff 30%, #fff 70%, rgba(255,255,255,0))",
          boxShadow: "0 0 10px 3px rgba(255,80,80,.85)",
          transform: `rotate(${-angle}deg) scaleX(0)`,
          ["--angle" as string]: `${-angle}deg`,
          animation: "fxSlash 380ms ease-out 40ms forwards",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -6,
          borderRadius: 8,
          background: "rgba(255,40,40,.45)",
          filter: "blur(6px)",
          opacity: 0,
          animation: "fxFlash 420ms ease-out 120ms forwards",
        }}
      />
    </div>
  );
}

const KEYFRAMES = `
@keyframes fxHide { to { opacity: 0; visibility: hidden; } }
@keyframes fxFadeOut { 0% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fxSpinFallback { from { transform: rotate(0deg) scale(var(--s0)); opacity: var(--o0); } to { transform: rotate(var(--spin)) scale(var(--s1)); opacity: var(--o1); } }
@keyframes fxSyncRing {
  0% { opacity: 0; transform: scale(.3); }
  20% { opacity: 1; transform: scale(1); }
  72% { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); }
  100% { opacity: 0; transform: translateY(var(--y)) scale(.4); filter: brightness(2.5); }
}
@keyframes fxFallIn { from { opacity: 1; transform: translateY(var(--from)); } to { opacity: 1; transform: translateY(0); } }
@keyframes fxConverge { from { opacity: 1; transform: translateY(0) scale(1); filter: brightness(1); } to { opacity: 0; transform: translateY(var(--y)) scale(.4); filter: brightness(2.5); } }
@keyframes fxFollowUp { from { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } to { opacity: 0; transform: translate(-50%, calc(-50% - var(--up))) scale(.65); filter: blur(2px); } }
@keyframes fxIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fxInScale { from { opacity: 0; transform: scale(.88); } to { opacity: 1; transform: scale(1); } }
@keyframes fxOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes fxDissolve { from { opacity: 1; transform: scale(1); filter: blur(0); } to { opacity: 0; transform: scale(1.35); filter: blur(8px); } }
@keyframes fxSphereDrop { 0% { opacity: 1; transform: translateY(var(--from)); } 92% { opacity: 1; transform: translateY(0) scale(1.3); } 100% { opacity: 0; transform: translateY(0) scale(1.8); } }
@keyframes fxFusionGlow { from { filter: drop-shadow(0 0 3px var(--c)) drop-shadow(0 0 8px var(--c)); } to { filter: brightness(2.2) drop-shadow(0 0 6px var(--c)) drop-shadow(0 0 20px var(--c)); } }
@keyframes fxFusionLight { 0% { opacity: 0; transform: scale(.2); } 30% { opacity: .35; transform: scale(.4); } 100% { opacity: 1; transform: scale(1); } }
@keyframes fxXyzVortexIn { from { opacity: 0; transform: scale(.3) rotate(90deg); } to { opacity: 1; transform: scale(1) rotate(0deg); } }
@keyframes fxXyzVortexOut { from { opacity: 1; transform: scale(1); filter: brightness(1); } to { opacity: 0; transform: scale(.15); filter: brightness(2.5); } }
@keyframes fxGrowIn { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }
@keyframes fxRitualLight {
  0% { opacity: 0; transform: scale(.6); }
  25% { opacity: 1; transform: scale(1.15); }
  60% { opacity: .55; transform: scale(1); }
  100% { opacity: .35; transform: scale(1); }
}
@keyframes fxLinkFrameIn { from { opacity: 0; transform: var(--rot) scale(.85); } to { opacity: 1; transform: var(--rot) scale(1); } }
@keyframes fxLinkArrow {
  0% { opacity: 0; filter: brightness(2.6) drop-shadow(0 0 0 #1ec8ff); }
  35% { opacity: 1; filter: brightness(2.2) drop-shadow(0 0 14px #ffffff); }
  100% { opacity: 1; filter: brightness(1.1) drop-shadow(0 0 8px #ff7a4d); }
}
@keyframes fxLinkWhiten { from { filter: none; } to { filter: grayscale(1) brightness(1.9) drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px var(--c)) drop-shadow(0 0 14px var(--c)); } }
@keyframes fxLinkVanish {
  0% { opacity: 1; transform: scale(1); filter: grayscale(1) brightness(1.9) drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px var(--c)) drop-shadow(0 0 14px var(--c)); }
  40% { opacity: 1; transform: scale(1.08); filter: grayscale(1) brightness(2.6) drop-shadow(0 0 4px #fff) drop-shadow(0 0 14px var(--c)) drop-shadow(0 0 28px var(--c)); }
  100% { opacity: 0; transform: scale(.55); filter: grayscale(1) brightness(3) blur(3px) drop-shadow(0 0 10px var(--c)); }
}
@keyframes fxHeat { 0% { filter: none; } 100% { filter: brightness(1.8) sepia(.6) saturate(3) hue-rotate(-20deg); } }
@keyframes fxShard {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; filter: brightness(1.8) sepia(.6) saturate(3) hue-rotate(-20deg); }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; filter: brightness(.6); }
}
@keyframes fxBurst { 0% { opacity: 0; transform: scale(.3); } 30% { opacity: 1; } 100% { opacity: 0; transform: scale(1.2); } }
@keyframes fxEmber { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.3); } }
@keyframes fxHit { 0% { filter: none; transform: translate(0, 0); } 40% { transform: translate(-3px, 2px); } 70% { transform: translate(3px, -2px); } 100% { filter: brightness(1.6) saturate(1.4); transform: translate(0, 0); } }
@keyframes fxHalf {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; filter: brightness(1.6) saturate(1.4); }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; filter: grayscale(.6) brightness(.7); }
}
@keyframes fxSlash { 0% { opacity: 1; transform: rotate(var(--angle)) scaleX(0); } 45% { opacity: 1; transform: rotate(var(--angle)) scaleX(1); } 100% { opacity: 0; transform: rotate(var(--angle)) scaleX(1.05); } }
@keyframes fxBlast { 0% { opacity: 1; transform: scale(.15); } 100% { opacity: 0; transform: scale(1); } }
@keyframes fxFlash { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
`;
