import { useEffect, useRef, useState } from "react";
import { playTimerAlarm } from "@/lib/timer-alarm";

// Server-synced countdown: timer_ends_at is an absolute deadline pushed to
// every client via the room's realtime subscription (see useRoom.ts), so
// all players always count down to the exact same moment. This component
// only reads the local clock to compute "how far are we from that shared
// deadline right now" — it never owns the deadline itself.
export function TeambuildingTimer({
  timerEndsAt,
  timerDurationSeconds,
  isHost,
  onSetTimer,
}: {
  timerEndsAt: string | null;
  timerDurationSeconds: number | null;
  isHost: boolean;
  onSetTimer: (seconds: number | null) => void;
}) {
  const endsAtMs = timerEndsAt ? new Date(timerEndsAt).getTime() : null;
  const running = endsAtMs !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const remainingMs = endsAtMs !== null ? Math.max(0, endsAtMs - now) : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const expired = running && remainingMs <= 0;
  const urgent = running && !expired && remainingSec <= 10;
  const pct =
    running && timerDurationSeconds
      ? Math.max(0, Math.min(100, (remainingMs / 1000 / timerDurationSeconds) * 100))
      : 0;

  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");

  // Play the alarm exactly once when the timer actually finishes, not on
  // every render/tick while it stays expired. Keyed on the deadline itself
  // so a fresh timer (even one started with the same length) always
  // triggers its own alarm rather than being suppressed by a stale ref.
  const alarmedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (expired && timerEndsAt && alarmedForRef.current !== timerEndsAt) {
      alarmedForRef.current = timerEndsAt;
      playTimerAlarm();
    }
    if (!running) alarmedForRef.current = null;
  }, [expired, timerEndsAt, running]);

  const [inputMin, setInputMin] = useState(10);
  const [inputSec, setInputSec] = useState(0);
  const requestedTotal = inputMin * 60 + inputSec;

  return (
    <section className="rounded-xl border border-accent/40 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Teambuilding Timer
          </div>
          {running ? (
            <div
              className={`mt-0.5 text-2xl font-bold tabular-nums ${
                expired || urgent ? "text-primary" : "text-foreground"
              }`}
              aria-live={expired ? "polite" : "off"}
            >
              {expired ? "Time's up!" : `${mm}:${ss}`}
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-muted-foreground">No timer running</div>
          )}
        </div>
        {isHost && (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={99}
              value={inputMin}
              onChange={(e) => setInputMin(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
              className="w-12 rounded-md border border-border bg-input px-1.5 py-1 text-center text-sm tabular-nums"
              aria-label="Minutes"
            />
            <span className="text-muted-foreground">:</span>
            <input
              type="number"
              min={0}
              max={59}
              value={inputSec}
              onChange={(e) => setInputSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
              className="w-12 rounded-md border border-border bg-input px-1.5 py-1 text-center text-sm tabular-nums"
              aria-label="Seconds"
            />
            <button
              onClick={() => onSetTimer(requestedTotal)}
              disabled={requestedTotal <= 0}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-accent-foreground hover:brightness-110 disabled:opacity-50"
            >
              {running ? "Restart" : "Start"}
            </button>
            {running && (
              <button
                onClick={() => onSetTimer(null)}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-secondary"
              >
                Stop
              </button>
            )}
          </div>
        )}
      </div>
      {running && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full transition-[width] ${expired || urgent ? "bg-primary" : "bg-accent"}`}
            style={{ width: `${expired ? 0 : pct}%` }}
          />
        </div>
      )}
    </section>
  );
}
