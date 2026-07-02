import { useEffect, useMemo, useState } from "react";
import type { DraftEntry } from "@/lib/draft-engine";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import {
  DEFAULT_FIELD,
  runCalc,
  slugToSpeciesName,
  slugToMoveName,
  SP_MAX_PER_STAT,
  SP_MAX_TOTAL,
  STATUSES,
  TERA_TYPES,
  TERRAINS,
  WEATHERS,
  ZERO_SP,
  type FieldConfig,
  type MoveResult,
  type SideConfig,
  type SpAlloc,
} from "@/lib/calc-adapter";
import { ALL_ITEMS, CHAMPIONS_ITEMS } from "@/lib/champions-items";

type SideKey = "atk" | "def";

type SideDraft = {
  entryId: string | null;
  useMega: boolean;
  ability: string;
  item: string;
  teraType: string;
  status: SideConfig["status"];
  sp: SpAlloc;
  moves: string[]; // 4 slots, slug or ""
};

const EMPTY_SIDE: SideDraft = {
  entryId: null,
  useMega: false,
  ability: "",
  item: "",
  teraType: "",
  status: "",
  sp: { ...ZERO_SP },
  moves: ["", "", "", ""],
};

export function CalcSidebar({
  pool,
  open,
  onClose,
}: {
  pool: DraftEntry[];
  open: boolean;
  onClose: () => void;
}) {
  const [atk, setAtk] = useState<SideDraft>(EMPTY_SIDE);
  const [def, setDef] = useState<SideDraft>(EMPTY_SIDE);
  const [field, setField] = useState<FieldConfig>(DEFAULT_FIELD);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-[480px] transform overflow-y-auto border-l border-border bg-background shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div>
            <h2 className="text-sm font-bold">Damage Calculator</h2>
            <p className="text-[10px] text-muted-foreground">
              Champions Reg M-B · Level 50 · Doubles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAtk((s) => ({ ...def }));
                setDef((s) => ({ ...atk }));
              }}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-secondary"
              title="Swap attacker and defender"
            >
              ⇄ Swap
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-secondary"
            >
              Close ✕
            </button>
          </div>
        </header>

        <div className="space-y-4 p-4">
          <SideCard
            title="Attacker"
            side="atk"
            pool={pool}
            state={atk}
            setState={setAtk}
          />
          <SideCard
            title="Defender"
            side="def"
            pool={pool}
            state={def}
            setState={setDef}
          />
          <FieldPanel field={field} setField={setField} />
          <Results attacker={atk} defender={def} field={field} pool={pool} />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Stats use Champions SP (1 SP ≈ +1 to that stat). Item and ability
            effects, weather, terrain, screens, spread reduction, crits and
            Tera are evaluated by Smogon's calc engine.
          </p>
        </div>
      </aside>
    </>
  );
}

// -------------------- Side card --------------------

function SideCard({
  title,
  side,
  pool,
  state,
  setState,
}: {
  title: string;
  side: SideKey;
  pool: DraftEntry[];
  state: SideDraft;
  setState: (updater: (s: SideDraft) => SideDraft) => void;
}) {
  const entry = pool.find((e) => e.id === state.entryId) ?? null;
  const data = usePokemonData(entry?.slug);

  // Reset dependent fields when the species changes
  useEffect(() => {
    setState((s) => ({
      ...s,
      ability: "",
      item: s.item,
      moves: ["", "", "", ""],
      sp: { ...ZERO_SP },
      teraType: "",
      useMega: entry?.isMega ?? false,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.entryId]);

  const spTotal = state.sp.hp + state.sp.atk + state.sp.def + state.sp.spa + state.sp.spd + state.sp.spe;
  const spBudgetLeft = SP_MAX_TOTAL - spTotal;

  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {data && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {data.types.map((t) => (
              <span
                key={t}
                className="rounded bg-secondary px-1.5 py-0.5 capitalize"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {data?.sprite && (
          <img
            src={data.sprite}
            alt=""
            className="h-16 w-16 shrink-0 object-contain"
          />
        )}
        <select
          value={state.entryId ?? ""}
          onChange={(e) =>
            setState((s) => ({ ...s, entryId: e.target.value || null }))
          }
          className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1.5 text-sm"
        >
          <option value="">— Select Pokémon —</option>
          {pool.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isMega ? " (Mega)" : ""}
            </option>
          ))}
        </select>
      </div>

      {entry && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <LabeledSelect
            label="Ability"
            value={state.ability}
            onChange={(v) => setState((s) => ({ ...s, ability: v }))}
            options={["", ...(data?.abilities ?? [])]}
            format={(v) => (v ? cap(v) : "Default")}
          />
          <LabeledSelect
            label="Item"
            value={state.item}
            onChange={(v) => setState((s) => ({ ...s, item: v }))}
            options={["", ...ALL_ITEMS]}
            groups={CHAMPIONS_ITEMS}
            format={(v) => v || "None"}
          />
          <LabeledSelect
            label="Tera"
            value={state.teraType}
            onChange={(v) => setState((s) => ({ ...s, teraType: v }))}
            options={["", ...TERA_TYPES]}
            format={(v) => v || "None"}
          />
          <LabeledSelect
            label="Status"
            value={state.status ?? ""}
            onChange={(v) => setState((s) => ({ ...s, status: v as SideConfig["status"] }))}
            options={STATUSES.map((s) => s.value ?? "")}
            format={(v) =>
              STATUSES.find((s) => (s.value ?? "") === v)?.label ?? "None"
            }
          />
        </div>
      )}

      {entry && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Stat Points</span>
            <span
              className={
                spBudgetLeft < 0 ? "font-bold text-primary" : ""
              }
            >
              {spTotal} / {SP_MAX_TOTAL}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["HP", "hp"],
                ["Atk", "atk"],
                ["Def", "def"],
                ["SpA", "spa"],
                ["SpD", "spd"],
                ["Spe", "spe"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="rounded-md border border-border bg-background/40 p-1.5">
                <div className="flex items-baseline justify-between text-[10px]">
                  <span className="font-semibold">{label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {data ? statBaseFor(data, key) : "—"} · +{state.sp[key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={SP_MAX_PER_STAT}
                  value={state.sp[key]}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      sp: { ...s.sp, [key]: Number(e.target.value) },
                    }))
                  }
                  className="w-full accent-accent"
                />
              </div>
            ))}
          </div>
          {spBudgetLeft < 0 && (
            <p className="mt-1 text-[10px] text-primary">
              Over budget by {Math.abs(spBudgetLeft)} SP
            </p>
          )}
        </div>
      )}

      {entry && side === "atk" && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Moves
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {state.moves.map((mv, i) => (
              <select
                key={i}
                value={mv}
                onChange={(e) =>
                  setState((s) => {
                    const next = s.moves.slice();
                    next[i] = e.target.value;
                    return { ...s, moves: next };
                  })
                }
                className="rounded-md border border-border bg-input px-2 py-1 text-[11px]"
              >
                <option value="">— empty —</option>
                {(data?.moves ?? []).map((mSlug) => (
                  <option key={mSlug} value={mSlug}>
                    {slugToMoveName(mSlug)}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function statBaseFor(data: PokemonData, key: keyof SpAlloc): number {
  switch (key) {
    case "hp": return data.stats.hp;
    case "atk": return data.stats.attack;
    case "def": return data.stats.defense;
    case "spa": return data.stats.specialAttack;
    case "spd": return data.stats.specialDefense;
    case "spe": return data.stats.speed;
  }
}

function cap(s: string): string {
  return s.replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// -------------------- Labeled select (with optional grouping) --------------------

function LabeledSelect({
  label,
  value,
  onChange,
  options,
  groups,
  format,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  groups?: { label: string; items: string[] }[];
  format?: (v: string) => string;
}) {
  const fmt = format ?? ((v: string) => v);
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-input px-2 py-1 text-[11px]"
      >
        {!groups && options.map((o) => (
          <option key={o} value={o}>
            {fmt(o)}
          </option>
        ))}
        {groups && (
          <>
            <option value="">{fmt("")}</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((it) => (
                  <option key={it} value={it}>
                    {it}
                  </option>
                ))}
              </optgroup>
            ))}
          </>
        )}
      </select>
    </label>
  );
}

// -------------------- Field panel --------------------

function FieldPanel({
  field,
  setField,
}: {
  field: FieldConfig;
  setField: (updater: (f: FieldConfig) => FieldConfig) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Field
      </div>
      <div className="grid grid-cols-2 gap-2">
        <LabeledSelect
          label="Format"
          value={field.gameType}
          onChange={(v) =>
            setField((f) => ({ ...f, gameType: v as "Singles" | "Doubles" }))
          }
          options={["Doubles", "Singles"]}
        />
        <LabeledSelect
          label="Weather"
          value={field.weather ?? ""}
          onChange={(v) => setField((f) => ({ ...f, weather: v || undefined }))}
          options={WEATHERS}
          format={(v) => v || "None"}
        />
        <LabeledSelect
          label="Terrain"
          value={field.terrain ?? ""}
          onChange={(v) => setField((f) => ({ ...f, terrain: v || undefined }))}
          options={TERRAINS}
          format={(v) => (v ? `${v} Terrain` : "None")}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Attacker side
          </div>
          <Checkbox
            label="Tailwind"
            checked={!!field.atk.isTailwind}
            onChange={(v) => setField((f) => ({ ...f, atk: { ...f.atk, isTailwind: v } }))}
          />
          <Checkbox
            label="Helping Hand"
            checked={!!field.atk.isHelpingHand}
            onChange={(v) =>
              setField((f) => ({ ...f, atk: { ...f.atk, isHelpingHand: v } }))
            }
          />
        </div>
        <div className="space-y-1 rounded-md border border-border bg-background/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Defender side
          </div>
          <Checkbox
            label="Reflect"
            checked={!!field.def.isReflect}
            onChange={(v) => setField((f) => ({ ...f, def: { ...f.def, isReflect: v } }))}
          />
          <Checkbox
            label="Light Screen"
            checked={!!field.def.isLightScreen}
            onChange={(v) =>
              setField((f) => ({ ...f, def: { ...f.def, isLightScreen: v } }))
            }
          />
          <Checkbox
            label="Aurora Veil"
            checked={!!field.def.isAuroraVeil}
            onChange={(v) =>
              setField((f) => ({ ...f, def: { ...f.def, isAuroraVeil: v } }))
            }
          />
        </div>
      </div>
    </section>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// -------------------- Results --------------------

function Results({
  attacker,
  defender,
  field,
  pool,
}: {
  attacker: SideDraft;
  defender: SideDraft;
  field: FieldConfig;
  pool: DraftEntry[];
}) {
  const results = useMemo<(MoveResult | null)[]>(() => {
    const aEntry = pool.find((e) => e.id === attacker.entryId);
    const dEntry = pool.find((e) => e.id === defender.entryId);
    if (!aEntry || !dEntry) return [];
    const aName = speciesNameFor(aEntry);
    const dName = speciesNameFor(dEntry);
    const aCfg: SideConfig = {
      speciesName: aName,
      ability: attacker.ability || undefined,
      item: attacker.item || undefined,
      teraType: attacker.teraType || undefined,
      sp: attacker.sp,
      status: attacker.status,
    };
    const dCfg: SideConfig = {
      speciesName: dName,
      ability: defender.ability || undefined,
      item: defender.item || undefined,
      teraType: defender.teraType || undefined,
      sp: defender.sp,
      status: defender.status,
    };
    return attacker.moves.map((mv) =>
      mv ? runCalc(aCfg, dCfg, mv, field) : null,
    );
  }, [attacker, defender, field, pool]);

  const anySelected = attacker.entryId && defender.entryId;
  if (!anySelected) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card/30 p-4 text-center text-xs text-muted-foreground">
        Pick an attacker and defender to see damage rolls.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        Results
      </div>
      <ul className="space-y-1.5">
        {attacker.moves.map((mv, i) => {
          const r = results[i];
          if (!mv) {
            return (
              <li
                key={i}
                className="rounded-md border border-dashed border-border/70 bg-background/30 px-2 py-1.5 text-[11px] text-muted-foreground"
              >
                Move slot {i + 1} empty
              </li>
            );
          }
          if (!r) {
            return (
              <li
                key={i}
                className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-[11px] text-primary"
              >
                {slugToMoveName(mv)} — calc error (unsupported name?)
              </li>
            );
          }
          return <MoveResultRow key={i} result={r} />;
        })}
      </ul>
    </section>
  );
}

function MoveResultRow({ result }: { result: MoveResult }) {
  const clampedMax = Math.min(100, result.maxPct);
  const barColor =
    result.maxPct >= 100
      ? "bg-primary"
      : result.maxPct >= 50
        ? "bg-accent"
        : "bg-muted-foreground/60";
  return (
    <li className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{result.moveName}</span>
        <span className="tabular-nums">
          {result.minPct.toFixed(1)}–{result.maxPct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-secondary">
        <div
          className={`h-full ${barColor}`}
          style={{ width: `${clampedMax}%` }}
        />
      </div>
      {result.koChance && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {result.koChance}
        </div>
      )}
    </li>
  );
}

// -------------------- Helpers --------------------

function speciesNameFor(entry: DraftEntry): string {
  // For mega entries, the mega form slug lives in altSlugs[0].
  if (entry.isMega && entry.altSlugs && entry.altSlugs[0]) {
    return slugToSpeciesName(entry.altSlugs[0]);
  }
  return slugToSpeciesName(entry.slug);
}

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