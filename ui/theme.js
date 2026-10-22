// Palettes for the UI and terminal. The user picks one in the sidebar:
//   "herdr"         follow the theme in Herdr's config.toml (the default)
//   "claude-dark"   Claude Code's dark look
//   "claude-light"  Claude Code's light look
//   "theme:<name>"  any of Herdr's built-in themes
// Herdr themes use a monospace UI and tight corners, like Herdr; Claude's
// palettes use a sans-serif UI and rounder corners, like Claude Code.

(function () {
  const THEMES = window.HERDR_THEMES;
  const FALLBACK = 'catppuccin';
  const MONO = '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace';
  const SANS = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

  const CLAUDE = {
    'claude-dark': {
      label: 'Claude dark', light: false,
      bg: '#1f1e1d', sidebar: '#1f1e1d', card: '#262624', row: '#2c2c2a', sel: '#353532',
      line: '#3d3d3a', lineDim: '#30302e', muted: '#9c9a92', subtle: '#c2c0b6', text: '#faf9f5',
      accent: '#d97757', onAccent: '#ffffff', green: '#8fbf7f', yellow: '#e0b960', red: '#e5786d',
      mauve: '#c49be0', teal: '#6fc2b5', blue: '#7aa2d9', peach: '#e8a07e',
    },
    'claude-light': {
      label: 'Claude light', light: true,
      bg: '#f5f4ed', sidebar: '#f5f4ed', card: '#faf9f5', row: '#ecebe4', sel: '#e5e3da',
      line: '#dedcd1', lineDim: '#e8e6dc', muted: '#73726c', subtle: '#3d3d3a', text: '#141413',
      accent: '#c6613f', onAccent: '#ffffff', green: '#4f7d3a', yellow: '#9a6b00', red: '#b5402f',
      mauve: '#7d4bb5', teal: '#2d7d72', blue: '#3b6bb3', peach: '#b85c2c',
    },
  };

  // Herdr's light/dark siblings, used for auto_switch when light_name/dark_name are unset.
  const SIBLINGS = {
    catppuccin: ['catppuccin-latte', 'catppuccin'], 'tokyo-night': ['tokyo-night-day', 'tokyo-night'],
    gruvbox: ['gruvbox-light', 'gruvbox'], 'one-dark': ['one-light', 'one-dark'],
    solarized: ['solarized-light', 'solarized'], kanagawa: ['kanagawa-lotus', 'kanagawa'],
    'rose-pine': ['rose-pine-dawn', 'rose-pine'],
  };
  const ALIASES = {
    'catppuccin-mocha': 'catppuccin', latte: 'catppuccin-latte', light: 'catppuccin-latte', tokyonight: 'tokyo-night',
    'tokyo-day': 'tokyo-night-day', 'tokyonight-day': 'tokyo-night-day', 'gruvbox-dark': 'gruvbox', onedark: 'one-dark',
    onelight: 'one-light', 'solarized-dark': 'solarized', lotus: 'kanagawa-lotus', rosepine: 'rose-pine',
    'rosepine-dawn': 'rose-pine-dawn', dawn: 'rose-pine-dawn',
  };
  const canonical = (name) => {
    const n = String(name || '').toLowerCase();
    return THEMES[n] ? n : ALIASES[n] || null;
  };
  const siblingFor = (name, dark) => {
    for (const [base, [light, darkName]] of Object.entries(SIBLINGS)) {
      if (name === base || name === light || name === darkName) return dark ? darkName : light;
    }
    return name;
  };
  const titleCase = (name) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  /** The Herdr theme name that config.toml selects right now. */
  function herdrThemeName(config = {}) {
    let name = canonical(config.name) || FALLBACK;
    if (config.auto_switch) {
      const dark = !window.matchMedia('(prefers-color-scheme: light)').matches;
      name = canonical(dark ? config.dark_name : config.light_name) || siblingFor(name, dark);
    }
    // "terminal" follows the host terminal's palette; ShellQuarry is the host, so use the default.
    return name === 'terminal' ? FALLBACK : name;
  }

  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  function mix(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function fromHerdr(name, custom = {}) {
    const base = THEMES[name] || THEMES[FALLBACK];
    const t = { ...base };
    for (const [k, v] of Object.entries(custom)) if (typeof v === 'string') t[k] = v;
    const c = (key, fallback) => (isHex(t[key]) ? t[key] : fallback);
    const card = c('surface_dim', c('active_row_bg', '#1e1e2e'));
    const bg = c('panel_bg', card);
    const text = c('text', '#cdd6f4');
    const light = luminance(card) > 0.5;
    const sel = c('selection_bg', c('surface0', mix(card, text, 0.12)));
    return {
      label: titleCase(name), light,
      bg, sidebar: c('sidebar_bg', bg), card,
      row: mix(card, sel, 0.6), sel,
      line: c('surface1', mix(card, text, 0.2)), lineDim: c('surface0', mix(card, text, 0.1)),
      muted: c('overlay0', mix(card, text, 0.45)), subtle: c('subtext0', mix(card, text, 0.75)), text,
      accent: c('accent', '#89b4fa'), onAccent: card,
      green: c('green', '#a6e3a1'), yellow: c('yellow', '#f9e2af'), red: c('red', '#f38ba8'),
      mauve: c('mauve', '#cba6f7'), teal: c('teal', '#94e2d5'), blue: c('blue', '#89b4fa'), peach: c('peach', '#fab387'),
    };
  }

  /** The palette for a choice; herdrConfig is the [theme] table from Herdr's config.toml. */
  function resolve(choice, herdrConfig = {}) {
    if (CLAUDE[choice]) return { ...CLAUDE[choice], id: choice, font: SANS, radius: '10px' };
    if (choice?.startsWith('theme:') && THEMES[choice.slice(6)]) {
      return { ...fromHerdr(choice.slice(6)), id: choice, font: MONO, radius: '6px' };
    }
    const name = herdrThemeName(herdrConfig);
    const custom = typeof herdrConfig.custom === 'object' ? herdrConfig.custom : {};
    return { ...fromHerdr(name, custom), id: 'herdr', label: `Herdr · ${titleCase(name)}`, font: MONO, radius: '6px' };
  }

  /** Everything the picker offers, with three preview colours each. */
  function choices(herdrConfig = {}) {
    const preview = (p) => [p.card, p.accent, p.green];
    const herdr = resolve('herdr', herdrConfig);
    return [
      { group: null, id: 'herdr', label: `Follow Herdr (${titleCase(herdrThemeName(herdrConfig))})`, dots: preview(herdr) },
      ...Object.keys(CLAUDE).map((id) => ({ group: 'Claude', id, label: CLAUDE[id].label, dots: preview(CLAUDE[id]) })),
      ...Object.keys(THEMES).filter((n) => n !== 'terminal').map((n) => {
        const p = fromHerdr(n);
        return { group: 'Herdr themes', id: `theme:${n}`, label: titleCase(n), dots: preview(p) };
      }),
    ];
  }

  function apply(p) {
    const s = document.documentElement.style;
    const vars = {
      bg: p.bg, sidebar: p.sidebar, card: p.card, row: p.row, sel: p.sel, line: p.line, 'line-dim': p.lineDim,
      muted: p.muted, subtle: p.subtle, text: p.text, accent: p.accent, 'on-accent': p.onAccent,
      green: p.green, yellow: p.yellow, red: p.red, radius: p.radius, 'font-ui': p.font,
    };
    for (const [k, v] of Object.entries(vars)) s.setProperty(`--${k}`, v);
    s.setProperty('color-scheme', p.light ? 'light' : 'dark');
  }

  function xterm(p) {
    return {
      background: p.card, foreground: p.text, cursor: p.accent, cursorAccent: p.card,
      selectionBackground: p.sel,
      black: p.light ? p.subtle : p.line, red: p.red, green: p.green, yellow: p.yellow,
      blue: p.blue, magenta: p.mauve, cyan: p.teal, white: p.light ? p.line : p.subtle,
      brightBlack: p.muted, brightRed: p.red, brightGreen: p.green, brightYellow: p.peach,
      brightBlue: p.accent, brightMagenta: p.mauve, brightCyan: p.teal, brightWhite: p.text,
    };
  }

  window.ShellQuarryTheme = { resolve, choices, apply, xterm };
})();
