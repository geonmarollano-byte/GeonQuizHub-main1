#!/usr/bin/env python3
"""
GEON'S GAMEHUB - audio asset generator.
Synthesizes the documented audio assets as real MP3 files:
click.mp3, correct.mp3, wrong.mp3, home-music.mp3, game-music.mp3,
motto-music.mp3, victory.mp3.
Usage: python3 tools/gen_audio.py   (requires: pip install lameenc)
"""
import math
import os
import random
import struct
import sys

import lameenc

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def encode_mp3(samples, path, bitrate=96):
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples)
    data = enc.encode(pcm)
    data += enc.flush()
    with open(path, "wb") as f:
        f.write(data)
    print(f"  {os.path.basename(path)}: {len(data)/1024:.1f} KB, {len(samples)/SR:.2f}s")


def env(i, n, attack=0.01, release=0.3):
    """Simple attack/decay envelope over n samples."""
    a = int(attack * SR)
    r = int(release * SR)
    if i < a:
        return i / max(1, a)
    if i > n - r:
        return max(0.0, (n - i) / max(1, r))
    return 1.0


def tone(freq, dur, vol=0.5, wave="sine", vibrato=0.0):
    n = int(dur * SR)
    out = []
    for i in range(n):
        t = i / SR
        f = freq * (1 + vibrato * math.sin(2 * math.pi * 5 * t))
        if wave == "sine":
            s = math.sin(2 * math.pi * f * t)
        elif wave == "square":
            s = 1.0 if math.sin(2 * math.pi * f * t) >= 0 else -1.0
        elif wave == "saw":
            s = 2.0 * ((f * t) % 1.0) - 1.0
        else:
            s = math.sin(2 * math.pi * f * t) + 0.4 * math.sin(4 * math.pi * f * t)
        out.append(s * vol * env(i, n, 0.008, min(0.25, dur / 3)))
    return out


def mix(base, add, offset_sec):
    off = int(offset_sec * SR)
    while len(base) < off + len(add):
        base.append(0.0)
    for i, s in enumerate(add):
        base[off + i] += s
    return base


def note_freq(semis_from_a4=0):
    return 440.0 * (2 ** (semis_from_a4 / 12))


def seq(notes, beat=0.25, vol=0.4, wave="sine"):
    """notes: list of (semitones_from_A4 or None, duration_in_beats)"""
    out = []
    for n, beats in notes:
        dur = beats * beat
        if n is None:
            out.extend([0.0] * int(dur * SR))
        else:
            out.extend(tone(note_freq(n), dur, vol, wave))
    return out


# ---------------------------------------------------------------- SFX
def click():
    return tone(1250, 0.06, 0.45, "sine")


def correct():
    out = seq([(3, 1), (7, 1), (10, 2)], beat=0.1, vol=0.42, wave="sine")
    return out


def wrong():
    n = int(0.38 * SR)
    out = []
    for i in range(n):
        t = i / SR
        f = 230 - 90 * (t / 0.38)
        s = math.sin(2 * math.pi * f * t) + 0.35 * math.sin(2 * math.pi * f * 2.02 * t)
        out.append(s * 0.4 * env(i, n, 0.005, 0.15))
    return out


# ---------------------------------------------------------------- MUSIC
def home_music():
    """Gentle arpeggio loop in C major - calm home screen vibe (~16.6s)."""
    random.seed(7)
    chords = [[-9, -5, -2, 3], [-7, -4, 0, 5], [-10, -5, -3, 2], [-5, -2, 2, 7]]  # C Am F G-ish
    out = []
    beat = 0.26
    for bar in range(16):
        chord = chords[bar % 4]
        pattern = [0, 1, 2, 3, 2, 1, 2, 3]
        for k, idx in enumerate(pattern):
            out.extend(tone(note_freq(chord[idx] + 12), beat * 0.95, 0.16, "sine"))
        # soft bass on beats 1 and 3
        bass_at = int((bar * 8 * beat) * SR)
        b = tone(note_freq(chord[0] - 12), beat * 1.8, 0.2, "sine")
        while len(out) < bass_at + len(b):
            out.append(0.0)
        for i, s in enumerate(b):
            out[bass_at + i] = out[bass_at + i] * 0.7 + s
    # fade loop edges for smooth looping
    fade = int(0.4 * SR)
    for i in range(fade):
        out[i] *= i / fade
        out[-1 - i] *= i / fade
    return out


def game_music():
    """Uplight sequencer loop for quiz play (~19s)."""
    random.seed(11)
    beat = 0.19
    prog = [[-9, -2, 3, 7], [-7, 0, 5, 8], [-10, -3, 2, 5], [-5, 2, 7, 11]]
    out = []
    for bar in range(25):
        chord = prog[bar % 4]
        # eighth-note arpeggio
        for k in range(8):
            idx = [0, 1, 2, 3, 2, 3, 1, 2][k]
            out.extend(tone(note_freq(chord[idx] + 12), beat * 0.9, 0.13, "saw"))
        # bass pulse
        bass_at = int((bar * 8 * beat) * SR)
        b = tone(note_freq(chord[0] - 12), beat * 1.5, 0.22, "square")
        while len(out) < bass_at + len(b):
            out.append(0.0)
        for i, s in enumerate(b):
            out[bass_at + i] = out[bass_at + i] * 0.65 + s * 0.8
        # hat on off-beats
        for k in range(8):
            if k % 2 == 1:
                hat_at = int((bar * 8 * beat + k * beat) * SR)
                hn = int(0.04 * SR)
                while len(out) < hat_at + hn:
                    out.append(0.0)
                for i in range(hn):
                    noise = (random.random() * 2 - 1) * 0.05 * (1 - i / hn)
                    out[hat_at + i] += noise
    fade = int(0.4 * SR)
    for i in range(fade):
        out[i] *= i / fade
        out[-1 - i] *= i / fade
    return out


def motto_music():
    """Warm cinematic swell for the motto screen (~9s)."""
    out = []
    n = int(9 * SR)
    for i in range(n):
        t = i / SR
        swell = min(1.0, t / 2.2) * max(0.0, 1 - max(0.0, (t - 7.2) / 1.8))
        s = 0.0
        for semi, vol in [(-9, 0.16), (-2, 0.13), (3, 0.13), (7, 0.1), (10, 0.07)]:
            f = note_freq(semi)
            s += vol * math.sin(2 * math.pi * f * t + 0.6 * math.sin(2 * math.pi * 0.25 * t))
        # sparkle arpeggio after 2.5s
        if t > 2.5:
            arp = [15, 19, 22, 19][int((t - 2.5) * 4) % 4]
            s += 0.06 * math.sin(2 * math.pi * note_freq(arp) * t)
        out.append(s * swell * 0.9)
    return out


def victory():
    """Triumphant little fanfare (~4.5s)."""
    beat = 0.17
    notes = [
        (3, 1), (3, 1), (3, 1), (3, 2), (0, 2), (3, 2),
        (7, 4), (None, 1), (10, 2), (7, 2), (10, 4),
    ]
    out = seq(notes, beat=beat, vol=0.3, wave="saw")
    # harmony a third below
    harm = seq([(n - 4 if n is not None else None, d) for n, d in notes], beat=beat, vol=0.16, wave="sine")
    for i, s in enumerate(harm):
        out[i] = out[i] * 0.8 + s
    # final chord
    chord_start = len(out) - int(4 * beat * SR)
    chord = tone(note_freq(3), 4 * beat, 0.18, "sine")
    for semi in (7, 10, 15):
        c = tone(note_freq(semi), 4 * beat, 0.12, "sine")
        for i, s in enumerate(c):
            chord[i] += s
    while len(out) < chord_start + len(chord):
        out.append(0.0)
    for i, s in enumerate(chord):
        out[chord_start + i] += s * 0.9
    return out


def main():
    assets = {
        "click.mp3": click(),
        "correct.mp3": correct(),
        "wrong.mp3": wrong(),
        "home-music.mp3": home_music(),
        "game-music.mp3": game_music(),
        "motto-music.mp3": motto_music(),
        "victory.mp3": victory(),
    }
    for name, samples in assets.items():
        # normalize
        peak = max(abs(s) for s in samples) or 1.0
        gain = 0.85 / peak
        encode_mp3([s * gain for s in samples], os.path.join(ROOT, name))


if __name__ == "__main__":
    main()
