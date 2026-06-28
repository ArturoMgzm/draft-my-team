import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { REG_MB_POOL } from "@/lib/pokemon-pool";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pokémon Champions Draft — Reg M-B Randomizer" },
      {
        name: "description",
        content:
          "Shared-pool draft tool for Pokémon Champions Regulation M-B. Configure players, megas, and form rules, then draft teams turn by turn.",
      },
      { property: "og:title", content: "Pokémon Champions Draft" },
      {
        property: "og:description",
        content: "Turn-based shared-pool drafting for Reg M-B.",
      },
    ],
  }),
  component: DraftPage,
});

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type DraftEntry = {
  id: string;
  name: string;
  slug: string; // sprite/types slug (base for megas)
  speciesKey: string; // base species slug — used for per-player form constraint
  isMega?: boolean;
  multiForm?: boolean; // species with forms, unified mode
  altSlugs?: string[]; // alternate sprites shown on hover (mega slug, or sibling forms)
  shiny?: boolean; // 1-in-8000 lucky roll
};

type Pick = { entryId: string; playerIdx: number };

type PickOrder = "sequential" | "snake";
type MegaMode = "exact" | "atleast";

type Config = {
  players: number;
  extras: number;
  megas: number;
  megaMode: MegaMode;
  pickOrder: PickOrder;
  splitForms: boolean;
};

const DEFAULT_CONFIG: Config = {
  players: 2,
  extras: 4,
  megas: 2,
  megaMode: "exact",
  pickOrder: "snake",
  splitForms: true,
};

const MEGA_CAPABLE_SPECIES = new Set(
  REG_MB_POOL.filter((s) => s.mega).map((s) => s.slug),
);

function buildBaseEntries(splitForms: boolean): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of REG_MB_POOL) {
    if (sp.forms && sp.forms.length > 0) {
      if (splitForms) {
        for (const f of sp.forms) {
          entries.push({
            id: `f:${sp.slug}:${f.slug}`,
            name: f.name,
            slug: f.slug,
            speciesKey: sp.slug,
          });
        }
      } else {
        entries.push({
          id: `b:${sp.slug}`,
          name: sp.name,
          slug: sp.slug,
          speciesKey: sp.slug,
          multiForm: true,
          altSlugs: sp.forms.map((f) => f.slug),
        });
      }
    } else {
      entries.push({
        id: `b:${sp.slug}`,
        name: sp.name,
        slug: sp.slug,
        speciesKey: sp.slug,
      });
    }
  }
  return entries;
}

function buildNonMegaEntries(splitForms: boolean): DraftEntry[] {
  return buildBaseEntries(splitForms).filter(
    (entry) => !MEGA_CAPABLE_SPECIES.has(entry.speciesKey),
  );
}

function buildMegaCapableEntries(splitForms: boolean): DraftEntry[] {
  const entries: DraftEntry[] = [];
  for (const sp of REG_MB_POOL) {
    if (!sp.mega) continue;
    // In split-forms mode, certain multi-form species can only mega from one
    // specific form. Override the sprite slug so the card shows that form.
    let spriteSlug = sp.slug;
    if (splitForms && sp.forms && sp.forms.length > 0) {
      const override = MEGA_FORM_OVERRIDES[sp.slug];
      if (override) spriteSlug = override;
    }
    entries.push({
      id: `m:${sp.slug}`,
      name: sp.name, // base species name; mega badge denotes mega status
      slug: spriteSlug,
      speciesKey: sp.slug,
      isMega: true,
      altSlugs: [sp.mega.slug],
    });
  }
  return entries;
}

// Split-forms mode: only this form of the species can mega evolve.
const MEGA_FORM_OVERRIDES: Record<string, string> = {
  floette: "floette-eternal",
  slowbro: "slowbro",
};

function rollPool(cfg: Config): DraftEntry[] {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  const guaranteedMegas = Math.min(cfg.megas, totalNeeded);
  const megaPool = shuffle(buildMegaCapableEntries(cfg.splitForms));
  const nonMegaPool = shuffle(buildNonMegaEntries(cfg.splitForms));
  let chosen: DraftEntry[];
  if (cfg.megaMode === "exact") {
    const nonMegas = nonMegaPool.slice(0, totalNeeded - guaranteedMegas);
    const megas = megaPool.slice(0, guaranteedMegas);
    chosen = [...nonMegas, ...megas];
  } else {
    // at least X megas: lock in X megas, fill the rest from the combined pool
    const lockedMegas = megaPool.slice(0, guaranteedMegas);
    const rest = shuffle([
      ...megaPool.slice(guaranteedMegas),
      ...nonMegaPool,
    ]).slice(0, totalNeeded - guaranteedMegas);
    chosen = [...lockedMegas, ...rest];
  }
  // 1-in-8000 shiny roll per entry
  chosen = chosen.map((e) => ({ ...e, shiny: Math.random() < 1 / 8000 }));
  return shuffle(chosen);
}

function nextPlayerFor(pickIdx: number, cfg: Config): number {
  const n = cfg.players;
  if (cfg.pickOrder === "sequential") return pickIdx % n;
  const round = Math.floor(pickIdx / n);
  const pos = pickIdx % n;
  return round % 2 === 0 ? pos : n - 1 - pos;
}

function DraftPage() {
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [pool, setPool] = useState<DraftEntry[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [manualPlayer, setManualPlayer] = useState<number | null>(null);

  const totalSlots = cfg.players * 6;
  const totalNeeded = totalSlots + cfg.extras;
  const megaMax = useMemo(
    () => Math.min(buildMegaCapableEntries(cfg.splitForms).length, totalNeeded),
    [cfg.splitForms, totalNeeded],
  );
  const overCapacity = useMemo(() => {
    const megaNeeded = Math.min(cfg.megas, totalNeeded);
    const nonMegaAvailable = buildNonMegaEntries(cfg.splitForms).length;
    const megaAvailable = buildMegaCapableEntries(cfg.splitForms).length;
    if (megaNeeded > megaAvailable) return true;
    if (cfg.megaMode === "exact") {
      return totalNeeded - megaNeeded > nonMegaAvailable;
    }
    return totalNeeded > nonMegaAvailable + megaAvailable;
  }, [cfg.splitForms, cfg.megas, cfg.megaMode, totalNeeded]);

  // Clamp megas if config changes
  useEffect(() => {
    if (cfg.megas > megaMax) setCfg((c) => ({ ...c, megas: megaMax }));
  }, [cfg.megas, megaMax]);

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

  const autoPlayer = nextPlayerFor(picks.length, cfg);
  const activePlayer = manualPlayer ?? autoPlayer;
  const draftComplete = picks.length >= totalSlots;

  function startDraft() {
    if (overCapacity) return;
    setPool(rollPool(cfg));
    setPicks([]);
    setManualPlayer(null);
    setUsernames(Array.from({ length: cfg.players }, () => ""));
  }

  function reroll() {
    if (!confirm("Re-roll the pool and clear all picks?")) return;
    startDraft();
  }

  function reset() {
    if (!confirm("Reset to configuration?")) return;
    setPool(null);
    setPicks([]);
    setManualPlayer(null);
  }

  function canPick(entry: DraftEntry, playerIdx: number): boolean {
    if (draftComplete) return false;
    const team = teams[playerIdx] ?? [];
    if (team.length >= 6) return false;
    if (team.some((e) => e.speciesKey === entry.speciesKey)) return false;
    return true;
  }

  function pick(entry: DraftEntry) {
    if (!canPick(entry, activePlayer)) return;
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              Pokémon <span className="text-primary">Champions</span> Draft
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shared-pool drafting · Regulation M-B
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pool && (
              <>
                <button
                  onClick={reroll}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                >
                  Re-roll Pool
                </button>
                <button
                  onClick={reset}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                >
                  ← Config
                </button>
              </>
            )}
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
        {!pool ? (
          <ConfigPanel
            cfg={cfg}
            setCfg={setCfg}
            megaMax={megaMax}
            overCapacity={overCapacity}
            onStart={startDraft}
          />
        ) : (
          <div className="grid gap-6 md:grid-cols-[320px_1fr]">
            <TeamsSidebar
              teams={teams}
              usernames={usernames}
              setUsername={setUsername}
              activePlayer={activePlayer}
              autoPlayer={autoPlayer}
              draftComplete={draftComplete}
              onSelectPlayer={selectPlayer}
              onUnpick={unpick}
            />
            <PoolGrid
              pool={remainingPool}
              canPick={(e) => canPick(e, activePlayer)}
              onPick={pick}
              activeUsername={
                usernames[activePlayer]?.trim() || `Player ${activePlayer + 1}`
              }
              draftComplete={draftComplete}
              totalPicked={picks.length}
              totalSlots={totalSlots}
            />
          </div>
        )}
      </main>

      <footer className="border-t border-border py-5 text-center text-xs text-muted-foreground">
        Reg M-B · Sprites cached locally per PokéAPI guidelines.
      </footer>
    </div>
  );
}

function ConfigPanel({
  cfg,
  setCfg,
  megaMax,
  overCapacity,
  onStart,
}: {
  cfg: Config;
  setCfg: (updater: (c: Config) => Config) => void;
  megaMax: number;
  overCapacity: boolean;
  onStart: () => void;
}) {
  const totalNeeded = cfg.players * 6 + cfg.extras;
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-lg">
      <h2 className="text-lg font-bold">Draft Configuration</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Shared pool of {totalNeeded} Pokémon ({cfg.players * 6} slots + {cfg.extras} extras).
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Players"
          value={cfg.players}
          min={1}
          max={8}
          onChange={(v) => setCfg((c) => ({ ...c, players: v }))}
          hint="6 Pokémon per player"
        />
        <NumberField
          label="Extra options"
          value={cfg.extras}
          min={0}
          max={50}
          onChange={(v) => setCfg((c) => ({ ...c, extras: v }))}
          hint="Bonus picks in shared pool"
        />
        <NumberField
          label="Megas in pool"
          value={cfg.megas}
          min={0}
          max={megaMax}
          onChange={(v) => setCfg((c) => ({ ...c, megas: v }))}
          hint={`Max ${megaMax}`}
        />
        <ToggleField
          label="Mega count"
          value={cfg.megaMode}
          options={[
            { value: "exact", label: "Exactly", hint: "Always X megas in pool" },
            { value: "atleast", label: "At least", hint: "X guaranteed, more may roll" },
          ]}
          onChange={(v) => setCfg((c) => ({ ...c, megaMode: v as MegaMode }))}
        />
        <div className="sm:col-span-2">
          <ToggleField
            label="Pick order"
            value={cfg.pickOrder}
            options={[
              { value: "sequential", label: "Sequential", hint: "1,2,3,1,2,3…" },
              { value: "snake", label: "Snake", hint: "1,2,3,3,2,1…" },
            ]}
            onChange={(v) => setCfg((c) => ({ ...c, pickOrder: v as PickOrder }))}
          />
        </div>
        <div className="sm:col-span-2">
          <ToggleField
            label="Pokémon forms"
            value={cfg.splitForms ? "split" : "unified"}
            options={[
              {
                value: "split",
                label: "Split forms",
                hint: "Each variant is its own pick · one per species per player",
              },
              {
                value: "unified",
                label: "Unified",
                hint: "All variants under one entry",
              },
            ]}
            onChange={(v) => setCfg((c) => ({ ...c, splitForms: v === "split" }))}
          />
        </div>
      </div>

      {overCapacity && (
        <div className="mt-4 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
          Pool too large — not enough eligible Pokémon for the selected split.
        </div>
      )}

      <button
        onClick={onStart}
        disabled={overCapacity}
        className="mt-5 h-12 w-full rounded-xl bg-primary px-6 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-md transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Roll Pool & Start Draft
      </button>
    </section>
  );
}

function ToggleField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                active
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-border bg-input text-muted-foreground hover:border-accent/50"
              }`}
            >
              <div className="font-semibold">{opt.label}</div>
              {opt.hint && (
                <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamsSidebar({
  teams,
  usernames,
  setUsername,
  activePlayer,
  autoPlayer,
  draftComplete,
  onSelectPlayer,
  onUnpick,
}: {
  teams: DraftEntry[][];
  usernames: string[];
  setUsername: (i: number, n: string) => void;
  activePlayer: number;
  autoPlayer: number;
  draftComplete: boolean;
  onSelectPlayer: (i: number) => void;
  onUnpick: (entryId: string) => void;
}) {
  return (
    <aside className="space-y-3 md:sticky md:top-4 md:self-start">
      <div className="rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        {draftComplete ? (
          <span className="font-semibold text-accent">Draft complete!</span>
        ) : (
          <>
            On the clock:{" "}
            <span className="font-semibold text-foreground">
              {usernames[activePlayer]?.trim() || `Player ${activePlayer + 1}`}
            </span>
            {activePlayer !== autoPlayer && (
              <span className="ml-1 text-accent">(out of turn)</span>
            )}
          </>
        )}
      </div>
      {teams.map((team, idx) => {
        const isActive = idx === activePlayer;
        const placeholder = `Player ${idx + 1}`;
        return (
          <div
            key={idx}
            onClick={() => onSelectPlayer(idx)}
            className={`cursor-pointer rounded-xl border p-3 transition ${
              isActive
                ? "border-accent bg-accent/5 shadow-md shadow-accent/10"
                : "border-border bg-card hover:border-accent/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              <input
                type="text"
                value={usernames[idx] ?? ""}
                placeholder={placeholder}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setUsername(idx, e.target.value)}
                className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/70 focus:underline"
              />
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {team.length}/6
              </span>
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1">
              {Array.from({ length: 6 }).map((_, slot) => {
                const entry = team[slot];
                return (
                  <div
                    key={slot}
                    className="aspect-square rounded-md border border-border/50 bg-background/40"
                  >
                    {entry && (
                      <TeamSlot entry={entry} onClick={() => onUnpick(entry.id)} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function TeamSlot({ entry, onClick }: { entry: DraftEntry; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (confirm(`Remove ${entry.name} from this team?`)) onClick();
      }}
      title={`${entry.name} — click to undo`}
      className="group relative h-full w-full"
    >
      <HoverSprite entry={entry} className="h-full w-full object-contain transition group-hover:opacity-50" />
      {entry.isMega && (
        <span className="absolute bottom-0 right-0 rounded-sm bg-accent px-0.5 text-[7px] font-bold uppercase text-accent-foreground">
          M
        </span>
      )}
      {entry.shiny && (
        <span className="absolute left-0 top-0 text-[9px]" title="Shiny!">✨</span>
      )}
      <span className="pointer-events-none absolute inset-0 grid place-content-center text-[10px] font-bold text-primary opacity-0 group-hover:opacity-100">
        ✕
      </span>
    </button>
  );
}

function PoolGrid({
  pool,
  canPick,
  onPick,
  activeUsername,
  draftComplete,
  totalPicked,
  totalSlots,
}: {
  pool: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
  activeUsername: string;
  draftComplete: boolean;
  totalPicked: number;
  totalSlots: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          Shared Pool{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pool.length} left)
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Picks: {totalPicked}/{totalSlots}
        </span>
      </div>
      {!draftComplete && (
        <p className="text-xs text-muted-foreground">
          Click a Pokémon to draft it to{" "}
          <span className="font-semibold text-foreground">{activeUsername}</span>.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {pool.map((e) => (
          <PoolCard key={e.id} entry={e} disabled={!canPick(e)} onClick={() => onPick(e)} />
        ))}
      </div>
      {pool.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Pool empty.
        </div>
      )}
    </section>
  );
}

function PoolCard({
  entry,
  disabled,
  onClick,
}: {
  entry: DraftEntry;
  disabled: boolean;
  onClick: () => void;
}) {
  const [types, setTypes] = useState<string[] | null>(null);
  useEffect(() => {
    let active = true;
    fetchPokemon(entry.slug).then((d) => active && setTypes(d?.types ?? []));
    return () => {
      active = false;
    };
  }, [entry.slug]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group relative flex flex-col items-center rounded-xl border bg-card p-2 text-left transition ${
        disabled
          ? "cursor-not-allowed border-border/40 opacity-40"
          : "border-border hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-accent/10"
      }`}
    >
      {entry.isMega && (
        <span className="absolute right-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-foreground">
          Mega
        </span>
      )}
      {entry.multiForm && (
        <span className="absolute left-1.5 top-1.5 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
          Multi
        </span>
      )}
      {entry.shiny && (
        <span
          className="absolute right-1.5 bottom-1.5 text-sm"
          title="Shiny — 1 in 8000!"
        >
          ✨
        </span>
      )}
      <div className="flex aspect-square w-full items-center justify-center">
        <HoverSprite
          entry={entry}
          className="h-full w-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-105"
        />
      </div>
      <div className="mt-1 w-full text-center">
        <div className="truncate text-xs font-bold">
          {entry.name}
        </div>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {types?.map((t) => <TypeBadge key={t} type={t} />)}
        </div>
      </div>
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex h-12 items-stretch overflow-hidden rounded-xl border border-border bg-input">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="px-4 text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isNaN(v)) return;
            onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-full bg-transparent text-center text-lg font-bold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="px-4 text-lg font-bold text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
      style={{ backgroundColor: `var(--type-${type}, var(--muted))` }}
    >
      {type}
    </span>
  );
}

function HoverSprite({
  entry,
  className,
}: {
  entry: DraftEntry;
  className?: string;
}) {
  const slugs = useMemo(
    () => [entry.slug, ...(entry.altSlugs ?? [])],
    [entry.slug, entry.altSlugs],
  );
  const [datas, setDatas] = useState<(PokemonData | null)[]>(() =>
    slugs.map(() => null),
  );
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    let active = true;
    setDatas(slugs.map(() => null));
    Promise.all(slugs.map((s) => fetchPokemon(s))).then((res) => {
      if (active) setDatas(res);
    });
    return () => {
      active = false;
    };
  }, [slugs]);

  useEffect(() => {
    if (!hover || slugs.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => (i + 1) % slugs.length);
    }, 700);
    return () => window.clearInterval(id);
  }, [hover, slugs.length]);

  useEffect(() => {
    if (!hover) setIdx(0);
  }, [hover]);

  const data = datas[idx] ?? datas[0];
  const src = entry.shiny
    ? data?.shinySprite ?? data?.sprite ?? null
    : data?.sprite ?? null;
  const label =
    idx === 0 ? entry.name : slugs[idx].replace(/-/g, " ");

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative h-full w-full"
    >
      {src ? (
        <img
          src={src}
          alt={label}
          loading="lazy"
          className={className}
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded bg-muted" />
      )}
      {hover && slugs.length > 1 && (
        <span className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-background/80 px-1 text-[9px] font-semibold capitalize text-foreground">
          {label}
        </span>
      )}
    </div>
  );
}
