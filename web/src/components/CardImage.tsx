"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { useApp } from "./AppContext";
import { DROP_MS, FADE_MS, FLY_MS, LIFT, motion, type AppearStyle, type LandPlan } from "@/lib/game/motion";
import { cardImage } from "@/lib/data/config";

/** Every card is drawn at exactly 59:86 (width:height). */
export const CARD_RATIO = 86 / 59;
export const cardHeight = (width: number) => Math.round((width * 86) / 59);

interface Props {
  code: number;
  /** Width in px; height follows the card ratio. */
  width: number;
  faceDown?: boolean;
  /** Rotate 90° for defense position. */
  sideways?: boolean;
  /** Rotate 180° (opponent's cards). */
  flipped?: boolean;
  selected?: boolean;
  highlight?: "action" | "select" | "target" | "linked" | null;
  dim?: boolean;
  /** Effects negated: black and white except the reds, with a glitched red cross. */
  negated?: boolean;
  /** Pop-up: start in colour, then turn negated, to show that it just happened. */
  negateIntro?: boolean;
  /** DuelCard id: enables move animations and lets overlays find this card. */
  trackId?: number;
  /** Chain link numbers shown as badges on the card. */
  chainLinks?: number[];
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  onHover?: (code: number) => void;
  onLeave?: () => void;
  title?: string;
}

/* ---------- move animations (FLIP) ---------- */

const lastRects = new Map<number, DOMRect>();
if (typeof window !== "undefined") {
  // Layout changes from resizing are not card moves.
  window.addEventListener("resize", () => lastRects.clear());
}

/** Where vanishing cards (see motion.vanish) were when they left. */
const vanishRects = new Map<number, DOMRect>();

/** Where a vanishing card was last seen on screen. */
export function vanishRect(trackId: number): DOMRect | undefined {
  return vanishRects.get(trackId) ?? lastRects.get(trackId);
}

export function forgetVanish(trackId: number) {
  motion.vanish.delete(trackId);
  // Materials that went somewhere not drawn (Xyz materials, the Deck) never used theirs.
  motion.appear.delete(trackId);
  vanishRects.delete(trackId);
}

/** Last settled on-screen rect of a card (its destination while it is still flying). */
export function cardRect(trackId: number): DOMRect | undefined {
  return lastRects.get(trackId);
}

/** Start keyframe, end keyframe and length (ms) of each way a card can appear. */
const APPEAR: Record<AppearStyle, [Keyframe, Keyframe, number]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }, 380],
  pop: [{ opacity: 0, transform: "scale(1.35)", filter: "brightness(2.5)" }, { opacity: 1, transform: "scale(1)", filter: "brightness(1)" }, 380],
  twist: [{ opacity: 0, transform: "rotate(-540deg) scale(.1)" }, { opacity: 1, transform: "rotate(0) scale(1)" }, 560],
};

/**
 * A summoned card's arrival (see LandPlan): hidden for `hold`, then it flies / fades / cuts in
 * at the fall point above its zone (bigger), waits, and drops into the zone.
 */
function landAnimation(el: HTMLElement, plan: LandPlan, prev: DOMRect | undefined, now: DOMRect) {
  const lift = `translate(0, ${plan.dir * LIFT.rise * now.height}px) scale(${LIFT.scale})`;
  const at = plan.dropAt !== undefined ? lift : "translate(0, 0) scale(1)";
  let start = at;
  if (plan.enter === "fly" && prev && now.width) {
    const dx = prev.left + prev.width / 2 - (now.left + now.width / 2);
    const dy = prev.top + prev.height / 2 - (now.top + now.height / 2);
    start = `translate(${dx}px, ${dy}px) scale(${prev.width / now.width})`;
  }
  const enterMs = plan.enter === "fly" ? FLY_MS : plan.enter === "fade" ? FADE_MS : 1;
  const shown = plan.hold + enterMs;
  const total = plan.dropAt !== undefined ? Math.max(plan.dropAt, shown) + DROP_MS : shown;
  const o = (t: number) => Math.min(1, Math.max(0, t / total));
  const visibleFrom = plan.enter === "fly" ? 1 : 0;
  const frames: Keyframe[] = [{ offset: 0, transform: start, opacity: visibleFrom, zIndex: 50 }];
  if (plan.hold > 0) frames.push({ offset: o(plan.hold), transform: start, opacity: visibleFrom, zIndex: 50 });
  frames.push({ offset: o(shown), transform: at, opacity: 1, zIndex: 50, easing: "cubic-bezier(.55,0,1,.45)" });
  if (plan.dropAt !== undefined) {
    if (plan.dropAt > shown) frames.push({ offset: o(plan.dropAt), transform: lift, opacity: 1, zIndex: 50, easing: "cubic-bezier(.55,0,1,.45)" });
    frames.push({ offset: 1, transform: "translate(0, 0) scale(1)", opacity: 1, zIndex: 50 });
  }
  // The flight eases out; the fall eases in (set per keyframe above).
  frames[0].easing = plan.enter === "fly" ? "cubic-bezier(.2,.7,.2,1)" : "linear";
  if (frames.length > 2 && plan.hold > 0) frames[1].easing = plan.enter === "fly" ? "cubic-bezier(.2,.7,.2,1)" : "ease-out";
  el.animate(frames, { duration: total, fill: "none" });
}

function useMoveAnimation(trackId: number | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(trackId);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || trackId === undefined) return;
    if (el.getAnimations().length) {
      // While an animation runs the rect is mid-flight; keep the stored destination.
      if (shown.current === trackId) return;
      // The element now shows another card: drop the old card's animation and start fresh.
      el.getAnimations().forEach((a) => a.cancel());
    }
    shown.current = trackId;
    const now = el.getBoundingClientRect();
    const prev = lastRects.get(trackId);
    lastRects.set(trackId, now);
    const vanished = motion.vanish.delete(trackId);
    if (vanished && prev) vanishRects.set(trackId, prev);
    const plan = motion.land.get(trackId);
    if (plan) {
      motion.land.delete(trackId);
      landAnimation(el, plan, prev, now);
      return;
    }
    const appear = motion.appear.get(trackId);
    if (appear) {
      // Hidden while an effect plays, then shows up in place instead of flying in.
      motion.appear.delete(trackId);
      const [from, to, length] = APPEAR[appear.style];
      const total = appear.hold + length;
      el.animate([from, { ...from, offset: appear.hold / total }, to], { duration: total, easing: "cubic-bezier(.2,.8,.3,1)" });
      return;
    }
    if (vanished) return;
    if (!prev || !now.width) return;
    const dx = prev.left + prev.width / 2 - (now.left + now.width / 2);
    const dy = prev.top + prev.height / 2 - (now.top + now.height / 2);
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    const scale = prev.width / now.width;
    const distance = Math.hypot(dx, dy);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, zIndex: 50 },
        { transform: "translate(0, 0) scale(1)", zIndex: 50 },
      ],
      { duration: Math.min(550, 220 + distance * 0.5), easing: "cubic-bezier(.2,.7,.2,1)" },
    );
  });
  return ref;
}

/* ---------- negation: only reds keep their colour ---------- */

const RED_KEEP_ID = "negate-redkeep";
/** Bump when the filter below changes. */
const RED_KEEP_VERSION = "4";

/**
 * Adds the "only reds keep their colour" SVG filter to the page once. It mixes a
 * black-and-white copy of the picture with the original seen through a mask of how much
 * redder than green and blue each pixel is: strong and dark reds stay, orange, brown,
 * magenta and skin tones turn grey. Raise the -5 / -2 to keep fewer colours. Black (and,
 * fading out, dark greys up to about 30% brightness) turns red: the "black" layer's
 * alpha is 1.2 x opacity - 4 x brightness (so empty, transparent pixels stay empty); lower the 1.2 to tint fewer darks.
 */
function ensureRedKeepFilter() {
  if (typeof document === "undefined") return;
  // Replaced when its definition changes (after an update without a full page reload).
  const old = document.getElementById(RED_KEEP_ID);
  if (old?.getAttribute("data-version") === RED_KEEP_VERSION) return;
  old?.closest("svg")?.remove();
  const div = document.createElement("div");
  div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0" aria-hidden="true">
    <filter id="${RED_KEEP_ID}" data-version="${RED_KEEP_VERSION}" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="saturate" values="0" result="gray" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.1  0 0 0 0 0.1  -0.85 -2.86 -0.29 1.2 0" result="black" />
      <feComposite in="black" in2="gray" operator="over" result="base" />
      <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  3 -5 -2 0 -0.2" result="red" />
      <feComposite in="red" in2="base" operator="over" />
    </filter>
  </svg>`;
  document.body.appendChild(div.firstElementChild!);
}

/** The negated look of a card picture. */
const NEGATED_FILTER = `url(#${RED_KEEP_ID})`;

/* ---------- negation: glitched red cross ---------- */

/**
 * A red X over the (black-and-white) card that glitches: slices of it jump sideways, with
 * red/cyan colour-split ghosts, and now and then the whole cross jolts. `intro`: appears
 * after a short delay (the pop-up shows the change).
 */
function Glitch({ width, height, intro }: { width: number; height: number; intro?: boolean }) {
  // The cross shows while the card is hovered (always in the pop-up, which can't be hovered).
  // A square X (45°) in the middle of the card.
  const side = Math.round(Math.min(width, height) * 0.78);
  const x0 = (width - side) / 2;
  const y0 = (height - side) / 2;
  const stroke = Math.max(3, Math.round(width * 0.12));
  const d = Math.max(3, Math.round(width * 0.1));
  const cross = (color: string, extra?: object) => (
    <Box
      component="svg"
      viewBox={`0 0 ${width} ${height}`}
      sx={{ position: "absolute", inset: 0, width, height, overflow: "visible", ...extra }}
    >
      <g stroke={color} strokeWidth={stroke} strokeLinecap="square">
        <line x1={x0} y1={y0} x2={x0 + side} y2={y0 + side} />
        <line x1={x0 + side} y1={y0} x2={x0} y2={y0 + side} />
      </g>
    </Box>
  );
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        borderRadius: "4px",
        zIndex: 1,
        opacity: intro ? 0 : 1,
        animation: intro ? "glitchIn .3s steps(3, end) .45s forwards" : undefined,
        "@keyframes glitchIn": { to: { opacity: 1 } },
        "@keyframes crossJolt": {
          "0%, 100%": { transform: "translate(0, 0)", opacity: 1 },
          "12%": { transform: `translate(${d}px, 0)`, opacity: 0.6 },
          "14%": { transform: "translate(0, 0)", opacity: 1 },
          "31%": { transform: `translate(${-d}px, 1px) skewX(10deg)` },
          "33%": { transform: "translate(0, 0)" },
          "47%": { transform: "translate(0, 0)", opacity: 1 },
          "48%": { transform: `translate(${d * 0.6}px, -1px)`, opacity: 0.3 },
          "50%": { transform: "translate(0, 0)", opacity: 1 },
          "62%": { transform: `translate(${d}px, 0)` },
          "64%": { transform: `translate(${-d}px, 1px)` },
          "66%": { transform: "translate(0, 0)" },
          "79%": { transform: "translate(0, 0) scaleX(1)" },
          "80%": { transform: `translate(${d * 1.2}px, 0) scaleX(1.15)` },
          "82%": { transform: "translate(0, 0) scaleX(1)" },
          "89%": { transform: `translate(${-d * 1.5}px, 0) skewX(-12deg)` },
          "91%": { transform: "translate(0, 0)" },
        },
        "@keyframes crossSliceA": {
          "0%, 100%": { clipPath: "inset(0 0 100% 0)", transform: "translateX(0)" },
          "10%": { clipPath: "inset(18% 0 66% 0)", transform: `translateX(${-d}px)` },
          "16%": { clipPath: "inset(52% 0 34% 0)", transform: `translateX(${d}px)` },
          "22%": { clipPath: "inset(0 0 100% 0)" },
          "60%": { clipPath: "inset(70% 0 14% 0)", transform: `translateX(${d * 1.5}px)` },
          "66%": { clipPath: "inset(30% 0 58% 0)", transform: `translateX(${-d}px)` },
          "72%": { clipPath: "inset(0 0 100% 0)" },
        },
        "@keyframes crossTear": {
          "0%, 100%": { clipPath: "none", transform: "translateX(0)" },
          "20%": { clipPath: "polygon(0 0, 100% 0, 100% 38%, 0 38%, 0 46%, 100% 46%, 100% 100%, 0 100%)" },
          "24%": { clipPath: "none" },
          "55%": { clipPath: "polygon(0 0, 100% 0, 100% 64%, 0 64%, 0 70%, 100% 70%, 100% 100%, 0 100%)", transform: `translateX(${d * 0.5}px)` },
          "59%": { clipPath: "none", transform: "translateX(0)" },
          "86%": { clipPath: "polygon(0 0, 100% 0, 100% 15%, 0 15%, 0 24%, 100% 24%, 100% 100%, 0 100%)" },
          "90%": { clipPath: "none" },
        },
        "@keyframes crossSliceB": {
          "0%, 100%": { clipPath: "inset(100% 0 0 0)", transform: "translateX(0)" },
          "34%": { clipPath: "inset(40% 0 46% 0)", transform: `translateX(${d}px)` },
          "40%": { clipPath: "inset(8% 0 80% 0)", transform: `translateX(${-d * 1.5}px)` },
          "46%": { clipPath: "inset(100% 0 0 0)" },
          "84%": { clipPath: "inset(62% 0 24% 0)", transform: `translateX(${-d}px)` },
          "90%": { clipPath: "inset(100% 0 0 0)" },
        },
      }}
    >
      {/* Half see-through, so the card shows through the cross. */}
      <Box sx={{ position: "absolute", inset: 0, opacity: 0.5, animation: "crossJolt 1.3s steps(1, end) infinite" }}>
        {/* Colour-split ghosts, offset, showing in the jumping slices. */}
        {cross("#00e5ff", { opacity: 0.85, mixBlendMode: "screen", animation: "crossSliceA 0.9s steps(1, end) infinite", left: -d / 2 })}
        {cross("#ff1744", { opacity: 0.9, mixBlendMode: "screen", animation: "crossSliceB 1.1s steps(1, end) infinite", left: d / 2 })}
        {/* The cross itself, torn by a few sliced bands too. */}
        {cross("#e53935", { filter: "drop-shadow(0 0 3px rgba(255,23,68,.8))", animation: "crossTear 1.6s steps(1, end) infinite" })}
      </Box>
    </Box>
  );
}

/* ---------- card back ---------- */

function CardBack({ width, height }: { width: number; height: number }) {
  const { config } = useApp();
  const src = config?.cardBackUrl || `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/img/card-back.jpg`;
  return <img src={src} alt="Card back" width={width} height={height} style={{ display: "block", width, height, objectFit: "cover" }} draggable={false} />;
}

function CardImageInner({
  code,
  width,
  faceDown,
  sideways,
  flipped,
  selected,
  highlight,
  dim,
  negated,
  negateIntro,
  trackId,
  chainLinks,
  onClick,
  onHover,
  onLeave,
  title,
}: Props) {
  const { config, res } = useApp();
  const [broken, setBroken] = useState<number | null>(null);
  const ref = useMoveAnimation(trackId);
  const height = cardHeight(width);
  const showBack = faceDown || !code;
  // The negated look's filter must be on the page before the card is drawn with it.
  if (negated) ensureRedKeepFilter();
  const name = code ? res?.cards.name(code) : "";
  const ring =
    highlight === "action"
      ? "0 0 0 2px #ffd54f, 0 0 10px 2px rgba(255,213,79,.75)"
      : highlight === "select"
        ? "0 0 0 2px #e6e6e6, 0 0 10px 2px rgba(230,230,230,.6)"
        : highlight === "target"
          ? "0 0 0 2px #ff6b6b, 0 0 10px 2px rgba(255,107,107,.6)"
          : highlight === "linked"
            ? "0 0 0 2px #ffffff, 0 0 14px 4px rgba(255,255,255,.8)"
            : "none";
  const outerW = sideways ? height : width;
  const outerH = sideways ? width : height;
  const angle = (sideways ? 90 : 0) + (flipped ? 180 : 0);
  return (
    <Box
      ref={ref}
      data-card-id={trackId}
      title={title ?? (showBack ? undefined : name)}
      onClick={onClick}
      onMouseEnter={() => onHover?.(code)}
      onMouseLeave={onLeave}
      sx={{
        width: outerW,
        height: outerH,
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        flex: "0 0 auto",
        opacity: dim ? 0.45 : 1,
        transition: "opacity .15s ease",
        // A negated card's glitched cross only shows on hover.
        "& .negate-x": { opacity: 0, transition: "opacity .12s ease" },
        "&:hover .negate-x": { opacity: 1 },
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width,
          height,
          transform: `translate(-50%, -50%) rotate(${angle}deg)`,
          borderRadius: "4px",
          boxShadow: selected ? "0 0 0 3px #f5c518, 0 0 12px 3px rgba(245,197,24,.8)" : ring,
          overflow: "hidden",
          bgcolor: "#111111",
          // Negated: black and white except the reds (and the glitched red cross on hover, see Glitch).
          filter: negated && !negateIntro ? NEGATED_FILTER : "none",
          transition: "transform .25s ease, filter .3s ease",
          // Pop-up: in colour first, then it turns grey as the glitch starts.
          ...(negated && negateIntro
            ? { animation: "negateIn .45s steps(1, end) .3s forwards", "@keyframes negateIn": { to: { filter: NEGATED_FILTER } } }
            : {}),
        }}
      >
        {showBack ? (
          <CardBack width={width} height={height} />
        ) : broken === code || !config ? (
          <Box
            sx={{
              width,
              height,
              boxSizing: "border-box",
              p: 0.5,
              fontSize: Math.max(9, width / 8),
              lineHeight: 1.15,
              color: "#ddd",
              bgcolor: "#333333",
              border: "1px solid #444",
              borderRadius: "4px",
              overflow: "hidden",
              wordBreak: "break-word",
            }}
          >
            {name}
          </Box>
        ) : (
          <img
            src={cardImage(config, code)}
            alt={name}
            width={width}
            height={height}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(code)}
            style={{ display: "block", width, height, objectFit: "cover" }}
          />
        )}
      </Box>
      {negated && !showBack && (
        <Box
          sx={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width,
            height,
            transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            pointerEvents: "none",
          }}
        >
          {/* A red border just inside the card's edge. The target / equip / action highlights
              are drawn outside the edge, so both show at once. Not under the card's black-and-
              white filter, so it stays red. */}
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              borderRadius: "4px",
              boxShadow: "inset 0 0 0 1px #e53935, inset 0 0 5px rgba(229,57,53,.5)",
              zIndex: 2,
            }}
          />
          <Box className={negateIntro ? undefined : "negate-x"} sx={{ position: "absolute", inset: 0 }}>
            <Glitch width={width} height={height} intro={negateIntro} />
          </Box>
        </Box>
      )}
      {chainLinks && chainLinks.length > 0 && (
        <Box sx={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: "2px", zIndex: 5, pointerEvents: "none" }}>
          {chainLinks.map((n) => (
            <Box
              key={n}
              title={`Chain Link ${n}`}
              sx={{
                height: 22,
                minWidth: 22,
                px: 0.6,
                borderRadius: "11px",
                bgcolor: "#f5c518",
                color: "#1b1300",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "1px",
                boxShadow: "0 0 0 2px #222222, 0 0 8px rgba(245,197,24,.8)",
                animation: "chainPop .3s ease",
                "@keyframes chainPop": { from: { transform: "scale(0)" }, to: { transform: "scale(1)" } },
              }}
            >
              <LinkIcon sx={{ fontSize: 14, transform: "rotate(-45deg)" }} />
              <Box component="span" sx={{ fontSize: 11.5, fontWeight: 800, lineHeight: 1 }}>
                {n}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export const CardImage = memo(CardImageInner);
