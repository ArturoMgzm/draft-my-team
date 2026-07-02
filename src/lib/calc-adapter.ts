// Bridges our PokéAPI-based pool to @smogon/calc.
// - Slugs → Showdown-style species names
// - Move slugs → Showdown-style move names
// - Champions stat rules (Level 50, perfect IVs, no natures, SP replaces EVs)

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

// Convert 1 SP -> 4 EVs at L50 so each SP maps to +1 final stat, matching the
// "1 SP = 1 stat point" reading of Champions' allocation UI. Nature is neutral,
// IVs are all 31.
function evsFromSp(sp: SpAlloc) {
  return {
    hp: sp.hp * 4,
    atk: sp.atk * 4,
    def: sp.def * 4,
    spa: sp.spa * 4,
    spd: sp.spd * 4,
    spe: sp.spe * 4,
  };
}

// ---- Slug → Showdown name conversion ------------------------------------

const SPECIES_OVERRIDES: Record<string, string> = {
  "farfetchd": "Farfetch'd",
  "sirfetchd": "Sirfetch'd",
  "mr-mime": "Mr. Mime",
  "mr-mime-galar": "Mr. Mime-Galar",
  "mime-jr": "Mime Jr.",
  "mr-rime": "Mr. Rime",
  "type-null": "Type: Null",
  "ho-oh": "Ho-Oh",
  "porygon-z": "Porygon-Z",
  "porygon2": "Porygon2",
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
  teraType?: string;
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
    teraType: cfg.teraType as never,
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
    const koRes = result.kochance();
    return {
      moveName,
      minPct,
      maxPct,
      minDmg: min,
      maxDmg: max,
      maxHp,
      desc: safeDesc(result),
      koChance: koRes?.text ?? "",
    };
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

// Given a base species + optional Mega alt slug, resolve which name to pass
// to the calc engine when the Mega toggle is enabled.
export function resolveSpeciesName(baseSlug: string, useMega: boolean, megaSlug?: string): string {
  if (useMega && megaSlug) return slugToSpeciesName(megaSlug);
  return slugToSpeciesName(baseSlug);
}

export const TERA_TYPES = [
  "Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground",
  "Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy","Stellar",
];

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