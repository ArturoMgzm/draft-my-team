// ============================================================
// Regulation registry
// ============================================================
//
// A "regulation" is a self-contained rule set: its legal Pokémon pool, its
// legal held-item list, and metadata. Each regulation lives in its OWN
// standalone JSON manifest (reg-*.json) — a complete, independently
// readable/editable list with no cross-references to any other regulation.
// The app can play under any registered regulation, and old ones never
// disappear: once added they stay selectable forever, just marked "legacy"
// when a newer one supersedes them.
//
// Why this needs no database migration: a regulation is pure client-side
// data. The server only ever receives the *resolved* pool array at draft
// start (stored by value in rooms.pool), and the chosen regulation id rides
// along in the existing rooms.config jsonb. So changing or retiring a
// regulation's definition never breaks drafts that already started — their
// pool is frozen in the row — and adding one needs no schema change.
//
// To add a new regulation:
//   1. Create src/lib/regulations/reg-xx.json with the shape below (id,
//      name, longName, formatLabel, status, pool[], items[]). It's a full
//      standalone manifest — copy an existing one as a starting point and
//      edit the lists.
//   2. Import it and add it to MANIFESTS below.
//   3. Flip the previous "current" entry's "status" to "legacy" in its JSON
//      if it's been superseded.
// Nothing else in the app needs to change.

import type { ItemGroup } from "@/lib/champions-items";
import type { PokemonSpecies } from "@/lib/pokemon-pool";
import regMbJson from "@/lib/regulations/reg-mb.json";
import regMaJson from "@/lib/regulations/reg-ma.json";

export type RegulationStatus = "current" | "legacy";

export type Regulation = {
  /** Stable id stored in config (never change once shipped). */
  id: string;
  /** Short label, e.g. "Reg M-B". */
  name: string;
  /** Longer descriptor shown in menus, e.g. "Regulation M-B". */
  longName: string;
  /** The game/format line shown under the calculator header, etc. */
  formatLabel: string;
  /** "current" regs are surfaced first; "legacy" stay selectable below. */
  status: RegulationStatus;
  /** Legal species pool. */
  pool: PokemonSpecies[];
  /** Legal held items, grouped for the item picker. */
  items: ItemGroup[];
};

// Each manifest is a plain-data JSON file; assert to the Regulation shape.
// (JSON can't carry TS literal types, so `status` widens to string on
// import — the cast re-narrows it. Keep each JSON "status" to exactly
// "current" | "legacy".)
const MANIFESTS = [regMbJson, regMaJson] as unknown as Regulation[];

// Order matters: earlier entries render first within their status group.
// The first "current" regulation is the app-wide default (see
// DEFAULT_REGULATION_ID).
export const REGULATIONS: Regulation[] = MANIFESTS;

// The default regulation for new drafts: the first "current" one, falling
// back to the first registered regulation if none are marked current.
export const DEFAULT_REGULATION_ID =
  REGULATIONS.find((r) => r.status === "current")?.id ?? REGULATIONS[0].id;

const REG_BY_ID = new Map(REGULATIONS.map((r) => [r.id, r]));

// Resolves a regulation id to its definition, always returning *something*
// valid — an unknown/missing id (e.g. an old config, or a regulation removed
// from code) falls back to the default rather than crashing.
export function getRegulation(id: string | undefined): Regulation {
  if (id) {
    const found = REG_BY_ID.get(id);
    if (found) return found;
  }
  return REG_BY_ID.get(DEFAULT_REGULATION_ID) ?? REGULATIONS[0];
}
