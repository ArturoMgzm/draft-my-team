import shinyAsset from "@/assets/shiny.mp3.asset.json";

const MUTE_KEY = "shinyMuted";
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

export function isShinyMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setShinyMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}

export function playShinyChime() {
  if (typeof window === "undefined") return;
  if (isShinyMuted()) return;
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