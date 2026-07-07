import { useMemo, useState } from "react";
import { buildAllEntries, type Config, type DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";

// The custom-pool picker. Left: a mini-grid of exactly `totalNeeded` slots
// that fill in with the chosen mons (mirrors the team-preview layout). Right:
// a searchable grid of every selectable entry; click to toggle. Selection is
// stored in config.customPool as entry ids and persists via the normal
// config sync, so all players see the host's selection live.
export function PoolPicker({
  cfg,
  setCfg,
  readonly = false,
}: {
  cfg: Config;
  setCfg: (updater: (c: Config) => Config) => void;
  readonly?: boolean;
}) {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const allEntries = useMemo(() => buildAllEntries(cfg.splitForms), [cfg.splitForms]);
  const selected = useMemo(() => new Set(cfg.customPool ?? []), [cfg.customPool]);
  const [query, setQuery] = useState("");
  const [megaOnly, setMegaOnly] = useState(false);

  const byId = useMemo(() => new Map(allEntries.map((e) => [e.id, e])), [allEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries.filter((e) => {
      if (megaOnly && !e.isMega) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    });
  }, [allEntries, query, megaOnly]);

  // Selected entries in selection order (kept stable so the slot grid doesn't
  // reshuffle as you toggle — new picks append, removed ones just vanish).
  const selectedEntries = useMemo(
    () => (cfg.customPool ?? []).map((id) => byId.get(id)).filter(Boolean) as DraftEntry[],
    [cfg.customPool, byId],
  );

  const atCapacity = selected.size >= totalNeeded;

  function toggle(entry: DraftEntry) {
    if (readonly) return;
    setCfg((c) => {
      const cur = c.customPool ?? [];
      if (cur.includes(entry.id)) {
        return { ...c, customPool: cur.filter((id) => id !== entry.id) };
      }
      // Ignore clicks that would exceed the required count.
      if (cur.length >= c.players * 6 + c.extras) return c;
      return { ...c, customPool: [...cur, entry.id] };
    });
  }

  function clearAll() {
    if (readonly) return;
    setCfg((c) => ({ ...c, customPool: [] }));
  }

  function autoFill() {
    if (readonly) return;
    // Fill the remaining slots with random unselected entries — a convenience
    // so a host can hand-pick a few must-haves and let the rest fill in.
    setCfg((c) => {
      const need = c.players * 6 + c.extras;
      const cur = c.customPool ?? [];
      if (cur.length >= need) return c;
      const curSet = new Set(cur);
      const pool = buildAllEntries(c.splitForms).filter((e) => !curSet.has(e.id));
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return { ...c, customPool: [...cur, ...pool.slice(0, need - cur.length).map((e) => e.id)] };
    });
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">
          Custom pool{" "}
          <span className={selected.size === totalNeeded ? "text-accent" : "text-primary"}>
            ({selected.size}/{totalNeeded})
          </span>
        </div>
        {!readonly && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={autoFill}
              disabled={atCapacity}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-accent hover:text-accent disabled:opacity-40"
            >
              Auto-fill rest
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-primary hover:text-primary disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
        {/* Left: slot grid that fills as you pick */}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Selected ({selectedEntries.length}/{totalNeeded})
          </div>
          <div className="grid grid-cols-4 gap-1 lg:grid-cols-3">
            {Array.from({ length: totalNeeded }).map((_, i) => {
              const e = selectedEntries[i];
              return (
                <div
                  key={i}
                  className={`relative aspect-square rounded-md border p-0.5 ${
                    e
                      ? "border-accent/50 bg-card"
                      : "border-dashed border-border/60 bg-background/30"
                  } ${e?.shiny ? "shiny-frame !border-transparent" : ""}`}
                  title={e ? e.name : "Empty slot"}
                >
                  {e ? (
                    <button
                      type="button"
                      onClick={() => toggle(e)}
                      disabled={readonly}
                      className="group h-full w-full"
                      title={`Remove ${e.name}`}
                    >
                      <HoverSprite entry={e} className="h-full w-full object-contain" />
                      {e.isMega && (
                        <span className="absolute right-0 top-0 rounded-bl bg-accent px-0.5 text-[7px] font-black leading-tight text-accent-foreground">
                          M
                        </span>
                      )}
                    </button>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground/50">
                      {i + 1}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: searchable full grid */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Pokémon…"
              className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs"
            />
            <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={megaOnly}
                onChange={(e) => setMegaOnly(e.target.checked)}
              />
              Megas only
            </label>
          </div>
          <div className="grid max-h-72 grid-cols-5 gap-1 overflow-y-auto sm:grid-cols-6 md:grid-cols-8">
            {filtered.map((e) => {
              const isSel = selected.has(e.id);
              const disabled = readonly || (!isSel && atCapacity);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e)}
                  disabled={disabled}
                  title={e.name}
                  className={`relative aspect-square rounded-md border p-0.5 transition ${
                    isSel
                      ? "border-accent bg-accent/15 ring-1 ring-accent"
                      : "border-border/40 bg-background/40 hover:border-accent/50"
                  } ${disabled && !isSel ? "opacity-30" : ""} ${
                    e.shiny ? "shiny-frame !border-transparent" : ""
                  }`}
                >
                  <HoverSprite entry={e} className="h-full w-full object-contain" />
                  {e.isMega && (
                    <span className="absolute right-0 top-0 rounded-bl bg-accent px-0.5 text-[7px] font-black leading-tight text-accent-foreground">
                      M
                    </span>
                  )}
                  {isSel && (
                    <span className="absolute bottom-0 left-0 rounded-tr bg-accent px-0.5 text-[8px] font-black leading-tight text-accent-foreground">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-full py-4 text-center text-[11px] text-muted-foreground">
                No matches.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
