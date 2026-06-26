// PokéAPI client with localStorage caching, per the API's "locally cache
// resources whenever you request them" guideline.
// https://pokeapi.co/docs/v2#fairuse

const CACHE_PREFIX = "pokeapi:v1:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type PokemonData = {
  id: number;
  name: string;
  sprite: string | null;
  types: string[];
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
          other?: {
            "official-artwork"?: { front_default: string | null };
            home?: { front_default: string | null };
          };
        };
        types: { type: { name: string } }[];
      };
      const data: PokemonData = {
        id: json.id,
        name: json.name,
        sprite:
          json.sprites.other?.["official-artwork"]?.front_default ??
          json.sprites.other?.home?.front_default ??
          json.sprites.front_default,
        types: json.types.map((t) => t.type.name),
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