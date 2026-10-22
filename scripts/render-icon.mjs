// Renders assets/icon.svg to assets/icon.png for `tauri icon`.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const png = new Resvg(readFileSync('assets/icon.svg'), { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync('assets/icon.png', png);
console.log('assets/icon.png');
