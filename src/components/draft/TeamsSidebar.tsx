import type { DraftEntry } from "@/lib/draft-engine";
import { HoverSprite } from "./HoverSprite";

export type SidebarPlayer = {
  id: string;
  label: string;
  team: DraftEntry[];
};

export function TeamsSidebar({
  players,
  activeIdx,
  autoIdx,
  draftComplete,
  onSelectPlayer,
  onUnpick,
  onRenamePlayer,
  selectableOverride,
  unpickEnabled,
  banner,
}: {
  players: SidebarPlayer[];
  activeIdx: number;
  autoIdx: number;
  draftComplete: boolean;
  onSelectPlayer?: (i: number) => void;
  onUnpick?: (entryId: string) => void;
  onRenamePlayer?: (i: number, name: string) => void;
  selectableOverride?: boolean; // if false, click does nothing
  unpickEnabled?: boolean; // if false, sprite clicks do nothing
  banner?: React.ReactNode;
}) {
  return (
    <aside className="space-y-3 md:sticky md:top-4 md:self-start">
      <div className="rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
        {banner ??
          (draftComplete ? (
            <span className="font-semibold text-accent">Draft complete!</span>
          ) : (
            <>
              On the clock:{" "}
              <span className="font-semibold text-foreground">
                {players[activeIdx]?.label ?? "—"}
              </span>
              {activeIdx !== autoIdx && (
                <span className="ml-1 text-accent">(out of turn)</span>
              )}
            </>
          ))}
      </div>
      {players.map((p, idx) => {
        const isActive = idx === activeIdx;
        const clickable = selectableOverride ?? true;
        return (
          <div
            key={p.id}
            onClick={() => {
              if (!clickable) return;
              if ((p.team ?? []).length >= 6) return;
              onSelectPlayer?.(idx);
            }}
            className={`rounded-xl border p-3 transition ${
              clickable ? "cursor-pointer" : "cursor-default"
            } ${
              isActive
                ? "border-accent bg-accent/5 shadow-md shadow-accent/10"
                : "border-border bg-card hover:border-accent/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              {onRenamePlayer ? (
                <input
                  type="text"
                  value={p.label}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onRenamePlayer(idx, e.target.value)}
                  className="w-full bg-transparent text-sm font-semibold outline-none focus:underline"
                />
              ) : (
                <span className="w-full truncate text-sm font-semibold">{p.label}</span>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {p.team.length}/6
              </span>
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1">
              {Array.from({ length: 6 }).map((_, slot) => {
                const entry = p.team[slot];
                return (
                  <div
                    key={slot}
                    className="aspect-square rounded-md border border-border/50 bg-background/40"
                  >
                    {entry && (
                      <SlotButton
                        entry={entry}
                        unpickEnabled={unpickEnabled ?? true}
                        onClick={() => onUnpick?.(entry.id)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function SlotButton({
  entry,
  unpickEnabled,
  onClick,
}: {
  entry: DraftEntry;
  unpickEnabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!unpickEnabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!unpickEnabled) return;
        if (confirm(`Remove ${entry.name} from this team?`)) onClick();
      }}
      title={unpickEnabled ? `${entry.name} — click to undo` : entry.name}
      className={`group relative h-full w-full ${entry.shiny ? "shiny-frame" : ""} ${
        unpickEnabled ? "" : "cursor-default"
      }`}
    >
      <div className="relative h-full w-full">
        <HoverSprite
          entry={entry}
          className="h-full w-full object-contain transition group-hover:opacity-50"
        />
      </div>
      {entry.isMega && (
        <span className="absolute bottom-0 right-0 rounded-sm bg-accent px-0.5 text-[7px] font-bold uppercase text-accent-foreground">
          M
        </span>
      )}
      {entry.shiny && (
        <span className="absolute left-0 top-0 text-[9px]" title="Shiny!">
          ✨
        </span>
      )}
      {unpickEnabled && (
        <span className="pointer-events-none absolute inset-0 grid place-content-center text-[10px] font-bold text-primary opacity-0 group-hover:opacity-100">
          ✕
        </span>
      )}
    </button>
  );
}