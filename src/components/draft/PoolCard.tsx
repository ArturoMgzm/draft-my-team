import { useEffect, useState } from "react";
import { fetchPokemon } from "@/lib/pokeapi";
import type { DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";

export function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
      style={{ backgroundColor: `var(--type-${type}, var(--muted))` }}
    >
      {type}
    </span>
  );
}

export function PoolCard({
  entry,
  disabled,
  onClick,
  showStats,
}: {
  entry: DraftEntry;
  disabled: boolean;
  onClick: () => void;
  showStats?: boolean;
}) {
  const [data, setData] = useState<{
    types: string[];
    bst: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    fetchPokemon(entry.slug).then((d) => {
      if (!active || !d) return;
      setData({ types: d.types, bst: d.bst });
    });
    return () => {
      active = false;
    };
  }, [entry.slug]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group relative flex flex-col items-center rounded-xl border p-2 text-left transition ${
        entry.shiny ? "shiny-frame !border-transparent" : "bg-card"
      } ${
        disabled
          ? "cursor-not-allowed border-border/40 opacity-40"
          : "border-border hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-accent/10"
      }`}
    >
      {entry.isMega && (
        <span className="absolute right-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-foreground">
          Mega
        </span>
      )}
      {entry.multiForm && (
        <span className="absolute left-1.5 top-1.5 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
          Multi
        </span>
      )}
      {entry.shiny && (
        <span
          className="absolute right-1.5 bottom-1.5 text-sm"
          title="Shiny — 1 in 4096!"
        >
          ✨
        </span>
      )}
      <div className="flex aspect-square w-full items-center justify-center">
        <HoverSprite
          entry={entry}
          className="h-full w-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-105"
        />
      </div>
      <div className="mt-1 w-full text-center">
        <div className="truncate text-xs font-bold">{entry.name}</div>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {data?.types.map((t) => <TypeBadge key={t} type={t} />)}
        </div>
        {showStats && data && (
          <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
            BST {data.bst}
          </div>
        )}
      </div>
    </button>
  );
}