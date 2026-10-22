import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, H, W } from './config';
import { Promo } from './Promo';
import { Gif, GIF } from './Gif';

const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={1200} fps={FPS} width={W} height={H} />
    <Composition id="Gif" component={Gif} durationInFrames={GIF.frames} fps={GIF.fps} width={GIF.w} height={GIF.h} />
  </>
);

registerRoot(Root);
