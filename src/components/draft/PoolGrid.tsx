import { useEffect, useMemo, useState } from "react";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import type { DraftEntry } from "@/lib/draft-engine";
import {
  EMPTY_FILTER,
  collectFilterOptions,
  filterHasConditions,
  partitionByFilter,
  sortEntries,
  type FilterTree,
  type SortKey,
} from "@/lib/sort-filter";
import { PoolCard } from "./PoolCard";
import { SortFilterBar } from "./SortFilterBar";

export function PoolGrid({
  pool,
  canPick,
  onPick,
  headerLeft,
  headerRight,
  footerNote,
}: {
  pool: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  footerNote?: React.ReactNode;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [filter, setFilter] = useState<FilterTree>(EMPTY_FILTER);
  const [dataMap, setDataMap] = useState<Map<string, PokemonData | null>>(
    () => new Map(),
  );

  // Load PokemonData for all pool entries (cache-warm so sort/filter has data).
  useEffect(() => {
    let alive = true;
    const slugs = Array.from(new Set(pool.map((e) => e.slug)));
    Promise.all(
      slugs.map(async (s) => [s, await fetchPokemon(s)] as const),
    ).then((pairs) => {
      if (!alive) return;
      setDataMap(new Map(pairs));
    });
    return () => {
      alive = false;
    };
  }, [pool]);

  const options = useMemo(() => collectFilterOptions(dataMap), [dataMap]);
  const sorted = useMemo(
    () => sortEntries(pool, sortKey, dataMap),
    [pool, sortKey, dataMap],
  );
  const { matches, others } = useMemo(
    () => partitionByFilter(sorted, filter, dataMap),
    [sorted, filter, dataMap],
  );
  const showSections = filterHasConditions(filter);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          Shared Pool{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({pool.length} left)
          </span>
        </h2>
        {headerRight}
      </div>
      {headerLeft}
      <SortFilterBar
        sortKey={sortKey}
        setSortKey={setSortKey}
        filter={filter}
        setFilter={setFilter}
        options={options}
      />
      {showSections ? (
        <>
          <Section
            title={`Matches filters (${matches.length})`}
            entries={matches}
            canPick={canPick}
            onPick={onPick}
          />
          <Section
            title={`Other (${others.length})`}
            entries={others}
            canPick={canPick}
            onPick={onPick}
            dim
          />
        </>
      ) : (
        <Grid entries={sorted} canPick={canPick} onPick={onPick} />
      )}
      {pool.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          Pool empty.
        </div>
      )}
      {footerNote}
    </section>
  );
}

function Section({
  title,
  entries,
  canPick,
  onPick,
  dim,
}: {
  title: string;
  entries: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
  dim?: boolean;
}) {
  return (
    <div className={dim ? "opacity-70" : undefined}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <Grid entries={entries} canPick={canPick} onPick={onPick} />
    </div>
  );
}

function Grid({
  entries,
  canPick,
  onPick,
}: {
  entries: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {entries.map((e) => (
        <PoolCard
          key={e.id}
          entry={e}
          disabled={!canPick(e)}
          onClick={() => onPick(e)}
          showStats
        />
      ))}
    </div>
  );
}