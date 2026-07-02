import { useMemo, useState } from "react";
import {
  applyRoomAction,
  type RoomPlayerRow,
  type RoomRow,
} from "@/lib/room-client";
import { nextPlayerIndex, rollPool, type DraftEntry } from "@/lib/draft-engine";
import { TeamsSidebar } from "./TeamsSidebar";
import { PoolGrid } from "./PoolGrid";
import { ResultsGrid } from "./ResultsGrid";
import { playShinyChime } from "@/lib/shiny-sound";
import { CalcSidebar } from "@/components/calc/CalcSidebar";

export function RoomDraft({
  room,
  players,
  selfId,
}: {
  room: RoomRow;
  players: RoomPlayerRow[];
  selfId: string;
}) {
  const isHost = room.host_id === selfId;
  const [pendingPick, setPendingPick] = useState<DraftEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);

  const orderedIds = (room.player_order ?? []).filter(Boolean);
  const orderedPlayers = useMemo(() => {
    const byId = new Map(players.map((p) => [p.player_id, p]));
    return orderedIds.map((id) => byId.get(id)).filter(Boolean) as RoomPlayerRow[];
  }, [players, orderedIds]);

  const teams: DraftEntry[][] = useMemo(() => {
    const t: DraftEntry[][] = orderedPlayers.map(() => []);
    const byEntryId = new Map((room.pool ?? []).map((e) => [e.id, e]));
    const idIdx = new Map(orderedPlayers.map((p, i) => [p.player_id, i]));
    for (const pk of room.picks ?? []) {
      const e = byEntryId.get(pk.entryId);
      const idx = idIdx.get(pk.playerId);
      if (e && idx !== undefined) t[idx].push(e);
    }
    return t;
  }, [room.picks, room.pool, orderedPlayers]);

  const autoIdx = nextPlayerIndex(
    (room.picks ?? []).length,
    orderedPlayers.length,
    room.config.pickOrder,
  );
  const activeIdx = autoIdx; // server is the source of truth; host overrides per-action via `forPlayer`

  const remainingPool = useMemo(() => {
    const taken = new Set((room.picks ?? []).map((p) => p.entryId));
    return (room.pool ?? []).filter((e) => !taken.has(e.id));
  }, [room.pool, room.picks]);

  const totalSlots = orderedPlayers.length * 6;
  const draftComplete =
    room.status === "finished" || (room.picks?.length ?? 0) >= totalSlots;

  const isMyTurn =
    !draftComplete &&
    orderedPlayers[activeIdx]?.player_id === selfId;

  // Host with override may pick on behalf of active player
  const canIPick = isMyTurn || (isHost && room.host_override);

  function canPick(entry: DraftEntry): boolean {
    if (draftComplete) return false;
    const targetIdx = activeIdx;
    const team = teams[targetIdx] ?? [];
    if (team.length >= 6) return false;
    if (team.some((e) => e.speciesKey === entry.speciesKey)) return false;
    return canIPick;
  }

  function selectEntry(entry: DraftEntry) {
    if (!canPick(entry)) return;
    setPendingPick(entry);
  }

  async function confirmPick() {
    if (!pendingPick) return;
    setBusy(true);
    setErr(null);
    try {
      await applyRoomAction(room.code, selfId, {
        type: "pick",
        entryId: pendingPick.id,
      });
      setPendingPick(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function hostUndo() {
    if (!isHost || !room.host_override) return;
    if (!confirm("Undo the last pick?")) return;
    try {
      await applyRoomAction(room.code, selfId, { type: "undo" });
    } catch (e) {
      setErr(String(e));
    }
  }

  async function hostRedraft() {
    if (!isHost) return;
    if (!confirm("Re-roll the pool and keep current players?")) return;
    const pool = rollPool(room.config);
    try {
      await applyRoomAction(room.code, selfId, { type: "redraft", pool });
      if (pool.some((e) => e.shiny)) playShinyChime();
    } catch (e) {
      setErr(String(e));
    }
  }

  async function hostToggleOverride(v: boolean) {
    if (!isHost) return;
    await applyRoomAction(room.code, selfId, { type: "toggle_override", value: v });
  }

  const sidebarPlayers = orderedPlayers.map((p, i) => ({
    id: p.player_id,
    label: p.username?.trim() || `Player ${i + 1}`,
    team: teams[i] ?? [],
  }));

  if (draftComplete) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Final Teams</h2>
          <div className="flex items-center gap-2">
            {isHost && (
              <button
                onClick={hostRedraft}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground hover:brightness-110"
              >
                Redraft same players
              </button>
            )}
          </div>
        </div>
        <ResultsGrid players={sidebarPlayers} unpicked={remainingPool} />
        {err && (
          <div className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
            {err}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <TeamsSidebar
        players={sidebarPlayers}
        activeIdx={activeIdx}
        autoIdx={autoIdx}
        draftComplete={false}
        selectableOverride={false}
        unpickEnabled={false}
      />
      <div className="space-y-3">
        {isHost && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={room.host_override}
                onChange={(e) => void hostToggleOverride(e.target.checked)}
              />
              <span>Host overrides</span>
            </label>
            {room.host_override && (
              <button
                onClick={hostUndo}
                className="rounded-md border border-border bg-card px-2 py-1 hover:bg-secondary"
              >
                Undo last pick
              </button>
            )}
          </div>
        )}
        <PoolGrid
          pool={remainingPool}
          canPick={canPick}
          onPick={selectEntry}
          headerRight={
            <span className="text-xs text-muted-foreground">
              {(room.picks ?? []).length}/{totalSlots} picks
            </span>
          }
          headerLeft={
            <p className="text-xs text-muted-foreground">
              {isMyTurn ? (
                <>
                  <span className="font-semibold text-accent">Your turn.</span> Click a Pokémon to draft.
                </>
              ) : isHost && room.host_override ? (
                <>
                  Override on — picking for{" "}
                  <span className="font-semibold text-foreground">
                    {orderedPlayers[activeIdx]?.username || "Player"}
                  </span>
                  .
                </>
              ) : (
                <>
                  Waiting for{" "}
                  <span className="font-semibold text-foreground">
                    {orderedPlayers[activeIdx]?.username || "Player"}
                  </span>
                  …
                </>
              )}
            </p>
          }
        />
        {err && (
          <div className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
            {err}
          </div>
        )}
      </div>
      {pendingPick && (
        <ConfirmDialog
          entry={pendingPick}
          busy={busy}
          onConfirm={confirmPick}
          onCancel={() => setPendingPick(null)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  entry,
  busy,
  onConfirm,
  onCancel,
}: {
  entry: DraftEntry;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <h3 className="text-lg font-bold">Draft this Pokémon?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          This can't be undone (unless the host enables overrides).
        </p>
        <div className="my-4 rounded-xl border border-border bg-background/40 p-3 text-center">
          <div className="text-base font-bold">{entry.name}</div>
          {entry.isMega && (
            <div className="text-[11px] uppercase tracking-wider text-accent">Mega</div>
          )}
          {entry.shiny && <div className="text-xs">✨ Shiny</div>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Drafting…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}