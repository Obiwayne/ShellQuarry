import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, FONT, SCENES, URL_TEXT } from './config';
import { AgentCursor, EASE, Key, OUT, Pill, Shot, Tap, Title, toCard, useIn, useOut } from './kit';

const CARD = { left: 40, top: 500, w: 1000, h: 980 };
const FULL = 1000 / 1402; // the whole window, edge to edge
const MID: [number, number] = [701, 456];

/** Fades a scene out over its last frames so cuts aren't harsh. */
const SceneFade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const out = useOut(dur - 14, 14);
  return <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.04})` }}>{children}</AbsoluteFill>;
};

// ---------------------------------------------------------------- 1. Hook

const ROWS = [
  { name: 'claude', state: 'Working', color: C.clay, pulse: true },
  { name: 'codex', state: 'Needs you', color: C.red, pulse: false },
  { name: 'gemini', state: 'Idle', color: C.muted, pulse: false },
];

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <SceneFade dur={SCENES.hook.dur}>
      <Title text="Running a few coding agents?" accent="agents" top={300} size={100} delay={4} />
      {ROWS.map((r, i) => {
        const p = useIn(26 + i * 9, 13);
        const pulse = r.pulse ? 0.55 + 0.45 * Math.abs(Math.sin(f / 9)) : 1;
        return (
          <div key={r.name} style={{ position: 'absolute', left: 150, right: 150, top: 820 + i * 150, height: 120, borderRadius: 30, background: 'rgba(38,38,36,0.96)', border: '2px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 28, padding: '0 40px', opacity: Math.min(1, p * 1.5), transform: `translateX(${(1 - p) * (i % 2 ? 300 : -300)}px)` }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: r.color, opacity: pulse, flex: 'none' }} />
            <span style={{ font: `600 48px 'Cascadia Mono', Consolas, monospace`, color: C.text, flex: 1 }}>{r.name}</span>
            <span style={{ font: `600 38px ${FONT.body}`, color: r.color === C.muted ? C.muted : r.color }}>{r.state}</span>
          </div>
        );
      })}
    </SceneFade>
  );
};

// ---------------------------------------------------------------- 2. Meet

export const Meet: React.FC = () => {
  const tile = useIn(4, 11);
  const rise = useIn(40, 15);
  const sub = useIn(24, 16);
  return (
    <SceneFade dur={SCENES.meet.dur}>
      <div style={{ position: 'absolute', left: 540 - 95, top: 230, width: 190, height: 190, transform: `scale(${tile}) rotate(${(1 - tile) * -20}deg)` }}>
        <Img src={staticFile('icon.png')} style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.5))' }} />
      </div>
      <Title text="ShellQuarry" top={470} size={120} delay={10} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 620, textAlign: 'center', font: `600 56px ${FONT.display}`, color: C.muted, opacity: sub, transform: `translateY(${(1 - sub) * 30}px)` }}>
        Herdr, with <span style={{ color: C.clay }}>buttons</span>.
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 790 + (1 - rise) * 1100 }}>
        <Shot src="hero.png" left={40} top={0} w={1000} h={650} keys={[{ at: 0, scale: FULL, focus: MID }]} />
      </div>
    </SceneFade>
  );
};

// ---------------------------------------------------------------- 3. New agent

const AGENT_KEYS: Key[] = [
  { at: 0, scale: FULL, focus: MID },
  { at: 54, scale: 1.95, focus: [700, 470] },
];

export const Agent: React.FC = () => {
  const press = 150;
  const target = toCard(AGENT_KEYS, 60, CARD.w, CARD.h, [873, 632]);
  const toast = useIn(press + 18, 13);
  return (
    <SceneFade dur={SCENES.agent.dur}>
      <Title text="Start any agent." accent="agent" top={250} size={112} delay={4} />
      <Shot src="new-agent.png" {...CARD} keys={AGENT_KEYS}>
        <Tap from={[CARD.w - 60, CARD.h + 40]} to={target} start={104} travel={40} pressAt={press} />
      </Shot>
      <div style={{ position: 'absolute', left: 0, right: 0, top: CARD.top + 40, textAlign: 'center', opacity: toast, transform: `translateY(${(1 - toast) * -40}px)` }}>
        <Pill text="claude is ready" color={C.green} />
      </div>
    </SceneFade>
  );
};

// ---------------------------------------------------------------- 4. Browser

const BROWSER_KEYS: Key[] = [
  { at: 0, scale: FULL, focus: MID },
  { at: 64, scale: 1.48, focus: [1072, 520] },
];

export const Browser: React.FC = () => {
  const f = useCurrentFrame();
  const glide = interpolate(f, [86, 150], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE });
  const a = toCard(BROWSER_KEYS, 80, CARD.w, CARD.h, [1240, 330]);
  const b = toCard(BROWSER_KEYS, 80, CARD.w, CARD.h, [1084, 586]);
  const x = a[0] + (b[0] - a[0]) * glide;
  const y = a[1] + (b[1] - a[1]) * glide - Math.sin(glide * Math.PI) * 60;
  const ring = interpolate(f, [158, 182], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT });
  const pill = useIn(70, 13);
  const show = interpolate(f, [80, 88], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <SceneFade dur={SCENES.browser.dur}>
      <Title text="Give them a browser." accent="browser" top={250} size={108} delay={4} />
      <Shot src="hero.png" {...CARD} keys={BROWSER_KEYS}>
        <div style={{ opacity: show }}>
          <AgentCursor x={x} y={y} size={52} ring={f >= 158 ? ring : 0} />
        </div>
      </Shot>
      <div style={{ position: 'absolute', left: 0, right: 0, top: CARD.top + CARD.h - 120, textAlign: 'center', opacity: pill, transform: `scale(${0.8 + 0.2 * pill})` }}>
        <Pill text="Agent is clicking" />
      </div>
    </SceneFade>
  );
};

// ---------------------------------------------------------------- 5. Needs you

const NEEDS_KEYS: Key[] = [
  { at: 0, scale: FULL, focus: MID },
  { at: 48, scale: 2.4, focus: [150, 262] },
  { at: 112, scale: 2.4, focus: [150, 262] },
  { at: 150, scale: 1.55, focus: [470, 640] },
];

export const Needs: React.FC = () => {
  const f = useCurrentFrame();
  const badge = toCard(NEEDS_KEYS, f, CARD.w, CARD.h, [188, 257]);
  const pulse = interpolate(f % 40, [0, 40], [0, 1]);
  const showPulse = interpolate(f, [50, 58, 108, 116], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <SceneFade dur={SCENES.needs.dur}>
      <Title text="Know who needs you." accent="needs" top={250} size={108} delay={4} />
      <Shot src="needs-you.png" {...CARD} keys={NEEDS_KEYS}>
        <div style={{ position: 'absolute', left: badge[0] - 90, top: badge[1] - 50, width: 180, height: 100, borderRadius: 60, border: `5px solid ${C.red}`, opacity: showPulse * (1 - pulse), transform: `scale(${0.9 + pulse * 0.6})` }} />
      </Shot>
    </SceneFade>
  );
};

// ---------------------------------------------------------------- 6. End card

export const End: React.FC = () => {
  const tile = useIn(4, 11);
  const line = useIn(30, 16);
  const url = useIn(46, 16);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 540 - 130, top: 470, width: 260, height: 260, transform: `scale(${tile})` }}>
        <Img src={staticFile('icon.png')} style={{ width: '100%', height: '100%', filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.55))' }} />
      </div>
      <Title text="ShellQuarry" top={780} size={132} delay={12} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 940, textAlign: 'center', font: `600 54px ${FONT.display}`, color: C.text, opacity: line, transform: `translateY(${(1 - line) * 30}px)` }}>
        Free and open source
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1015, textAlign: 'center', font: `500 40px ${FONT.body}`, color: C.muted, opacity: line }}>
        for Herdr · Windows
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1150, textAlign: 'center', opacity: url, transform: `translateY(${(1 - url) * 30}px)` }}>
        <span style={{ display: 'inline-block', padding: '18px 34px', borderRadius: 999, background: C.claySoft, border: `2px solid ${C.clay}`, font: `600 40px ${FONT.body}`, color: C.text }}>{URL_TEXT}</span>
      </div>
    </AbsoluteFill>
  );
};
