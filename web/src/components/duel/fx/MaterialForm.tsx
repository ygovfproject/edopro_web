"use client";

import { useEffect, useState } from "react";
import { Box } from "@mui/material";
import type { PickForm } from "@/lib/game/motion";

/** Delay between shapes appearing / leaving, and how long one takes to rise into place (ms). */
const STEP = 90;
const RISE = 320;

/** How long it takes until the whole stack has formed (used to start leaving after it). */
export function formTime(form: PickForm) {
  const n = count(form);
  return (n - 1) * STEP + RISE;
}

function count(form: PickForm) {
  return form.shape === "rings" || form.shape === "spheres" ? Math.max(1, Math.min(12, form.count)) : 1;
}

/**
 * A material as glowing shapes stacked in its zone: Synchro Tuners as rings (one per
 * Level), other Synchro materials as spheres (one per Level), Xyz / Link materials as
 * one sphere. The bottom shape sits in the middle of the cell and the stack grows
 * upwards from there.
 *
 * `active` switches between the card and the shapes. Turning on, the shapes come out of
 * the bottom one, one after another, and climb to their places; turning off plays the
 * same in reverse. `leave` then sends them up and away, top one first.
 */
export function MaterialForm({
  form,
  width,
  height,
  active,
  leave,
}: {
  form: PickForm;
  width: number;
  height: number;
  active: boolean;
  /** Float away upwards (material leaving the field): each shape follows the one above it. */
  leave?: { up: number; delay: number };
}) {
  const n = count(form);
  const ring = form.shape === "rings";
  // A bit smaller than the field cell (cells are square, card height + 6 px).
  const ringD = (height + 6) * 0.88;
  const dotD = n === 1 ? Math.min(width * 0.45, 26) : Math.min(width * 0.3, 18);
  // Spacing between shapes; the stack is at most ~2.2 cards tall.
  const gap = n > 1 ? Math.min(ring ? ringD * 0.3 : dotD * 1.45, (height * 2.2) / (n - 1)) : 0;
  return (
    <Box sx={{ position: "absolute", left: "50%", top: "50%", width, height, transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 3 }}>
      {Array.from({ length: n }, (_, i) => {
        // i = 0 is the bottom shape, in the middle of the cell.
        const y = height / 2 - i * gap;
        const delay = active ? i * STEP : (n - 1 - i) * (STEP * 0.6);
        // Hidden / not yet risen: down at the bottom shape's spot, small.
        const at = active ? "translate(-50%, -50%) scale(1)" : `translate(-50%, calc(-50% + ${i * gap}px)) scale(.3)`;
        const leaveAnim = leave
          ? `fxFollowUp 560ms cubic-bezier(.55,0,.9,.45) ${leave.delay + (n - 1 - i) * Math.min(120, 480 / n)}ms forwards`
          : null;
        const common = {
          position: "absolute" as const,
          left: "50%",
          top: y,
          opacity: active ? 1 : 0,
          transform: at,
          transition: `opacity .2s ease ${delay}ms, transform ${RISE}ms cubic-bezier(.25,.9,.35,1.1) ${delay}ms`,
          ...(leave ? { ["--up" as string]: `${leave.up}px` } : {}),
        };
        if (ring) {
          return <SynchroRing key={i} size={ringD} style={{ ...common, ...(leaveAnim ? { animation: leaveAnim } : {}) }} />;
        }
        const shine = shinyDot(form.color);
        return (
          <Box
            key={i}
            sx={{
              ...common,
              width: dotD,
              height: dotD,
              borderRadius: "50%",
              ...shine,
              // Leaving and twinkling at the same time (one animation must not replace the other).
              animation: leaveAnim ? `${leaveAnim}, ${shine.animation}` : shine.animation,
            }}
          />
        );
      })}
    </Box>
  );
}

/**
 * Keeps the last form around after the card is un-picked, so the reverse
 * transformation can play; the card itself fades back in meanwhile.
 */
export function PickLayer({ form, width, height }: { form: PickForm | undefined; width: number; height: number }) {
  const [last, setLast] = useState<PickForm | undefined>(form);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (form) {
      setLast(form);
      // Next frame, so the shapes animate in from their hidden state.
      const r = requestAnimationFrame(() => setActive(true));
      return () => cancelAnimationFrame(r);
    }
    setActive(false);
  }, [form]);
  // Link materials have no shapes: the card itself glows (Board).
  if (!last || last.shape === "glow") return null;
  return <MaterialForm form={last} width={width} height={height} active={active} />;
}

/** Where the Synchro ring picture lives (public/fx). Replace that SVG to restyle the rings. */
export const SYNCHRO_RING_SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/fx/synchro-ring.svg`;
/** The ring fills 80% of its image; the rest is room for its glow. */
const RING_FILL = 0.8;

/** One Synchro ring, `size` px across (the ring itself, not counting its glow). */
export function SynchroRing({ size, style }: { size: number; style?: React.CSSProperties | Record<string, unknown> }) {
  const img = size / RING_FILL;
  return (
    <Box
      component="img"
      src={SYNCHRO_RING_SRC}
      alt=""
      draggable={false}
      sx={{ display: "block", width: img, height: img, ...(style as object) }}
    />
  );
}

/** A white ball shining in `color`, softly twinkling. */
export function shinyDot(color: string) {
  return {
    background: "radial-gradient(circle at 42% 38%, #ffffff 0%, #ffffff 50%, #f4fff2 70%, rgba(255,255,255,.9) 100%)",
    boxShadow: `0 0 3px 1px #ffffff, 0 0 8px 3px ${color}, 0 0 18px 7px ${color}aa, 0 0 32px 12px ${color}55`,
    animation: "dotShine 900ms ease-in-out infinite alternate",
    "@keyframes dotShine": {
      from: { filter: "brightness(1)" },
      to: { filter: "brightness(1.35) drop-shadow(0 0 4px #ffffff)" },
    },
  };
}

/**
 * A material that leaves the field: if it wasn't already shown as shapes (someone else's
 * summon), the shapes first come out of the bottom one and climb into place; then they
 * float up and away, top one first.
 */
export function LeavingForm({ form, width, height, formed }: { form: PickForm; width: number; height: number; formed: boolean }) {
  const [active, setActive] = useState(formed);
  useEffect(() => {
    if (formed) return;
    const r = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(r);
  }, [formed]);
  return <MaterialForm form={form} width={width} height={height} active={active} leave={{ up: height * 1.8, delay: formed ? 0 : formTime(form) + 120 }} />;
}
