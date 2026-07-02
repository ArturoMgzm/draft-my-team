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
  "aegislash-shield": "Aegislash",
  "aegislash-blade": "Aegislash-Blade",
  "floette-eternal": "Floette-Eternal",
  "basculegion-male": "Basculegion",
  "basculegion-female": "Basculegion-F",
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

// ---- Side config used by the sidebar ------------------------------------

export type SideConfig = {
  speciesName: string;
  ability?: string;
  item?: string;
  isMega?: boolean;
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
    nature: "Hardy",
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: evsFromSp(cfg.sp),
    ability: cfg.ability,
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

// Final stat at Level 50 with a neutral nature and 31 IVs, given a base
// stat and SP investment. Mirrors the standard formula so the UI can show
// a live "base -> final" readout next to each SP slider:
//   floor(floor((2*base + IV + floor(EV/4)) * level/100) * nature) + mod
// HP adds level+10 instead of the flat +5 non-HP stats get, and has no
// nature multiplier. EV = SP * 8 (see evsFromSp above for why 8 and not 4).
export function computeStatAtL50(base: number, sp: number, isHp: boolean): number {
  const ev = Math.max(0, Math.min(SP_MAX_PER_STAT, sp)) * 8;
  const iv = 31;
  const inner = 2 * base + iv + Math.floor(ev / 4);
  const scaled = Math.floor((inner * 50) / 100);
  return isHp ? scaled + 50 + 10 : scaled + 5;
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