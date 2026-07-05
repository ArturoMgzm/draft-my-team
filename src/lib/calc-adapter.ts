// Bridges our PokéAPI-based pool to @smogon/calc.
// - Slugs → Showdown-style species names
// - Move slugs → Showdown-style move names
// - Champions stat rules (Level 50, perfect IVs, no natures, SP replaces EVs)
// Note: Terastallization is not a playable mechanic in the current Champions
// regulation (it exists in the game files but isn't active), so Tera is not
// modeled here — only Mega Evolution.

import { calculate, Field, Generations, Move, Pokemon, Result, Side } from "@smogon/calc";

const GEN = Generations.get(9);

// Champions SP allocation: 32 max per stat, 66 max total.
export const SP_MAX_PER_STAT = 32;
export const SP_MAX_TOTAL = 66;

export type SpAlloc = {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
};

export const ZERO_SP: SpAlloc = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

// Convert 1 SP -> 8 EVs at L50 so each SP maps to +1 final stat, matching
// Champions' "1 SP = 1 stat point" allocation. Nature is neutral, IVs are
// all 31.
//
// Why 8 and not 4: the underlying stat formula is
//   floor(floor((2*base + IV + floor(EV/4)) * level/100) * nature) + 5
// At level 50, level/100 = 0.5, so each +1 to floor(EV/4) only adds 0.5
// inside the outer floor — which only rounds up to a whole stat point on
// every *other* increment. Going from 4 EVs/SP to 8 EVs/SP makes
// floor(EV/4) jump by 2 per SP, guaranteeing a full +1 stat point every
// time regardless of rounding parity. (Verified against @smogon/calc:
// with 4 EVs/SP a stat only rose on every other SP invested — e.g.
// 150, 151, 151, 152, 152... — while 8 EVs/SP gives a clean +1 per SP.)
// 32 SP -> 256 EVs, matching Champions' official ~256-EV-equivalent cap
// per stat (SP_MAX_PER_STAT stays 32; only the EV multiplier changes).
function evsFromSp(sp: SpAlloc) {
  return {
    hp: sp.hp * 8,
    atk: sp.atk * 8,
    def: sp.def * 8,
    spa: sp.spa * 8,
    spd: sp.spd * 8,
    spe: sp.spe * 8,
  };
}

// ---- Slug → Showdown name conversion ------------------------------------

const SPECIES_OVERRIDES: Record<string, string> = {
  farfetchd: "Farfetch'd",
  sirfetchd: "Sirfetch'd",
  "mr-mime": "Mr. Mime",
  "mr-mime-galar": "Mr. Mime-Galar",
  "mime-jr": "Mime Jr.",
  "mr-rime": "Mr. Rime",
  "type-null": "Type: Null",
  "ho-oh": "Ho-Oh",
  "porygon-z": "Porygon-Z",
  porygon2: "Porygon2",
  "nidoran-f": "Nidoran-F",
  "nidoran-m": "Nidoran-M",
  "tapu-koko": "Tapu Koko",
  "tapu-lele": "Tapu Lele",
  "tapu-bulu": "Tapu Bulu",
  "tapu-fini": "Tapu Fini",
  "great-tusk": "Great Tusk",
  "scream-tail": "Scream Tail",
  "brute-bonnet": "Brute Bonnet",
  "flutter-mane": "Flutter Mane",
  "slither-wing": "Slither Wing",
  "sandy-shocks": "Sandy Shocks",
  "iron-treads": "Iron Treads",
  "iron-bundle": "Iron Bundle",
  "iron-hands": "Iron Hands",
  "iron-jugulis": "Iron Jugulis",
  "iron-moth": "Iron Moth",
  "iron-thorns": "Iron Thorns",
  "iron-valiant": "Iron Valiant",
  "iron-leaves": "Iron Leaves",
  "iron-boulder": "Iron Boulder",
  "iron-crown": "Iron Crown",
  "roaring-moon": "Roaring Moon",
  "walking-wake": "Walking Wake",
  "gouging-fire": "Gouging Fire",
  "raging-bolt": "Raging Bolt",
  "chi-yu": "Chi-Yu",
  "chien-pao": "Chien-Pao",
  "wo-chien": "Wo-Chien",
  "ting-lu": "Ting-Lu",
  "jangmo-o": "Jangmo-o",
  "hakamo-o": "Hakamo-o",
  "kommo-o": "Kommo-o",
  // Aegislash has NO plain "Aegislash" species in @smogon/calc's data — only
  // the two stance-specific formes (plus "Aegislash-Both", unused here)
  // exist, so the Shield forme must keep its suffix.
  "aegislash-shield": "Aegislash-Shield",
  "aegislash-blade": "Aegislash-Blade",
  "floette-eternal": "Floette-Eternal",
  "basculegion-male": "Basculegion",
  "basculegion-female": "Basculegion-F",
  // The species below all follow the same "default form has NO suffix in
  // Showdown/@smogon-calc's data, but PokeAPI's slug still gives it one"
  // pattern — the generic slug->name conversion produces a name that
  // simply doesn't exist as a species, causing the calc to throw. Found by
  // testing every species/form/mega slug in the pool against the real
  // calc engine end to end (not just spot-checking the reported ones).
  "gourgeist-average": "Gourgeist",
  "lycanroc-midday": "Lycanroc",
  "maushold-family-of-four": "Maushold-Four",
  "maushold-family-of-three": "Maushold",
  "meowstic-male": "Meowstic",
  "meowstic-female": "Meowstic-F",
  "meowstic-male-mega": "Meowstic-M-Mega",
  "meowstic-female-mega": "Meowstic-F-Mega",
  "mimikyu-disguised": "Mimikyu",
  "morpeko-full-belly": "Morpeko",
  "palafin-zero": "Palafin",
  "pyroar-male": "Pyroar",
  "tauros-paldea-combat-breed": "Tauros-Paldea-Combat",
  "tauros-paldea-blaze-breed": "Tauros-Paldea-Blaze",
  "tauros-paldea-aqua-breed": "Tauros-Paldea-Aqua",
};

function titleCasePart(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function slugToSpeciesName(slug: string): string {
  const override = SPECIES_OVERRIDES[slug];
  if (override) return override;
  const parts = slug.split("-").map(titleCasePart);
  return parts.join("-");
}

const MOVE_OVERRIDES: Record<string, string> = {
  "u-turn": "U-turn",
  "v-create": "V-create",
  "x-scissor": "X-Scissor",
  "will-o-wisp": "Will-O-Wisp",
  "trick-or-treat": "Trick-or-Treat",
  "wake-up-slap": "Wake-Up Slap",
  "double-edge": "Double-Edge",
  "self-destruct": "Self-Destruct",
  "mud-slap": "Mud-Slap",
  "power-up-punch": "Power-Up Punch",
  "freeze-dry": "Freeze-Dry",
  "soft-boiled": "Soft-Boiled",
  "lock-on": "Lock-On",
  "mean-look": "Mean Look",
  "multi-attack": "Multi-Attack",
  "topsy-turvy": "Topsy-Turvy",
  "high-jump-kick": "High Jump Kick",
  "hi-jump-kick": "High Jump Kick",
};

export function slugToMoveName(slug: string): string {
  const override = MOVE_OVERRIDES[slug];
  if (override) return override;
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// Abilities were being passed to @smogon/calc as raw PokéAPI slugs (e.g.
// "water-absorb"), which the engine silently fails to recognize — it
// stores whatever string it's given without validating it, so there's no
// error, but the ability's actual effect (Water Absorb's immunity, Guts'
// boost, etc.) just never triggers. Verified directly: constructing a
// Pokemon with ability "water-absorb" and calculating a Water-type hit
// against it still deals full damage, while ability "Water Absorb" (the
// Title Case, space-separated Showdown convention) correctly zeroes it.
export function slugToAbilityName(slug: string): string {
  return slug
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

// ---- Natures (Champions calls this "Stat Alignment") --------------------

export type NatureStatKey = "atk" | "def" | "spa" | "spd" | "spe";

export type NatureInfo = {
  name: string;
  /** Stat boosted 10%, or null for the 5 neutral natures. */
  plus: NatureStatKey | null;
  /** Stat reduced 10%, or null for the 5 neutral natures. */
  minus: NatureStatKey | null;
};

// The standard 25-nature table (verified against @smogon/calc's own
// GEN.natures data). The 5 "neutral" natures (Hardy, Docile, Serious,
// Bashful, Quirky) boost and reduce the same stat, which cancels out to
// no effect — represented here as plus/minus: null for a 1.0x multiplier.
export const NATURES: NatureInfo[] = [
  { name: "Hardy", plus: null, minus: null },
  { name: "Lonely", plus: "atk", minus: "def" },
  { name: "Brave", plus: "atk", minus: "spe" },
  { name: "Adamant", plus: "atk", minus: "spa" },
  { name: "Naughty", plus: "atk", minus: "spd" },
  { name: "Bold", plus: "def", minus: "atk" },
  { name: "Docile", plus: null, minus: null },
  { name: "Relaxed", plus: "def", minus: "spe" },
  { name: "Impish", plus: "def", minus: "spa" },
  { name: "Lax", plus: "def", minus: "spd" },
  { name: "Timid", plus: "spe", minus: "atk" },
  { name: "Hasty", plus: "spe", minus: "def" },
  { name: "Serious", plus: null, minus: null },
  { name: "Jolly", plus: "spe", minus: "spa" },
  { name: "Naive", plus: "spe", minus: "spd" },
  { name: "Modest", plus: "spa", minus: "atk" },
  { name: "Mild", plus: "spa", minus: "def" },
  { name: "Quiet", plus: "spa", minus: "spe" },
  { name: "Bashful", plus: null, minus: null },
  { name: "Rash", plus: "spa", minus: "spd" },
  { name: "Calm", plus: "spd", minus: "atk" },
  { name: "Gentle", plus: "spd", minus: "def" },
  { name: "Sassy", plus: "spd", minus: "spe" },
  { name: "Careful", plus: "spd", minus: "spa" },
  { name: "Quirky", plus: null, minus: null },
];

const NATURES_BY_NAME = new Map(NATURES.map((n) => [n.name, n]));

export function natureMultiplier(natureName: string | undefined, stat: NatureStatKey): number {
  const nature = natureName ? NATURES_BY_NAME.get(natureName) : undefined;
  if (!nature) return 1;
  if (nature.plus === stat) return 1.1;
  if (nature.minus === stat) return 0.9;
  return 1;
}

// Reverse lookup for a "pick which stat is boosted / which is hurt" nature
// picker: given a +stat and a -stat (either or both may be absent), find
// the matching nature name. Equal or fully-absent plus/minus both mean
// neutral, and any of the five interchangeable neutral natures works
// identically for calc purposes, so "Hardy" is used as the canonical one.
export function natureFromPlusMinus(
  plus: NatureStatKey | null,
  minus: NatureStatKey | null,
): string {
  if (!plus || !minus || plus === minus) return "Hardy";
  const match = NATURES.find((n) => n.plus === plus && n.minus === minus);
  return match?.name ?? "Hardy";
}

// ---- Side config used by the sidebar ------------------------------------

export type SideConfig = {
  speciesName: string;
  ability?: string;
  item?: string;
  isMega?: boolean;
  nature?: string;
  sp: SpAlloc;
  status?: "" | "brn" | "par" | "psn" | "tox" | "slp" | "frz";
  boosts?: Partial<SpAlloc>;
};

export type FieldConfig = {
  gameType: "Singles" | "Doubles";
  weather?: string;
  terrain?: string;
  atk: {
    isTailwind?: boolean;
    isReflect?: boolean;
    isLightScreen?: boolean;
    isAuroraVeil?: boolean;
    isHelpingHand?: boolean;
  };
  def: {
    isTailwind?: boolean;
    isReflect?: boolean;
    isLightScreen?: boolean;
    isAuroraVeil?: boolean;
    isSR?: boolean;
    spikes?: number;
  };
};

export const DEFAULT_FIELD: FieldConfig = {
  gameType: "Doubles",
  atk: {},
  def: {},
};

function buildPokemon(cfg: SideConfig): Pokemon {
  // Item is either the user-selected held item, OR — if Mega toggled on and the
  // engine knows a canonical mega stone for this species — an empty item plus
  // the mega forme name. Simpler: pass the base species + `isMega`-style
  // handling by directly using the *-Mega name if provided upstream (we do
  // that in resolveMegaName). Item stays as the held item.
  return new Pokemon(GEN, cfg.speciesName, {
    level: 50,
    nature: cfg.nature || "Hardy",
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: evsFromSp(cfg.sp),
    ability: cfg.ability ? slugToAbilityName(cfg.ability) : undefined,
    item: cfg.item,
    status: (cfg.status ?? "") as never,
    boosts: cfg.boosts as never,
  });
}

function buildField(f: FieldConfig): Field {
  return new Field({
    gameType: f.gameType,
    weather: f.weather as never,
    terrain: f.terrain as never,
    attackerSide: new Side(f.atk as never),
    defenderSide: new Side(f.def as never),
  });
}

export type MoveResult = {
  moveName: string;
  minPct: number;
  maxPct: number;
  desc: string;
  koChance: string;
  minDmg: number;
  maxDmg: number;
  maxHp: number;
  immune: boolean;
};

export function runCalc(
  attacker: SideConfig,
  defender: SideConfig,
  moveSlug: string,
  fieldCfg: FieldConfig,
): MoveResult | null {
  try {
    const atk = buildPokemon(attacker);
    const def = buildPokemon(defender);
    const moveName = slugToMoveName(moveSlug);
    const move = new Move(GEN, moveName);
    const field = buildField(fieldCfg);
    const result: Result = calculate(GEN, atk, def, move, field);
    const dmg = result.damage;
    let min: number;
    let max: number;
    if (Array.isArray(dmg)) {
      const flat = (dmg as unknown as number[]).flat
        ? ((dmg as unknown[]).flat() as number[])
        : (dmg as number[]);
      const nums = flat.filter((n) => typeof n === "number");
      min = nums.length ? Math.min(...nums) : 0;
      max = nums.length ? Math.max(...nums) : 0;
    } else {
      min = max = Number(dmg) || 0;
    }
    const maxHp = def.maxHP();
    const minPct = (min / maxHp) * 100;
    const maxPct = (max / maxHp) * 100;
    // @smogon/calc's kochance() (and desc()/fullDesc() by extension) throws
    // internally when max damage is 0 — e.g. a Ground move into a Flying
    // type, or any other immunity. That's a completely valid result (0%,
    // no effect), not a calc failure, so it must be guarded separately
    // from the rest of the pipeline or the outer catch below would turn a
    // real immunity into an indistinguishable "calc error" in the UI.
    const isImmune = max === 0;
    const koRes = isImmune ? null : safeKoChance(result);
    return {
      moveName,
      minPct,
      maxPct,
      minDmg: min,
      maxDmg: max,
      maxHp,
      desc: isImmune ? "No effect." : safeDesc(result),
      koChance: isImmune ? "" : (koRes?.text ?? ""),
      immune: isImmune,
    };
  } catch {
    return null;
  }
}

function safeKoChance(r: Result): { text?: string } | null {
  try {
    return r.kochance();
  } catch {
    return null;
  }
}

function safeDesc(r: Result): string {
  try {
    const d = (r as unknown as { fullDesc?: () => string }).fullDesc;
    if (typeof d === "function") return d.call(r);
  } catch {
    /* ignore */
  }
  try {
    return r.desc();
  } catch {
    return "";
  }
}

// Final stat at Level 50 with 31 IVs, given a base stat, SP investment, and
// nature multiplier. Mirrors the standard formula so the UI can show a live
// "base -> final" readout next to each SP slider:
//   floor((floor((2*base + IV + floor(EV/4)) * level/100) + 5) * nature)
// HP adds level+10 instead of the flat +5 non-HP stats get, and is never
// affected by nature (verified against @smogon/calc: the +5 non-HP offset
// is applied *before* the nature multiplier, not after).
// EV = SP * 8 (see evsFromSp above for why 8 and not 4).
export function computeStatAtL50(base: number, sp: number, isHp: boolean, natureMult = 1): number {
  const ev = Math.max(0, Math.min(SP_MAX_PER_STAT, sp)) * 8;
  const iv = 31;
  const inner = 2 * base + iv + Math.floor(ev / 4);
  const scaled = Math.floor((inner * 50) / 100);
  if (isHp) return scaled + 50 + 10;
  return Math.floor((scaled + 5) * natureMult);
}

export const WEATHERS = ["", "Sun", "Rain", "Sand", "Snow", "Harsh Sunshine", "Heavy Rain"];
export const TERRAINS = ["", "Electric", "Grassy", "Misty", "Psychic"];
export const STATUSES: { label: string; value: SideConfig["status"] }[] = [
  { label: "None", value: "" },
  { label: "Burn", value: "brn" },
  { label: "Paralyze", value: "par" },
  { label: "Poison", value: "psn" },
  { label: "Badly poisoned", value: "tox" },
  { label: "Sleep", value: "slp" },
  { label: "Freeze", value: "frz" },
];
