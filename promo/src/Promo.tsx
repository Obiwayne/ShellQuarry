import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, staticFile } from 'remotion';
import { C, FONT, FPS, SCENES, VO } from './config';
import { Backdrop, Caption } from './kit';
import { Agent, Browser, End, Hook, Meet, Needs } from './scenes';

/** Load the brand fonts before frame 0 renders: a fallback font is a bug. */
function useFonts() {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const faces = [
      new FontFace(FONT.display, `url(${staticFile('space-grotesk-latin-wght-normal.woff2')})`, { weight: '300 700' }),
      new FontFace(FONT.body, `url(${staticFile('inter-latin-wght-normal.woff2')})`, { weight: '100 900' }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => { loaded.forEach((f) => document.fonts.add(f)); return document.fonts.ready; })
      .then(() => continueRender(handle));
  }, [handle]);
}

/** Music sits at about -10 dB and ducks under each voice line, with short ramps. */
function musicVolume(f: number) {
  let duck = 0;
  for (const v of VO) {
    const end = v.at + v.seconds * FPS;
    duck = Math.max(duck, interpolate(f, [v.at - 12, v.at, end, end + 14], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  }
  const fadeOut = interpolate(f, [1140, 1200], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (0.34 - duck * 0.21) * fadeOut;
}

/** Sound effects: a whoosh on each cut, a click on the tap and the agent's click. */
const SFX: [string, number, number][] = [
  ['sfx-whoosh.wav', SCENES.meet.from - 4, 0.35],
  ['sfx-whoosh.wav', SCENES.agent.from - 4, 0.35],
  ['sfx-click.wav', SCENES.agent.from + 150, 0.6],
  ['sfx-pop.wav', SCENES.agent.from + 168, 0.45],
  ['sfx-whoosh.wav', SCENES.browser.from - 4, 0.35],
  ['sfx-pop.wav', SCENES.browser.from + 70, 0.4],
  ['sfx-click.wav', SCENES.browser.from + 158, 0.6],
  ['sfx-whoosh.wav', SCENES.needs.from - 4, 0.35],
  ['sfx-whoosh.wav', SCENES.end.from - 4, 0.35],
];

export const Promo: React.FC = () => {
  useFonts();
  const scenes: [keyof typeof SCENES, React.FC][] = [['hook', Hook], ['meet', Meet], ['agent', Agent], ['browser', Browser], ['needs', Needs], ['end', End]];
  return (
    <AbsoluteFill style={{ background: C.ink, fontFamily: FONT.body, color: C.text }}>
      <Backdrop />
      {scenes.map(([key, Scene]) => (
        <Sequence key={key} from={SCENES[key].from} durationInFrames={SCENES[key].dur}>
          <Scene />
        </Sequence>
      ))}
      {VO.map((v) => (
        <Sequence key={v.file} from={v.at} durationInFrames={Math.ceil(v.seconds * FPS) + 24}>
          <Audio src={staticFile(v.file)} volume={1} />
          {v.at < SCENES.end.from ? <Caption text={v.text} seconds={v.seconds} /> : null}
        </Sequence>
      ))}
      {SFX.map(([file, at, vol], i) => (
        <Sequence key={i} from={at} durationInFrames={60}>
          <Audio src={staticFile(file)} volume={vol} />
        </Sequence>
      ))}
      <Audio src={staticFile('jazz.wav')} volume={(f) => musicVolume(f)} />
    </AbsoluteFill>
  );
};
