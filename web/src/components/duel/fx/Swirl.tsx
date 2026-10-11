"use client";

import { useEffect, useId, useRef } from "react";
import { useApp } from "../../AppContext";
import { cardImage } from "@/lib/data/config";

/**
 * Whirlpool ("vortex") displacement map, made once. It covers twice the card in each
 * direction (the card is the middle half), so the card's edges and corners swirl too and
 * its outline winds out into spiral arms. Every point is pushed along the circle around the
 * centre (plus a little inwards), strongest in the middle, fading out well past the corners.
 * Red/green = x/y push, 0.5 = none.
 */
let swirlMap: string | null = null;
const PASSES = 12;
function getSwirlMap(): string {
  if (swirlMap) return swirlMap;
  const n = 192;
  const R = 2.2; // fade-out radius, in card half-sizes (corners are at about 1.4)
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (((x + 0.5) / n) * 2 - 1) * 2;
      const v = (((y + 0.5) / n) * 2 - 1) * 2;
      const r = Math.hypot(u, v);
      const f = r < R ? (1 - r / R) ** 2 : 0;
      // Tangential (the twist) plus a slight pull towards the centre.
      const dx = ((-v - u * 0.2) * f) / R;
      const dy = ((u - v * 0.2) * f) / R;
      const i = (y * n + x) * 4;
      img.data[i] = Math.round((0.5 + dx * 0.5) * 255);
      img.data[i + 1] = Math.round((0.5 + dy * 0.5) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  swirlMap = c.toDataURL();
  return swirlMap;
}

/**
 * A card picture twisted into a whirlpool with an SVG displacement filter (twelve passes). The browser
 * applies the filter itself, so it works with any image server (no CORS needed) and
 * needs no WebGL. `from`/`to` is the twist strength (0 = none, ±1 = full whirlpool, the sign is the direction) and
 * `fadeFrom`/`fadeTo` the opacity over `duration` ms.
 */
export function Swirl({
  code,
  width,
  height,
  from,
  to,
  fadeFrom,
  fadeTo,
  duration,
  delay = 0,
  rotate = 0,
}: {
  code: number;
  width: number;
  height: number;
  from: number;
  to: number;
  fadeFrom: number;
  fadeTo: number;
  duration: number;
  delay?: number;
  /** Extra rotation of the whole picture (opponent's card, defense position), degrees. */
  rotate?: number;
}) {
  const { config } = useApp();
  const id = `swirl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const filterRef = useRef<SVGFilterElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const src = config && code ? cardImage(config, code) : null;
  // The map is applied PASSES times in a row: one push only shears the picture, several
  // small ones add up to a real whirlpool. Filter units are fractions of the card's box.
  const max = 4.5;

  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const frame = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const scale = String((from + (to - from) * e) * max);
      filterRef.current?.querySelectorAll("feDisplacementMap").forEach((d) => d.setAttribute("scale", scale));
      if (boxRef.current) {
        boxRef.current.style.opacity = String(fadeFrom + (fadeTo - fadeFrom) * e);
        // A little shrink while it twists away, grow while it twists in.
        boxRef.current.style.transform = `rotate(${rotate}deg) scale(${1 - 0.25 * Math.abs(from + (to - from) * e)})`;
      }
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [from, to, fadeFrom, fadeTo, duration, delay, max, rotate]);

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          {/* Twice the card's size, so its outline can swirl out past the edges. */}
          <filter ref={filterRef} id={id} x="-0.5" y="-0.5" width="2" height="2" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feImage href={getSwirlMap()} x="-0.5" y="-0.5" width="2" height="2" preserveAspectRatio="none" result="map" />
            {Array.from({ length: PASSES }, (_, i) => (
              <feDisplacementMap
                key={i}
                in={i === 0 ? "SourceGraphic" : `p${i - 1}`}
                in2="map"
                scale={from * max}
                xChannelSelector="R"
                yChannelSelector="G"
                result={`p${i}`}
              />
            ))}
          </filter>
        </defs>
      </svg>
      <div
        ref={boxRef}
        style={{
          width,
          height,
          opacity: fadeFrom,
          transform: `rotate(${rotate}deg)`,
          filter: `url(#${id})`,
          borderRadius: 4,
          background: src ? `url("${src}") center / cover no-repeat` : "#333",
        }}
      />
    </>
  );
}
