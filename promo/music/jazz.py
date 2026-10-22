"""Original 20-second jazz bed, synthesised from scratch (no samples, no licences).

Rhodes-style electric piano comping a ii-V-I-vi in F, upright-style walking bass,
brushed snare swishes and a swung ride. 112 bpm swing.

    python music/jazz.py public/jazz.wav
"""
import sys
import wave

import numpy as np

SR = 48000
BPM = int(sys.argv[2]) if len(sys.argv) > 2 else 112
SNAPS = "--snaps" in sys.argv
BEAT = 60 / BPM
DUR = 20.6
rng = np.random.default_rng(7)
out = np.zeros(int(SR * DUR))
stereo_l = np.zeros_like(out)
stereo_r = np.zeros_like(out)


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= len(out):
        return
    sig = sig[: len(out) - i] * gain
    stereo_l[i : i + len(sig)] += sig * (1 - pan) / 2 ** 0.5
    stereo_r[i : i + len(sig)] += sig * (1 + pan) / 2 ** 0.5


def rhodes(note, length, vel=0.5):
    t = np.arange(int(SR * length)) / SR
    f = midi(note)
    # Bell-like attack (FM) over a warm sine body, with gentle tremolo.
    mod = np.sin(2 * np.pi * f * 14 * t) * np.exp(-t * 18) * 1.6
    body = np.sin(2 * np.pi * f * t + mod) + 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
    env = (1 - np.exp(-t * 300)) * np.exp(-t * 1.6)
    env *= np.clip((length - t) / 0.08, 0, 1)
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)
    return body * env * trem * vel


def bass(note, length, vel=0.8):
    t = np.arange(int(SR * length)) / SR
    f = midi(note)
    sig = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    env = (1 - np.exp(-t * 400)) * np.exp(-t * 4.5) * np.clip((length - t) / 0.03, 0, 1)
    thump = np.exp(-t * 60) * np.sin(2 * np.pi * f * 0.5 * t) * 0.4
    return (sig * env + thump) * vel


def noise(length, decay, hp=True):
    n = rng.standard_normal(int(SR * length))
    if hp:
        n = np.diff(n, prepend=0)  # crude high-pass for air
    t = np.arange(len(n)) / SR
    return n * np.exp(-t * decay)


def ride(vel):
    t = np.arange(int(SR * 0.6)) / SR
    metal = sum(np.sin(2 * np.pi * f * t) for f in (3150, 4370, 5420, 6890)) / 4
    return (noise(0.6, 9) * 0.5 + metal * 0.5) * np.exp(-t * 7) * vel


def brush(length, vel):
    n = noise(length, 3)
    t = np.arange(len(n)) / SR
    swell = np.sin(np.pi * np.clip(t / length, 0, 1))
    return n * swell * vel


# Chords (Rhodes voicings) and roots: Gm9, C13, Fmaj9, Dm9 — two beats each? one bar each.
CHORDS = [
    (43, [58, 62, 65, 69]),  # Gm9: Bb D F A
    (48, [58, 62, 64, 69]),  # C13: Bb D E A
    (41, [57, 60, 64, 67]),  # Fmaj9: A C E G
    (50, [57, 60, 64, 65]),  # Dm9: A C E F
]
WALK = [
    [43, 46, 50, 49],
    [48, 52, 55, 54],
    [41, 45, 48, 47],
    [50, 53, 57, 44],
]

swing = BEAT * 2 / 3  # second eighth of each beat lands on the triplet
bar = 4 * BEAT
t0 = 0.15
n_bars = int((DUR - t0) / bar) + 1
for b in range(n_bars):
    root, voicing = CHORDS[b % 4]
    start = t0 + b * bar
    # Walking bass, quarter notes.
    for k, n in enumerate(WALK[b % 4]):
        add(bass(n, BEAT * 0.95, 0.55 + 0.1 * (k == 0)), start + k * BEAT + rng.uniform(-0.005, 0.005), pan=-0.1)
    # Rhodes comping: on 1 (long) and the swung "and" of 2 (short), voices rolled slightly.
    for when, length, vel in ((0, BEAT * 1.6, 0.16), (BEAT + swing, BEAT * 0.9, 0.12), (3 * BEAT + swing, BEAT * 0.8, 0.09 if b % 2 else 0.0)):
        if vel == 0:
            continue
        for v, note in enumerate(voicing):
            add(rhodes(note, length, vel), start + when + v * 0.012, pan=0.25)
    # Ride: ding, ding-a ding, ding-a (swing).
    for k in range(4):
        add(ride(0.06 if k % 2 == 0 else 0.075), start + k * BEAT, pan=0.45)
        if k % 2 == 1:
            add(ride(0.04), start + k * BEAT + swing, pan=0.45)
    # Brushes: sweep across the bar, slap on 2 and 4.
    add(brush(bar * 0.95, 0.025), start, pan=-0.3)
    for k in (1, 3):
        add(noise(0.18, 25) * 0.09, start + k * BEAT, pan=-0.2)
    # Finger snaps on 2 and 4 (v2): a bright click plus a short burst of noise.
    if SNAPS:
        for k in (1, 3):
            t = np.arange(int(SR * 0.12)) / SR
            snap = (noise(0.12, 60) * 0.5 + np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 90) * 0.4) * 0.22
            add(snap, start + k * BEAT + 0.004, pan=0.15)
    # Feathered kick on 1 and 3.
    t = np.arange(int(SR * 0.25)) / SR
    kick = np.sin(2 * np.pi * (55 + 60 * np.exp(-t * 40)) * t) * np.exp(-t * 14) * 0.22
    add(kick, start)
    add(kick * 0.6, start + 2 * BEAT)

# Final chord: Fmaj9 ring-out, then fade.
end = t0 + n_bars * bar
mix = np.stack([stereo_l, stereo_r], axis=1)
# Soft saturation and fades.
mix = np.tanh(mix * 1.6) / 1.6
fade_in = np.clip(np.arange(len(mix)) / (SR * 0.3), 0, 1)
fade_out = np.clip((DUR - np.arange(len(mix)) / SR) / 1.6, 0, 1)
mix *= (fade_in * fade_out)[:, None]
mix /= np.max(np.abs(mix)) * 1.12

path = sys.argv[1] if len(sys.argv) > 1 else "jazz.wav"
with wave.open(path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"{path}: {DUR}s, {n_bars} bars at {BPM} bpm")
