// Everything a revision usually touches: timing, copy and colours.
export const FPS = 60;
export const W = 1080;
export const H = 1920;

export const C = {
  ink: '#141413',
  ink2: '#1f1e1d',
  card: '#262624',
  clay: '#d97757',
  claySoft: 'rgba(217,119,87,0.18)',
  blue: '#89b4fa',
  mauve: '#cba6f7',
  green: '#8fbf7f',
  red: '#e5786d',
  text: '#faf9f5',
  muted: '#a6a39b',
};

export const FONT = { display: 'Space Grotesk', body: 'Inter' };

// Scene start frames and lengths (sum = 1200 = 20 s), fitted to the voiceover in public/vo.json.
export const SCENES = {
  hook: { from: 0, dur: 150 },
  meet: { from: 150, dur: 210 },
  agent: { from: 360, dur: 240 },
  browser: { from: 600, dur: 260 },
  needs: { from: 860, dur: 180 },
  end: { from: 1040, dur: 160 },
};

// Voiceover: one clip per scene, starting a few frames after the cut.
export const VO = [
  { file: 'vo-1.wav', at: 10, text: 'Running a few coding agents at once?', seconds: 1.96 },
  { file: 'vo-2.wav', at: 162, text: 'Meet ShellQuarry. Herdr, with buttons.', seconds: 2.25 },
  { file: 'vo-3.wav', at: 374, text: 'Start Claude Code, Codex, or twenty-two more.', seconds: 2.58 },
  { file: 'vo-4.wav', at: 614, text: 'Give them a browser they drive while you watch.', seconds: 2.17 },
  { file: 'vo-5.wav', at: 874, text: 'And see which one needs you.', seconds: 1.25 },
  { file: 'vo-6.wav', at: 1052, text: 'ShellQuarry. Free and open source.', seconds: 2.01 },
];

/** Screenshots are 1402 × 912 window captures of the real app. */
export const SHOT = { w: 1402, h: 912 };
export const URL_TEXT = 'github.com/Obiwayne/ShellQuarry';
