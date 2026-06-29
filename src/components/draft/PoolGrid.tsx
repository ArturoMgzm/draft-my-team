import { useEffect, useMemo, useState } from "react";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import { getFormSlugs, type DraftEntry } from "@/lib/draft-engine";
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
  const [dataMap, setDataMap] = useState<Map<string, PokemonData | null>>(() => new Map());
  // Which form index (into getFormSlugs(entry)) is currently being viewed,
  // per entry id. Resets naturally whenever `pool` changes (new roll) since
  // this state isn't keyed off anything persisted across pools.
  const [formIndex, setFormIndex] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    setFormIndex(new Map());
  }, [pool]);

  // Load PokemonData for every viewable form of every pool entry (cache-warm
  // so sort/filter has data for whichever form is currently selected).
  useEffect(() => {
    let alive = true;
    const slugs = Array.from(new Set(pool.flatMap((e) => getFormSlugs(e))));
    Promise.all(slugs.map(async (s) => [s, await fetchPokemon(s)] as const)).then((pairs) => {
      if (!alive) return;
      setDataMap(new Map(pairs));
    });
    return () => {
      alive = false;
    };
  }, [pool]);

  // The slug actually being displayed/sorted/filtered on for each entry,
  // accounting for the currently selected form (defaults to base slug).
  const activeSlug = (entry: DraftEntry): string => {
    const forms = getFormSlugs(entry);
    const idx = formIndex.get(entry.id) ?? 0;
    return forms[idx] ?? entry.slug;
  };

  // Sort/filter need a map keyed by entry.id (since two entries can share a
  // base slug across different selected forms) mapping to the active form's
  // PokemonData — not the raw slug-keyed dataMap.
  const activeDataByEntryId = useMemo(() => {
    const m = new Map<string, PokemonData | null>();
    for (const e of pool) {
      m.set(e.id, dataMap.get(activeSlug(e)) ?? null);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, dataMap, formIndex]);

  const options = useMemo(() => collectFilterOptions(dataMap), [dataMap]);
  const sorted = useMemo(
    () => sortEntries(pool, sortKey, activeDataByEntryId, (e) => e.id),
    [pool, sortKey, activeDataByEntryId],
  );
  const { matches, others } = useMemo(
    () => partitionByFilter(sorted, filter, activeDataByEntryId, (e) => e.id),
    [sorted, filter, activeDataByEntryId],
  );
  const showSections = filterHasConditions(filter);

  function setForm(entry: DraftEntry, idx: number) {
    setFormIndex((m) => {
      const next = new Map(m);
      next.set(entry.id, idx);
      return next;
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          Shared Pool{" "}
          <span className="text-sm font-normal text-muted-foreground">({pool.length} left)</span>
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
            formIndex={formIndex}
            setForm={setForm}
          />
          <Section
            title={`Other (${others.length})`}
            entries={others}
            canPick={canPick}
            onPick={onPick}
            formIndex={formIndex}
            setForm={setForm}
            dim
          />
        </>
      ) : (
        <Grid
          entries={sorted}
          canPick={canPick}
          onPick={onPick}
          formIndex={formIndex}
          setForm={setForm}
        />
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
  formIndex,
  setForm,
  dim,
}: {
  title: string;
  entries: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
  formIndex: Map<string, number>;
  setForm: (entry: DraftEntry, idx: number) => void;
  dim?: boolean;
}) {
  return (
    <div className={dim ? "opacity-70" : undefined}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <Grid
        entries={entries}
        canPick={canPick}
        onPick={onPick}
        formIndex={formIndex}
        setForm={setForm}
      />
    </div>
  );
}

function Grid({
  entries,
  canPick,
  onPick,
  formIndex,
  setForm,
}: {
  entries: DraftEntry[];
  canPick: (e: DraftEntry) => boolean;
  onPick: (e: DraftEntry) => void;
  formIndex: Map<string, number>;
  setForm: (entry: DraftEntry, idx: number) => void;
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
          formIdx={formIndex.get(e.id) ?? 0}
          onSelectForm={(idx) => setForm(e, idx)}
        />
      ))}
    </div>
  );
}