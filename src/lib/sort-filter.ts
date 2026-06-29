import type { DraftEntry } from "@/lib/draft-engine";
import type { PokemonData } from "@/lib/pokeapi";

export type SortKey =
  | "default"
  | "name"
  | "bst"
  | "hp"
  | "attack"
  | "defense"
  | "specialAttack"
  | "specialDefense"
  | "speed"
  | "type";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "default", label: "Default (roll order)" },
  { value: "name", label: "Alphabetical" },
  { value: "bst", label: "BST" },
  { value: "hp", label: "HP" },
  { value: "attack", label: "Attack" },
  { value: "defense", label: "Defense" },
  { value: "specialAttack", label: "Sp. Atk" },
  { value: "specialDefense", label: "Sp. Def" },
  { value: "speed", label: "Speed" },
  { value: "type", label: "Type" },
];

export type FilterKind = "type" | "ability" | "move";
export type FilterCondition = {
  id: string;
  kind: FilterKind;
  value: string;
};
export type FilterGroup = {
  id: string;
  mode: "AND" | "OR";
  conditions: FilterCondition[];
};
export type FilterTree = {
  mode: "AND" | "OR"; // mode between groups
  groups: FilterGroup[];
};

export const EMPTY_FILTER: FilterTree = { mode: "AND", groups: [] };

export function filterHasConditions(tree: FilterTree): boolean {
  return tree.groups.some((g) => g.conditions.length > 0);
}

function evalCondition(cond: FilterCondition, data: PokemonData): boolean {
  if (cond.kind === "type") return data.types.includes(cond.value);
  if (cond.kind === "ability") return data.abilities.includes(cond.value);
  if (cond.kind === "move") return data.moves.includes(cond.value);
  return false;
}

export function evalFilter(tree: FilterTree, data: PokemonData | null | undefined): boolean {
  if (!filterHasConditions(tree)) return true;
  if (!data) return false;
  const groupResults = tree.groups
    .filter((g) => g.conditions.length > 0)
    .map((g) => {
      const results = g.conditions.map((c) => evalCondition(c, data));
      return g.mode === "AND" ? results.every(Boolean) : results.some(Boolean);
    });
  if (groupResults.length === 0) return true;
  return tree.mode === "AND" ? groupResults.every(Boolean) : groupResults.some(Boolean);
}

function sortValue(key: SortKey, data: PokemonData | null | undefined): number | string {
  if (!data) return key === "name" || key === "type" ? "zzz" : -1;
  switch (key) {
    case "name":
      return data.name;
    case "type":
      return data.types[0] ?? "zzz";
    case "bst":
      return data.bst;
    case "hp":
      return data.stats.hp;
    case "attack":
      return data.stats.attack;
    case "defense":
      return data.stats.defense;
    case "specialAttack":
      return data.stats.specialAttack;
    case "specialDefense":
      return data.stats.specialDefense;
    case "speed":
      return data.stats.speed;
    default:
      return 0;
  }
}

export function sortEntries(
  entries: DraftEntry[],
  key: SortKey,
  dataMap: Map<string, PokemonData | null>,
  keyOf: (e: DraftEntry) => string = (e) => e.slug,
): DraftEntry[] {
  if (key === "default") return entries;
  const list = entries.slice();
  const stringKey = key === "name" || key === "type";
  list.sort((a, b) => {
    const va = sortValue(key, dataMap.get(keyOf(a)));
    const vb = sortValue(key, dataMap.get(keyOf(b)));
    if (stringKey) {
      const sa = String(va);
      const sb = String(vb);
      const cmp = sa.localeCompare(sb);
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name);
    }
    const na = Number(va);
    const nb = Number(vb);
    if (na !== nb) return nb - na; // descending for stat-like
    return a.name.localeCompare(b.name);
  });
  return list;
}

export function partitionByFilter(
  entries: DraftEntry[],
  tree: FilterTree,
  dataMap: Map<string, PokemonData | null>,
  keyOf: (e: DraftEntry) => string = (e) => e.slug,
): { matches: DraftEntry[]; others: DraftEntry[] } {
  if (!filterHasConditions(tree)) {
    return { matches: entries, others: [] };
  }
  const matches: DraftEntry[] = [];
  const others: DraftEntry[] = [];
  for (const e of entries) {
    (evalFilter(tree, dataMap.get(keyOf(e))) ? matches : others).push(e);
  }
  return { matches, others };
}

export function collectFilterOptions(dataMap: Map<string, PokemonData | null>): {
  types: string[];
  abilities: string[];
  moves: string[];
} {
  const types = new Set<string>();
  const abilities = new Set<string>();
  const moves = new Set<string>();
  for (const d of dataMap.values()) {
    if (!d) continue;
    d.types.forEach((t) => types.add(t));
    d.abilities.forEach((a) => abilities.add(a));
    d.moves.forEach((m) => moves.add(m));
  }
  const cmp = (a: string, b: string) => a.localeCompare(b);
  return {
    types: [...types].sort(cmp),
    abilities: [...abilities].sort(cmp),
    moves: [...moves].sort(cmp),
  };
}