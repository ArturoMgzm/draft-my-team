// Champions ladder data for a single Pokémon, shown in a modal: top moves,
// held items, abilities, natures, SP spreads and teammates, straight from
// championsbattledata.com (see src/lib/champions-data.ts).
//
// The modal has two modes:
//   - Read-only (from a pool card): "what do people actually run on this?"
//   - Apply mode (from the damage calculator): every row is a button that
//     loads that value into the calc side it was opened from, plus a
//     one-click "Load meta set" for the whole top set.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchItem,
  fetchMoveInfo,
  fetchPokemon,
  itemNameToSlug,
  type PokemonData,
} from "@/lib/pokeapi";
import {
  BATTLE_FORMATS,
  fetchBattleData,
  isKnownNature,
  isMegaSlug,
  isMegaStone,
  matchAbilitySlug,
  matchItemName,
  matchMoveSlug,
  missingTopMoves,
  USAGE_RANK_NOTE,
  type BattleData,
  type BattleFormat,
  type SpreadRow,
  type UsageRow,
} from "@/lib/champions-data";
import type { SpAlloc } from "@/lib/calc-adapter";
import type { ItemGroup } from "@/lib/champions-items";
import { TypeBadge } from "@/components/draft/TypeBadge";

/** Fields this modal can push into a calc side. All optional. */
export type BattleDataPatch = {
  sp?: SpAlloc;
  nature?: string;
  item?: string;
  /** PokéAPI ability slug. */
  ability?: string;
  /** PokéAPI move slugs, in order, for the 4 move slots. */
  moves?: string[];
};

/** Present when the modal was opened from somewhere that can receive a set. */
export type ApplyContext = {
  /** Where values land, e.g. "Attacker" — shown on the buttons. */
  label: string;
  /** The regulation's legal held items, used to reject unselectable ones. */
  itemGroups: ItemGroup[];
  /** Current move slots, so a single move click fills the first empty one. */
  currentMoves: string[];
  /** False where the target has no move slots (the calc's defender side):
   *  moves then stay read-only instead of pretending to apply. */
  acceptsMoves?: boolean;
  onApply: (patch: BattleDataPatch) => void;
};

const STAT_COLUMNS: { key: keyof SpAlloc; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "ATK" },
  { key: "def", label: "DEF" },
  { key: "spa", label: "SPA" },
  { key: "spd", label: "SPD" },
  { key: "spe", label: "SPE" },
];

// Usage bars read as "core / common / niche" rather than good/bad — a 15%
// move isn't a mistake, it's a tech choice — so the ramp goes gold (core)
// to warm amber (common) to muted (niche) using existing theme tokens only.
function barColor(percent: number | null): string {
  if (percent === null) return "var(--muted-foreground)";
  if (percent >= 50) return "var(--accent)";
  if (percent >= 20) return "var(--chart-5)";
  return "var(--muted-foreground)";
}

function UsageBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:w-24">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(2, Math.min(100, percent))}%`,
            backgroundColor: barColor(percent),
          }}
        />
      </span>
      <span className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums">
        {percent.toFixed(1)}%
      </span>
    </span>
  );
}

function SectionCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ what }: { what: string }) {
  return <p className="py-2 text-[11px] text-muted-foreground">No {what} data.</p>;
}

/** One ranked row; a button when it can be applied, a plain row otherwise. */
function Row({
  onApply,
  applyTitle,
  children,
}: {
  onApply?: () => void;
  applyTitle?: string;
  children: React.ReactNode;
}) {
  const base = "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition";
  if (!onApply) return <div className={base}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onApply}
      title={applyTitle}
      className={`${base} hover:bg-secondary`}
    >
      {children}
    </button>
  );
}

function RankNum({ n }: { n: number }) {
  return (
    <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

// -------------------- Item icon --------------------

function ItemRowIcon({ name }: { name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchItem(itemNameToSlug(name)).then((item) => {
      if (alive) setSrc(item?.sprite ?? null);
    });
    return () => {
      alive = false;
    };
  }, [name]);
  // Reserve the slot either way so item names stay aligned while sprites load.
  if (!src) return <span className="h-4 w-4 shrink-0" aria-hidden />;
  return <img src={src} alt="" className="h-4 w-4 shrink-0 object-contain" />;
}

// -------------------- Move types --------------------

/** Resolves each listed move name to its type, for the type chips. */
function useMoveTypes(moves: UsageRow[], moveSlugs: string[]): Map<string, string> {
  const [types, setTypes] = useState<Map<string, string>>(() => new Map());
  const key = moves.map((m) => m.name).join("|") + "::" + moveSlugs.length;

  useEffect(() => {
    let alive = true;
    const pairs = moves
      .map((m) => [m.name, matchMoveSlug(m.name, moveSlugs)] as const)
      .filter((p): p is readonly [string, string] => p[1] !== null);
    if (pairs.length === 0) {
      setTypes(new Map());
      return;
    }
    void Promise.all(
      pairs.map(async ([name, slug]) => {
        const info = await fetchMoveInfo(slug);
        return [name, info?.type ?? ""] as const;
      }),
    ).then((res) => {
      if (!alive) return;
      setTypes(new Map(res.filter(([, t]) => t !== "")));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return types;
}

// -------------------- Modal --------------------

export function BattleDataModal({
  open,
  onClose,
  slug,
  name,
  defaultFormat = "Doubles",
  apply,
}: {
  open: boolean;
  onClose: () => void;
  /** Pool slug of the form being inspected (PokéAPI style). */
  slug: string;
  /** Display name for the header, e.g. "Mega Charizard Y". */
  name: string;
  defaultFormat?: BattleFormat;
  apply?: ApplyContext;
}) {
  const [format, setFormat] = useState<BattleFormat>(defaultFormat);
  const [data, setData] = useState<BattleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pokemon, setPokemon] = useState<PokemonData | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    if (open) setFormat(defaultFormat);
  }, [open, defaultFormat]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setData(null);
    void fetchBattleData(slug, format).then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, slug, format]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchPokemon(slug).then((d) => {
      if (alive) setPokemon(d);
    });
    return () => {
      alive = false;
    };
  }, [open, slug]);

  // Esc to close + scroll lock, matching how the calc sidebar behaves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Clear the "applied" confirmation whenever the context changes under it.
  useEffect(() => {
    setApplied(null);
  }, [open, slug, format]);

  // Stable identities: these feed a useMemo below, and a fresh [] on every
  // render would re-run it every time.
  const moveSlugs = useMemo(() => pokemon?.moves ?? [], [pokemon]);
  const abilitySlugs = useMemo(() => pokemon?.abilities ?? [], [pokemon]);
  const moveTypes = useMoveTypes(data?.moves ?? [], moveSlugs);

  const acceptsMoves = apply?.acceptsMoves !== false;
  const topSet = useMemo(
    () =>
      data
        ? buildTopSet(
            data,
            moveSlugs,
            abilitySlugs,
            apply?.itemGroups ?? [],
            acceptsMoves,
            isMegaSlug(slug),
          )
        : null,
    [data, moveSlugs, abilitySlugs, apply?.itemGroups, acceptsMoves, slug],
  );

  const missingMoves = data ? missingTopMoves(data) : 0;
  const otherFormat: BattleFormat = format === "Doubles" ? "Singles" : "Doubles";

  // The move-list truncation is per format, and the two rarely coincide: of
  // the 35 Pokémon truncated in Doubles, 33 have a complete Singles list
  // (only Manectric and Vivillon are short in both). So when this format is
  // short, check the other one — it usually has the full picture. This only
  // offers a switch; the lists are NOT interchangeable, since move usage
  // differs sharply by format (Garchomp's top Doubles move is Rock Slide at
  // 83%, its top Singles move is Earthquake at 99%).
  const [otherHasFullList, setOtherHasFullList] = useState(false);
  useEffect(() => {
    if (!open || missingMoves === 0) {
      setOtherHasFullList(false);
      return;
    }
    let alive = true;
    void fetchBattleData(slug, otherFormat).then((d) => {
      if (alive) setOtherHasFullList(d !== null && missingTopMoves(d) === 0);
    });
    return () => {
      alive = false;
    };
  }, [open, slug, otherFormat, missingMoves]);

  if (!open || typeof document === "undefined") return null;

  function push(patch: BattleDataPatch, what: string) {
    apply?.onApply(patch);
    setApplied(`${what} → ${apply?.label ?? ""}`);
  }

  function applyMove(moveName: string) {
    if (!apply) return;
    const slugMatch = matchMoveSlug(moveName, moveSlugs);
    if (!slugMatch) {
      setApplied(`${moveName} isn't in this form's movepool`);
      return;
    }
    const next = apply.currentMoves.slice(0, 4);
    while (next.length < 4) next.push("");
    if (next.includes(slugMatch)) {
      setApplied(`${moveName} is already set`);
      return;
    }
    const emptyAt = next.indexOf("");
    next[emptyAt === -1 ? 3 : emptyAt] = slugMatch;
    push({ moves: next }, moveName);
  }

  function applyItem(itemName: string) {
    if (!apply) return;
    if (isMegaStone(itemName)) {
      setApplied(`${itemName} is applied by picking the Mega form`);
      return;
    }
    const match = matchItemName(itemName, apply.itemGroups);
    if (!match) {
      setApplied(`${itemName} isn't in this regulation's item list`);
      return;
    }
    push({ item: match }, itemName);
  }

  function applyAbility(abilityName: string) {
    if (!apply) return;
    const match = matchAbilitySlug(abilityName, abilitySlugs);
    if (!match) {
      setApplied(`${abilityName} isn't available on this form`);
      return;
    }
    push({ ability: match }, abilityName);
  }

  function applyNature(natureName: string) {
    if (!apply) return;
    if (!isKnownNature(natureName)) {
      setApplied(`Unknown nature: ${natureName}`);
      return;
    }
    push({ nature: natureName }, natureName);
  }

  function applySpread(row: SpreadRow) {
    push({ sp: row.sp }, `${formatSpread(row.sp)} spread`);
  }

  function applyTopSet() {
    if (!apply || !topSet) return;
    apply.onApply(topSet);
    // Name what actually landed rather than a blanket "applied" — parts are
    // legitimately skipped (a Mega reading its base species' rows gets no
    // ability or item), and silently dropping them would be misleading.
    setApplied(`${describePatch(topSet, missingMoves)} → ${apply.label}`);
  }

  const megaFallback =
    isMegaSlug(slug) && data !== null && data.showdownId !== slug.replace(/-/g, "");

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} battle data`}
        className="fixed inset-x-2 top-[3vh] z-[61] mx-auto flex max-h-[94vh] w-auto max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-4"
      >
        {/* ---- Header ---- */}
        <header className="flex shrink-0 items-start gap-3 border-b border-border bg-card/70 p-3 sm:p-4">
          {pokemon?.sprite && (
            <img
              src={pokemon.sprite}
              alt=""
              className="hidden h-20 w-20 shrink-0 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] sm:block"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Champions ladder data
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-black tracking-tight sm:text-2xl">{name}</h2>
              {data?.usageRank && (
                <span
                  className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent"
                  title={USAGE_RANK_NOTE}
                >
                  #{data.usageRank} used
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {pokemon?.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>

            {data && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                <TopTile label="Top move" row={data.moves[0]} />
                <TopTile label="Top item" row={data.items[0]} />
                <TopTile label="Top ability" row={data.abilities[0]} />
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs hover:bg-secondary"
            >
              Close ✕
            </button>
            <div className="flex gap-1">
              {BATTLE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    format === f
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-accent"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {apply && topSet && (
              <button
                type="button"
                onClick={applyTopSet}
                className="rounded-md border border-accent bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent hover:brightness-110"
                title={`Load the most common spread, nature, item, ability and moves into ${apply.label}`}
              >
                ⬇ Load meta set
              </button>
            )}
          </div>
        </header>

        {apply && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 sm:px-4">
            <span className="text-[10px] text-muted-foreground">
              Click any row to send it to{" "}
              <span className="font-bold text-foreground">{apply.label}</span>.
            </span>
            {applied && <span className="text-[10px] font-semibold text-accent">{applied}</span>}
          </div>
        )}

        {/* ---- Body ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {loading && <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>}

          {!loading && !data && (
            <div className="py-8 text-center">
              <p className="text-sm font-semibold">
                No {format} data for {name}.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The Champions dataset covers a subset of the pool — try the other format, or check
                back once it appears upstream.
              </p>
            </div>
          )}

          {!loading && data && (
            <div className="space-y-3">
              {megaFallback && (
                <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
                  Megas have no separate entry upstream — these are{" "}
                  <span className="font-semibold text-foreground">{data.pokemon}</span>&apos;s rows,
                  covering both the base form and every Mega. The Mega Stone percentages under Held
                  items show how often each Mega is actually run.
                </p>
              )}

              {missingMoves > 0 && (
                <p className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Upstream is missing this Pokémon&apos;s top {missingMoves} move
                    {missingMoves === 1 ? "" : "s"}
                  </span>{" "}
                  — the move list below starts at #{missingMoves + 1}, so what you see are the{" "}
                  {data.moves.length} next-most-used moves, not the most-used ones. Every other
                  section is complete.
                  {otherHasFullList && (
                    <>
                      {" "}
                      {otherFormat} has the full list for this Pokémon — a different metagame, but
                      worth a look.{" "}
                      <button
                        type="button"
                        onClick={() => setFormat(otherFormat)}
                        className="font-semibold text-accent underline hover:brightness-110"
                      >
                        View {otherFormat} →
                      </button>
                    </>
                  )}
                </p>
              )}

              {/* Spreads first: the highest-value table here. */}
              <SectionCard
                title="Stat spreads"
                hint={apply ? "click to load into the calc" : "SP, out of 66"}
              >
                {data.spreads.length === 0 ? (
                  <EmptyRow what="spread" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] border-collapse text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="w-4 py-1 text-right font-semibold">#</th>
                          <th className="py-1 pl-2 text-left font-semibold">Usage</th>
                          {STAT_COLUMNS.map((c) => (
                            <th key={c.key} className="w-10 py-1 text-right font-semibold">
                              {c.label}
                            </th>
                          ))}
                          <th className="w-10 py-1 text-right font-semibold">Tot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.spreads.map((row) => (
                          <tr
                            key={row.rank}
                            onClick={apply ? () => applySpread(row) : undefined}
                            onKeyDown={
                              apply
                                ? (e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      applySpread(row);
                                    }
                                  }
                                : undefined
                            }
                            tabIndex={apply ? 0 : undefined}
                            role={apply ? "button" : undefined}
                            className={`border-t border-border/60 ${
                              apply
                                ? "cursor-pointer hover:bg-secondary focus:bg-secondary focus:outline-none"
                                : ""
                            }`}
                          >
                            <td className="py-1 text-right text-[10px] tabular-nums text-muted-foreground">
                              {row.rank}
                            </td>
                            <td className="py-1 pl-2">
                              <UsageBar percent={row.percent} />
                            </td>
                            {STAT_COLUMNS.map((c) => {
                              const v = row.sp[c.key];
                              return (
                                <td
                                  key={c.key}
                                  className={`py-1 text-right tabular-nums ${
                                    v === 0
                                      ? "text-muted-foreground/40"
                                      : v >= 32
                                        ? "font-bold text-accent"
                                        : "font-semibold"
                                  }`}
                                >
                                  {v}
                                </td>
                              );
                            })}
                            <td className="py-1 text-right text-[11px] tabular-nums text-muted-foreground">
                              {row.total}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              <div className="grid gap-3 lg:grid-cols-2">
                <SectionCard
                  title="Moves"
                  hint={missingMoves > 0 ? `top ${missingMoves} missing upstream` : undefined}
                >
                  {data.moves.length === 0 ? (
                    <EmptyRow what="move" />
                  ) : (
                    <div className="space-y-0.5">
                      {data.moves.map((m) => {
                        const type = moveTypes.get(m.name);
                        return (
                          <Row
                            key={`${m.rank}-${m.name}`}
                            onApply={apply && acceptsMoves ? () => applyMove(m.name) : undefined}
                            applyTitle={
                              apply && acceptsMoves ? `Add ${m.name} to ${apply.label}` : undefined
                            }
                          >
                            <RankNum n={m.rank} />
                            <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                            {type && <TypeBadge type={type} />}
                            <UsageBar percent={m.percent} />
                          </Row>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Held items">
                  {data.items.length === 0 ? (
                    <EmptyRow what="item" />
                  ) : (
                    <div className="space-y-0.5">
                      {data.items.map((it) => (
                        <Row
                          key={`${it.rank}-${it.name}`}
                          onApply={apply ? () => applyItem(it.name) : undefined}
                          applyTitle={apply ? `Set ${it.name} on ${apply.label}` : undefined}
                        >
                          <RankNum n={it.rank} />
                          <ItemRowIcon name={it.name} />
                          <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                          <UsageBar percent={it.percent} />
                        </Row>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Natures" hint="Champions calls this Stat Alignment">
                  {data.natures.length === 0 ? (
                    <EmptyRow what="nature" />
                  ) : (
                    <div className="space-y-0.5">
                      {data.natures.map((n) => (
                        <Row
                          key={`${n.rank}-${n.name}`}
                          onApply={apply ? () => applyNature(n.name) : undefined}
                          applyTitle={apply ? `Set ${n.name} on ${apply.label}` : undefined}
                        >
                          <RankNum n={n.rank} />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-medium">{n.name}</span>
                            {n.up && (
                              <span className="ml-1.5 text-[10px] font-bold text-accent">
                                +{shortStat(n.up)}
                              </span>
                            )}
                            {n.down && (
                              <span className="ml-1 text-[10px] font-bold text-primary">
                                −{shortStat(n.down)}
                              </span>
                            )}
                          </span>
                          <UsageBar percent={n.percent} />
                        </Row>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Abilities">
                  {data.abilities.length === 0 ? (
                    <EmptyRow what="ability" />
                  ) : (
                    <div className="space-y-0.5">
                      {data.abilities.map((a) => (
                        <Row
                          key={`${a.rank}-${a.name}`}
                          onApply={apply ? () => applyAbility(a.name) : undefined}
                          applyTitle={apply ? `Set ${a.name} on ${apply.label}` : undefined}
                        >
                          <RankNum n={a.rank} />
                          <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                          <UsageBar percent={a.percent} />
                        </Row>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {data.teammates.length > 0 && (
                <SectionCard title="Common teammates" hint="in usage order">
                  <div className="flex flex-wrap gap-1.5">
                    {data.teammates.map((t) => (
                      <span
                        key={`${t.rank}-${t.name}`}
                        className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px]"
                      >
                        <span className="mr-1 text-[9px] tabular-nums text-muted-foreground">
                          {t.rank}
                        </span>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </SectionCard>
              )}

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Source:{" "}
                <a
                  href={`https://championsbattledata.com/pokemon/${data.showdownId}/`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-accent"
                >
                  championsbattledata.com
                </a>{" "}
                · {data.format} · season {data.season}
                {data.date ? ` · ${data.date.replace(/_/g, "/")}` : ""}
                {data.usageRank ? ` · usage rank ${USAGE_RANK_NOTE.toLowerCase()}` : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function TopTile({ label, row }: { label: string; row: UsageRow | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-2 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="truncate text-[11px] font-semibold">
        {row ? (
          <>
            {row.name}
            {row.percent !== null && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({row.percent.toFixed(1)}%)
              </span>
            )}
          </>
        ) : (
          "—"
        )}
      </p>
    </div>
  );
}

/** "Sp. Def" -> "SPD", for the compact nature chips. */
function shortStat(label: string): string {
  const key = label.toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, string> = {
    hp: "HP",
    attack: "ATK",
    defense: "DEF",
    spatk: "SPA",
    spattack: "SPA",
    specialattack: "SPA",
    spdef: "SPD",
    spdefense: "SPD",
    specialdefense: "SPD",
    speed: "SPE",
  };
  return map[key] ?? label.toUpperCase();
}

function formatSpread(sp: SpAlloc): string {
  return [sp.hp, sp.atk, sp.def, sp.spa, sp.spd, sp.spe].join("/");
}

/**
 * The one-click "meta set": most common spread, nature, ability and item,
 * plus the top 4 moves — each included only when it resolves to something
 * the calc's own pickers can actually hold.
 */
/** Human-readable list of the parts a patch actually carries. */
function describePatch(patch: BattleDataPatch, missingMoves: number): string {
  const parts: string[] = [];
  if (patch.sp) parts.push("spread");
  if (patch.nature) parts.push("nature");
  if (patch.ability) parts.push("ability");
  if (patch.item) parts.push("item");
  const moveCount = patch.moves?.filter(Boolean).length ?? 0;
  if (moveCount > 0) {
    // Say it here too: the banner explains the gap, but this is the moment
    // someone is actually acting on moves that aren't the real top ones.
    const caveat = missingMoves > 0 ? ` (not the top ${missingMoves} — missing upstream)` : "";
    parts.push(`${moveCount} move${moveCount === 1 ? "" : "s"}${caveat}`);
  }
  return parts.length > 0 ? parts.join(", ") : "nothing applicable";
}

/** Below this share, no held item is common enough to call it the meta one. */
const MIN_CONSENSUS_ITEM_PERCENT = 5;

function buildTopSet(
  data: BattleData,
  moveSlugs: string[],
  abilitySlugs: string[],
  itemGroups: ItemGroup[],
  includeMoves: boolean,
  isMega: boolean,
): BattleDataPatch {
  const patch: BattleDataPatch = {};

  if (data.spreads[0]) patch.sp = data.spreads[0].sp;
  if (data.natures[0] && isKnownNature(data.natures[0].name)) patch.nature = data.natures[0].name;

  if (data.abilities[0]) {
    const ability = matchAbilitySlug(data.abilities[0].name, abilitySlugs);
    if (ability) patch.ability = ability;
  }

  // A Mega's held item is its stone, which is applied implicitly by choosing
  // the Mega form, so a Mega target never gets one. For a base form, the
  // stone rows are skipped and the top real held item is used — but only if
  // a meaningful share of sets actually runs it. Below that, there is no
  // consensus item and picking the top of the tail would fabricate one
  // (93.5% of Charizard hold Charizardite Y; the best non-stone item under
  // it is Choice Scarf at 0.2%).
  if (!isMega) {
    const topItem = data.items.find((i) => !isMegaStone(i.name));
    if (topItem && (topItem.percent ?? 0) >= MIN_CONSENSUS_ITEM_PERCENT) {
      const item = matchItemName(topItem.name, itemGroups);
      if (item) patch.item = item;
    }
  }

  if (includeMoves) {
    const moves: string[] = [];
    for (const m of data.moves) {
      if (moves.length === 4) break;
      const slug = matchMoveSlug(m.name, moveSlugs);
      if (slug && !moves.includes(slug)) moves.push(slug);
    }
    if (moves.length > 0) {
      while (moves.length < 4) moves.push("");
      patch.moves = moves;
    }
  }

  return patch;
}
