"use client";

/**
 * Glowing yellow spheres circling an Xyz Monster, one per attached material, each on its
 * own tilted orbit (two materials: the orbits cross like an X). Each sphere leaves a short
 * fading trail. Drawn over the card but under its badges.
 */
export function XyzOrbits({ count, width, height }: { count: number; width: number; height: number }) {
  const n = Math.min(count, 8);
  if (n <= 0) return null;
  const size = Math.max(width, height) * 1.45;
  const c = size / 2;
  const rx = Math.max(width, height) * 0.62;
  const ry = rx * 0.32;
  const r = Math.max(2.5, width * 0.06);
  // Evenly spread tilts; two orbits make an X.
  const tilt = (i: number) => (n === 1 ? -25 : 45 + (i * 180) / n);
  const path = `M ${c - rx} ${c} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 1, overflow: "visible" }}
    >
      <defs>
        <radialGradient id="xyzOrb">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#ffe066" />
          <stop offset="100%" stopColor="#ffb300" stopOpacity="0" />
        </radialGradient>
        <filter id="xyzGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {Array.from({ length: n }, (_, i) => {
        const dur = 2.4 + i * 0.35;
        const begin = -(i * dur) / n;
        return (
          <g key={i} transform={`rotate(${tilt(i)} ${c} ${c})`} filter="url(#xyzGlow)">
            {/* Trail: smaller, fainter copies a little behind. */}
            {[0.16, 0.1, 0.05, 0].map((lag, k) => (
              <circle key={k} r={r * (0.45 + k * 0.18)} fill="url(#xyzOrb)" opacity={0.25 + k * 0.25}>
                <animateMotion dur={`${dur}s`} begin={`${begin - lag}s`} repeatCount="indefinite" path={path} />
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
