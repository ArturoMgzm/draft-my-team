import type { DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";

export function ResultsGrid({
  players,
  unpicked,
}: {
  players: { id: string; label: string; team: DraftEntry[] }[];
  unpicked: DraftEntry[];
}) {
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
                return (
                  <div
                    key={i}
                    className={`aspect-square rounded-lg border border-border/60 bg-background/40 p-1 ${
                      e?.shiny ? "shiny-frame !border-transparent" : ""
                    }`}
                  >
                    {e && (
                      <div className="relative h-full w-full">
                        <HoverSprite entry={e} className="h-full w-full object-contain" />
                        {e.isMega && (
                          <span className="absolute bottom-0 right-0 rounded-sm bg-accent px-0.5 text-[7px] font-bold uppercase text-accent-foreground">
                            M
                          </span>
                        )}
                        {e.shiny && (
                          <span className="absolute left-0 top-0 text-[10px]">✨</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 truncate text-center text-[11px] text-muted-foreground">
              {p.team.map((e) => e.name).join(" · ")}
            </div>
          </div>
        ))}
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