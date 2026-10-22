"""Transition sound effects, synthesised: whoosh (cuts), pop (cards), click (taps).

    python music/sfx.py public
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
rng = np.random.default_rng(3)
out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")


def save(name, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    with wave.open(str(out / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def lowpass(x, a):
    y = np.zeros_like(x)
    for i in range(1, len(x)):
        y[i] = y[i - 1] + a[i] * (x[i] - y[i - 1])
    return y


# Whoosh: noise through a sweeping low-pass, swelling in and out.
n = int(SR * 0.42)
t = np.arange(n) / SR
sweep = 0.02 + 0.5 * np.sin(np.pi * t / t[-1]) ** 2
save("sfx-whoosh.wav", lowpass(rng.standard_normal(n), sweep) * np.sin(np.pi * t / t[-1]) ** 1.5)

# Pop: a quick downward pitch blip.
n = int(SR * 0.12)
t = np.arange(n) / SR
f = 900 * np.exp(-t * 30) + 280
save("sfx-pop.wav", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38))

# Click: a short tick for the tap.
n = int(SR * 0.04)
t = np.arange(n) / SR
save("sfx-click.wav", (np.sin(2 * np.pi * 3200 * t) * 0.6 + rng.standard_normal(n) * 0.4) * np.exp(-t * 160))
print("sfx written")
