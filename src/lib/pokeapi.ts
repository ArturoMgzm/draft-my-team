// PokéAPI client with localStorage caching, per the API's "locally cache
// resources whenever you request them" guideline.
// https://pokeapi.co/docs/v2#fairuse

const CACHE_PREFIX = "pokeapi:v3:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type PokemonData = {
  id: number;
  name: string;
  sprite: string | null;
  shinySprite: string | null;
  types: string[];
  stats: {
    hp: number;
    attack: number;
    defense: number;
    specialAttack: number;
    specialDefense: number;
    speed: number;
  };
  bst: number;
  abilities: string[]; // ability names (no hidden flag distinction)
  moves: string[]; // moves learnable in version_group "champions" only
};

type CacheEntry<T> = { t: number; v: T };

function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - parsed.t > CACHE_TTL_MS) {
      window.localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { t: Date.now(), v: value };
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled — silently ignore; we'll just refetch.
  }
}

export type ItemData = {
  name: string;
  sprite: string | null;
};

// Our item names are display/Showdown-style ("Life Orb", "King's Rock",
// "NeverMeltIce") but PokéAPI's item slugs are kebab-case ("life-orb",
// "kings-rock", "never-melt-ice"). This covers the general case; anything
// that doesn't reduce cleanly (camelCase names with no separators) needs
// an explicit override below.
const ITEM_SLUG_OVERRIDES: Record<string, string> = {
  NeverMeltIce: "never-melt-ice",
};

export function itemNameToSlug(name: string): string {
  const override = ITEM_SLUG_OVERRIDES[name];
  if (override) return override;
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const itemInflight = new Map<string, Promise<ItemData | null>>();

// Fetches just the sprite + display name for a held item — enough for a
// small icon preview next to the item picker, without pulling in the
// full effect text/attribute payload PokéAPI also returns.
export function fetchItem(slug: string): Promise<ItemData | null> {
  const cacheKey = `item:${slug}`;
  const cached = readCache<ItemData>(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existing = itemInflight.get(slug);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/item/${slug}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        name: string;
        sprites: { default: string | null };
      };
      const data: ItemData = {
        name: json.name,
        sprite: json.sprites?.default ?? null,
      };
      writeCache(cacheKey, data);
      return data;
    } catch {
      return null;
    } finally {
      itemInflight.delete(slug);
    }
  })();

  itemInflight.set(slug, p);
  return p;
}

const inflight = new Map<string, Promise<PokemonData | null>>();

export function fetchPokemon(slug: string): Promise<PokemonData | null> {
  const cached = readCache<PokemonData>(slug);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(slug);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`);
      if (!res.ok) return null;
      const json = (await res.json()) as {
        id: number;
        name: string;
        sprites: {
          front_default: string | null;
          front_shiny: string | null;
          other?: {
            "official-artwork"?: {
              front_default: string | null;
              front_shiny: string | null;
            };
            home?: {
              front_default: string | null;
              front_shiny: string | null;
            };
          };
        };
        types: { type: { name: string } }[];
        stats: { base_stat: number; stat: { name: string } }[];
        abilities: { ability: { name: string } }[];
        moves: {
          move: { name: string };
          version_group_details: { version_group: { name: string } }[];
        }[];
      };
      const statMap: Record<string, number> = {};
      for (const s of json.stats) statMap[s.stat.name] = s.base_stat;
      const stats = {
        hp: statMap["hp"] ?? 0,
        attack: statMap["attack"] ?? 0,
        defense: statMap["defense"] ?? 0,
        specialAttack: statMap["special-attack"] ?? 0,
        specialDefense: statMap["special-defense"] ?? 0,
        speed: statMap["speed"] ?? 0,
      };
      const bst =
        stats.hp +
        stats.attack +
        stats.defense +
        stats.specialAttack +
        stats.specialDefense +
        stats.speed;
      const moves = Array.from(
        new Set(
          json.moves
            .filter((m) =>
              m.version_group_details.some((v) => v.version_group.name === "champions"),
            )
            .map((m) => m.move.name),
        ),
      );
      const data: PokemonData = {
        id: json.id,
        name: json.name,
        sprite:
          json.sprites.other?.["official-artwork"]?.front_default ??
          json.sprites.other?.home?.front_default ??
          json.sprites.front_default,
        shinySprite:
          json.sprites.other?.["official-artwork"]?.front_shiny ??
          json.sprites.other?.home?.front_shiny ??
          json.sprites.front_shiny,
        types: json.types.map((t) => t.type.name),
        stats,
        bst,
        abilities: Array.from(new Set(json.abilities.map((a) => a.ability.name))),
        moves,
      };
      writeCache(slug, data);
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(slug);
    }
  })();

  inflight.set(slug, p);
  return p;
}