import React, { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT } from './config';
import { AgentCursor, EASE, OUT } from './kit';

// A looping GIF that shows what ShellQuarry is: Herdr's terminal first, then the shell
// that wraps around it, then an agent driving the browser. Every piece is a crop of one
// real window capture (public/gif/window.png), placed by the rects in public/gif/layout.json.

export const GIF = { w: 1200, h: 760, fps: 30, frames: 330 };

type Rect = { x: number; y: number; w: number; h: number };
type Layout = { window: { w: number; h: number }; term: Rect; sidebar: Rect; toolbar: Rect; composer: Rect; titlebar: Rect; browser: Rect; click: [number, number]; start: [number, number] };

const SCALE = 0.78; // window pixels → GIF pixels
const OX = (GIF.w - 1402 * SCALE) / 2;
const OY = 92;

const ramp = (f: number, a: number, b: number, ease = OUT) =>
  interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

/** One rectangle of the window capture, drawn where it sits in the window, nudged by dx/dy. */
const Piece: React.FC<{ r: Rect; o: number; dx?: number; dy?: number; glow?: number }> = ({ r, o, dx = 0, dy = 0, glow = 0 }) => (
  <div
    style={{
      position: 'absolute', left: OX + r.x * SCALE + dx, top: OY + r.y * SCALE + dy, width: r.w * SCALE, height: r.h * SCALE,
      overflow: 'hidden', opacity: o, borderRadius: 8,
      boxShadow: glow ? `0 0 0 ${3 * glow}px rgba(217,119,87,${0.9 * glow}), 0 0 40px rgba(217,119,87,${0.35 * glow})` : undefined,
    }}
  >
    <Img src={staticFile('gif/window.png')} style={{ position: 'absolute', left: -r.x * SCALE, top: -r.y * SCALE, width: 1402 * SCALE }} />
  </div>
);

const Label: React.FC<{ text: React.ReactNode; sub: string; o: number; color?: string }> = ({ text, sub, o, color = C.clay }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: 18, textAlign: 'center', opacity: o, transform: `translateY(${(1 - o) * 14}px)` }}>
    <div style={{ font: `700 34px ${FONT.display}`, letterSpacing: '-0.02em', color: C.text }}>{text}</div>
    <div style={{ font: `500 19px ${FONT.body}`, color: C.muted, marginTop: 4 }}>
      <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 8, verticalAlign: 'middle' }} />
      {sub}
    </div>
  </div>
);

function useGifAssets() {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [handle] = useState(() => delayRender('gif assets'));
  useEffect(() => {
    const faces = [
      new FontFace(FONT.display, `url(${staticFile('space-grotesk-latin-wght-normal.woff2')})`, { weight: '300 700' }),
      new FontFace(FONT.body, `url(${staticFile('inter-latin-wght-normal.woff2')})`, { weight: '100 900' }),
    ];
    Promise.all([fetch(staticFile('gif/layout.json')).then((r) => r.json()), ...faces.map((f) => f.load())]).then(([l, ...loaded]) => {
      (loaded as FontFace[]).forEach((f) => document.fonts.add(f));
      setLayout(l as Layout);
      continueRender(handle);
    });
  }, [handle]);
  return layout;
}

export const Gif: React.FC = () => {
  const f = useCurrentFrame();
  const L = useGifAssets();
  if (!L) return null;

  // 0–75: Herdr alone. 75–165: the shell wraps around it. 165–300: the agent drives the browser. 300–330: fade to loop.
  const herdrIn = ramp(f, 4, 26);
  const label1 = ramp(f, 10, 30) * (1 - ramp(f, 66, 78, EASE));
  const shell = ramp(f, 80, 112);
  const label2 = ramp(f, 92, 112) * (1 - ramp(f, 156, 168, EASE));
  const termGlow = ramp(f, 8, 30) * (1 - ramp(f, 80, 100, EASE));
  const browser = ramp(f, 168, 196);
  const label3 = ramp(f, 176, 196);
  const fade = 1 - ramp(f, 306, 328, EASE);

  // The agent's cursor glides from the address bar to the link, then clicks.
  const glide = ramp(f, 206, 248, EASE);
  const at = (p: [number, number]) => [OX + p[0] * SCALE, OY + p[1] * SCALE];
  const [sx, sy] = at(L.start);
  const [tx, ty] = at(L.click);
  const cx = sx + (tx - sx) * glide;
  const cy = sy + (ty - sy) * glide - Math.sin(glide * Math.PI) * 40;
  const ring = ramp(f, 254, 276);
  const cursorO = ramp(f, 198, 206) * (1 - ramp(f, 290, 300));

  const frameO = shell * fade;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(700px 500px at 30% 20%, rgba(217,119,87,0.16), transparent 60%), radial-gradient(700px 500px at 80% 90%, rgba(137,180,250,0.10), transparent 60%), ${C.ink}` }}>
      {/* the window outline, so Herdr is seen sitting inside something from the start */}
      <div style={{ position: 'absolute', left: OX - 1, top: OY - 1, width: L.window.w * SCALE + 2, height: L.window.h * SCALE + 2, borderRadius: 10, border: `1.5px dashed rgba(250,249,245,${0.18 * (1 - shell) * fade})` }} />
      <div style={{ position: 'absolute', left: OX, top: OY, width: L.window.w * SCALE, height: L.window.h * SCALE, borderRadius: 10, background: C.ink2, opacity: frameO, boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }} />

      <Piece r={L.titlebar} o={frameO} dy={(1 - shell) * -24} />
      <Piece r={L.sidebar} o={frameO} dx={(1 - shell) * -60} />
      <Piece r={L.toolbar} o={frameO} dy={(1 - shell) * -18} />
      <Piece r={L.composer} o={frameO} dy={(1 - shell) * 30} />
      <Piece r={L.browser} o={browser * fade} dx={(1 - browser) * 80} glow={ramp(f, 196, 210) * (1 - ramp(f, 280, 300))} />
      <Piece r={L.term} o={herdrIn * fade} glow={termGlow} />

      <div style={{ opacity: cursorO }}>
        <AgentCursor x={cx} y={cy} size={30} ring={f >= 254 ? ring : 0} />
      </div>

      <Label o={label1 * fade} color={C.green} text={<>This is <span style={{ color: C.green }}>Herdr</span></>} sub="your agents, running in the terminal, unchanged" />
      <Label o={label2 * fade} text={<><span style={{ color: C.clay }}>ShellQuarry</span> is a shell on top</>} sub="a sidebar, buttons and a message box around Herdr" />
      <Label o={label3 * fade} color={C.blue} text={<>…with a <span style={{ color: C.blue }}>browser</span> your agents drive</>} sub="free and open source · github.com/Obiwayne/ShellQuarry" />
    </AbsoluteFill>
  );
};
