import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getFormOptions, type DraftEntry } from "@/lib/draft-engine";
import {
  fetchItem,
  fetchPokemon,
  itemNameToSlug,
  type ItemData,
  type PokemonData,
} from "@/lib/pokeapi";
import {
  computeStatAtL50,
  DEFAULT_FIELD,
  NATURES,
  natureMultiplier,
  runCalc,
  slugToSpeciesName,
  slugToMoveName,
  SP_MAX_PER_STAT,
  SP_MAX_TOTAL,
  STATUSES,
  TERRAINS,
  WEATHERS,
  ZERO_SP,
  type FieldConfig,
  type MoveResult,
  type SideConfig,
  type SpAlloc,
} from "@/lib/calc-adapter";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CHAMPIONS_ITEMS } from "@/lib/champions-items";

type SideKey = "atk" | "def";

type SideDraft = {
  entryId: string | null;
  /** Index into getFormOptions(entry) — which base/mega/alt form is active. */
  formIdx: number;
  ability: string;
  item: string;
  nature: string;
  status: SideConfig["status"];
  sp: SpAlloc;
  moves: string[]; // 4 slots, slug or ""
};

const EMPTY_SIDE: SideDraft = {
  entryId: null,
  formIdx: 0,
  ability: "",
  item: "",
  nature: "Hardy",
  status: "",
  sp: { ...ZERO_SP },
  moves: ["", "", "", ""],
};

// One distinct color per stat, pulled entirely from the existing design
// tokens (chart-1..5, primary, accent) — no new colors introduced. Used to
// tint each SP slider's fill so HP/Atk/Def/SpA/SpD/Spe are visually
// distinguishable at a glance.
const STAT_COLORS: Record<keyof SpAlloc, { var: string; text: string }> = {
  hp: { var: "var(--chart-1)", text: "text-chart-1" },
  atk: { var: "var(--primary)", text: "text-primary" },
  def: { var: "var(--accent)", text: "text-accent" },
  spa: { var: "var(--chart-2)", text: "text-chart-2" },
  spd: { var: "var(--chart-3)", text: "text-chart-3" },
  spe: { var: "var(--chart-5)", text: "text-chart-5" },
};

// Attacker/Defender each get a distinct accent pulled from the existing
// design tokens (poké-red primary, chart-2 teal) so the two sides read as
// visually distinct at a glance without introducing any new colors.
type SideAccentStyle = { border: string; bg: string; text: string; ring: string; dot: string };

const SIDE_ACCENT: Record<SideKey, SideAccentStyle> = {
  atk: {
    border: "border-primary/50",
    bg: "bg-primary/10",
    text: "text-primary",
    ring: "focus-within:ring-primary/30",
    dot: "bg-primary",
  },
  def: {
    border: "border-chart-2/50",
    bg: "bg-chart-2/10",
    text: "text-chart-2",
    ring: "focus-within:ring-chart-2/30",
    dot: "bg-chart-2",
  },
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
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-[520px] transform overflow-y-auto border-l border-border bg-background shadow-2xl transition-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div>
            <h2 className="text-sm font-bold tracking-tight">Damage Calculator</h2>
            <p className="text-[10px] text-muted-foreground">
              Champions Reg M-B · Level 50 · Doubles · No Tera (not yet playable)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAtk(def);
                setDef(atk);
              }}
              className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:border-accent hover:text-accent"
              title="Swap attacker and defender"
            >
              <span aria-hidden>⇄</span> Swap
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
          <SideCard title="Attacker" side="atk" pool={pool} state={atk} setState={setAtk} />
          <SideCard title="Defender" side="def" pool={pool} state={def} setState={setDef} />
          <FieldPanel field={field} setField={setField} />
          <Results attacker={atk} defender={def} field={field} pool={pool} />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Stats use Champions SP (1 SP = +1 to that stat, verified against @smogon/calc). Item and
            ability effects, weather, terrain, screens, spread reduction, and crits are evaluated by
            Smogon's calc engine.
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
  const accent = SIDE_ACCENT[side];
  const entry = pool.find((e) => e.id === state.entryId) ?? null;
  const formOptions = useMemo(() => (entry ? getFormOptions(entry) : []), [entry]);
  const activeForm = formOptions[Math.min(state.formIdx, formOptions.length - 1)] ?? null;
  const data = usePokemonData(activeForm?.slug);

  // Reset dependent fields whenever the selected Pokémon changes.
  useEffect(() => {
    setState((s) => ({
      ...s,
      formIdx: 0,
      ability: "",
      nature: "Hardy",
      moves: ["", "", "", ""],
      sp: { ...ZERO_SP },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.entryId]);

  // Ability and movepool are form-specific — Mega Evolution changes the
  // ability, and regional/alt forms can learn a different moveset — so
  // reset those when the viewed form changes. SP and held item persist
  // across a form switch (a Mega Evolution keeps the trained Pokémon's
  // stat investment; the held item doesn't change just because you're
  // previewing a different form).
  useEffect(() => {
    setState((s) => ({ ...s, ability: "", moves: ["", "", "", ""] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.formIdx]);

  const spTotal =
    state.sp.hp + state.sp.atk + state.sp.def + state.sp.spa + state.sp.spd + state.sp.spe;
  const spBudgetLeft = SP_MAX_TOTAL - spTotal;

  return (
    <section
      className={`rounded-xl border ${accent.border} bg-card/60 p-3 transition ${accent.ring} focus-within:ring-2`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} aria-hidden />
          <span className={`text-[11px] font-bold uppercase tracking-wider ${accent.text}`}>
            {title}
          </span>
        </div>
        {data && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {data.types.map((t) => (
              <span key={t} className="rounded bg-secondary px-1.5 py-0.5 capitalize">
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
            className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <select
            value={state.entryId ?? ""}
            onChange={(e) => setState((s) => ({ ...s, entryId: e.target.value || null }))}
            className="w-full min-w-0 rounded-md border border-border bg-input px-2 py-1.5 text-sm"
          >
            <option value="">— Select Pokémon —</option>
            {pool.map((p) => {
              const opts = getFormOptions(p);
              return (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {opts.length > 1 ? ` (${opts.length} forms)` : ""}
                </option>
              );
            })}
          </select>

          {/* Form / Mega toggle — the whole point of this section: every
              base form, alt regional form, and Mega variant that's actually
              in the drafted pool for this entry is individually selectable
              here, not just whichever form the draft happened to land on. */}
          {entry && formOptions.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {formOptions.map((f, i) => {
                const isActive = i === state.formIdx;
                return (
                  <button
                    key={f.slug}
                    type="button"
                    onClick={() => setState((s) => ({ ...s, formIdx: i }))}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                      isActive
                        ? `${accent.border} ${accent.bg} ${accent.text}`
                        : "border-border bg-background/40 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                    }`}
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
          <ItemPicker value={state.item} onChange={(v) => setState((s) => ({ ...s, item: v }))} />
          <LabeledSelect
            label="Nature"
            value={state.nature}
            onChange={(v) => setState((s) => ({ ...s, nature: v }))}
            options={NATURES.map((n) => n.name)}
            format={(v) => {
              const n = NATURES.find((x) => x.name === v);
              if (!n || !n.plus) return `${v} (neutral)`;
              return `${v} (+${n.plus.toUpperCase()}/-${n.minus?.toUpperCase()})`;
            }}
          />
          <LabeledSelect
            label="Status"
            value={state.status ?? ""}
            onChange={(v) => setState((s) => ({ ...s, status: v as SideConfig["status"] }))}
            options={STATUSES.map((s) => s.value ?? "")}
            format={(v) => STATUSES.find((s) => (s.value ?? "") === v)?.label ?? "None"}
          />
        </div>
      )}

      {entry && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Stat Points</span>
            <span className={spTotal === SP_MAX_TOTAL ? `font-bold ${accent.text}` : ""}>
              {spTotal} / {SP_MAX_TOTAL}
            </span>
          </div>
          <div className="space-y-1.5">
            {(
              [
                ["HP", "hp"],
                ["Atk", "atk"],
                ["Def", "def"],
                ["SpA", "spa"],
                ["SpD", "spd"],
                ["Spe", "spe"],
              ] as const
            ).map(([label, key]) => {
              const base = data ? statBaseFor(data, key) : null;
              const mult = key === "hp" ? 1 : natureMultiplier(state.nature, key);
              const final =
                base !== null ? computeStatAtL50(base, state.sp[key], key === "hp", mult) : null;
              const value = state.sp[key];
              // Each slider's own max shrinks as the other five stats eat
              // into the shared 66-point budget, so it's mechanically
              // impossible to drag past what's actually available — the
              // fill simply stops advancing once the budget runs out,
              // rather than allowing an "over budget" state to happen at all.
              const maxForThisStat = Math.min(SP_MAX_PER_STAT, value + spBudgetLeft);
              const fillPct = (value / SP_MAX_PER_STAT) * 100;
              const color = STAT_COLORS[key];
              const isBoosted = mult > 1;
              const isReduced = mult < 1;
              const setValue = (next: number) =>
                setState((s) => ({
                  ...s,
                  sp: { ...s.sp, [key]: Math.max(0, Math.min(maxForThisStat, next)) },
                }));
              return (
                <div key={key} className="rounded-md border border-border bg-background/40 p-2">
                  <div className="mb-1 flex items-baseline justify-between text-[11px]">
                    <span className="font-semibold">
                      {label}
                      {isBoosted && (
                        <span className={`ml-0.5 ${color.text}`} title="Boosted by nature">
                          +
                        </span>
                      )}
                      {isReduced && (
                        <span className="ml-0.5 text-muted-foreground" title="Reduced by nature">
                          −
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {base !== null ? (
                        <>
                          {base} <span aria-hidden>→</span>{" "}
                          <span className={value > 0 ? color.text : ""}>{final}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  {/* Full-width slider for quick bulk changes, flanked by
                      +/- steppers for exact 1-point adjustments — dragging
                      to hit a precise value out of 32 possible steps on a
                      narrow track is genuinely hard, so the steppers (and
                      the number between them) are the precise-entry path,
                      while the slider stays for fast rough positioning. */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setValue(value - 1)}
                      disabled={value <= 0}
                      className="stat-step-btn"
                      aria-label={`Decrease ${label}`}
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={maxForThisStat}
                      value={value}
                      onChange={(e) => setValue(Number(e.target.value))}
                      className="stat-range flex-1"
                      style={
                        {
                          background: `linear-gradient(to right, ${color.var} 0%, ${color.var} ${fillPct}%, var(--input) ${fillPct}%, var(--input) 100%)`,
                          "--thumb-color": color.var,
                        } as CSSProperties
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setValue(value + 1)}
                      disabled={value >= maxForThisStat}
                      className="stat-step-btn"
                      aria-label={`Increase ${label}`}
                    >
                      +
                    </button>
                    <span
                      className={`w-7 shrink-0 text-right text-xs font-bold tabular-nums ${value > 0 ? color.text : "text-muted-foreground"}`}
                    >
                      {value}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
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
    case "hp":
      return data.stats.hp;
    case "atk":
      return data.stats.attack;
    case "def":
      return data.stats.defense;
    case "spa":
      return data.stats.specialAttack;
    case "spd":
      return data.stats.specialDefense;
    case "spe":
      return data.stats.speed;
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
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  groups?: { label: string; items: string[] }[];
  format?: (v: string) => string;
  /** Small preview (e.g. an item's PokéAPI sprite) shown next to the label. */
  icon?: ReactNode;
}) {
  const fmt = format ?? ((v: string) => v);
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-input px-2 py-1 text-[11px]"
      >
        {!groups &&
          options.map((o) => (
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

// Small icon preview for the currently selected held item, pulled from
// PokéAPI's item endpoint (sprite + name only — no effect text needed here).
function ItemIcon({ name }: { name: string }) {
  const item = useItemSprite(name);
  if (!name || !item?.sprite) return null;
  return <img src={item.sprite} alt="" className="h-3.5 w-3.5 object-contain" />;
}

function useItemSprite(name: string): ItemData | null {
  const [data, setData] = useState<ItemData | null>(null);
  useEffect(() => {
    if (!name) {
      setData(null);
      return;
    }
    let alive = true;
    void fetchItem(itemNameToSlug(name)).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [name]);
  return data;
}

// A native <select> can't render images inside its own <option> elements in
// any browser, so the item picker uses the Radix-based Select component
// instead — it renders each option as real DOM, which lets every item show
// its PokéAPI sprite right in the dropdown list, not just in a preview
// above the trigger.
const NONE_ITEM = "__none__";

function ItemPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <ItemIcon name={value} />
        Item
      </span>
      <Select value={value || NONE_ITEM} onValueChange={(v) => onChange(v === NONE_ITEM ? "" : v)}>
        <SelectTrigger className="h-auto rounded-md border border-border bg-input px-2 py-1 text-[11px] shadow-none">
          <SelectValue placeholder="None" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={NONE_ITEM} className="text-[11px]">
            None
          </SelectItem>
          {CHAMPIONS_ITEMS.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {g.label}
              </SelectLabel>
              {g.items.map((it) => (
                <ItemSelectOption key={it} name={it} />
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ItemSelectOption({ name }: { name: string }) {
  const item = useItemSprite(name);
  return (
    <SelectItem value={name} textValue={name} className="text-[11px]">
      <span className="flex items-center gap-1.5">
        {item?.sprite ? (
          <img src={item.sprite} alt="" className="h-4 w-4 shrink-0 object-contain" />
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        {name}
      </span>
    </SelectItem>
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
          onChange={(v) => setField((f) => ({ ...f, gameType: v as "Singles" | "Doubles" }))}
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
        <div
          className={`space-y-1 rounded-md border ${SIDE_ACCENT.atk.border} bg-background/40 p-2`}
        >
          <div
            className={`text-[10px] font-semibold uppercase tracking-wider ${SIDE_ACCENT.atk.text}`}
          >
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
            onChange={(v) => setField((f) => ({ ...f, atk: { ...f.atk, isHelpingHand: v } }))}
          />
        </div>
        <div
          className={`space-y-1 rounded-md border ${SIDE_ACCENT.def.border} bg-background/40 p-2`}
        >
          <div
            className={`text-[10px] font-semibold uppercase tracking-wider ${SIDE_ACCENT.def.text}`}
          >
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
            onChange={(v) => setField((f) => ({ ...f, def: { ...f.def, isLightScreen: v } }))}
          />
          <Checkbox
            label="Aurora Veil"
            checked={!!field.def.isAuroraVeil}
            onChange={(v) => setField((f) => ({ ...f, def: { ...f.def, isAuroraVeil: v } }))}
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
  const aEntry = pool.find((e) => e.id === attacker.entryId) ?? null;
  const dEntry = pool.find((e) => e.id === defender.entryId) ?? null;
  const aFormName = aEntry ? formNameFor(aEntry, attacker.formIdx) : null;
  const dFormName = dEntry ? formNameFor(dEntry, defender.formIdx) : null;

  const results = useMemo<(MoveResult | null)[]>(() => {
    if (!aEntry || !dEntry) return [];
    const aName = speciesNameFor(aEntry, attacker.formIdx);
    const dName = speciesNameFor(dEntry, defender.formIdx);
    const aCfg: SideConfig = {
      speciesName: aName,
      ability: attacker.ability || undefined,
      item: attacker.item || undefined,
      nature: attacker.nature,
      sp: attacker.sp,
      status: attacker.status,
    };
    const dCfg: SideConfig = {
      speciesName: dName,
      ability: defender.ability || undefined,
      item: defender.item || undefined,
      nature: defender.nature,
      sp: defender.sp,
      status: defender.status,
    };
    return attacker.moves.map((mv) => (mv ? runCalc(aCfg, dCfg, mv, field) : null));
  }, [attacker, defender, field, aEntry, dEntry]);

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
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Results
        </span>
        {aFormName && dFormName && (
          <span className="truncate pl-2 text-[10px] text-muted-foreground">
            <span className={SIDE_ACCENT.atk.text}>{aFormName}</span>
            {" → "}
            <span className={SIDE_ACCENT.def.text}>{dFormName}</span>
          </span>
        )}
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
  if (result.immune) {
    return (
      <li className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-[11px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{result.moveName}</span>
          <span className="tabular-nums text-muted-foreground">0.0%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-secondary" />
        <div className="mt-1 text-[10px] text-muted-foreground">No effect — immune</div>
      </li>
    );
  }
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
        <div className={`h-full ${barColor}`} style={{ width: `${clampedMax}%` }} />
      </div>
      {result.koChance && (
        <div className="mt-1 text-[10px] text-muted-foreground">{result.koChance}</div>
      )}
    </li>
  );
}

// -------------------- Helpers --------------------

// Resolves the exact species name @smogon/calc expects for whichever form
// (base / alt-form / specific Mega variant) is currently selected on this
// side — not just whatever form the entry happened to default to.
function speciesNameFor(entry: DraftEntry, formIdx: number): string {
  const options = getFormOptions(entry);
  const active = options[Math.min(formIdx, options.length - 1)] ?? options[0];
  return slugToSpeciesName(active.slug);
}

function formNameFor(entry: DraftEntry, formIdx: number): string {
  const options = getFormOptions(entry);
  return options[Math.min(formIdx, options.length - 1)]?.name ?? entry.name;
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
