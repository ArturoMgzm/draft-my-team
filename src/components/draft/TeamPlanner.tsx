import { Fragment, useEffect, useState } from "react";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import { getFormSlugs, type DraftEntry } from "@/lib/draft-engine";
import {
  defenseMatchup,
  effectivenessLabel,
  prettyAbilityName,
  type AbilityAdjustment,
} from "@/lib/type-chart";

type Player = { id: string; label: string; team: DraftEntry[] };
type MonInfo = { entry: DraftEntry; data: PokemonData | null };

function activeSlugFor(entry: DraftEntry, formIndex: Map<string, number>): string {
  const forms = getFormSlugs(entry);
  const idx = formIndex.get(entry.id) ?? 0;
  return forms[Math.min(idx, forms.length - 1)] ?? entry.slug;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Fetches (cached, via fetchPokemon) the PokemonData for whichever form of
// each entry is currently active per the shared formIndex map — so toggling
// a card's Mega badge while the planner is open updates the analysis too.
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

type TypeResult = { type: string; base: number; adjustments: AbilityAdjustment[] };
type Matchup = { multiplier: number; perType: TypeResult[]; loading: boolean };

// attackerTypes vs (defenderTypes + defenderAbilities), taking the highest
// multiplier across the attacker's available STAB types. That single "max"
// operation means the same value simultaneously reads as "worst case for
// the defender" and "best case for the attacker" — which is exactly what
// each checker needs, just viewed from opposite sides.
function typeMatchup(attacker: MonInfo, defender: MonInfo): Matchup {
  if (!attacker.data || !defender.data) return { multiplier: 1, perType: [], loading: true };
  const perType = attacker.data.types.map((t) => {
    const { base, adjustments } = defenseMatchup(t, defender.data!.types, defender.data!.abilities);
    return { type: t, base, adjustments };
  });
  const multiplier = Math.max(...perType.map((r) => r.base));
  return { multiplier, perType, loading: false };
}

function matchupTooltip(m: Matchup): string {
  if (m.loading) return "Loading…";
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

// mode "defense": green/teal = good for the defender (resists/immune),
// red = bad (weak). mode "offense": green/teal = good for the attacker
// (super effective), red = bad (resisted/immune) — same multiplier scale,
// opposite framing, so the color mapping is simply mirrored between modes.
function cellColorClass(mult: number, mode: "defense" | "offense"): string {
  const goodness =
    mode === "defense" ? -Math.log2(Math.max(mult, 0.0001)) : Math.log2(Math.max(mult, 0.0001));
  if (mult === 0) return mode === "defense" ? "bg-chart-2 text-white" : "bg-primary text-white";
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
        <img src={info.data.sprite} alt="" className="h-7 w-7 object-contain" />
      ) : (
        <div className="h-7 w-7" />
      )}
      <span className="max-w-[36px] truncate text-center text-[8px] text-muted-foreground">
        {info.entry.name}
      </span>
    </div>
  );
}

function MatchupGrid({
  title,
  description,
  rows,
  cols,
  mode,
}: {
  title: string;
  description: string;
  rows: MonInfo[];
  cols: MonInfo[];
  mode: "defense" | "offense";
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground">{description}</p>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-0.5"
          style={{ gridTemplateColumns: `44px repeat(${cols.length}, 32px)` }}
        >
          <div />
          {cols.map((c) => (
            <MonHeaderCell key={c.entry.id} info={c} />
          ))}
          {rows.map((r) => (
            <Fragment key={r.entry.id}>
              <div className="flex items-center">
                <MonHeaderCell info={r} />
              </div>
              {cols.map((c) => {
                const m = typeMatchup(mode === "defense" ? c : r, mode === "defense" ? r : c);
                return (
                  <div
                    key={c.entry.id}
                    title={`${r.entry.name} vs ${c.entry.name}\n${matchupTooltip(m)}`}
                    className={`flex aspect-square items-center justify-center rounded text-[10px] font-bold tabular-nums ${
                      m.loading
                        ? "bg-muted/40 text-muted-foreground"
                        : cellColorClass(m.multiplier, mode)
                    }`}
                  >
                    {m.loading ? "…" : cellLabel(m.multiplier)}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TeamPlanner({
  myTeam,
  opponents,
  formIndex,
  onClose,
}: {
  myTeam: DraftEntry[];
  opponents: Player[];
  formIndex: Map<string, number>;
  onClose: () => void;
}) {
  const [opponentId, setOpponentId] = useState<string | null>(
    opponents.length === 1 ? opponents[0].id : null,
  );
  const opponent = opponents.find((o) => o.id === opponentId) ?? null;

  const myInfo = useTeamInfo(myTeam, formIndex);
  const oppInfo = useTeamInfo(opponent?.team ?? [], formIndex);

  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
          Team Planner
        </span>
        <button
          onClick={onClose}
          className="rounded-md border border-border bg-card px-2 py-1 text-[10px] hover:bg-secondary"
        >
          Close ✕
        </button>
      </div>

      {opponents.length > 1 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Compare against
          </div>
          <div className="flex flex-wrap gap-1.5">
            {opponents.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOpponentId(opponentId === o.id ? null : o.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                  opponentId === o.id
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-accent"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!opponent ? (
        <p className="text-xs text-muted-foreground">
          Pick a team above to check resistances and coverage against.
        </p>
      ) : oppInfo.length === 0 || myInfo.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Both teams need at least one Pokémon to compare.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MatchupGrid
            title="Resistance check"
            description={`How your team (rows) takes ${opponent.label}'s STAB types (columns). Green = you resist/are immune, red = you're weak.`}
            rows={myInfo}
            cols={oppInfo}
            mode="defense"
          />
          <MatchupGrid
            title="Coverage check"
            description={`How well your STAB types (rows) hit ${opponent.label}'s team (columns). Green = super effective, red = resisted/immune.`}
            rows={myInfo}
            cols={oppInfo}
            mode="offense"
          />
        </div>
      )}
      <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
        Based on typing + common defensive abilities (Levitate, Water Absorb, Thick Fat, Filter,
        etc.) — hover a cell for the full breakdown. Since a team's actual ability isn't locked in
        until you build it, ability effects shown are possibilities, not guarantees.
      </p>
    </div>
  );
}
