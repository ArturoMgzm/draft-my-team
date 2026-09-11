// Client for championsbattledata.com — real Pokémon Champions ladder data
// (top moves / held items / abilities / natures / SP spreads / teammates
// per Pokémon, per format).
//
// The API is public, auth-free and CORS-open (access-control-allow-origin: *),
// and a single Pokémon's battle row set is ~1.3 KB gzipped, so this fetches
// lazily per Pokémon and caches in localStorage exactly like pokeapi.ts does.
//
// Docs: https://championsbattledata.com/api_guide
// (The guide documents four row categories; the live payload actually returns
// six — "stat_alignment" and "stat_points" are undocumented but are the two
// most useful ones here, since they map 1:1 onto our nature + SP model.)

import { NATURES, SP_MAX_PER_STAT, type SpAlloc } from "@/lib/calc-adapter";
import type { ItemGroup } from "@/lib/champions-items";

const API_ROOT = "https://championsbattledata.com";

const CACHE_PREFIX = "cbd:v1:";
// The upstream data is regenerated daily (the index exposes one folder per
// day), so anything under a day is fresh enough; 6h keeps a long draft
// session on a single fetch per Pokémon without going stale overnight.
const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
// Misses are cached too — the dataset covers ~236 Pokémon, fewer than our
// pools, so "no data for this one" is a normal answer for a real chunk of
// the pool and shouldn't re-request every time a card is opened. Shorter
// TTL so newly-added Pokémon show up the same day.
const MISS_TTL_MS = 1000 * 60 * 60;

export type BattleFormat = "Doubles" | "Singles";

export const BATTLE_FORMATS: BattleFormat[] = ["Doubles", "Singles"];

/** A ranked row with a usage percentage (moves, items, abilities). */
export type UsageRow = {
  rank: number;
  name: string;
  /** Percentage of sets running this, or null when upstream omits it. */
  percent: number | null;
};

/** A ranked nature, carrying which stat it raises and which it lowers. */
export type NatureRow = UsageRow & {
  /** Display labels straight from the API, e.g. "Sp. Def" / "Attack". */
  up: string;
  down: string;
};

/** A ranked SP spread, already in our own SpAlloc shape. */
export type SpreadRow = {
  rank: number;
  percent: number | null;
  sp: SpAlloc;
  total: number;
};

export type BattleData = {
  /** Display name as the dataset spells it. */
  pokemon: string;
  showdownId: string;
  format: BattleFormat;
  /** Season the rows came from, e.g. "Current" / "M5". */
  season: string;
  /** Snapshot date when the rows are from a daily folder, else null. */
  date: string | null;
  /** Usage rank in this format — see USAGE_RANK_NOTE. */
  usageRank: number | null;
  moves: UsageRow[];
  items: UsageRow[];
  abilities: UsageRow[];
  natures: NatureRow[];
  spreads: SpreadRow[];
  teammates: UsageRow[];
};

// "column_position" is the Pokémon's position in the upstream source table
// and tracks usage order closely (Doubles: Garchomp 2, Sneasler 3,
// Sinistcha 6, Incineroar 7, Abomasnow 102, Pikachu 165). It is NOT a
// documented field, so it's surfaced as an approximate "usage rank" and
// everything degrades gracefully if it ever disappears.
export const USAGE_RANK_NOTE =
  "Approximate — derived from the dataset's own ordering, not an official usage figure.";

// ---- Pool slug to Showdown id -------------------------------------------

// Our pool slugs are PokéAPI-style ("aegislash-shield"); the API keys on
// Showdown ids ("aegislash"). Stripping hyphens resolves most of the pool,
// but ~20 entries need an explicit mapping — the same "PokéAPI keeps a form
// suffix that Showdown drops" family already handled in calc-adapter's
// SPECIES_OVERRIDES, plus the -F female-form ids.
//
// Deliberately absent: "mr-mime". Hyphen-stripping gives "mrmime", which
// correctly finds nothing; the dataset's similar-looking "mrrime" is Mr.
// Rime, a different species, and must not be substituted for it.
const SHOWDOWN_ID_OVERRIDES: Record<string, string> = {
  "aegislash-shield": "aegislash",
  "basculegion-male": "basculegion",
  "basculegion-female": "basculegionf",
  "floette-eternal": "floette",
  "gourgeist-average": "gourgeist",
  "indeedee-male": "indeedee",
  "indeedee-female": "indeedeef",
  "lycanroc-midday": "lycanroc",
  "meowstic-male": "meowstic",
  "meowstic-female": "meowsticf",
  "mimikyu-disguised": "mimikyu",
  "morpeko-full-belly": "morpeko",
  "palafin-zero": "palafin",
  "pyroar-male": "pyroar",
  "squawkabilly-green-plumage": "squawkabilly",
  "tauros-paldea-aqua-breed": "taurospaldeaaqua",
  "tauros-paldea-blaze-breed": "taurospaldeablaze",
  "tauros-paldea-combat-breed": "taurospaldeacombat",
  "toxtricity-amped": "toxtricity",
  vivillon: "vivillonfancy",
  // The dataset carries a single "maushold" entry and doesn't distinguish
  // the three- and four-member families, so both of our forms read it.
  "maushold-family-of-three": "maushold",
  "maushold-family-of-four": "maushold",
};

const MEGA_SUFFIX_RE = /-mega(-x|-y|-z)?$/;

/**
 * Showdown ids to try for a pool slug, in order.
 *
 * Megas get two candidates: their own id first (a handful, e.g. Mega Gallade,
 * do have their own entry) and then the base species, which is where the rest
 * of a Mega's data actually lives — the base species' held-item rows are what
 * reveal the Mega split (Charizard: Charizardite Y 93.5% / X 5.0%).
 */
export function showdownIdCandidates(slug: string): string[] {
  const direct = SHOWDOWN_ID_OVERRIDES[slug] ?? slug.replace(/-/g, "");
  const candidates = [direct];
  if (MEGA_SUFFIX_RE.test(slug)) {
    const baseSlug = slug.replace(MEGA_SUFFIX_RE, "");
    const base = SHOWDOWN_ID_OVERRIDES[baseSlug] ?? baseSlug.replace(/-/g, "");
    if (base && base !== direct) candidates.push(base);
  }
  return candidates;
}

/** True when this slug is a Mega, whose data may come from its base species. */
export function isMegaSlug(slug: string): boolean {
  return MEGA_SUFFIX_RE.test(slug);
}

// ---- Cache --------------------------------------------------------------

type CacheEntry = { t: number; v: BattleData | null };

function readCache(key: string): { hit: boolean; value: BattleData | null } {
  if (typeof window === "undefined") return { hit: false, value: null };
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return { hit: false, value: null };
    const parsed = JSON.parse(raw) as CacheEntry;
    const ttl = parsed.v === null ? MISS_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - parsed.t > ttl) {
      window.localStorage.removeItem(CACHE_PREFIX + key);
      return { hit: false, value: null };
    }
    return { hit: true, value: parsed.v };
  } catch {
    return { hit: false, value: null };
  }
}

function writeCache(key: string, value: BattleData | null) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { t: Date.now(), v: value };
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled — just refetch next time.
  }
}

// ---- Fetch + parse ------------------------------------------------------

type RawRow = {
  pokemon?: string;
  column_position?: number | string | null;
  category?: string;
  rank?: number | string | null;
  name?: string;
  percentage?: string;
  percentage_value?: number | null;
  stat_up?: string;
  stat_down?: string;
  hp_points?: number | string;
  attack_points?: number | string;
  defense_points?: number | string;
  sp_atk_points?: number | string;
  sp_def_points?: number | string;
  speed_points?: number | string;
};

type RawResponse = {
  pokemon?: string;
  showdownId?: string;
  format?: string;
  season?: string;
  date?: string | null;
  rows?: RawRow[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function spPoints(v: unknown): number {
  return Math.max(0, Math.min(SP_MAX_PER_STAT, Math.round(num(v))));
}

function usageRows(rows: RawRow[], category: string): UsageRow[] {
  return rows
    .filter((r) => r.category === category && (r.name ?? "").trim() !== "")
    .map((r) => ({
      rank: num(r.rank),
      name: (r.name ?? "").trim(),
      percent: typeof r.percentage_value === "number" ? r.percentage_value : null,
    }))
    .sort((a, b) => a.rank - b.rank);
}

function parseBattleData(json: RawResponse, format: BattleFormat): BattleData | null {
  const rows = Array.isArray(json.rows) ? json.rows : [];
  if (rows.length === 0) return null;

  const natures: NatureRow[] = rows
    .filter((r) => r.category === "stat_alignment" && (r.name ?? "").trim() !== "")
    .map((r) => ({
      rank: num(r.rank),
      name: (r.name ?? "").trim(),
      percent: typeof r.percentage_value === "number" ? r.percentage_value : null,
      up: (r.stat_up ?? "").trim(),
      down: (r.stat_down ?? "").trim(),
    }))
    .sort((a, b) => a.rank - b.rank);

  const spreads: SpreadRow[] = rows
    .filter((r) => r.category === "stat_points")
    .map((r) => {
      const alloc: SpAlloc = {
        hp: spPoints(r.hp_points),
        atk: spPoints(r.attack_points),
        def: spPoints(r.defense_points),
        spa: spPoints(r.sp_atk_points),
        spd: spPoints(r.sp_def_points),
        spe: spPoints(r.speed_points),
      };
      return {
        rank: num(r.rank),
        percent: typeof r.percentage_value === "number" ? r.percentage_value : null,
        sp: alloc,
        total: alloc.hp + alloc.atk + alloc.def + alloc.spa + alloc.spd + alloc.spe,
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => a.rank - b.rank);

  const rank = num(rows[0]?.column_position);

  return {
    pokemon: json.pokemon ?? "",
    showdownId: json.showdownId ?? "",
    format,
    season: json.season ?? "Current",
    date: json.date ?? null,
    usageRank: rank > 0 ? rank : null,
    moves: usageRows(rows, "move"),
    items: usageRows(rows, "held_item"),
    abilities: usageRows(rows, "ability"),
    natures,
    spreads,
    teammates: usageRows(rows, "teammate"),
  };
}

const inflight = new Map<string, Promise<BattleData | null>>();

async function fetchOne(showdownId: string, format: BattleFormat): Promise<BattleData | null> {
  const res = await fetch(`${API_ROOT}/api/battle/${format}/${encodeURIComponent(showdownId)}`);
  // 404 is the normal "this Pokémon isn't in the dataset" answer, not a fault.
  if (!res.ok) return null;
  const json = (await res.json()) as RawResponse;
  return parseBattleData(json, format);
}

/**
 * Ladder data for a pool slug, or null when the dataset doesn't cover it.
 * Results (including misses) are cached in localStorage and deduped in flight.
 */
export function fetchBattleData(slug: string, format: BattleFormat): Promise<BattleData | null> {
  const cacheKey = `${format}:${slug}`;
  const cached = readCache(cacheKey);
  if (cached.hit) return Promise.resolve(cached.value);

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    try {
      for (const id of showdownIdCandidates(slug)) {
        const data = await fetchOne(id, format);
        if (data) {
          writeCache(cacheKey, data);
          return data;
        }
      }
      writeCache(cacheKey, null);
      return null;
    } catch {
      // Network/CORS failure: don't cache, so it retries on the next open.
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}

// ---- Mapping API names back onto our own pickers ------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves an API move name ("Will-O-Wisp") to the PokéAPI slug the calc's
 * move dropdown actually uses ("will-o-wisp"), by matching against that
 * Pokémon's own learnable-move slugs. Returns null when the move isn't in
 * the movepool we hold — which keeps the calc from being handed a value its
 * own select element has no option for.
 */
export function matchMoveSlug(apiName: string, availableSlugs: string[]): string | null {
  const target = norm(apiName);
  return availableSlugs.find((s) => norm(s) === target) ?? null;
}

/**
 * Mega Stones ("Charizardite Y", "Venusaurite") aren't selectable held items
 * here — picking the Mega form applies the stone implicitly — so they show in
 * the item table but are excluded from "apply to calc".
 */
export function isMegaStone(itemName: string): boolean {
  return /ite(\s+[XYZ])?$/i.test(itemName.trim());
}

/**
 * Resolves an API item name to the exact string in this regulation's item
 * list, or null when the item isn't legal/known here.
 */
export function matchItemName(apiName: string, groups: ItemGroup[]): string | null {
  const target = norm(apiName);
  for (const g of groups) {
    const found = g.items.find((it) => norm(it) === target);
    if (found) return found;
  }
  return null;
}

/**
 * Resolves an API ability name ("Intimidate") to the PokéAPI slug the
 * ability dropdown uses ("intimidate").
 */
export function matchAbilitySlug(apiName: string, availableSlugs: string[]): string | null {
  const target = norm(apiName);
  return availableSlugs.find((s) => norm(s) === target) ?? null;
}

/** True when the API's nature name is one the calc knows. */
export function isKnownNature(name: string): boolean {
  return NATURES.some((n) => n.name === name);
}
