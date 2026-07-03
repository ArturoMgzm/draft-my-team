import { useState } from "react";
import type { DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";
import { PoolCard } from "./PoolCard";
import { TeamPlanner } from "./TeamPlanner";

export function ResultsGrid({
  players,
  unpicked,
}: {
  players: { id: string; label: string; team: DraftEntry[] }[];
  unpicked: DraftEntry[];
}) {
  // Which form (base/Mega/alt) is currently being viewed, per drafted
  // entry id — shared across every team's cards (entry ids are unique
  // across the whole pool) so the planner can read the exact same active
  // forms the cards are currently showing, rather than guessing its own.
  const [formIndex, setFormIndex] = useState<Map<string, number>>(() => new Map());
  // Only one team's planner is open at a time.
  const [plannerTeamId, setPlannerTeamId] = useState<string | null>(null);

  function setForm(entry: DraftEntry, idx: number) {
    setFormIndex((m) => {
      const next = new Map(m);
      next.set(entry.id, idx);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p, idx) => {
          const plannerOpen = plannerTeamId === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border border-border bg-card p-4 shadow ${
                plannerOpen ? "sm:col-span-2 lg:col-span-3" : ""
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-base font-bold">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
                    {idx + 1}
                  </span>
                  {p.label}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">{p.team.length}/6</span>
                  {p.team.length > 0 && players.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setPlannerTeamId(plannerOpen ? null : p.id)}
                      title="Resistance & coverage planner"
                      className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                        plannerOpen
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-border bg-background/40 text-muted-foreground hover:border-accent/50 hover:text-accent"
                      }`}
                    >
                      📋 Planner
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => {
                  const e = p.team[i];
                  if (!e) {
                    return (
                      <div
                        key={i}
                        className="aspect-[3/4.2] rounded-xl border border-dashed border-border/40 bg-background/20"
                      />
                    );
                  }
                  return (
                    <PoolCard
                      key={e.id}
                      entry={e}
                      pickable={false}
                      showStats
                      formIdx={formIndex.get(e.id) ?? 0}
                      onSelectForm={(fi) => setForm(e, fi)}
                    />
                  );
                })}
              </div>
              <div className="mt-2 truncate text-center text-[11px] text-muted-foreground">
                {p.team.map((e) => e.name).join(" · ")}
              </div>
              {plannerOpen && (
                <TeamPlanner
                  myTeam={p.team}
                  opponents={players.filter((o) => o.id !== p.id)}
                  formIndex={formIndex}
                  onClose={() => setPlannerTeamId(null)}
                />
              )}
            </div>
          );
        })}
      </div>
      {unpicked.length > 0 && (
        <details className="rounded-xl border border-border bg-card/40 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
            Unpicked pool ({unpicked.length})
          </summary>
          <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {unpicked.map((e) => (
              <div
                key={e.id}
                className={`aspect-square rounded-md border border-border/40 bg-background/40 p-1 ${
                  e.shiny ? "shiny-frame !border-transparent" : ""
                }`}
                title={e.name}
              >
                <HoverSprite entry={e} className="h-full w-full object-contain" />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
