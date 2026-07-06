// Auction-mode sound effects and background music — all synthesized at
// runtime via the Web Audio API (oscillators only, no external audio
// assets), so everything is royalty-free by construction. Volumes are kept
// deliberately low: the auction UI is the star, sound is seasoning.
// Everything respects the shared global mute (sound-prefs).

import { isSoundMuted } from "@/lib/sound-prefs";

let ctx: AudioContext | null = null;

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

function tone(
  audioCtx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  gainPeak: number,
  type: OscillatorType = "triangle",
) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function withCtx(fn: (audioCtx: AudioContext, t0: number) => void) {
  if (typeof window === "undefined" || isSoundMuted()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    fn(audioCtx, audioCtx.currentTime);
  } catch {
    // autoplay policies etc — never let sound break the auction
  }
}

/** Short bright blip when any bid lands. Pitch rises slightly with price. */
export function playBidBlip(amount: number) {
  withCtx((audioCtx, t0) => {
    const freq = 620 + Math.min(400, amount * 4);
    tone(audioCtx, freq, t0, 0.09, 0.12, "square");
  });
}

/** Descending two-note "gavel" + confirmation chord when a mon is sold. */
export function playSold() {
  withCtx((audioCtx, t0) => {
    tone(audioCtx, 880, t0, 0.1, 0.14);
    tone(audioCtx, 660, t0 + 0.09, 0.12, 0.14);
    // little resolution chord
    tone(audioCtx, 523.25, t0 + 0.24, 0.3, 0.1);
    tone(audioCtx, 659.25, t0 + 0.24, 0.3, 0.08);
    tone(audioCtx, 783.99, t0 + 0.24, 0.3, 0.08);
  });
}

/** Quick rising sweep when a new mon is revealed on the block. */
export function playReveal() {
  withCtx((audioCtx, t0) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, t0);
    osc.frequency.exponentialRampToValueAtTime(1000, t0 + 0.22);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  });
}

/** Low descending thud when a mon goes unsold and is skipped. */
export function playSkip() {
  withCtx((audioCtx, t0) => {
    tone(audioCtx, 320, t0, 0.14, 0.1);
    tone(audioCtx, 220, t0 + 0.12, 0.2, 0.1);
  });
}

/** Single roulette tick — the random-assign animation calls this per hop. */
export function playRouletteTick() {
  withCtx((audioCtx, t0) => {
    tone(audioCtx, 1400, t0, 0.035, 0.06, "square");
  });
}

/** Triumphant flourish when the roulette lands on the random winner. */
export function playRouletteWin() {
  withCtx((audioCtx, t0) => {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => tone(audioCtx, f, t0 + i * 0.09, 0.16, 0.12));
  });
}

/** Urgent tick for the last seconds of the auction clock. */
export function playCountdownTick() {
  withCtx((audioCtx, t0) => {
    tone(audioCtx, 980, t0, 0.05, 0.07, "square");
  });
}

// ---- Background music ------------------------------------------------------
//
// A very quiet generative loop: a slow two-chord pad (Am -> F over a C
// pedal) with a sparse pentatonic pluck on top. Synthesized note-by-note,
// so there's no recording to license. Scheduled bar-by-bar with a lookahead
// timer, and stopped by cancelling that timer + letting tails ring out.

let musicTimer: ReturnType<typeof setTimeout> | null = null;
let musicPlaying = false;

const BAR_SECONDS = 3.6;
const PAD_CHORDS: number[][] = [
  [220.0, 261.63, 329.63], // A3 C4 E4  (Am)
  [174.61, 261.63, 349.23], // F3 C4 F4 (F)
];
const PLUCK_SCALE = [523.25, 587.33, 659.25, 783.99, 880.0]; // C major pentatonic-ish

function scheduleBar(audioCtx: AudioContext, barIdx: number, startTime: number) {
  const chord = PAD_CHORDS[barIdx % PAD_CHORDS.length];
  for (const f of chord) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.02, startTime + 0.8);
    gain.gain.linearRampToValueAtTime(0.012, startTime + BAR_SECONDS - 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + BAR_SECONDS + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + BAR_SECONDS + 0.5);
  }
  // Sparse pluck: 1-2 random pentatonic notes per bar, very quiet.
  const plucks = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < plucks; i++) {
    const at = startTime + 0.4 + Math.random() * (BAR_SECONDS - 1.2);
    const f = PLUCK_SCALE[Math.floor(Math.random() * PLUCK_SCALE.length)];
    tone(audioCtx, f, at, 0.5, 0.03);
  }
}

export function startAuctionMusic() {
  if (typeof window === "undefined" || musicPlaying) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  musicPlaying = true;
  let bar = 0;
  let nextBarTime = audioCtx.currentTime + 0.1;

  const tick = () => {
    if (!musicPlaying) return;
    try {
      if (audioCtx.state === "suspended") void audioCtx.resume();
      // Schedule ahead while respecting live mute toggling.
      while (nextBarTime < audioCtx.currentTime + BAR_SECONDS * 1.5) {
        if (!isSoundMuted()) scheduleBar(audioCtx, bar, nextBarTime);
        bar += 1;
        nextBarTime += BAR_SECONDS;
      }
    } catch {
      // never let music break the auction
    }
    musicTimer = setTimeout(tick, 500);
  };
  tick();
}

export function stopAuctionMusic() {
  musicPlaying = false;
  if (musicTimer) {
    clearTimeout(musicTimer);
    musicTimer = null;
  }
}
