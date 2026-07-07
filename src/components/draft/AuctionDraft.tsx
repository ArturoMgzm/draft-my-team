import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftEntry } from "@/lib/draft-engine";
import { getFormOptions } from "@/lib/draft-engine";
import { applyRoomAction, type RoomPlayerRow, type RoomRow } from "@/lib/room-client";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import { slugToMoveName } from "@/lib/calc-adapter";
import { TypeBadge } from "./PoolCard";
import { HoverSprite } from "./HoverSprite";
import {
  playBidBlip,
  playCountdownTick,
  playReveal,
  playRouletteTick,
  playRouletteWin,
  playSkip,
  playSold,
  startAuctionMusic,
  stopAuctionMusic,
} from "@/lib/auction-sounds";

// ---------------------------------------------------------------------------
// Resolve scheduling: every client schedules a resolve_auction call at the
// deadline (host slightly early at +150ms, others staggered later as backup
// so the flow survives a host disconnect). The server call is idempotent —
// SELECT ... FOR UPDATE serializes concurrent resolvers and everyone after
// the first no-ops — so duplicate calls are harmless by design.
// ---------------------------------------------------------------------------

// Up to 8 distinct player colors, all pulled from existing design tokens
// (no new colors introduced). Keyed by seat index in player_order so each
// player keeps a stable identity color across the whole auction UI.
const PLAYER_COLORS = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--accent)",
  "var(--chart-1)",
  "var(--ring)",
];

function usePokemonData(slug: string | undefined): PokemonData | null {
  const [data, setData] = useState<PokemonData | null>(null);
  useEffect(() => {
    if (!slug) {
      setData(null);
      return;
    }
    let alive = true;
    void fetchPokemon(slug).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [slug]);
  return data;
}

function useCountdown(endsAt: string | null): number {
  const endsMs = endsAt ? new Date(endsAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsMs === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [endsMs]);
  if (endsMs === null) return 0;
  return Math.max(0, (endsMs - now) / 1000);
}

export function AuctionDraft({
  room,
  players,
  selfId,
}: {
  room: RoomRow;
  players: RoomPlayerRow[];
  selfId: string;
}) {
  const isHost = room.host_id === selfId;
  const auction = room.auction ?? {};
  const money = auction.money ?? {};
  const queue = auction.queue ?? [];
  const currentId = auction.current ?? null;
  const bid = auction.bid ?? 0;
  const bidder = auction.bidder ?? null;
  const pendingSwap = auction.pending_swap ?? null;
  const last = auction.last ?? null;
  const seq = auction.seq ?? 0;

  const byEntryId = useMemo(() => new Map((room.pool ?? []).map((e) => [e.id, e])), [room.pool]);
  const nameOf = (pid: string | null | undefined) =>
    players.find((p) => p.player_id === pid)?.username?.trim() || "Player";
  const orderedIds = useMemo(() => (room.player_order ?? []).filter(Boolean), [room.player_order]);
  const colorOf = (pid: string | null | undefined) => {
    const idx = pid ? orderedIds.indexOf(pid) : -1;
    return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : "var(--muted-foreground)";
  };

  const current = currentId ? (byEntryId.get(currentId) ?? null) : null;
  const secondsLeft = useCountdown(room.auction_ends_at);
  const noBidsYet = bid === 0;
  const revealAll = (room.config.revealMode ?? "auction") === "roll";

  // Roulette overlay for random assignments. Declared up here (not with the
  // rest of the animation logic below) because the just-assigned pick must
  // be hidden from the team displays WHILE the wheel spins — otherwise the
  // winner's team visibly gains the mon before the animation lands, spoiling
  // it. The server adds the pick immediately (it has to, to stay
  // authoritative), so the client hides that specific pick locally until the
  // reveal is acked.
  const [roulette, setRoulette] = useState<{
    entry: DraftEntry;
    winner: string;
    display: string;
  } | null>(null);

  // Picks with the actively-revealing random assignment filtered out, so
  // "Teams so far" and the per-player counts don't spoil the roulette.
  // Uses the authoritative server flag (auction.pending_reveal) rather than
  // the client `roulette` state, so the pick is hidden from the very first
  // render after it lands — the client effect that starts the wheel runs
  // after paint, so keying off `roulette` alone could flash one spoiled
  // frame. pending_reveal is true for exactly the window between the random
  // assignment and the ack_reveal that ends the animation.
  const pendingReveal = !!auction.pending_reveal;
  const hideEntry = pendingReveal && last?.random && last.player ? last.entry : null;
  const hidePlayer = pendingReveal && last?.random && last.player ? last.player : null;
  const visiblePicks = useMemo(() => {
    const all = room.picks ?? [];
    if (!hideEntry || !hidePlayer) return all;
    let removed = false;
    return all.filter((pk) => {
      if (!removed && pk.entryId === hideEntry && pk.playerId === hidePlayer) {
        removed = true;
        return false;
      }
      return true;
    });
  }, [room.picks, hideEntry, hidePlayer]);

  const teamCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pk of visiblePicks) {
      counts.set(pk.playerId, (counts.get(pk.playerId) ?? 0) + 1);
    }
    return counts;
  }, [visiblePicks]);

  const myCount = teamCounts.get(selfId) ?? 0;
  const myMoney = money[selfId] ?? 0;
  const allowOverdraft = !!room.config.allowOverdraft;
  const folded = auction.folded ?? [];
  const iHaveFolded = folded.includes(selfId);
  const amTopBidder = bidder === selfId && bid > 0;

  const [err, setErr] = useState<string | null>(null);
  const [customBid, setCustomBid] = useState("");

  // ---- Music lifecycle ----
  useEffect(() => {
    startAuctionMusic();
    return () => stopAuctionMusic();
  }, []);

  // ---- Bid history (reconstructed client-side) ----
  // The server only stores the *current* top bid, not the sequence — so
  // each client accumulates its own history by watching bid/bidder change
  // via realtime, and wipes it whenever a new mon hits the block. (A burst
  // of near-simultaneous bids could occasionally coalesce into one realtime
  // reload and skip an intermediate entry locally; harmless for a display.)
  const [history, setHistory] = useState<{ pid: string; amount: number; key: number }[]>([]);
  const histKeyRef = useRef(0);
  const prevBidForHist = useRef(0);
  useEffect(() => {
    // Wipe when the mon changes.
    setHistory([]);
    prevBidForHist.current = 0;
  }, [currentId]);
  useEffect(() => {
    if (bid > 0 && bidder && bid !== prevBidForHist.current) {
      histKeyRef.current += 1;
      const key = histKeyRef.current;
      setHistory((h) => [{ pid: bidder, amount: bid, key }, ...h].slice(0, 30));
    }
    prevBidForHist.current = bid;
  }, [bid, bidder]);

  // ---- Sounds & animations driven by state transitions ----
  const prevBid = useRef(bid);
  useEffect(() => {
    if (bid > 0 && bid !== prevBid.current) playBidBlip(bid);
    prevBid.current = bid;
  }, [bid]);

  const prevCurrent = useRef<string | null>(currentId);
  const [revealKey, setRevealKey] = useState(0);
  useEffect(() => {
    if (currentId && currentId !== prevCurrent.current) {
      setRevealKey((k) => k + 1);
      playReveal();
    }
    prevCurrent.current = currentId;
  }, [currentId]);

  // Countdown ticks for the last 5 seconds.
  const lastTickRef = useRef(-1);
  useEffect(() => {
    const whole = Math.ceil(secondsLeft);
    if (secondsLeft > 0 && whole <= 5 && whole !== lastTickRef.current) {
      lastTickRef.current = whole;
      playCountdownTick();
    }
    if (secondsLeft <= 0) lastTickRef.current = -1;
  }, [secondsLeft]);

  // ---- Roulette overlay for random assignments ----
  const canBid =
    !!current &&
    !pendingSwap &&
    !roulette &&
    !iHaveFolded &&
    secondsLeft > 0 &&
    (myCount < 6 || allowOverdraft) &&
    myMoney > bid;
  // Fold is available to anyone who could otherwise act but isn't the one
  // currently holding the top bid.
  const canFold =
    !!current && !pendingSwap && !roulette && !iHaveFolded && !amTopBidder && secondsLeft > 0;
  const rouletteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSeq = useRef(seq);
  useEffect(() => {
    if (seq === prevSeq.current) return;
    prevSeq.current = seq;
    if (!last) return;
    if (last.random && last.player) {
      // Client-side roulette animation toward the server-decided winner.
      // Only players with an unfilled team could have received it, so the
      // cycling names are drawn from exactly that set (computed from the
      // picks snapshot BEFORE this assignment — the winner's slot count at
      // decision time was < 6). The server has parked in pending_reveal and
      // will not open the next mon until we ack_reveal below.
      const entry = byEntryId.get(last.entry);
      if (!entry) {
        void applyRoomAction(room.code, selfId, { type: "ack_reveal" }).catch(() => {});
        return;
      }
      const counts = new Map<string, number>();
      for (const pk of room.picks ?? []) {
        // Exclude the just-assigned mon so the winner's pre-assignment count is used.
        if (pk.entryId === last.entry && pk.playerId === last.player) continue;
        counts.set(pk.playerId, (counts.get(pk.playerId) ?? 0) + 1);
      }
      const candidates = (room.player_order ?? [])
        .filter(Boolean)
        .filter((pid) => (counts.get(pid) ?? 0) < 6);
      const ackReveal = () => {
        void applyRoomAction(room.code, selfId, { type: "ack_reveal" }).catch(() => {});
      };

      // Only one possible recipient → no suspense to build, skip the spin.
      if (candidates.length <= 1) {
        setRoulette({ entry, winner: last.player, display: nameOf(last.player) });
        playRouletteWin();
        rouletteTimerRef.current = setTimeout(() => {
          setRoulette(null);
          ackReveal();
        }, 1200);
        return;
      }

      let hop = 0;
      const totalHops = 14 + Math.floor(Math.random() * 4);
      const step = () => {
        hop += 1;
        const pid = hop >= totalHops ? last.player! : candidates[hop % candidates.length];
        setRoulette({ entry, winner: last.player!, display: nameOf(pid) });
        playRouletteTick();
        if (hop < totalHops) {
          rouletteTimerRef.current = setTimeout(step, 60 + hop * 22);
        } else {
          playRouletteWin();
          rouletteTimerRef.current = setTimeout(() => {
            setRoulette(null);
            ackReveal();
          }, 2200);
        }
      };
      step();
    } else if (last.skipped) {
      playSkip();
    } else if (last.player) {
      playSold();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  useEffect(
    () => () => {
      if (rouletteTimerRef.current) clearTimeout(rouletteTimerRef.current);
    },
    [],
  );

  // ---- Resolve scheduling (idempotent server-side) ----
  useEffect(() => {
    if (!room.auction_ends_at || !currentId) return;
    const deadline = new Date(room.auction_ends_at).getTime();
    const delay = isHost ? 150 : 1200 + Math.random() * 800;
    const wait = Math.max(0, deadline - Date.now()) + delay;
    const id = setTimeout(() => {
      void applyRoomAction(room.code, selfId, { type: "resolve_auction" }).catch(() => {});
    }, wait);
    return () => clearTimeout(id);
  }, [room.auction_ends_at, currentId, isHost, room.code, selfId]);

  async function placeBid(amount: number) {
    setErr(null);
    try {
      await applyRoomAction(room.code, selfId, { type: "bid", amount });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }

  async function fold() {
    setErr(null);
    try {
      await applyRoomAction(room.code, selfId, { type: "fold" });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }

  async function swapOut(entryId: string) {
    setErr(null);
    try {
      await applyRoomAction(room.code, selfId, { type: "swap_out", entryId });
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }

  const timerPct =
    secondsLeft > 0 && room.auction_ends_at
      ? Math.min(
          100,
          (secondsLeft / (noBidsYet ? 10 : (room.config.auctionTimerSeconds ?? 30))) * 100,
        )
      : 0;
  const urgent = secondsLeft > 0 && secondsLeft <= 5;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">💰 Auction Draft</h2>
        <span className="text-xs text-muted-foreground">
          {queue.length} left in queue · {revealAll ? "pool revealed" : "revealed as auctioned"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* ---------------- Spotlight ---------------- */}
        <section className="relative overflow-hidden rounded-2xl border-2 border-accent/50 bg-card p-5">
          {pendingSwap ? (
            <SwapPanel
              pendingSwap={pendingSwap}
              selfId={selfId}
              byEntryId={byEntryId}
              picks={room.picks ?? []}
              nameOf={nameOf}
              onSwap={swapOut}
            />
          ) : current ? (
            <div key={revealKey} className="auction-reveal">
              <SpotlightMon entry={current} />
              {/* Bid bar */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/50 p-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {noBidsYet ? "Opening price" : "Current bid"}
                  </div>
                  <div className="text-2xl font-black tabular-nums text-accent">
                    ${noBidsYet ? 1 : bid}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {noBidsYet ? (
                      "No bids yet — goes unsold at 0:00"
                    ) : (
                      <>
                        Held by{" "}
                        <span className="font-semibold" style={{ color: colorOf(bidder) }}>
                          {nameOf(bidder)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {[1, 5, 10].map((inc) => {
                    const next = (noBidsYet ? 0 : bid) + inc;
                    return (
                      <button
                        key={inc}
                        type="button"
                        disabled={!canBid || next > myMoney}
                        onClick={() => placeBid(next)}
                        className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm font-bold text-accent transition hover:bg-accent/25 active:scale-95 disabled:opacity-35"
                      >
                        +${inc}
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={bid + 1}
                      max={myMoney}
                      value={customBid}
                      onChange={(e) => setCustomBid(e.target.value)}
                      placeholder="$"
                      className="w-16 rounded-lg border border-border bg-input px-2 py-2 text-center text-sm tabular-nums"
                    />
                    <button
                      type="button"
                      disabled={
                        !canBid ||
                        !customBid ||
                        Number(customBid) <= bid ||
                        Number(customBid) > myMoney
                      }
                      onClick={() => {
                        void placeBid(Number(customBid));
                        setCustomBid("");
                      }}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-accent-foreground transition hover:brightness-110 active:scale-95 disabled:opacity-35"
                    >
                      Bid
                    </button>
                  </div>
                </div>
              </div>
              {/* Fold row */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {iHaveFolded
                    ? "You folded — out until the next mon."
                    : amTopBidder
                      ? "You hold the top bid."
                      : "Not interested? Fold to speed things up."}
                </span>
                <button
                  type="button"
                  disabled={!canFold}
                  onClick={() => void fold()}
                  className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 active:scale-95 disabled:opacity-35"
                >
                  {iHaveFolded ? "Folded" : "Fold"}
                </button>
              </div>
              {/* Countdown */}
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between text-[11px]">
                  <span className="uppercase tracking-wider text-muted-foreground">
                    {noBidsYet ? "No-bid window" : "Auction clock"}
                  </span>
                  <span
                    className={`text-lg font-black tabular-nums ${urgent ? "animate-pulse text-primary" : ""}`}
                  >
                    {secondsLeft.toFixed(1)}s
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full transition-[width] duration-200 ${urgent ? "bg-primary" : "bg-accent"}`}
                    style={{ width: `${timerPct}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Any bid with under 10s left resets the clock to 10s.
                  {myCount >= 6 && allowOverdraft && " Your team is full — winning forces a swap."}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Waiting for the next auction…
            </div>
          )}

          {/* Roulette overlay — the mon is the centerpiece */}
          {roulette && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/92 backdrop-blur-sm">
              <div className="text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">
                No bids — fate decides!
              </div>
              <div className="relative flex items-center justify-center">
                <div
                  className="auction-roulette-halo absolute h-44 w-44 rounded-full"
                  aria-hidden
                />
                <div
                  className={`relative flex h-40 w-40 items-center justify-center rounded-2xl border-2 border-accent/40 bg-background/70 p-2 ${
                    roulette.entry.shiny ? "shiny-frame !border-transparent" : ""
                  }`}
                >
                  <HoverSprite
                    entry={roulette.entry}
                    className="h-full w-full object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
                  />
                </div>
              </div>
              <div className="text-lg font-black">{roulette.entry.name}</div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                goes to…
              </div>
              <div
                key={roulette.display}
                className={`rounded-xl border-2 px-8 py-2.5 text-3xl font-black ${
                  roulette.display === nameOf(roulette.winner)
                    ? "auction-roulette-final border-accent text-accent"
                    : "border-border text-foreground"
                }`}
                style={{
                  color:
                    roulette.display === nameOf(roulette.winner)
                      ? colorOf(roulette.winner)
                      : undefined,
                }}
              >
                {roulette.display}
              </div>
            </div>
          )}
        </section>

        {/* ---------------- Side column ---------------- */}
        <div className="space-y-3">
          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Players
            </div>
            <ul className="space-y-1.5">
              {(room.player_order ?? []).filter(Boolean).map((pid) => {
                const isMe = pid === selfId;
                const isTop = bidder === pid && bid > 0;
                const cash = money[pid] ?? 0;
                const count = teamCounts.get(pid) ?? 0;
                return (
                  <li
                    key={pid}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition ${
                      isTop ? "border-accent bg-accent/10" : "border-border bg-background/40"
                    } ${isMe ? "ring-1 ring-accent/40" : ""}`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(pid) }}
                      aria-hidden
                    />
                    <span className="truncate">
                      {nameOf(pid)}
                      {isMe && <span className="ml-1 text-[10px] text-muted-foreground">you</span>}
                      {isTop && <span className="ml-1 text-[10px] text-accent">top bid</span>}
                      {folded.includes(pid) && !isTop && (
                        <span className="ml-1 text-[10px] text-muted-foreground">folded</span>
                      )}
                    </span>
                    <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                      {count}/6
                    </span>
                    <span className="whitespace-nowrap font-bold tabular-nums text-accent">
                      ${cash}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Bid history
            </div>
            {history.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No bids yet on this mon. Newest bids show at the top.
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {history.map((h, i) => (
                  <li
                    key={h.key}
                    className={`flex items-center gap-2 text-[12px] ${
                      i === 0 ? "font-bold" : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(h.pid) }}
                      aria-hidden
                    />
                    <span className="truncate">{nameOf(h.pid)}</span>
                    <span className="ml-auto whitespace-nowrap tabular-nums text-accent">
                      ${h.amount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {last && !roulette && (
            <section className="rounded-2xl border border-border bg-card p-3 text-[12px]">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Last result
              </div>
              {last.skipped ? (
                <span className="text-muted-foreground">
                  {byEntryId.get(last.entry)?.name ?? "?"} went unsold — skipped.
                </span>
              ) : (
                <span>
                  <span className="font-semibold">{byEntryId.get(last.entry)?.name ?? "?"}</span> →{" "}
                  <span className="font-semibold">{nameOf(last.player)}</span>{" "}
                  {last.random ? (
                    <span className="text-accent">(random assign)</span>
                  ) : (
                    <span className="tabular-nums text-accent">for ${last.price}</span>
                  )}
                </span>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {revealAll ? `Up next (${queue.length})` : `Queue (${queue.length} hidden)`}
            </div>
            {revealAll ? (
              <div className="grid max-h-56 grid-cols-5 gap-1 overflow-y-auto">
                {queue.map((id) => {
                  const e = byEntryId.get(id);
                  if (!e) return null;
                  const extraForms = getFormOptions(e).length > 1;
                  const badge = e.isMega ? "M" : extraForms ? "⧉" : null;
                  return (
                    <div
                      key={id}
                      title={
                        e.isMega
                          ? `${e.name} (Mega)`
                          : extraForms
                            ? `${e.name} (multiple forms)`
                            : e.name
                      }
                      className={`relative aspect-square rounded-md border border-border/40 bg-background/40 p-0.5 ${
                        e.shiny ? "shiny-frame !border-transparent" : ""
                      }`}
                    >
                      <HoverSprite entry={e} className="h-full w-full object-contain" />
                      {badge && (
                        <span
                          className="absolute right-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-bl rounded-tr bg-accent px-0.5 text-[8px] font-black leading-none text-accent-foreground"
                          aria-hidden
                        >
                          {badge}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Mons are revealed one at a time as they hit the auction block.
              </p>
            )}
          </section>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
          {err}
        </div>
      )}

      {/* Teams so far */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Teams so far
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(room.player_order ?? []).filter(Boolean).map((pid) => {
            const team = visiblePicks
              .filter((pk) => pk.playerId === pid)
              .map((pk) => byEntryId.get(pk.entryId))
              .filter(Boolean) as DraftEntry[];
            return (
              <div key={pid} className="rounded-lg border border-border bg-background/40 p-2">
                <div className="mb-1 truncate text-xs font-semibold">
                  {nameOf(pid)} <span className="text-muted-foreground">({team.length}/6)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {team.map((e) => (
                    <div
                      key={e.id}
                      title={e.name}
                      className={`h-9 w-9 rounded border border-border/40 bg-card p-0.5 ${
                        e.shiny ? "shiny-frame !border-transparent" : ""
                      }`}
                    >
                      <HoverSprite entry={e} className="h-full w-full object-contain" />
                    </div>
                  ))}
                  {team.length === 0 && (
                    <span className="text-[10px] text-muted-foreground">No picks yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------- Spotlight mon card ----------------
// Information density is the point: a bidder has seconds to decide, so
// stats, abilities, typing, and the moveset count are all right here.

function SpotlightMon({ entry }: { entry: DraftEntry }) {
  const forms = getFormOptions(entry);
  const [formIdx, setFormIdx] = useState(0);
  useEffect(() => setFormIdx(0), [entry.id]);
  const active = forms[Math.min(formIdx, forms.length - 1)] ?? forms[0];
  const data = usePokemonData(active?.slug);
  const [showMoves, setShowMoves] = useState(false);
  useEffect(() => setShowMoves(false), [entry.id]);

  const statRows: { label: string; value: number | undefined }[] = [
    { label: "HP", value: data?.stats.hp },
    { label: "Atk", value: data?.stats.attack },
    { label: "Def", value: data?.stats.defense },
    { label: "SpA", value: data?.stats.specialAttack },
    { label: "SpD", value: data?.stats.specialDefense },
    { label: "Spe", value: data?.stats.speed },
  ];

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex flex-col items-center gap-2">
        <div
          className={`auction-spotlight flex h-40 w-40 items-center justify-center rounded-2xl border border-accent/30 bg-background/60 p-2 ${
            entry.shiny ? "shiny-frame !border-transparent" : ""
          }`}
        >
          {data?.sprite ? (
            <img
              src={data.sprite}
              alt=""
              className="h-full w-full object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
            />
          ) : (
            <span className="text-xs text-muted-foreground">…</span>
          )}
        </div>
        {forms.length > 1 && (
          <div className="flex flex-wrap justify-center gap-1">
            {forms.map((f, i) => (
              <button
                key={f.slug}
                type="button"
                onClick={() => setFormIdx(i)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                  i === formIdx
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-2xl font-black">{entry.name}</h3>
          {entry.shiny && <span title="Shiny!">✨</span>}
          {data?.types.map((t) => (
            <TypeBadge key={t} type={t} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {statRows.map((s) => (
            <div
              key={s.label}
              className="rounded-md border border-border bg-background/40 p-1.5 text-center"
            >
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </div>
              <div className="text-sm font-bold tabular-nums">{s.value ?? "…"}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            BST <span className="font-bold text-foreground">{data?.bst ?? "…"}</span>
          </span>
          <span>
            Abilities:{" "}
            <span className="text-foreground">
              {data?.abilities
                .map((a) =>
                  a
                    .split("-")
                    .map((w) => w[0]?.toUpperCase() + w.slice(1))
                    .join(" "),
                )
                .join(" · ") ?? "…"}
            </span>
          </span>
          {data && data.moves.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMoves((v) => !v)}
              className="font-semibold text-accent hover:underline"
            >
              {showMoves ? "Hide" : "Show"} {data.moves.length} moves
            </button>
          )}
        </div>
        {showMoves && data && (
          <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border border-border bg-background/40 p-1.5">
            {data.moves
              .slice()
              .sort((a, b) => slugToMoveName(a).localeCompare(slugToMoveName(b)))
              .map((m) => (
                <span
                  key={m}
                  className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground"
                >
                  {slugToMoveName(m)}
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Overdraft swap panel ----------------

function SwapPanel({
  pendingSwap,
  selfId,
  byEntryId,
  picks,
  nameOf,
  onSwap,
}: {
  pendingSwap: { player: string; won: string };
  selfId: string;
  byEntryId: Map<string, DraftEntry>;
  picks: { entryId: string; playerId: string }[];
  nameOf: (pid: string | null | undefined) => string;
  onSwap: (entryId: string) => void;
}) {
  const won = byEntryId.get(pendingSwap.won);
  const mine = pendingSwap.player === selfId;
  const team = picks
    .filter((pk) => pk.playerId === pendingSwap.player)
    .map((pk) => byEntryId.get(pk.entryId))
    .filter(Boolean) as DraftEntry[];

  return (
    <div className="text-center">
      <div className="text-[11px] uppercase tracking-widest text-accent">Overdraft!</div>
      <div className="mt-1 text-lg font-bold">
        {nameOf(pendingSwap.player)} won {won?.name ?? "?"}
      </div>
      {won && (
        <div className="mx-auto mt-2 h-24 w-24">
          <HoverSprite entry={won} className="h-full w-full object-contain" />
        </div>
      )}
      {mine ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a team member to release — it goes to the back of the auction queue.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {team.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSwap(e.id)}
                className="group flex w-20 flex-col items-center rounded-lg border border-border bg-background/40 p-2 transition hover:border-primary hover:bg-primary/10"
                title={`Release ${e.name}`}
              >
                <HoverSprite entry={e} className="h-12 w-12 object-contain" />
                <span className="mt-1 w-full truncate text-[10px] group-hover:text-primary">
                  {e.name}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Waiting for {nameOf(pendingSwap.player)} to choose who to release…
        </p>
      )}
    </div>
  );
}
