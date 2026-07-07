import { useEffect, useMemo, useState } from "react";
import { applyRoomAction, type RoomPlayerRow, type RoomRow } from "@/lib/room-client";
import { ConfigPanel } from "./ConfigPanel";
import {
  type Config,
  buildCustomPool,
  computeOverCapacity,
  rollPool,
  shuffle,
} from "@/lib/draft-engine";
import { playShinyChime } from "@/lib/shiny-sound";

export function Lobby({
  room,
  players,
  selfId,
  onLeave,
}: {
  room: RoomRow;
  players: RoomPlayerRow[];
  selfId: string;
  onLeave: () => void;
}) {
  const isHost = room.host_id === selfId;
  const self = players.find((p) => p.player_id === selfId);
  const [myName, setMyName] = useState(self?.username ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (self && self.username !== myName) setMyName(self.username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self?.username]);

  // Compose ordered + lobby-only players list
  const ordered = useMemo(() => {
    const byId = new Map(players.map((p) => [p.player_id, p]));
    const seen = new Set<string>();
    const list: RoomPlayerRow[] = [];
    for (const id of room.player_order ?? []) {
      const p = byId.get(id);
      if (p) {
        list.push(p);
        seen.add(id);
      }
    }
    for (const p of players) if (!seen.has(p.player_id)) list.push(p);
    return list;
  }, [players, room.player_order]);

  async function run<T extends unknown[]>(
    label: string,
    fn: (...args: T) => Promise<unknown>,
    ...args: T
  ) {
    setBusy(label);
    setErr(null);
    try {
      await fn(...args);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const updateUsername = (name: string) => {
    setMyName(name);
    void applyRoomAction(room.code, selfId, {
      type: "join",
      username: name.trim() || "Player",
    });
  };

  const setConfig = (cfg: Config) =>
    run("config", () => applyRoomAction(room.code, selfId, { type: "update_config", config: cfg }));

  const move = (idx: number, dir: -1 | 1) => {
    const arr = ordered.map((p) => p.player_id);
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    void run("order", () => applyRoomAction(room.code, selfId, { type: "set_order", order: arr }));
  };

  const randomizeOrder = () => {
    const order = shuffle(ordered.map((p) => p.player_id));
    void run("order", () => applyRoomAction(room.code, selfId, { type: "set_order", order }));
  };

  const kick = (pid: string) =>
    void run("kick", () => applyRoomAction(room.code, selfId, { type: "kick", player_id: pid }));

  const toggleOverride = (v: boolean) =>
    void run("override", () =>
      applyRoomAction(room.code, selfId, { type: "toggle_override", value: v }),
    );

  const begin = () => {
    const cfg = room.config;
    const totalNeeded = cfg.players * 6 + cfg.extras;
    let pool;
    if (cfg.useCustomPool) {
      if ((cfg.customPool?.length ?? 0) !== totalNeeded) {
        setErr(
          `Custom pool needs exactly ${totalNeeded} mons (currently ${cfg.customPool?.length ?? 0}). Adjust your selection or the player/extra counts.`,
        );
        return;
      }
      pool = buildCustomPool(cfg);
    } else {
      pool = rollPool(cfg);
    }
    void run("begin", async () => {
      await applyRoomAction(room.code, selfId, { type: "begin", pool });
      if (pool.some((e) => e.shiny)) playShinyChime();
    });
  };

  const leave = () =>
    void run("leave", async () => {
      await applyRoomAction(room.code, selfId, { type: "leave" });
      onLeave();
    });

  const cancel = () =>
    void run("cancel", async () => {
      await applyRoomAction(room.code, selfId, { type: "cancel" });
    });

  const overCapacity = computeOverCapacity(room.config);
  const enoughPlayers = players.length >= 2;
  const customTotalNeeded = room.config.players * 6 + room.config.extras;
  const customPoolIncomplete =
    room.config.useCustomPool && (room.config.customPool?.length ?? 0) !== customTotalNeeded;
  const startDisabled = !enoughPlayers
    ? "Need at least 2 players"
    : overCapacity
      ? "Pool too large"
      : customPoolIncomplete
        ? `Custom pool: pick ${customTotalNeeded} (have ${room.config.customPool?.length ?? 0})`
        : null;

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="rounded-2xl border border-accent/40 bg-accent/5 p-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Room code</div>
          <div className="mt-1 flex items-center gap-3">
            <code className="text-3xl font-black tracking-[0.3em] text-accent">{room.code}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(room.code)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-secondary"
            >
              Copy
            </button>
            <span className="ml-auto text-xs text-muted-foreground">
              {isHost ? "You are the host" : "Waiting for host…"}
            </span>
          </div>
        </div>

        <ConfigPanel
          cfg={room.config}
          setCfg={(updater) => setConfig(updater(room.config))}
          readonly={!isHost}
          hideStart={!isHost}
          onStart={begin}
          startLabel={busy === "begin" ? "Rolling…" : "Roll Pool & Start Draft"}
          startDisabledReason={startDisabled}
          multiplayer
        />

        {isHost && (
          <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={room.host_override}
              onChange={(e) => toggleOverride(e.target.checked)}
            />
            <span>
              Host overrides{" "}
              <span className="text-xs text-muted-foreground">
                — allow host to undo picks and change active player mid-draft
              </span>
            </span>
          </label>
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your name
          </div>
          <input
            type="text"
            value={myName}
            onChange={(e) => updateUsername(e.target.value)}
            placeholder="Username"
            className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Players ({players.length})
            </div>
            {isHost && players.length > 1 && (
              <button onClick={randomizeOrder} className="text-[11px] text-accent hover:underline">
                Randomize order
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {ordered.map((p, idx) => {
              const isMe = p.player_id === selfId;
              const isPlayerHost = p.player_id === room.host_id;
              return (
                <li
                  key={p.player_id}
                  className={`flex items-center gap-2 rounded-md border border-border bg-background/40 px-2 py-1.5 text-sm ${
                    isMe ? "ring-1 ring-accent/50" : ""
                  }`}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-secondary text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="truncate">
                    {p.username?.trim() || "Player"}
                    {isPlayerHost && <span className="ml-1 text-[10px] text-accent">HOST</span>}
                    {isMe && <span className="ml-1 text-[10px] text-muted-foreground">you</span>}
                  </span>
                  {isHost && (
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        className="rounded px-1.5 text-xs hover:bg-secondary disabled:opacity-30"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => move(idx, 1)}
                        disabled={idx === ordered.length - 1}
                        className="rounded px-1.5 text-xs hover:bg-secondary disabled:opacity-30"
                        title="Move down"
                      >
                        ↓
                      </button>
                      {!isMe && (
                        <button
                          onClick={() => kick(p.player_id)}
                          className="rounded px-1.5 text-xs text-primary hover:bg-primary/10"
                          title="Kick"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {err && (
          <div className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={leave}
            className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
          >
            Leave room
          </button>
          {isHost && room.status !== "lobby" && (
            <button
              onClick={cancel}
              className="flex-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
            >
              Cancel draft
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
