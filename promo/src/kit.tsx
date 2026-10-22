import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FONT, SHOT } from './config';

export const EASE = Easing.bezier(0.42, 0, 0.58, 1); // easy ease for camera moves
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const IN = Easing.bezier(0.55, 0, 1, 0.45);

/** Spring entrance with a slight overshoot, starting at `delay`. */
export function useIn(delay = 0, damping = 14) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, stiffness: 120, mass: 0.9 } });
}

/** 0→1 over an exit that starts at `start` and lasts `dur` frames. */
export function useOut(start: number, dur = 16) {
  const f = useCurrentFrame();
  return interpolate(f, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: IN });
}

/** Ink background with slowly drifting clay and blue glows. */
export const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const a = 50 + Math.sin(f / 90) * 8;
  const b = 22 + Math.cos(f / 110) * 6;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 800px at ${a}% ${b}%, rgba(217,119,87,0.22), transparent 60%),
          radial-gradient(800px 700px at ${100 - a}% ${88 - b}%, rgba(137,180,250,0.14), transparent 60%), ${C.ink}`,
      }}
    />
  );
};

/** Big title, revealed word by word, with an optional accent word. */
export const Title: React.FC<{ text: string; delay?: number; size?: number; accent?: string; top?: number; exitAt?: number }> = ({ text, delay = 0, size = 96, accent, top = 230, exitAt }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = exitAt ? interpolate(f, [exitAt, exitAt + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: IN }) : 0;
  return (
    <div style={{ position: 'absolute', left: 70, right: 70, top, textAlign: 'center', font: `700 ${size}px/1.04 ${FONT.display}`, letterSpacing: '-0.025em', color: C.text, opacity: 1 - out, transform: `translateY(${-40 * out}px)` }}>
      {text.split(' ').map((w, i) => {
        const p = spring({ frame: f - delay - i * 3, fps, config: { damping: 14, stiffness: 140 } });
        const isAccent = accent && w.replace(/[^\w']/g, '') === accent;
        return (
          <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 60}px)`, color: isAccent ? C.clay : undefined }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Voiceover caption: words light up in time with the line (approximate, by word length). */
export const Caption: React.FC<{ text: string; seconds: number }> = ({ text, seconds }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  const weights = words.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  const starts = weights.map((w) => { const s = (acc / total) * seconds * fps; acc += w; return s; });
  const end = seconds * fps;
  const vis = interpolate(f, [0, 6, end + 10, end + 20], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, top: 1560, textAlign: 'center', opacity: vis }}>
      <span style={{ display: 'inline', padding: '10px 18px', borderRadius: 18, background: 'rgba(20,20,19,0.78)', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', font: `600 46px/1.55 ${FONT.body}` }}>
        {words.map((w, i) => (
          <span key={i} style={{ color: f >= starts[i] ? C.text : 'rgba(250,249,245,0.32)' }}>{w}{i < words.length - 1 ? ' ' : ''}</span>
        ))}
      </span>
    </div>
  );
};

export type Key = { at: number; scale: number; focus: [number, number] };

/** Where a point of the screenshot lands inside the card at frame f. */
export function camera(keys: Key[], f: number) {
  const ats = keys.map((k) => k.at);
  const opt = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: EASE };
  const scale = keys.length > 1 ? interpolate(f, ats, keys.map((k) => k.scale), opt) : keys[0].scale;
  const fx = keys.length > 1 ? interpolate(f, ats, keys.map((k) => k.focus[0]), opt) : keys[0].focus[0];
  const fy = keys.length > 1 ? interpolate(f, ats, keys.map((k) => k.focus[1]), opt) : keys[0].focus[1];
  return { scale, fx, fy };
}

/**
 * A window card showing an app screenshot, panned and zoomed by keyframes.
 * `focus` is the screenshot pixel kept at the card's centre; `scale` is card px per screenshot px.
 * Children are drawn on top in card coordinates (use `toCard` to place them on screenshot points).
 */
export const Shot: React.FC<{ src: string; left: number; top: number; w: number; h: number; keys: Key[]; children?: React.ReactNode }> = ({ src, left, top, w, h, keys, children }) => {
  const f = useCurrentFrame();
  const { scale, fx, fy } = camera(keys, f);
  return (
    <div style={{ position: 'absolute', left, top, width: w, height: h, borderRadius: 28, overflow: 'hidden', background: C.ink2, boxShadow: '0 0 0 2px rgba(255,255,255,0.10), 0 60px 140px rgba(0,0,0,0.6)' }}>
      <Img src={staticFile(src)} style={{ position: 'absolute', left: w / 2 - fx * scale, top: h / 2 - fy * scale, width: SHOT.w * scale, height: SHOT.h * scale }} />
      {children}
    </div>
  );
};

/** Card coordinates of a screenshot point at frame f. */
export function toCard(keys: Key[], f: number, w: number, h: number, p: [number, number]): [number, number] {
  const { scale, fx, fy } = camera(keys, f);
  return [w / 2 + (p[0] - fx) * scale, h / 2 + (p[1] - fy) * scale];
}

/** A tap that travels along an arc, settles, then presses. */
export const Tap: React.FC<{ from: [number, number]; to: [number, number]; start: number; travel?: number; pressAt: number }> = ({ from, to, start, travel = 36, pressAt }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: f - start, fps, config: { damping: 15, stiffness: 90 }, durationInFrames: travel });
  const mx = (from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.15;
  const my = (from[1] + to[1]) / 2 - Math.abs(to[0] - from[0]) * 0.15;
  const x = (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * mx + t ** 2 * to[0];
  const y = (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * my + t ** 2 * to[1];
  const press = interpolate(f, [pressAt, pressAt + 4, pressAt + 8], [1, 0.82, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ring = interpolate(f, [pressAt, pressAt + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT });
  const vis = interpolate(f, [start - 6, start, pressAt + 30, pressAt + 40], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: x - 34, top: y - 34, width: 68, height: 68, opacity: vis }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.88)', transform: `scale(${press})`, boxShadow: '0 8px 30px rgba(0,0,0,0.45)' }} />
      <div style={{ position: 'absolute', inset: -20, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.85)', transform: `scale(${0.6 + ring})`, opacity: f >= pressAt ? 1 - ring : 0 }} />
    </div>
  );
};

/** The agent's cursor (the same arrow the MCP server draws in the browser). */
export const AgentCursor: React.FC<{ x: number; y: number; size?: number; ring?: number }> = ({ x, y, size = 44, ring = 0 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: size, height: size, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))' }}>
    <svg width={size} height={size} viewBox="0 0 24 24"><path d="M4 2l15 11l-6.5 1.2l3.6 6.8l-2.9 1.5l-3.6-6.8L4 20z" fill={C.blue} stroke="#1e1e2e" strokeWidth="1.5" strokeLinejoin="round" /></svg>
    <div style={{ position: 'absolute', left: -size * 0.6, top: -size * 0.6, width: size * 1.2, height: size * 1.2, borderRadius: '50%', border: `4px solid ${C.blue}`, opacity: ring > 0 ? 1 - ring : 0, transform: `scale(${0.5 + ring})` }} />
  </div>
);

/** A small pill label, like the app's "Agent is clicking". */
export const Pill: React.FC<{ text: string; color?: string; style?: React.CSSProperties }> = ({ text, color = C.clay, style }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '14px 26px', borderRadius: 999, background: 'rgba(38,38,36,0.96)', border: '2px solid rgba(255,255,255,0.10)', boxShadow: '0 20px 50px rgba(0,0,0,0.45)', font: `600 34px ${FONT.body}`, color: C.text, ...style }}>
    <span style={{ width: 16, height: 16, borderRadius: '50%', background: color }} />
    {text}
  </div>
);
