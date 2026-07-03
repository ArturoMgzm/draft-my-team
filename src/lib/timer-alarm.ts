// Teambuilding timer alarm — fully synthesized at runtime via the Web Audio
// API, so there's no external audio file and nothing to license: every tone
// here is generated in-browser from oscillators. It's a bright ascending
// three-note major arpeggio (C5-E5-G5, a classic "quest complete" motif),
// played twice back to back on a triangle wave for a warm, retro handheld-
// game feel that matches the site's Champions theme without reproducing
// any specific existing game's jingle.

import { isSoundMuted } from "@/lib/sound-prefs";

const DEBOUNCE_MS = 2000;

let ctx: AudioContext | null = null;
let lastPlayed = 0;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

// One short percussive tone: quick linear attack, exponential decay —
// the standard shape for a clean, non-clicky synthesized "blip".
function tone(
  audioCtx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  gainPeak: number,
) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

export function playTimerAlarm() {
  if (typeof window === "undefined") return;
  if (isSoundMuted()) return;
  const now = Date.now();
  if (now - lastPlayed < DEBOUNCE_MS) return;
  lastPlayed = now;

  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const t0 = audioCtx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const noteLen = 0.12;
    const gap = 0.03;
    const repeatGap = 0.25;
    for (let rep = 0; rep < 2; rep++) {
      const repStart = t0 + rep * (notes.length * (noteLen + gap) + repeatGap);
      notes.forEach((freq, i) => {
        tone(audioCtx, freq, repStart + i * (noteLen + gap), noteLen, 0.18);
      });
    }
  } catch {
    // ignore (autoplay policies block audio before a user gesture, etc.)
  }
}
