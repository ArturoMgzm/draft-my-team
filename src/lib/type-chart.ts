// Type effectiveness + defensive-ability adjustments, used by the team
// planner's resistance/coverage checkers.
//
// The base chart is pulled directly from @smogon/calc's own exported
// TYPE_CHART rather than hand-transcribed, so it's guaranteed consistent
// with the same engine already powering the damage calculator (and immune
// to copy/paste errors across 18*18 = 324 matchups).

import { TYPE_CHART } from "@smogon/calc";

const CHART = TYPE_CHART[9] as unknown as Record<string, Record<string, number>>;

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Multiplier of a single attacking type against a (possibly dual-typed)
// defender, from pure typing alone.
export function typeEffectiveness(attackType: string, defenderTypes: string[]): number {
  const row = CHART[titleCase(attackType)];
  if (!row) return 1;
  return defenderTypes.reduce((mult, defType) => {
    const m = row[titleCase(defType)];
    return mult * (typeof m === "number" ? m : 1);
  }, 1);
}

// ---- Defensive abilities -------------------------------------------------
//
// A curated, common-cases table rather than an exhaustive simulation of
// every ability in the game — covers the abilities people actually reason
// about when drafting/team-building: full-immunity abilities (Levitate,
// Water Absorb, ...), damage-halving abilities (Thick Fat, Heatproof, ...),
// the three "reduce any super-effective hit" abilities (Filter/Solid
// Rock/Prism Armor), and Wonder Guard's all-or-nothing rule. PokéAPI
// ability slugs (lowercase-hyphenated) are the keys, matching what
// fetchPokemon() already returns.
//
// Each adjuster receives the pure-type multiplier and the (title-cased)
// attacking type, and returns the adjusted multiplier, or null if that
// ability doesn't affect this particular matchup.
type AbilityAdjuster = (baseMultiplier: number, attackType: string) => number | null;

const DEFENSIVE_ABILITY_ADJUSTERS: Record<string, AbilityAdjuster> = {
  levitate: (_m, t) => (t === "Ground" ? 0 : null),
  "water-absorb": (_m, t) => (t === "Water" ? 0 : null),
  "volt-absorb": (_m, t) => (t === "Electric" ? 0 : null),
  "motor-drive": (_m, t) => (t === "Electric" ? 0 : null),
  "lightning-rod": (_m, t) => (t === "Electric" ? 0 : null),
  "storm-drain": (_m, t) => (t === "Water" ? 0 : null),
  "sap-sipper": (_m, t) => (t === "Grass" ? 0 : null),
  "flash-fire": (_m, t) => (t === "Fire" ? 0 : null),
  "well-baked-body": (_m, t) => (t === "Fire" ? 0 : null),
  "earth-eater": (_m, t) => (t === "Ground" ? 0 : null),
  "dry-skin": (m, t) => (t === "Water" ? 0 : t === "Fire" ? m * 1.25 : null),
  "thick-fat": (m, t) => (t === "Fire" || t === "Ice" ? m * 0.5 : null),
  heatproof: (m, t) => (t === "Fire" ? m * 0.5 : null),
  "purifying-salt": (m, t) => (t === "Ghost" ? m * 0.5 : null),
  "water-bubble": (m, t) => (t === "Fire" ? m * 0.5 : null),
  filter: (m) => (m > 1 ? m * 0.75 : null),
  "solid-rock": (m) => (m > 1 ? m * 0.75 : null),
  "prism-armor": (m) => (m > 1 ? m * 0.75 : null),
  "wonder-guard": (m) => (m > 1 ? m : 0),
};

export type AbilityAdjustment = { ability: string; multiplier: number };

// Pure-type multiplier plus every way the defender's *possible* abilities
// (we don't know which one they actually picked) could change it. The base
// multiplier stays the guaranteed, typing-only number; adjustments are
// shown as explicit "if they have X" possibilities rather than silently
// folded into a single guessed number.
export function defenseMatchup(
  attackType: string,
  defenderTypes: string[],
  defenderAbilities: string[] = [],
): { base: number; adjustments: AbilityAdjustment[] } {
  const base = typeEffectiveness(attackType, defenderTypes);
  const capType = titleCase(attackType);
  const adjustments: AbilityAdjustment[] = [];
  const seen = new Set<number>();
  for (const ability of defenderAbilities) {
    const fn = DEFENSIVE_ABILITY_ADJUSTERS[ability];
    if (!fn) continue;
    const result = fn(base, capType);
    if (result !== null && result !== base && !seen.has(result)) {
      seen.add(result);
      adjustments.push({ ability, multiplier: result });
    }
  }
  return { base, adjustments };
}

export function effectivenessLabel(mult: number): string {
  if (mult === 0) return "Immune (0x)";
  if (mult >= 4) return "Extremely effective (4x)";
  if (mult === 2) return "Super effective (2x)";
  if (mult === 1) return "Neutral (1x)";
  if (mult === 0.5) return "Not very effective (0.5x)";
  if (mult <= 0.25) return "Mostly ineffective (0.25x)";
  return `${mult}x`;
}

export function prettyAbilityName(slug: string): string {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// The 18 standard types a Pokémon can actually have as its own typing.
// Deliberately excludes "???" (a legacy placeholder, unused since Gen 5)
// and "Stellar" (a Terapagos-exclusive battle state, not a real typing) —
// neither is a defending type any drafted Pokémon can actually have, so
// including them in a coverage summary would just be noise.
export const ALL_TYPES = [
  "Normal",
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
];

export type CoverageSummary = {
  x4: string[];
  x2: string[];
  x1: string[];
  x05: string[];
  x025: string[];
  x0: string[];
};

// Abstract offensive coverage: given a set of attacking types (a team's
// collective STAB + chosen moves), buckets each of the 18 real types by how
// the *best* available attack type fares against a hypothetical pure
// single-type defender of that type. Ability-agnostic on purpose — this is
// a typing-only coverage map, not a matchup against any specific Pokémon.
//
// Since each check is against a single type in isolation, only 0x/0.5x/1x/
// 2x are actually reachable here (4x and 0.25x require a *dual*-typed
// defender stacking two resistances/weaknesses) — those two tiers exist
// for label consistency with effectivenessLabel and the real matchup grid,
// but will typically show "None" in this abstract view.
export function teamCoverageSummary(attackTypes: string[]): CoverageSummary {
  const uniqueAttacks = Array.from(new Set(attackTypes));
  const summary: CoverageSummary = { x4: [], x2: [], x1: [], x05: [], x025: [], x0: [] };
  for (const defType of ALL_TYPES) {
    const best =
      uniqueAttacks.length === 0
        ? 1
        : Math.max(...uniqueAttacks.map((a) => typeEffectiveness(a, [defType])));
    if (best >= 4) summary.x4.push(defType);
    else if (best === 2) summary.x2.push(defType);
    else if (best === 1) summary.x1.push(defType);
    else if (best === 0.5) summary.x05.push(defType);
    else if (best > 0) summary.x025.push(defType);
    else summary.x0.push(defType);
  }
  return summary;
}
