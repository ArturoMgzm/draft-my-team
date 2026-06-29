import { useMemo, useState } from "react";
import {
  SORT_OPTIONS,
  type FilterCondition,
  type FilterGroup,
  type FilterKind,
  type FilterTree,
  type SortKey,
} from "@/lib/sort-filter";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function SortFilterBar({
  sortKey,
  setSortKey,
  filter,
  setFilter,
  options,
}: {
  sortKey: SortKey;
  setSortKey: (k: SortKey) => void;
  filter: FilterTree;
  setFilter: (f: FilterTree) => void;
  options: { types: string[]; abilities: string[]; moves: string[] };
}) {
  const [showFilters, setShowFilters] = useState(false);
  const activeCount = useMemo(
    () => filter.groups.reduce((s, g) => s + g.conditions.length, 0),
    [filter],
  );

  const addGroup = () =>
    setFilter({
      ...filter,
      groups: [
        ...filter.groups,
        { id: uid(), mode: "AND", conditions: [] } as FilterGroup,
      ],
    });

  const removeGroup = (gid: string) =>
    setFilter({ ...filter, groups: filter.groups.filter((g) => g.id !== gid) });

  const updateGroup = (gid: string, patch: Partial<FilterGroup>) =>
    setFilter({
      ...filter,
      groups: filter.groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)),
    });

  const addCondition = (gid: string) =>
    setFilter({
      ...filter,
      groups: filter.groups.map((g) =>
        g.id === gid
          ? {
              ...g,
              conditions: [
                ...g.conditions,
                { id: uid(), kind: "type", value: options.types[0] ?? "" } as FilterCondition,
              ],
            }
          : g,
      ),
    });

  const updateCondition = (gid: string, cid: string, patch: Partial<FilterCondition>) =>
    setFilter({
      ...filter,
      groups: filter.groups.map((g) =>
        g.id === gid
          ? {
              ...g,
              conditions: g.conditions.map((c) =>
                c.id === cid
                  ? { ...c, ...patch }
                  : c,
              ),
            }
          : g,
      ),
    });

  const removeCondition = (gid: string, cid: string) =>
    setFilter({
      ...filter,
      groups: filter.groups.map((g) =>
        g.id === gid
          ? { ...g, conditions: g.conditions.filter((c) => c.id !== cid) }
          : g,
      ),
    });

  const clear = () => setFilter({ mode: "AND", groups: [] });

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sort
        </label>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-border bg-input px-2 py-1 text-xs"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 && (
            <button
              onClick={clear}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-secondary"
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold hover:bg-secondary"
          >
            Filters {activeCount > 0 && <span className="text-accent">({activeCount})</span>}
            {showFilters ? " ▴" : " ▾"}
          </button>
        </div>
      </div>
      {showFilters && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {filter.groups.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Between groups:</span>
              <BoolToggle
                value={filter.mode}
                onChange={(m) => setFilter({ ...filter, mode: m })}
              />
            </div>
          )}
          {filter.groups.map((g) => (
            <div
              key={g.id}
              className="rounded-lg border border-border bg-background/40 p-2"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase text-muted-foreground">
                  Group
                </span>
                <BoolToggle
                  value={g.mode}
                  onChange={(m) => updateGroup(g.id, { mode: m })}
                />
                <button
                  onClick={() => removeGroup(g.id)}
                  className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-primary"
                >
                  Remove group
                </button>
              </div>
              <div className="space-y-1.5">
                {g.conditions.map((c) => (
                  <ConditionRow
                    key={c.id}
                    cond={c}
                    options={options}
                    onChange={(patch) => updateCondition(g.id, c.id, patch)}
                    onRemove={() => removeCondition(g.id, c.id)}
                  />
                ))}
                <button
                  onClick={() => addCondition(g.id)}
                  className="rounded border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-accent hover:text-accent"
                >
                  + condition
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={addGroup}
            className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-accent hover:text-accent"
          >
            + filter group
          </button>
        </div>
      )}
    </div>
  );
}

function BoolToggle({
  value,
  onChange,
}: {
  value: "AND" | "OR";
  onChange: (v: "AND" | "OR") => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-border text-[11px] font-bold">
      {(["AND", "OR"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-2 py-0.5 ${
            value === v ? "bg-accent text-accent-foreground" : "bg-card text-muted-foreground"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function ConditionRow({
  cond,
  options,
  onChange,
  onRemove,
}: {
  cond: FilterCondition;
  options: { types: string[]; abilities: string[]; moves: string[] };
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const list =
    cond.kind === "type"
      ? options.types
      : cond.kind === "ability"
        ? options.abilities
        : options.moves;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <select
        value={cond.kind}
        onChange={(e) => {
          const kind = e.target.value as FilterKind;
          const next =
            kind === "type"
              ? options.types[0]
              : kind === "ability"
                ? options.abilities[0]
                : options.moves[0];
          onChange({ kind, value: next ?? "" });
        }}
        className="rounded border border-border bg-input px-1.5 py-1"
      >
        <option value="type">Type</option>
        <option value="ability">Ability</option>
        <option value="move">Move</option>
      </select>
      <select
        value={cond.value}
        onChange={(e) => onChange({ value: e.target.value })}
        className="min-w-[8rem] flex-1 rounded border border-border bg-input px-1.5 py-1"
      >
        {list.map((v) => (
          <option key={v} value={v}>
            {v.replace(/-/g, " ")}
          </option>
        ))}
      </select>
      <button
        onClick={onRemove}
        className="rounded px-1.5 py-1 text-muted-foreground hover:text-primary"
      >
        ✕
      </button>
    </div>
  );
}