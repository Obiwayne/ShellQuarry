"""Mixes the music under the voice for the v2 promo and reports how far apart they sit.

    python music/mix.py out/v2-voice.wav public/house.wav out/v2-mix.wav

The voice stem (voice + sound effects, rendered with music off) drives the ducking:
while she speaks, the music drops by DUCK_DB and gets an extra dip in the speech band,
so the words sit clearly on top. Between lines the music comes back up.
"""
import sys
import wave

import numpy as np
from scipy import signal

GAP_BELOW_VOICE_DB = 6.0   # music level between lines, relative to the voice's speaking level
DUCK_DB = 13.0             # extra drop while speaking
SPEECH_DIP_DB = 6.0        # further dip in 300 Hz - 3.5 kHz while speaking
ATTACK, RELEASE = 0.04, 0.30


def read(path):
    with wave.open(path) as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype="<i2").astype(float).reshape(-1, ch) / 32768
    if ch == 1:
        x = np.repeat(x, 2, axis=1)
    return sr, x


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-9))


sr, voice = read(sys.argv[1])
sr2, music = read(sys.argv[2])
assert sr == sr2, "sample rates differ"
n = len(voice)
music = np.pad(music, ((0, max(0, n - len(music))), (0, 0)))[:n]

# Voice activity envelope (10 ms hops, mono, speech band only so whooshes don't trigger it).
speech = signal.sosfilt(signal.butter(4, [200, 4000], "band", fs=sr, output="sos"), voice.mean(axis=1))
hop = sr // 100
frames = np.sqrt(np.add.reduceat(speech ** 2, np.arange(0, n, hop)) / hop)
active = frames > 10 ** (-38 / 20)
# Smooth on/off into a 0..1 ducking amount with attack and release.
amt = np.zeros(len(active))
a_up, a_dn = 1 - np.exp(-0.01 / ATTACK), 1 - np.exp(-0.01 / RELEASE)
for i in range(1, len(active)):
    target = 1.0 if active[i] else 0.0
    amt[i] = amt[i - 1] + (a_up if target > amt[i - 1] else a_dn) * (target - amt[i - 1])
# Look ahead 60 ms so the dip starts just before the first syllable.
amt = np.maximum(amt, np.concatenate([amt[6:], np.zeros(6)]))
duck = np.interp(np.arange(n), np.arange(len(amt)) * hop, amt)

# Levels: speaking level of the voice, gap level of the music.
voice_rms = np.sqrt(np.mean(voice[duck > 0.9] ** 2))
gap = duck < 0.05
music_gap_rms = np.sqrt(np.mean(music[gap] ** 2)) if gap.any() else np.sqrt(np.mean(music ** 2))
base = voice_rms * 10 ** (-GAP_BELOW_VOICE_DB / 20) / music_gap_rms
music = music * base

band = signal.sosfilt(signal.butter(2, [300, 3500], "band", fs=sr, output="sos"), music, axis=0)
dip = 1 - 10 ** (-SPEECH_DIP_DB / 20)
music_ducked = (music - band * dip * duck[:, None]) * (10 ** (-DUCK_DB * duck / 20))[:, None]

mix = voice + music_ducked
peak = np.max(np.abs(mix))
mix = mix / peak * 0.89

with wave.open(sys.argv[3], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes((mix * 32767).astype("<i2").tobytes())

# Report: voice versus music while she speaks, in the speech band and full band.
spk = duck > 0.9
sb = lambda x: signal.sosfilt(signal.butter(4, [300, 3500], "band", fs=sr, output="sos"), x.mean(axis=1))
v_full = db(np.sqrt(np.mean(voice[spk] ** 2)))
m_full = db(np.sqrt(np.mean(music_ducked[spk] ** 2)))
v_sb = db(np.sqrt(np.mean(sb(voice)[spk] ** 2)))
m_sb = db(np.sqrt(np.mean(sb(music_ducked)[spk] ** 2)))
m_gap = db(np.sqrt(np.mean(music_ducked[gap] ** 2))) if gap.any() else float("nan")
print(f"while speaking: voice is {v_full - m_full:.1f} dB above the music (full band), {v_sb - m_sb:.1f} dB in the speech band")
print(f"between lines: music sits {v_full - m_gap:.1f} dB under the voice's speaking level")
print(f"speaking {spk.mean() * 100:.0f}% of the time")
