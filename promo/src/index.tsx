import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { FPS, H, W } from './config';
import { Promo } from './Promo';

const Root: React.FC = () => <Composition id="Promo" component={Promo} durationInFrames={1200} fps={FPS} width={W} height={H} />;

registerRoot(Root);
