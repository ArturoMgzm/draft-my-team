import shinyAsset from "@/assets/shiny.mp3.asset.json";
import { isSoundMuted } from "@/lib/sound-prefs";

const DEBOUNCE_MS = 1500;

let audio: HTMLAudioElement | null = null;
let lastPlayed = 0;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio(shinyAsset.url);
    audio.volume = 0.6;
    audio.preload = "auto";
  }
  return audio;
}

export function playShinyChime() {
  if (typeof window === "undefined") return;
  if (isSoundMuted()) return;
  const now = Date.now();
  if (now - lastPlayed < DEBOUNCE_MS) return;
  lastPlayed = now;
  const a = getAudio();
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    // ignore (browsers may block before first user gesture)
  }
}
