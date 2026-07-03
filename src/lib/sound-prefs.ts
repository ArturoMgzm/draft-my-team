// Shared mute preference for every sound effect on the site (shiny chime,
// teambuilding timer alarm, etc). One flag, one button — previously each
// sound had its own independent mute toggle, which meant two buttons that
// could disagree with each other (e.g. shiny chime muted but the timer
// alarm still on). Everything now reads/writes this single preference.
const MUTE_KEY = "soundMuted";

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setSoundMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}
