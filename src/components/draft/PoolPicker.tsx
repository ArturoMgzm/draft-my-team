import { useMemo, useState } from "react";
import { buildAllEntries, type Config, type DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// The curated-pool picker. Guarantees and bans steer the roll instead of
// replacing it: guaranteed mons are always in the pool, banned mons can
// never be rolled, and every slot left over is filled randomly at draft
// start. Both lists live in the config (customPool / bannedPool) as entry
// ids and persist via the normal config sync, so every player sees the
// host's choices live.
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
  // buildAllEntries only reads splitForms + regulation from cfg; depend on
  // exactly those so the grid rebuilds when either changes (and no more).
  const { splitForms, regulation } = cfg;
  const allEntries = useMemo(
    () => buildAllEntries({ ...cfg, splitForms, regulation }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [splitForms, regulation],
  );
  const selected = useMemo(() => new Set(cfg.customPool ?? []), [cfg.customPool]);
  const banned = useMemo(() => new Set(cfg.bannedPool ?? []), [cfg.bannedPool]);
  const [query, setQuery] = useState("");
  const [megaOnly, setMegaOnly] = useState(false);
  // What a plain click does. Right-click always does the other one, but
  // touch devices have no right-click — this is their way in.
  const [clickMode, setClickMode] = useState<"guarantee" | "ban">("guarantee");

  const byId = useMemo(() => new Map(allEntries.map((e) => [e.id, e])), [allEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries.filter((e) => {
      if (megaOnly && !e.isMega) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    });
  }, [allEntries, query, megaOnly]);

  // Guaranteed/banned entries in selection order (kept stable so the grids
  // don't reshuffle as you toggle — new picks append, removed ones vanish).
  const selectedEntries = useMemo(
    () => (cfg.customPool ?? []).map((id) => byId.get(id)).filter(Boolean) as DraftEntry[],
    [cfg.customPool, byId],
  );
  const bannedEntries = useMemo(
    () => (cfg.bannedPool ?? []).map((id) => byId.get(id)).filter(Boolean) as DraftEntry[],
    [cfg.bannedPool, byId],
  );

  const randomSlots = Math.max(0, totalNeeded - selectedEntries.length);
  const atCapacity = selected.size >= totalNeeded;

  // Guarantee and ban are mutually exclusive: setting one clears the other.
  function toggleGuarantee(entry: DraftEntry) {
    if (readonly) return;
    setCfg((c) => {
      const cur = c.customPool ?? [];
      const bans = (c.bannedPool ?? []).filter((id) => id !== entry.id);
      if (cur.includes(entry.id)) {
        return { ...c, customPool: cur.filter((id) => id !== entry.id), bannedPool: bans };
      }
      // Ignore clicks that would guarantee more mons than the pool holds.
      if (cur.length >= c.players * 6 + c.extras) return { ...c, bannedPool: bans };
      return { ...c, customPool: [...cur, entry.id], bannedPool: bans };
    });
  }

  function toggleBan(entry: DraftEntry) {
    if (readonly) return;
    setCfg((c) => {
      const bans = c.bannedPool ?? [];
      if (bans.includes(entry.id)) {
        return { ...c, bannedPool: bans.filter((id) => id !== entry.id) };
      }
      return {
        ...c,
        bannedPool: [...bans, entry.id],
        customPool: (c.customPool ?? []).filter((id) => id !== entry.id),
      };
    });
  }

  const primary = clickMode === "guarantee" ? toggleGuarantee : toggleBan;
  const secondary = clickMode === "guarantee" ? toggleBan : toggleGuarantee;

  function clearAll() {
    if (readonly) return;
    setCfg((c) => ({ ...c, customPool: [], bannedPool: [] }));
  }

  function fillAll() {
    if (readonly) return;
    // Pin the remaining random slots to concrete mons — for a host who wants
    // to see (and tweak) the exact pool before starting rather than leaving
    // it to the roll.
    setCfg((c) => {
      const need = c.players * 6 + c.extras;
      const cur = c.customPool ?? [];
      if (cur.length >= need) return c;
      const taken = new Set([...cur, ...(c.bannedPool ?? [])]);
      const pool = buildAllEntries(c).filter((e) => !taken.has(e.id));
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
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <span>Pool</span>
          <span className="text-accent">{selectedEntries.length} guaranteed</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-destructive">{bannedEntries.length} banned</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-primary">{randomSlots} random</span>
          <HowItWorks />
        </div>
        {!readonly && (
          <div className="flex items-center gap-1.5">
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setClickMode("guarantee")}
                className={`px-2 py-1 text-[11px] ${
                  clickMode === "guarantee"
                    ? "bg-accent text-accent-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
                title="Click a mon to guarantee it (right-click bans)"
              >
                ✓ Guarantee
              </button>
              <button
                type="button"
                onClick={() => setClickMode("ban")}
                className={`px-2 py-1 text-[11px] ${
                  clickMode === "ban"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
                title="Click a mon to ban it (right-click guarantees)"
              >
                ✕ Ban
              </button>
            </div>
            <button
              type="button"
              onClick={fillAll}
              disabled={atCapacity}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-accent hover:text-accent disabled:opacity-40"
            >
              Fill rest now
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0 && banned.size === 0}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:border-primary hover:text-primary disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
        {/* Left: slot grid — guaranteed picks fill it, the rest stay random */}
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Pool slots ({selectedEntries.length}/{totalNeeded} set)
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
                  title={e ? e.name : "Random — rolled at draft start"}
                >
                  {e ? (
                    <button
                      type="button"
                      onClick={() => toggleGuarantee(e)}
                      disabled={readonly}
                      className="group h-full w-full"
                      title={`Remove ${e.name} from the guaranteed list`}
                    >
                      <HoverSprite entry={e} className="h-full w-full object-contain" />
                      {e.isMega && (
                        <span className="absolute right-0 top-0 rounded-bl bg-accent px-0.5 text-[7px] font-black leading-tight text-accent-foreground">
                          M
                        </span>
                      )}
                    </button>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-base text-muted-foreground/40">
                      🎲
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {bannedEntries.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Banned ({bannedEntries.length})
              </div>
              <div className="grid grid-cols-4 gap-1 lg:grid-cols-3">
                {bannedEntries.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleBan(e)}
                    disabled={readonly}
                    title={`Un-ban ${e.name}`}
                    className="relative aspect-square rounded-md border border-destructive/50 bg-destructive/10 p-0.5"
                  >
                    <HoverSprite
                      entry={e}
                      className="h-full w-full object-contain opacity-50 grayscale"
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-destructive">
                      ✕
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
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
              const isBanned = banned.has(e.id);
              // A full guarantee list only greys out *new* guarantees; the
              // button stays live so right-click can still ban (and a
              // disabled button would swallow that right-click entirely).
              const dim = !isSel && !isBanned && atCapacity && clickMode === "guarantee";
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => primary(e)}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    secondary(e);
                  }}
                  disabled={readonly}
                  title={`${e.name}\nClick to ${clickMode === "guarantee" ? "guarantee" : "ban"}, right-click to ${clickMode === "guarantee" ? "ban" : "guarantee"}`}
                  className={`relative aspect-square rounded-md border p-0.5 transition ${
                    isBanned
                      ? "border-destructive bg-destructive/15 ring-1 ring-destructive"
                      : isSel
                        ? "border-accent bg-accent/15 ring-1 ring-accent"
                        : "border-border/40 bg-background/40 hover:border-accent/50"
                  } ${dim ? "opacity-30" : ""} ${e.shiny ? "shiny-frame !border-transparent" : ""}`}
                >
                  <HoverSprite
                    entry={e}
                    className={`h-full w-full object-contain ${isBanned ? "opacity-50 grayscale" : ""}`}
                  />
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
                  {isBanned && (
                    <span className="absolute bottom-0 left-0 rounded-tr bg-destructive px-0.5 text-[8px] font-black leading-tight text-destructive-foreground">
                      ✕
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

// The rules of the picker, one hover (or tap) away. Controlled `open` so a
// tap works on touch devices, where Radix tooltips never open on their own.
function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="How the pool picker works"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-border text-[9px] font-black text-muted-foreground hover:border-accent hover:text-accent"
          >
            i
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-72 space-y-1 px-3 py-2 text-left">
          <p className="font-bold">Ban, guarantee, randomize</p>
          <p>
            <span className="font-bold">Click</span> a mon to guarantee it — it&apos;s always in the
            pool.
          </p>
          <p>
            <span className="font-bold">Right-click</span> to ban it — it can never be rolled. (On
            touch, flip the ✓/✕ toggle and tap instead.)
          </p>
          <p>
            Every slot you leave empty is <span className="font-bold">rolled randomly</span> at
            draft start, skipping banned mons.
          </p>
          <p className="text-primary-foreground/70">
            Guaranteed megas count toward the mega quota, and draft order is always shuffled.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
