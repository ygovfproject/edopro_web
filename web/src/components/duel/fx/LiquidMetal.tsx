"use client";

/*
 * Liquid metal background: an animated WebGL surface of fluid folds with chrome highlights.
 *
 * The shader is adapted from "Liquid Metal Shader" by Nacre UI
 * (https://github.com/johnmamanao/nacre-ui, components/ui/liquid-metal-shader.tsx), used under
 * the MIT License:
 *
 *   Copyright (c) 2026 Nacre UI contributors
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify, merge,
 *   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 *   to whom the Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 *   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 *   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 *   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 *
 * Changes: no pointer interaction (the surface ignores the mouse entirely), a lower pixel
 * ratio cap for a full-window background, darker defaults with the deepest folds kept at the
 * base colour (not black), no CSS module.
 */

import { useEffect, useRef, useState } from "react";

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_distortion;
uniform float u_scale;
uniform vec3 u_base;
uniform vec3 u_metal;
uniform vec3 u_highlight;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float weight = 0.52;
  mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
  for (int octave = 0; octave < 4; octave++) {
    value += noise(p) * weight;
    p = rotation * p * 2.03 + 17.17;
    weight *= 0.5;
  }
  return value;
}

float liquidField(vec2 p, float time) {
  vec2 drift = vec2(time * 0.045, -time * 0.032);
  vec2 firstWarp = vec2(
    fbm(p * 0.72 + drift),
    fbm(p * 0.76 + vec2(5.2, 1.3) - drift.yx)
  );
  vec2 secondWarp = vec2(
    fbm(p * 0.78 + firstWarp * 2.7 + vec2(1.7, 9.2) + drift * 1.3),
    fbm(p * 0.74 + firstWarp * 2.5 + vec2(8.3, 2.8) - drift * 1.1)
  );
  return fbm(p * 0.68 + secondWarp * (2.75 * u_distortion));
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0) * u_scale;

  float field = liquidField(p, u_time);
  float shadow = smoothstep(0.18, 0.42, field);
  float silver = smoothstep(0.38, 0.64, field);
  float specular = smoothstep(0.60, 0.82, field);
  // The deepest folds stay close to the base colour (not black), so it reads as the base.
  vec3 color = mix(u_base * 0.72, u_base, shadow);
  color = mix(color, u_metal, silver * 0.88);
  color = mix(color, u_highlight, specular * 0.94);

  float softReflection = smoothstep(0.0, 0.13, 0.13 - abs(field - 0.51));
  color = mix(color, u_highlight, softReflection * 0.12);
  color += (hash21(gl_FragCoord.xy + floor(u_time * 12.0)) - 0.5) * 0.004;

  float vignette = 1.0 - smoothstep(0.48, 1.08, length((v_uv - 0.5) * vec2(0.82, 1.0)));
  color *= 0.76 + vignette * 0.24;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/**
 * Fills its parent (absolutely positioned) with the moving liquid metal surface. Purely a
 * background: it never takes the mouse (pointer-events: none) and doesn't react to it.
 * Without WebGL it shows a plain dark metal gradient instead.
 */
export function LiquidMetal({
  // The page's own background (#161616) with a soft graphite sheen: dim, not chrome-bright.
  baseColor = "#161616",
  metalColor = "#2b2c32",
  highlightColor = "#4a4c55",
  distortion = 0.6,
  scale = 0.92,
  speed = 0.72,
  pixelRatio = 1,
  style,
}: {
  baseColor?: string;
  metalColor?: string;
  highlightColor?: string;
  distortion?: number;
  scale?: number;
  speed?: number;
  /** Cap on device pixels per CSS pixel (lower is lighter on the GPU). */
  pixelRatio?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!canvas || !gl) {
      setFailed(true);
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!vs || !fs || !program || !buffer) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      setFailed(true);
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const uRes = u("u_resolution");
    const uTime = u("u_time");
    gl.uniform1f(u("u_distortion"), Math.min(Math.max(distortion, 0), 1.5));
    gl.uniform1f(u("u_scale"), Math.min(Math.max(scale, 0.6), 2.4));
    gl.uniform3fv(u("u_base"), rgb(baseColor));
    gl.uniform3fv(u("u_metal"), rgb(metalColor));
    gl.uniform3fv(u("u_highlight"), rgb(highlightColor));

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    const draw = (now: number) => {
      raf = 0;
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = now;
      if (!still) elapsed += dt * speed;
      const ratio = Math.min(window.devicePixelRatio || 1, pixelRatio);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * ratio));
      const h = Math.max(1, Math.round(r.height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (visible && !still) raf = requestAnimationFrame(draw);
    };
    const start = () => {
      if (raf || !visible) return;
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(start);
    resize.observe(canvas);
    const seen = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    seen.observe(canvas);
    const lost = (e: Event) => {
      e.preventDefault();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setFailed(true);
    };
    canvas.addEventListener("webglcontextlost", lost);
    start();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      resize.disconnect();
      seen.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [baseColor, metalColor, highlightColor, distortion, scale, speed, pixelRatio]);
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        background: baseColor,
        ...style,
      }}
    >
      {!failed && <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} />}
    </div>
  );
}
