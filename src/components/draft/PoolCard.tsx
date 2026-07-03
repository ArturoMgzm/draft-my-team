import { useEffect, useState } from "react";
import { fetchPokemon, type PokemonData } from "@/lib/pokeapi";
import { getFormOptions, getFormSlugs, type DraftEntry } from "@/lib/draft-engine";
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

// Traditional competitive stat abbreviations, in standard display order.
const STAT_ROWS: { key: keyof PokemonData["stats"]; label: string }[] = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "ATK" },
  { key: "defense", label: "DEF" },
  { key: "specialAttack", label: "SPA" },
  { key: "specialDefense", label: "SPD" },
  { key: "speed", label: "SPE" },
];

// Visual scale cap for the bars. 255 is the theoretical max base stat, but
// real-world stats rarely approach it — capping lower keeps typical values
// (40-150ish) readable instead of every bar looking tiny.
const STAT_SCALE_MAX = 180;

function StatBars({ stats }: { stats: PokemonData["stats"] }) {
  return (
    <div className="flex w-full flex-col gap-1">
      {STAT_ROWS.map(({ key, label }) => {
        const value = stats[key];
        const pct = Math.min(100, Math.round((value / STAT_SCALE_MAX) * 100));
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-7 shrink-0 text-[9px] font-bold tabular-nums text-muted-foreground">
              {label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right text-[9px] tabular-nums text-foreground">
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Shortens a full mega name for the compact card badge: "Mega Charizard X"
// -> "Mega X", "Mega Abomasnow" -> "Mega" (no X/Y suffix to show).
function shortMegaLabel(fullName: string): string {
  const m = fullName.match(/\s([A-Z])$/);
  return m ? `Mega ${m[1]}` : "Mega";
}

export function PoolCard({
  entry,
  disabled,
  onClick,
  showStats,
  formIdx = 0,
  onSelectForm,
  pickable = true,
  showTypeBadges = true,
}: {
  entry: DraftEntry;
  /** Only meaningful when pickable (default true). */
  disabled?: boolean;
  /** Only needed when pickable (default true). */
  onClick?: () => void;
  showStats?: boolean;
  /** Index into getFormSlugs(entry) for the form currently being viewed. */
  formIdx?: number;
  /** Called with the next form index when the Mega/Multi badge is clicked. */
  onSelectForm?: (idx: number) => void;
  /** False for a view-only card (e.g. final team roster): still supports
   * form toggling and right-click-to-flip stats, but no pick action and no
   * "can't pick this" dimming. */
  pickable?: boolean;
  /** False to hide the front-face type badges — used on the final team
   * roster where 6+ cards per team get visually busy; right-click still
   * flips to the full stats/typing back face. */
  showTypeBadges?: boolean;
}) {
  const forms = getFormSlugs(entry);
  const formOptions = getFormOptions(entry);
  const hasFormSwitch = forms.length > 1 && !!onSelectForm;
  const activeSlug = forms[Math.min(formIdx, forms.length - 1)] ?? entry.slug;
  const isAltForm = formIdx > 0;
  const isDisabled = pickable && !!disabled;

  const [flipped, setFlipped] = useState(false);
  const [dataBySlug, setDataBySlug] = useState<Map<string, PokemonData | null>>(() => new Map());

  useEffect(() => {
    let active = true;
    setDataBySlug(new Map());
    Promise.all(forms.map(async (s) => [s, await fetchPokemon(s)] as const)).then((pairs) => {
      if (!active) return;
      setDataBySlug(new Map(pairs));
    });
    return () => {
      active = false;
    };
    // forms is derived from entry — re-fetch only when the entry itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const data = dataBySlug.get(activeSlug) ?? null;
  const displayName = formOptions[formIdx]?.name ?? entry.name;

  function cycleForm() {
    if (!hasFormSwitch) return;
    onSelectForm!((formIdx + 1) % forms.length);
  }

  return (
    <div
      className={`group relative aspect-[3/4.2] w-full rounded-xl border p-2 transition ${
        entry.shiny ? "shiny-frame !border-transparent" : "bg-card"
      } ${
        !pickable
          ? "border-border hover:border-accent/60"
          : isDisabled
            ? "border-border/40 opacity-40"
            : "border-border hover:-translate-y-0.5 hover:border-accent hover:shadow-lg hover:shadow-accent/10"
      }`}
      style={{ perspective: "1000px" }}
    >
      {/* Badges live in their own layer, stacked above the flip card, and are
          never nested inside the pick button below — so there's no shared
          ancestor click/transform to race against. */}
      {entry.isMega && (
        <button
          type="button"
          onClick={cycleForm}
          disabled={!hasFormSwitch}
          title={
            hasFormSwitch
              ? `Click to cycle: ${formOptions.map((f) => f.name).join(" → ")}`
              : undefined
          }
          className={`absolute right-1.5 top-1.5 z-10 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-foreground ${
            hasFormSwitch
              ? "cursor-pointer ring-1 ring-accent-foreground/0 hover:brightness-110 hover:ring-accent-foreground/40"
              : ""
          }`}
        >
          {isAltForm ? `${shortMegaLabel(formOptions[formIdx]?.name ?? "Mega")} ✓` : "Mega"}
        </button>
      )}
      {entry.multiForm && (
        <button
          type="button"
          onClick={cycleForm}
          disabled={!hasFormSwitch}
          title={hasFormSwitch ? "Click to cycle forms" : undefined}
          className={`absolute left-1.5 top-1.5 z-10 rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground ${
            hasFormSwitch
              ? "cursor-pointer ring-1 ring-foreground/0 hover:text-foreground hover:ring-foreground/30"
              : ""
          }`}
        >
          Multi {forms.length > 1 ? `${formIdx + 1}/${forms.length}` : ""}
        </button>
      )}
      {entry.shiny && (
        <span className="absolute right-1.5 bottom-1.5 z-10 text-sm" title="Shiny — 1 in 4096!">
          ✨
        </span>
      )}

      {/* Pick + flip surface. Sits beneath the badge layer (z-0) and never
          contains the badge buttons, so badge clicks can't bubble into it. */}
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => {
          if (!pickable) return;
          if (flipped) return;
          onClick?.();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setFlipped((f) => !f);
        }}
        title="Right-click to flip"
        className={`relative z-0 flex h-full w-full flex-col items-center text-left ${
          !pickable ? "cursor-default" : isDisabled ? "cursor-not-allowed" : "cursor-pointer"
        }`}
        style={{
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: "transform 0.5s",
          transformStyle: "preserve-3d",
        }}
      >
        {/* Front face */}
        <div
          className="absolute inset-0 flex flex-col items-center"
          style={{ backfaceVisibility: "hidden" }}
        >
          <div className="flex aspect-square w-full items-center justify-center">
            <HoverSprite
              entry={entry}
              activeIndex={formIdx}
              className="h-full w-full object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)] transition-transform group-hover:scale-105"
            />
          </div>
          <div className="mt-1 w-full text-center">
            <div className="truncate text-xs font-bold">{displayName}</div>
            {showTypeBadges && (
              <div className="mt-1 flex flex-wrap justify-center gap-1">
                {data?.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </div>
            )}
            {showStats && data && (
              <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                BST {data.bst}
              </div>
            )}
          </div>
        </div>

        {/* Back face — base stats for the currently viewed form */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-0.5"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <div className="w-full truncate text-center text-xs font-bold">{displayName}</div>
          {data ? (
            <>
              <StatBars stats={data.stats} />
              <div className="text-[10px] tabular-nums text-muted-foreground">BST {data.bst}</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">Loading…</div>
          )}
        </div>
      </button>
    </div>
  );
}
