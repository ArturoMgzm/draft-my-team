import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { REG_MB_POOL, type DraftPokemon } from "@/lib/pokemon-pool";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pokémon Champions Draft — Reg M-B Randomizer" },
      {
        name: "description",
        content:
          "Shared-pool draft randomizer for Pokémon Champions Regulation M-B. Pick player count, get a randomized draft pool from the 224 legal Pokémon.",
      },
      { property: "og:title", content: "Pokémon Champions Draft" },
      {
        property: "og:description",
        content: "Randomized shared-pool drafting for Reg M-B.",
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

function DraftPage() {
  const [players, setPlayers] = useState(2);
  const [extras, setExtras] = useState(4);
  const [draft, setDraft] = useState<DraftPokemon[] | null>(null);
  const [seed, setSeed] = useState(0);

  const totalNeeded = players * 6 + extras;
  const overCapacity = totalNeeded > REG_MB_POOL.length;

  function roll() {
    if (overCapacity) return;
    setDraft(shuffle(REG_MB_POOL).slice(0, totalNeeded));
    setSeed((s) => s + 1);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              Pokémon{" "}
              <span className="text-primary">Champions</span> Draft
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Shared-pool randomizer · Regulation M-B · {REG_MB_POOL.length} legal Pokémon
            </p>
          </div>
          <a
            href="https://pokeapi.co"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-accent"
          >
            Sprites & data via PokéAPI ↗
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-lg">
          <div className="grid gap-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <NumberField
              label="Players"
              value={players}
              min={1}
              max={8}
              onChange={setPlayers}
              hint="6 Pokémon drafted per player"
            />
            <NumberField
              label="Extra options (N)"
              value={extras}
              min={0}
              max={50}
              onChange={setExtras}
              hint="Bonus options added to the shared pool"
            />
            <button
              onClick={roll}
              disabled={overCapacity}
              className="h-12 rounded-xl bg-primary px-6 text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-md transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draft ? "Re-roll Draft" : "Roll Draft"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Pool size:{" "}
              <span className={overCapacity ? "text-primary font-semibold" : "text-foreground font-semibold"}>
                {totalNeeded}
              </span>{" "}
              / {REG_MB_POOL.length}
            </span>
            {overCapacity && (
              <span className="text-primary">
                Too many — lower players or extras.
              </span>
            )}
          </div>
        </section>

        {draft && (
          <DraftResults key={seed} draft={draft} extras={extras} />
        )}

        {!draft && (
          <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            Configure your players and extras, then roll the draft.
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Pokémon Champions Reg M-B (Jun 17 – Sep 2, 2026). Sprites cached locally per PokéAPI guidelines.
      </footer>
    </div>
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

function DraftResults({ draft, extras }: { draft: DraftPokemon[]; extras: number }) {
  return (
    <section className="mt-8 space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-bold">
          Shared Draft Pool{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({draft.length} Pokémon · {extras} extras)
          </span>
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {draft.map((p, i) => (
          <PokemonCard key={`${p.slug}-${i}`} entry={p} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

function PokemonCard({ entry, index }: { entry: DraftPokemon; index: number }) {
  const [data, setData] = useState<PokemonData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPokemon(entry.slug).then((d) => {
      if (active) {
        setData(d);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [entry.slug]);

  return (
    <div className="group relative flex flex-col items-center rounded-xl border border-border bg-card p-3 transition hover:border-accent hover:shadow-lg hover:shadow-accent/10">
      <span className="absolute left-2 top-2 rounded-md bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        #{String(index).padStart(2, "0")}
      </span>
      {entry.isMega && (
        <span className="absolute right-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-foreground">
          Mega
        </span>
      )}
      <div className="flex aspect-square w-full items-center justify-center">
        {data?.sprite ? (
          <img
            src={data.sprite}
            alt={entry.name}
            loading="lazy"
            className="h-full w-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full animate-pulse rounded-lg bg-muted" />
        )}
      </div>
      <div className="mt-2 w-full text-center">
        <div className="truncate text-sm font-bold">{entry.name}</div>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {loaded &&
            data?.types.map((t) => <TypeBadge key={t} type={t} />)}
          {loaded && !data && (
            <span className="text-[10px] text-muted-foreground">offline</span>
          )}
        </div>
      </div>
    </div>
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
