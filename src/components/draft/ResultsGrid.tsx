import { useState } from "react";
import type { DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";
import { PoolCard } from "./PoolCard";
import { TeamPlanner } from "./TeamPlanner";

export type ResultsPlayer = { id: string; label: string; team: DraftEntry[] };

export function ResultsGrid({
  players,
  unpicked,
  selfId,
}: {
  players: ResultsPlayer[];
  unpicked: DraftEntry[];
  selfId?: string | null;
}) {
  // Which form (base/Mega/alt) is currently being viewed, per drafted
  // entry id — shared across every team's cards (entry ids are unique
  // across the whole pool) so the planner reads the exact same active
  // forms the cards are currently showing.
  const [formIndex, setFormIndex] = useState<Map<string, number>>(() => new Map());
  // 4 move slots per drafted entry, lifted up here (not owned by the
  // planner's carousel) specifically so they persist while browsing other
  // teams — you can set up move slots for every team, not just whichever
  // one is currently in view.
  const [moveSlots, setMoveSlots] = useState<Map<string, string[]>>(() => new Map());

  function setForm(entry: DraftEntry, idx: number) {
    setFormIndex((m) => {
      const next = new Map(m);
      next.set(entry.id, idx);
      return next;
    });
  }

  function setMoveSlot(entryId: string, slotIdx: number, moveSlug: string) {
    setMoveSlots((m) => {
      const next = new Map(m);
      const current = next.get(entryId) ?? ["", "", "", ""];
      const updated = current.slice();
      updated[slotIdx] = moveSlug;
      next.set(entryId, updated);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {players.map((p, idx) => (
          <div key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-bold">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
                  {idx + 1}
                </span>
                {p.label}
              </h3>
              <span className="text-[11px] text-muted-foreground">{p.team.length}/6</span>
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
                    showTypeBadges={false}
                    formIdx={formIndex.get(e.id) ?? 0}
                    onSelectForm={(fi) => setForm(e, fi)}
                  />
                );
              })}
            </div>
            <div className="mt-2 truncate text-center text-[11px] text-muted-foreground">
              {p.team.map((e) => e.name).join(" · ")}
            </div>
          </div>
        ))}
      </div>

      {players.some((p) => p.team.length > 0) && (
        <TeamPlanner
          players={players}
          selfId={selfId ?? null}
          formIndex={formIndex}
          moveSlots={moveSlots}
          setMoveSlot={setMoveSlot}
        />
      )}

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
