"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CardImage, cardRect, forgetVanish, vanishRect } from "../CardImage";
import { FADE_IN_HOLD, MATERIAL_HOLD, SUMMON_REVEAL, type Fx, type FxCard, type SummonFx } from "@/lib/game/duel";

/** How long each effect stays on screen, ms. */
const DURATION: Record<Fx["kind"], number> = {
  spsummon: 1100,
  destroy: 1000,
  battle: 1000,
  fusion: 1150,
  synchro: 1300,
  xyz: 1450,
  link: 1300,
};
/** A Special Summon from the hand waits for the card to land in its zone. */
const LAND_DELAY = 300;

const COLORS = {
  gold: "255,213,79",
  blue: "90,170,255",
  green: "130,255,110",
};

/**
 * Board effects drawn on top of the page: summons (plain, Ritual, Fusion,
 * Synchro, Xyz, Link), the card shattering when destroyed, and a slash that
 * cuts it in two when destroyed by battle. Which cards vanish, and when cards
 * appear, is decided by the board model (lib/game/motion.ts); this only draws.
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

interface Placed {
  card: FxCard;
  rect: DOMRect;
}

function FxItem({ fx, me, onDone }: { fx: Fx; me: number; onDone: (id: number) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mats, setMats] = useState<Placed[]>([]);
  const summon = fx.kind !== "destroy" && fx.kind !== "battle";
  useEffect(() => {
    // Runs after the board's layout effects, so the card positions are known.
    const r = summon
      ? cardRect(fx.cardId) ?? document.querySelector(`[data-card-id="${fx.cardId}"]`)?.getBoundingClientRect()
      : vanishRect(fx.cardId);
    if (!r || !r.width || reducedMotion()) {
      for (const m of fx.materials ?? []) forgetVanish(m.cardId);
      onDone(fx.id);
      return;
    }
    setRect(r);
    setMats(
      (fx.materials ?? []).flatMap((m) => {
        const mr = vanishRect(m.cardId);
        return mr && mr.width ? [{ card: m, rect: mr }] : [];
      }),
    );
    const t = setTimeout(() => {
      forgetVanish(fx.cardId);
      for (const m of fx.materials ?? []) forgetVanish(m.cardId);
      onDone(fx.id);
    }, DURATION[fx.kind]);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rect) return null;

  const box = boxOf(rect);
  const ghost = (c: FxCard, w: number) => (
    <CardImage code={c.faceDown ? 0 : c.code} faceDown={c.faceDown} width={w} sideways={c.sideways} flipped={c.controller !== me} />
  );

  switch (fx.kind) {
    case "spsummon":
      return <Ring rect={rect} color={fx.ring === "blue" ? COLORS.blue : COLORS.gold} delay={fx.fromHand ? LAND_DELAY : FADE_IN_HOLD} />;
    case "fusion":
    case "synchro":
    case "xyz":
    case "link":
      return (
        <>
          {mats.map((m) => (
            <Material key={m.card.cardId} kind={fx.kind as SummonFx} at={m.rect} card={ghost(m.card, m.card.sideways ? m.rect.height : m.rect.width)} />
          ))}
          {fx.kind === "synchro" && <Ring rect={rect} color={COLORS.green} delay={SUMMON_REVEAL.synchro} />}
          {fx.kind === "xyz" && <XyzDrop rect={rect} />}
          {fx.kind === "link" && <Link box={box} rect={rect} marker={fx.linkMarker ?? 0} flipped={fx.controller !== me} />}
        </>
      );
    default: {
      const card = ghost(fx, fx.sideways ? rect.height : rect.width);
      return fx.kind === "battle" ? <BattleCut box={box} card={card} rect={rect} /> : <Shatter box={box} card={card} rect={rect} />;
    }
  }
}

const boxOf = (r: DOMRect): CSSProperties => ({ position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height });

/* ---------- summon rings ---------- */

/** One expanding circle around a zone. */
function Ring({ rect, color, delay }: { rect: DOMRect; color: string; delay: number }) {
  const size = Math.max(rect.width, rect.height) * 1.1;
  return (
    <div style={boxOf(rect)}>
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
          border: `3px solid rgba(${color},.95)`,
          boxShadow: `0 0 12px 2px rgba(${color},.7), inset 0 0 10px rgba(${color},.6)`,
          opacity: 0,
          animation: `fxRing 800ms ease-out ${delay}ms forwards`,
        }}
      />
    </div>
  );
}

/* ---------- materials, animated where they were ---------- */

/**
 * Fusion: twists away. Synchro: fades inside a green circle. Xyz: turns into a
 * shining sphere that flies up. Link: fades out in blue light. Afterwards the
 * card fades in wherever it went (GY, banishment, ...).
 */
function Material({ kind, at, card }: { kind: SummonFx; at: DOMRect; card: ReactNode }) {
  const hold = MATERIAL_HOLD[kind];
  const ghost = {
    fusion: `fxTwistOut ${hold}ms cubic-bezier(.5,0,.8,.5) forwards`,
    synchro: `fxFadeOut ${hold}ms ease-in forwards`,
    xyz: `fxToSphere 340ms ease-in forwards`,
    link: `fxBlueOut ${hold}ms ease-in forwards`,
  }[kind];
  const c = { x: at.width / 2, y: at.height / 2 };
  return (
    <div style={boxOf(at)}>
      <div style={{ position: "absolute", inset: 0, animation: ghost }}>{card}</div>
      {kind === "synchro" && <Ring rect={new DOMRect(0, 0, at.width, at.height)} color={COLORS.green} delay={0} />}
      {kind === "xyz" && (
        <Sphere
          style={{
            left: c.x,
            top: c.y,
            ["--up" as string]: `${-(at.top + at.height / 2 + 60)}px`,
            animation: "fxSphereUp 520ms cubic-bezier(.5,0,.9,.6) 220ms forwards",
          }}
        />
      )}
    </div>
  );
}

function Sphere({ style }: { style: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        width: 22,
        height: 22,
        marginLeft: -11,
        marginTop: -11,
        borderRadius: "50%",
        background: "radial-gradient(circle at 40% 35%, #fff, #fff4c2 30%, #ffd54f 55%, rgba(255,170,0,.25) 80%)",
        boxShadow: "0 0 16px 6px rgba(255,214,90,.9)",
        opacity: 0,
        ...style,
      }}
    />
  );
}

/* ---------- Xyz: a circle on the field, a sphere drops into it ---------- */

function XyzDrop({ rect }: { rect: DOMRect }) {
  const size = Math.max(rect.width, rect.height) * 1.1;
  const impact = SUMMON_REVEAL.xyz;
  return (
    <div style={boxOf(rect)}>
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
          border: `3px solid rgba(${COLORS.gold},.95)`,
          boxShadow: `0 0 12px 2px rgba(${COLORS.gold},.7), inset 0 0 12px rgba(${COLORS.gold},.6)`,
          opacity: 0,
          animation: `fxRingWait ${impact - 380 + 450}ms ease-out 380ms forwards`,
        }}
      />
      <Sphere
        style={{
          left: "50%",
          top: "50%",
          ["--from" as string]: `${-(rect.top + rect.height / 2 + 60)}px`,
          animation: `fxSphereDrop 300ms cubic-bezier(.6,0,1,.6) ${impact - 300}ms forwards`,
        }}
      />
      <Burst size={size * 1.4} color={`rgba(${COLORS.gold},.85)`} at={impact - 20} />
    </div>
  );
}

/** A flash where the new monster appears. */
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
        animation: `fxBurst 520ms ease-out ${at}ms forwards`,
      }}
    />
  );
}

/* ---------- Link: the monster's Link Arrows light up ---------- */

/** Link marker bits, clockwise from the top-left, with their direction. */
const LINK_ARROWS: { bit: number; dx: number; dy: number }[] = [
  { bit: 0x040, dx: -1, dy: -1 },
  { bit: 0x080, dx: 0, dy: -1 },
  { bit: 0x100, dx: 1, dy: -1 },
  { bit: 0x020, dx: 1, dy: 0 },
  { bit: 0x004, dx: 1, dy: 1 },
  { bit: 0x002, dx: 0, dy: 1 },
  { bit: 0x001, dx: -1, dy: 1 },
  { bit: 0x008, dx: -1, dy: 0 },
];

/** Link: the materials are drawn in, the monster's Link Arrows light up one by one. */
function Link({ box, rect, marker, flipped }: { box: CSSProperties; rect: DOMRect; marker: number; flipped: boolean }) {
  const s = 14;
  let lit = 0;
  return (
    <div style={box}>
      <div style={{ position: "absolute", inset: 0, transform: flipped ? "rotate(180deg)" : undefined }}>
        <div
          style={{
            position: "absolute",
            inset: -6,
            border: "2px solid rgba(90,190,255,.95)",
            borderRadius: 4,
            boxShadow: "0 0 14px 3px rgba(80,180,255,.7), inset 0 0 12px rgba(80,180,255,.5)",
            opacity: 0,
            animation: "fxLinkFrame 1100ms ease-out 200ms forwards",
          }}
        />
        {LINK_ARROWS.map((a) => {
          const on = !!(marker & a.bit);
          const delay = on ? 300 + lit++ * 70 : 250;
          const x = (a.dx + 1) / 2;
          const y = (a.dy + 1) / 2;
          const angle = (Math.atan2(a.dy, a.dx) * 180) / Math.PI + 90;
          return (
            <div
              key={a.bit}
              style={{
                position: "absolute",
                left: `calc(${x * 100}% + ${a.dx * 12}px - ${s / 2}px)`,
                top: `calc(${y * 100}% + ${a.dy * 12}px - ${s / 2}px)`,
                width: s,
                height: s,
                transform: `rotate(${angle}deg)`,
                clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
                background: on ? "#ff5a3c" : "rgba(120,140,160,.6)",
                filter: on ? "drop-shadow(0 0 6px rgba(255,90,60,.9))" : undefined,
                opacity: 0,
                animation: `${on ? "fxArrowOn" : "fxArrowOff"} 900ms ease-out ${delay}ms forwards`,
              }}
            />
          );
        })}
      </div>
      <Burst size={Math.max(rect.width, rect.height) * 1.6} color="rgba(90,190,255,.85)" at={SUMMON_REVEAL.link - 40} />
    </div>
  );
}

/* ---------- destroyed by an effect: the card shatters ---------- */

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
@keyframes fxTwistOut { 0% { opacity: 1; transform: rotate(0) scale(1); } 100% { opacity: 0; transform: rotate(540deg) scale(.1); } }
@keyframes fxFadeOut { 0% { opacity: 1; } 100% { opacity: 0; filter: brightness(1.6); } }
@keyframes fxBlueOut { 0% { opacity: 1; filter: none; } 40% { opacity: 1; filter: brightness(1.8) drop-shadow(0 0 10px rgba(90,170,255,1)) hue-rotate(160deg); } 100% { opacity: 0; filter: brightness(2.4) drop-shadow(0 0 16px rgba(90,170,255,1)) hue-rotate(160deg); } }
@keyframes fxToSphere { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(.12); filter: brightness(2.5) sepia(1); } }
@keyframes fxSphereUp { 0% { opacity: 1; transform: translateY(0); } 85% { opacity: 1; } 100% { opacity: 0; transform: translateY(var(--up)); } }
@keyframes fxSphereDrop { 0% { opacity: 1; transform: translateY(var(--from)); } 92% { opacity: 1; transform: translateY(0) scale(1.4); } 100% { opacity: 0; transform: translateY(0) scale(2); } }
@keyframes fxRingWait { 0% { opacity: 0; transform: scale(.3); } 25% { opacity: 1; transform: scale(1); } 70% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes fxLinkFrame { 0% { opacity: 0; transform: scale(1.6); } 30% { opacity: 1; transform: scale(1); } 75% { opacity: 1; } 100% { opacity: 0; transform: scale(1.05); } }
@keyframes fxArrowOn { 0% { opacity: 0; } 15% { opacity: 1; filter: brightness(2) drop-shadow(0 0 8px #ff5a3c); } 80% { opacity: 1; } 100% { opacity: 0; } }
@keyframes fxArrowOff { 0% { opacity: 0; } 25% { opacity: .7; } 70% { opacity: .7; } 100% { opacity: 0; } }
@keyframes fxRing { 0% { opacity: 1; transform: scale(.3); } 100% { opacity: 0; transform: scale(1.7); } }
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
@keyframes fxFlash { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
`;
