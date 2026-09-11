// Shared type chip. Lives in its own module (rather than in PoolCard, where
// it started) so components PoolCard itself renders — the battle-data modal —
// can use it without creating an import cycle. PoolCard re-exports it, so
// existing `import { TypeBadge } from "./PoolCard"` call sites keep working.

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
