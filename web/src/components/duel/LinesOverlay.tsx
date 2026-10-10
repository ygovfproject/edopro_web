"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface Link {
  from: string; // CSS selector of the source element
  to: string; // CSS selector of the target element
  kind: "attack" | "target" | "equip";
}

interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: Link["kind"];
}

function center(sel: string) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Draws arrows between elements on top of the page (attacks, equips, targets). */
export default function LinesOverlay({ links, version }: { links: Link[]; version: unknown }) {
  const [lines, setLines] = useState<Line[]>([]);
  const key = links.map((l) => `${l.kind}:${l.from}>${l.to}`).join("|");
  const measureRef = useRef<() => void>(() => {});
  measureRef.current = () => {
    const out: Line[] = [];
    for (const l of links) {
      const a = center(l.from);
      const b = center(l.to);
      if (!a || !b) continue;
      out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, kind: l.kind });
    }
    setLines(out);
  };

  useLayoutEffect(() => {
    measureRef.current();
    // Measure again once move animations have settled.
    const t = setTimeout(() => measureRef.current(), 600);
    return () => clearTimeout(t);
  }, [key, version]);

  useEffect(() => {
    const onResize = () => measureRef.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!lines.length) return null;
  return (
    <svg style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", pointerEvents: "none", zIndex: 40 }}>
      <defs>
        <marker id="arrow-attack" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#ff5c5c" />
        </marker>
        <marker id="arrow-link" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffffff" />
        </marker>
      </defs>
      {lines.map((l, i) =>
        l.kind === "attack" ? (
          <g key={i}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(255,60,60,.35)" strokeWidth={10} strokeLinecap="round" />
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#ff5c5c"
              strokeWidth={4}
              strokeLinecap="round"
              markerEnd="url(#arrow-attack)"
              strokeDasharray="14 8"
            >
              <animate attributeName="stroke-dashoffset" from="44" to="0" dur="0.8s" repeatCount="indefinite" />
            </line>
          </g>
        ) : (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="#ffffff"
            strokeWidth={2.5}
            strokeDasharray={l.kind === "equip" ? "none" : "6 5"}
            markerEnd="url(#arrow-link)"
            opacity={0.9}
          />
        ),
      )}
    </svg>
  );
}
