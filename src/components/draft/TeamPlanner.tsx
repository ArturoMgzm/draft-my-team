import { useEffect, useState } from "react";
import { fetchMoveInfo, fetchPokemon, type MoveInfo, type PokemonData } from "@/lib/pokeapi";
import { getFormSlugs, type DraftEntry } from "@/lib/draft-engine";
import { slugToMoveName } from "@/lib/calc-adapter";
import {
  defenseMatchup,
  effectivenessLabel,
  prettyAbilityName,
  teamCoverageSummary,
  type AbilityAdjustment,
} from "@/lib/type-chart";
import { TypeBadge } from "./PoolCard";
import type { ResultsPlayer } from "./ResultsGrid";

type MonInfo = { entry: DraftEntry; data: PokemonData | null };

function activeSlugFor(entry: DraftEntry, formIndex: Map<string, number>): string {
  const forms = getFormSlugs(entry);
  const idx = formIndex.get(entry.id) ?? 0;
  return forms[Math.min(idx, forms.length - 1)] ?? entry.slug;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Fetches PokemonData for whichever form of each entry is currently active
// per the shared formIndex map, so toggling a card's Mega badge updates the
// analysis even while the planner is open.
function useTeamInfo(team: DraftEntry[], formIndex: Map<string, number>): MonInfo[] {
  const [dataMap, setDataMap] = useState<Map<string, PokemonData | null>>(() => new Map());
  const slugs = team.map((e) => activeSlugFor(e, formIndex));
  const slugsKey = slugs.join(",");

  useEffect(() => {
    let alive = true;
    const uniqueSlugs = Array.from(new Set(slugs));
    Promise.all(uniqueSlugs.map(async (s) => [s, await fetchPokemon(s)] as const)).then((pairs) => {
      if (!alive) return;
      setDataMap(new Map(pairs));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey]);

  return team.map((entry, i) => ({ entry, data: dataMap.get(slugs[i]) ?? null }));
}

// Fetches type + damage-class info for every currently-filled move slug
// across the given entries, deduped. Moves are shared across many species,
// so this caches well over the course of a session.
function useMoveInfos(moveSlots: Map<string, string[]>, entries: DraftEntry[]) {
  const [infoMap, setInfoMap] = useState<Map<string, MoveInfo | null>>(() => new Map());
  const allSlugs = Array.from(
    new Set(entries.flatMap((e) => (moveSlots.get(e.id) ?? []).filter(Boolean))),
  );
  const key = allSlugs.slice().sort().join(",");

  useEffect(() => {
    let alive = true;
    Promise.all(allSlugs.map(async (s) => [s, await fetchMoveInfo(s)] as const)).then((pairs) => {
      if (!alive) return;
      setInfoMap(new Map(pairs));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return infoMap;
}

// The attacking types actually used in the checks for one Pokémon: the
// types of whichever move slots are filled in with a *damaging* move
// (status moves like Swords Dance or Toxic don't attack, so they're
// excluded even though PokéAPI still reports a type for them), plus — only
// if at least one slot is still empty — its own type(s) as a generic
// stand-in, so the planner stays useful before you've filled in real
// coverage moves. Once all 4 slots are set, only the chosen damaging
// moves' types count.
function attackTypesFor(
  info: MonInfo,
  moveSlots: Map<string, string[]>,
  moveInfos: Map<string, MoveInfo | null>,
): string[] {
  const slots = moveSlots.get(info.entry.id) ?? ["", "", "", ""];
  const filled = slots.filter(Boolean);
  const filledTypes = filled
    .map((slug) => moveInfos.get(slug))
    .filter((m): m is MoveInfo => !!m && m.isDamaging)
    .map((m) => m.type);
  const anyEmpty = slots.some((s) => !s);
  const ownTypes = info.data?.types ?? [];
  const combined = anyEmpty ? [...filledTypes, ...ownTypes] : filledTypes;
  return Array.from(new Set(combined));
}

type TypeResult = { type: string; base: number; adjustments: AbilityAdjustment[] };
type Matchup = { multiplier: number; perType: TypeResult[]; loading: boolean };

// The attacker's available attack types (damaging moves + STAB fallback)
// vs the defender's typing/abilities, taking the highest multiplier across
// those attack types — "worst case for the defender" and "best case for
// the attacker" are the same value, just opposite framing.
function typeMatchup(
  attacker: MonInfo,
  defender: MonInfo,
  moveSlots: Map<string, string[]>,
  moveInfos: Map<string, MoveInfo | null>,
): Matchup {
  if (!attacker.data || !defender.data) return { multiplier: 1, perType: [], loading: true };
  const attackTypes = attackTypesFor(attacker, moveSlots, moveInfos);
  if (attackTypes.length === 0) return { multiplier: 1, perType: [], loading: false };
  const perType = attackTypes.map((t) => {
    const { base, adjustments } = defenseMatchup(t, defender.data!.types, defender.data!.abilities);
    return { type: t, base, adjustments };
  });
  const multiplier = Math.max(...perType.map((r) => r.base));
  return { multiplier, perType, loading: false };
}

function matchupTooltip(m: Matchup): string {
  if (m.loading) return "Loading…";
  if (m.perType.length === 0) return "No damaging moves or types to check yet";
  return m.perType
    .map((r) => {
      const abilityPart = r.adjustments.length
        ? ` (${r.adjustments
            .map((a) => `${effectivenessLabel(a.multiplier)} w/ ${prettyAbilityName(a.ability)}`)
            .join(", ")})`
        : "";
      return `${titleCase(r.type)}: ${effectivenessLabel(r.base)}${abilityPart}`;
    })
    .join(" · ");
}

function cellColorClass(mult: number): string {
  // "good" always means good for the attacker here (super effective);
  // callers relabel the axes, but the color always reads offense-first.
  const goodness = Math.log2(Math.max(mult, 0.0001));
  if (mult === 0) return "bg-primary text-white";
  if (goodness >= 2) return "bg-chart-2 text-white";
  if (goodness >= 1) return "bg-chart-2/50";
  if (goodness <= -2) return "bg-primary text-white";
  if (goodness <= -1) return "bg-primary/50";
  return "bg-muted";
}

function cellLabel(mult: number): string {
  if (mult === 0) return "0";
  if (mult === 0.25) return "¼";
  if (mult === 0.5) return "½";
  if (mult === 1) return "1";
  if (mult === 2) return "2";
  if (mult === 4) return "4";
  return String(mult);
}

function MonHeaderCell({ info }: { info: MonInfo }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={info.entry.name}>
      {info.data?.sprite ? (
        <img src={info.data.sprite} alt="" className="h-8 w-8 object-contain" />
      ) : (
        <div className="h-8 w-8" />
      )}
      <span className="max-w-[52px] truncate text-center text-[9px] text-muted-foreground">
        {info.entry.name}
      </span>
    </div>
  );
}

// ---- Move-slot cards for the viewed team ---------------------------------

function PlannerMonCard({
  info,
  moveSlots,
  setMoveSlot,
}: {
  info: MonInfo;
  moveSlots: Map<string, string[]>;
  setMoveSlot: (entryId: string, slotIdx: number, moveSlug: string) => void;
}) {
  const slots = moveSlots.get(info.entry.id) ?? ["", "", "", ""];
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2">
      <div className="flex items-center gap-2">
        {info.data?.sprite && (
          <img src={info.data.sprite} alt="" className="h-12 w-12 shrink-0 object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold">{info.entry.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {info.data?.types.map((t) => <TypeBadge key={t} type={t} />) ?? (
              <span className="text-[10px] text-muted-foreground">Loading…</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        {slots.map((mv, i) => (
          <select
            key={i}
            value={mv}
            onChange={(e) => setMoveSlot(info.entry.id, i, e.target.value)}
            className="rounded-md border border-border bg-input px-1.5 py-1 text-[10px]"
          >
            <option value="">— empty —</option>
            {(info.data?.moves ?? []).map((mSlug) => (
              <option key={mSlug} value={mSlug}>
                {slugToMoveName(mSlug)}
              </option>
            ))}
          </select>
        ))}
      </div>
    </div>
  );
}

// ---- Matchup grid ---------------------------------------------------------
//
// Attacking/defending labels sit directly against their axis — a rotated
// label to the left of the rows, a horizontal label above the columns —
// rather than a floating legend disconnected from either axis. The grid
// itself is sized to a fixed, readable cell size (not stretched to the
// panel's full width, which for only 6 columns would make each cell
// enormous) and centered by its caller.

function MatchupGrid({
  attackers,
  defenders,
  attackerLabel,
  defenderLabel,
  moveSlots,
  moveInfos,
}: {
  attackers: MonInfo[];
  defenders: MonInfo[];
  attackerLabel: string;
  defenderLabel: string;
  moveSlots: Map<string, string[]>;
  moveInfos: Map<string, MoveInfo | null>;
}) {
  return (
    <div className="flex items-stretch justify-center gap-2 overflow-x-auto">
      <div className="flex shrink-0 items-center justify-center">
        <span
          className="whitespace-nowrap text-[10px] font-bold text-primary"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          ⚔ Attacking: {attackerLabel}
        </span>
      </div>
      <div className="shrink-0">
        <div className="mb-1 text-center text-[10px] font-bold text-chart-2">
          🛡 Defending: {defenderLabel}
        </div>
        <div
          className="inline-grid gap-1"
          style={{ gridTemplateColumns: `64px repeat(${defenders.length}, 52px)` }}
        >
          <div />
          {defenders.map((d) => (
            <MonHeaderCell key={d.entry.id} info={d} />
          ))}
          {attackers.map((a) => (
            <FragmentRow
              key={a.entry.id}
              attacker={a}
              defenders={defenders}
              moveSlots={moveSlots}
              moveInfos={moveInfos}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({
  attacker,
  defenders,
  moveSlots,
  moveInfos,
}: {
  attacker: MonInfo;
  defenders: MonInfo[];
  moveSlots: Map<string, string[]>;
  moveInfos: Map<string, MoveInfo | null>;
}) {
  return (
    <>
      <div className="flex items-center">
        <MonHeaderCell info={attacker} />
      </div>
      {defenders.map((d) => {
        const m = typeMatchup(attacker, d, moveSlots, moveInfos);
        return (
          <div
            key={d.entry.id}
            title={`${attacker.entry.name} → ${d.entry.name}\n${matchupTooltip(m)}`}
            className={`flex aspect-square items-center justify-center rounded text-xs font-bold tabular-nums ${
              m.loading ? "bg-muted/40 text-muted-foreground" : cellColorClass(m.multiplier)
            }`}
          >
            {m.loading ? "…" : cellLabel(m.multiplier)}
          </div>
        );
      })}
    </>
  );
}

// ---- Coverage summary (viewing your own team) -----------------------------

const COVERAGE_TIERS: { key: keyof ReturnType<typeof teamCoverageSummary>; mult: number }[] = [
  { key: "x4", mult: 4 },
  { key: "x2", mult: 2 },
  { key: "x1", mult: 1 },
  { key: "x05", mult: 0.5 },
  { key: "x025", mult: 0.25 },
  { key: "x0", mult: 0 },
];

function CoverageSummaryView({ summary }: { summary: ReturnType<typeof teamCoverageSummary> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {COVERAGE_TIERS.map((tier) => (
        <SummaryList
          key={tier.key}
          title={effectivenessLabel(tier.mult)}
          types={summary[tier.key]}
        />
      ))}
    </div>
  );
}

function SummaryList({ title, types }: { title: string; types: string[] }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {types.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {types.map((t) => (
            <TypeBadge key={t} type={t.toLowerCase()} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main planner ---------------------------------------------------------

export function TeamPlanner({
  players,
  selfId,
  formIndex,
  moveSlots,
  setMoveSlot,
}: {
  players: ResultsPlayer[];
  selfId: string | null;
  formIndex: Map<string, number>;
  moveSlots: Map<string, string[]>;
  setMoveSlot: (entryId: string, slotIdx: number, moveSlug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const myIdx = Math.max(
    0,
    players.findIndex((p) => p.id === selfId),
  );
  // The carousel — arrows only move which team's cards/movesets are shown
  // here, nothing else. "My team" (below) is fixed to the viewer's own
  // team regardless of where the carousel currently points.
  const [viewedIdx, setViewedIdx] = useState(myIdx);
  // "mine": my team attacks, viewed team defends (coverage-style).
  // "theirs": viewed team attacks, my team defends (resistance-style).
  const [direction, setDirection] = useState<"mine" | "theirs">("theirs");

  const myTeam = players[Math.min(myIdx, players.length - 1)];
  const viewed = players[Math.min(viewedIdx, players.length - 1)];
  const viewingSelf = viewed?.id === myTeam?.id;

  function goTo(delta: number) {
    setViewedIdx((i) => (i + delta + players.length) % players.length);
  }

  const viewedInfo = useTeamInfo(viewed?.team ?? [], formIndex);
  const myInfo = useTeamInfo(viewingSelf ? [] : (myTeam?.team ?? []), formIndex);
  const allEntriesInView = [...(viewed?.team ?? []), ...(viewingSelf ? [] : (myTeam?.team ?? []))];
  const moveInfos = useMoveInfos(moveSlots, allEntriesInView);

  const viewedAttackTypes = viewedInfo.flatMap((m) => attackTypesFor(m, moveSlots, moveInfos));
  const coverageSummary = teamCoverageSummary(viewedAttackTypes);

  if (!viewed) return null;

  return (
    <section
      className={`overflow-hidden rounded-2xl border-2 transition-colors ${
        open ? "border-accent bg-accent/5" : "border-accent/50 bg-accent/5 hover:border-accent"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <span>
            <span className="block text-sm font-bold text-accent">Team Planner</span>
            <span className="block text-[11px] text-muted-foreground">
              Resistance &amp; coverage checker — see how your team matches up type-for-type
            </span>
          </span>
        </span>
        <span
          className={`shrink-0 text-accent transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-accent/30 px-4 py-4">
          {/* Carousel header — only changes which team's cards are shown below */}
          <div className="mb-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => goTo(-1)}
              disabled={players.length < 2}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm hover:bg-secondary disabled:opacity-40"
              aria-label="Previous team"
            >
              ←
            </button>
            <div className="text-center">
              <div className="text-sm font-bold">{viewed.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {viewingSelf ? "Your team" : "Team"} · {viewedIdx + 1}/{players.length}
              </div>
            </div>
            <button
              type="button"
              onClick={() => goTo(1)}
              disabled={players.length < 2}
              className="rounded-md border border-border bg-card px-2 py-1 text-sm hover:bg-secondary disabled:opacity-40"
              aria-label="Next team"
            >
              →
            </button>
          </div>

          {/* Move-slot cards for whichever team the carousel is showing */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {viewedInfo.map((info) => (
              <PlannerMonCard
                key={info.entry.id}
                info={info}
                moveSlots={moveSlots}
                setMoveSlot={setMoveSlot}
              />
            ))}
          </div>

          {/* Graph or coverage summary */}
          <div className="mt-4">
            {viewingSelf ? (
              <>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {myTeam.label}&apos;s type coverage
                </div>
                <CoverageSummaryView summary={coverageSummary} />
                <p className="mt-2 text-[9px] text-muted-foreground">
                  Based on typing plus any damaging moves filled in above. Browse to another team
                  with the arrows above to see an actual matchup instead.
                </p>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {myTeam.label} vs {viewed.label}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirection((d) => (d === "mine" ? "theirs" : "mine"))}
                    className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold hover:bg-secondary"
                    title="Swap which side is attacking"
                  >
                    ⇄ Swap attacker/defender
                  </button>
                </div>
                <MatchupGrid
                  attackers={direction === "mine" ? myInfo : viewedInfo}
                  defenders={direction === "mine" ? viewedInfo : myInfo}
                  attackerLabel={direction === "mine" ? myTeam.label : viewed.label}
                  defenderLabel={direction === "mine" ? viewed.label : myTeam.label}
                  moveSlots={moveSlots}
                  moveInfos={moveInfos}
                />
              </>
            )}
          </div>

          <p className="mt-3 text-[9px] leading-relaxed text-muted-foreground">
            Uses each Pokémon&apos;s filled-in damaging moves; status moves (Swords Dance, Toxic,
            etc.) don&apos;t count, and any empty slot falls back to that Pokémon&apos;s own type(s)
            as a generic same-type attack. Also accounts for common defensive abilities (Levitate,
            Water Absorb, Thick Fat, Filter, etc.) as possibilities — hover a cell for the full
            breakdown, since a team&apos;s actual ability isn&apos;t locked in here.
          </p>
        </div>
      )}
    </section>
  );
}
