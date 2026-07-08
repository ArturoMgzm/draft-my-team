import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  type Config,
  DEFAULT_CONFIG,
  type DraftEntry,
  nextPlayerIndex,
  rollPool,
} from "@/lib/draft-engine";
import { playShinyChime } from "@/lib/shiny-sound";
import { isSoundMuted, setSoundMuted } from "@/lib/sound-prefs";
import { ConfigPanel } from "@/components/draft/ConfigPanel";
import { PoolGrid } from "@/components/draft/PoolGrid";
import { TeamsSidebar } from "@/components/draft/TeamsSidebar";
import { Lobby } from "@/components/draft/Lobby";
import { RoomDraft } from "@/components/draft/RoomDraft";
import { AuctionDraft } from "@/components/draft/AuctionDraft";
import { CalcSidebar } from "@/components/calc/CalcSidebar";
import { useRoom } from "@/hooks/useRoom";
import { applyRoomAction, generateRoomCode, getDeviceId } from "@/lib/room-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Champions Draft — Reg M-B Randomizer" },
      {
        name: "description",
        content:
          "Shared-pool draft tool for Champions Regulation M-B. Solo or multiplayer rooms with sort, filter, and configurable mega counts.",
      },
      { property: "og:title", content: "Champions Draft" },
      {
        property: "og:description",
        content: "Turn-based shared-pool drafting for Reg M-B — solo or multiplayer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "Champions Draft" },
    ],
  }),
  component: Page,
});

type Mode = "menu" | "solo" | "room";

function Page() {
  const [mode, setMode] = useState<Mode>("menu");
  const [roomCode, setRoomCode] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
          <button
            onClick={() => {
              if (mode !== "menu" && !confirm("Return to main menu?")) return;
              setMode("menu");
              setRoomCode(null);
            }}
            className="text-left"
          >
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              <span className="text-primary">Champions</span> Draft
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shared-pool drafting · Regulation M-B
            </p>
          </button>
          <div className="flex items-center gap-3">
            <MuteToggle />
            <a
              href="https://pokeapi.co"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-accent"
            >
              via PokéAPI ↗
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {mode === "menu" && (
          <MainMenu
            onSolo={() => setMode("solo")}
            onRoom={(code) => {
              setRoomCode(code);
              setMode("room");
            }}
          />
        )}
        {mode === "solo" && <SoloDraft onExit={() => setMode("menu")} />}
        {mode === "room" && roomCode && (
          <RoomMode
            code={roomCode}
            onExit={() => {
              setRoomCode(null);
              setMode("menu");
            }}
          />
        )}
      </main>

      <footer className="border-t border-border px-6 py-5 text-center text-[11px] leading-relaxed text-muted-foreground">
        <p>
          Pokémon and Pokémon character names are trademarks of Nintendo, Game Freak, and The
          Pokémon Company. This is an unofficial fan project, not affiliated with or endorsed by
          them. Pokémon data and sprites via{" "}
          <a
            href="https://pokeapi.co"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-accent"
          >
            PokéAPI
          </a>{" "}
          (cached locally per fair-use guidelines).
        </p>
        <p className="mt-2">
          <Link to="/legal" className="underline hover:text-accent">
            Legal & disclaimers
          </Link>
        </p>
      </footer>
    </div>
  );
}

function MuteToggle() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(isSoundMuted());
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const next = !muted;
        setMuted(next);
        setSoundMuted(next);
      }}
      title={muted ? "Sound muted" : "Sound on"}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      className="rounded-md border border-border bg-card px-2 py-1.5 text-xs hover:bg-secondary"
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

function MainMenu({ onSolo, onRoom }: { onSolo: () => void; onRoom: (code: string) => void }) {
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function hostRoom() {
    setBusy(true);
    setErr(null);
    try {
      const code = generateRoomCode();
      const deviceId = getDeviceId();
      await applyRoomAction(code, deviceId, {
        type: "create",
        config: DEFAULT_CONFIG,
        username: "Host",
      });
      onRoom(code);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 5) {
      setErr("Code must be 5 characters");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const deviceId = getDeviceId();
      await applyRoomAction(code, deviceId, {
        type: "join",
        username: joinName.trim() || "Player",
      });
      onRoom(code);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <h2 className="text-xl font-bold">How will you draft?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Solo is one device, multi-seat. Rooms let other people join over the internet.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button
            onClick={onSolo}
            className="rounded-xl border border-border bg-input p-4 text-left transition hover:border-accent hover:bg-accent/5"
          >
            <div className="text-sm font-bold">Solo / Local</div>
            <div className="mt-1 text-[11px] text-muted-foreground">One screen, take turns</div>
          </button>
          <button
            onClick={hostRoom}
            disabled={busy}
            className="rounded-xl border border-accent/40 bg-accent/10 p-4 text-left transition hover:border-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <div className="text-sm font-bold">Host Room</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Creates a 5-char code to share
            </div>
          </button>
          <button
            onClick={() => setJoining((s) => !s)}
            className="rounded-xl border border-border bg-input p-4 text-left transition hover:border-accent hover:bg-accent/5"
          >
            <div className="text-sm font-bold">Join Room</div>
            <div className="mt-1 text-[11px] text-muted-foreground">Enter a code from the host</div>
          </button>
        </div>
        {joining && (
          <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-3 sm:flex-row">
            <input
              value={joinCode}
              onChange={(e) =>
                setJoinCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 5),
                )
              }
              placeholder="CODE"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-center font-mono text-lg tracking-[0.4em]"
            />
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
            <button
              onClick={joinRoom}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "…" : "Join"}
            </button>
          </div>
        )}
        {err && (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
            {err}
          </div>
        )}
      </div>
    </section>
  );
}

function RoomMode({ code, onExit }: { code: string; onExit: () => void }) {
  const selfId = useMemo(() => getDeviceId(), []);
  const { room, players, loading, error } = useRoom(code);

  if (loading && !room) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading room…</div>;
  }
  if (error || !room) {
    return (
      <div className="mx-auto max-w-md space-y-3 text-center">
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-3 text-sm text-primary">
          {error ?? "Room not found"}
        </div>
        <button
          onClick={onExit}
          className="rounded-md bg-card px-3 py-1.5 text-xs hover:bg-secondary"
        >
          Back to menu
        </button>
      </div>
    );
  }

  if (room.status === "lobby") {
    return <Lobby room={room} players={players} selfId={selfId} onLeave={onExit} />;
  }
  if (room.status === "drafting" && (room.config.draftMode ?? "standard") === "auction") {
    return <AuctionDraft room={room} players={players} selfId={selfId} />;
  }
  return <RoomDraft room={room} players={players} selfId={selfId} />;
}

// ----------------- Solo (single-device) mode -----------------
// Keeps the original local turn-based draft behavior (per-turn picks,
// out-of-turn override, undo on slot click). Now uses the shared
// PoolGrid with sort/filter.

type Pick = { entryId: string; playerIdx: number };

function SoloDraft({ onExit }: { onExit: () => void }) {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [pool, setPool] = useState<DraftEntry[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [manualPlayer, setManualPlayer] = useState<number | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  const totalSlots = cfg.players * 6;

  const remainingPool = useMemo(() => {
    if (!pool) return [];
    const taken = new Set(picks.map((p) => p.entryId));
    return pool.filter((e) => !taken.has(e.id));
  }, [pool, picks]);

  const teams = useMemo(() => {
    const t: DraftEntry[][] = Array.from({ length: cfg.players }, () => []);
    if (!pool) return t;
    const byId = new Map(pool.map((e) => [e.id, e]));
    for (const p of picks) {
      const e = byId.get(p.entryId);
      if (e && p.playerIdx < t.length) t[p.playerIdx].push(e);
    }
    return t;
  }, [picks, pool, cfg.players]);

  const autoPlayer = nextPlayerIndex(picks.length, cfg.players, cfg.pickOrder);
  const activePlayer = manualPlayer ?? autoPlayer;
  const draftComplete = picks.length >= totalSlots;

  function startDraft() {
    const rolled = rollPool(cfg);
    setPool(rolled);
    setPicks([]);
    setManualPlayer(null);
    setUsernames(Array.from({ length: cfg.players }, () => ""));
    if (rolled.some((e) => e.shiny)) playShinyChime();
  }

  function reroll() {
    if (!confirm("Re-roll the pool and clear all picks?")) return;
    startDraft();
  }

  function backToConfig() {
    if (!confirm("Return to configuration?")) return;
    setPool(null);
    setPicks([]);
    setManualPlayer(null);
  }

  function canPick(entry: DraftEntry): boolean {
    if (draftComplete) return false;
    const team = teams[activePlayer] ?? [];
    if (team.length >= 6) return false;
    if (team.some((e) => e.speciesKey === entry.speciesKey)) return false;
    return true;
  }

  function pick(entry: DraftEntry) {
    if (!canPick(entry)) return;
    setPicks((prev) => [...prev, { entryId: entry.id, playerIdx: activePlayer }]);
    setManualPlayer(null);
  }

  function unpick(entryId: string) {
    setPicks((prev) => prev.filter((p) => p.entryId !== entryId));
  }

  function selectPlayer(idx: number) {
    if ((teams[idx] ?? []).length >= 6) return;
    setManualPlayer(idx);
  }

  function setUsername(idx: number, name: string) {
    setUsernames((prev) => {
      const next = prev.slice();
      next[idx] = name;
      return next;
    });
  }

  if (!pool) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <button onClick={onExit} className="text-xs text-muted-foreground hover:text-accent">
          ← Back to menu
        </button>
        <ConfigPanel cfg={cfg} setCfg={setCfg} onStart={startDraft} />
      </div>
    );
  }

  const sidebarPlayers = teams.map((team, idx) => ({
    id: String(idx),
    label: usernames[idx]?.trim() || `Player ${idx + 1}`,
    team,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {draftComplete
            ? "Draft complete!"
            : `On the clock: ${sidebarPlayers[activePlayer]?.label}`}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reroll}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
          >
            Re-roll Pool
          </button>
          <button
            onClick={backToConfig}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
          >
            ← Config
          </button>
          <button
            onClick={() => setCalcOpen(true)}
            className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
          >
            🧮 Calculator
          </button>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <TeamsSidebar
          players={sidebarPlayers}
          activeIdx={activePlayer}
          autoIdx={autoPlayer}
          draftComplete={draftComplete}
          onSelectPlayer={selectPlayer}
          onUnpick={unpick}
          onRenamePlayer={setUsername}
          unpickEnabled
          selectableOverride
        />
        <PoolGrid
          pool={remainingPool}
          canPick={canPick}
          onPick={pick}
          headerRight={
            <span className="text-xs text-muted-foreground">
              {picks.length}/{totalSlots} picks
            </span>
          }
          headerLeft={
            !draftComplete ? (
              <p className="text-xs text-muted-foreground">
                Click a Pokémon to draft it to{" "}
                <span className="font-semibold text-foreground">
                  {sidebarPlayers[activePlayer]?.label}
                </span>
                .
              </p>
            ) : null
          }
        />
      </div>
      <CalcSidebar
        pool={pool}
        regulationId={cfg.regulation}
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
      />
    </div>
  );
}
