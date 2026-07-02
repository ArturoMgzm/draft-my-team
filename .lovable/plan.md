# Draft-aware Damage Calculator (Champions Reg M-B)

A collapsible right-side sidebar on the draft page. Uses `@smogon/calc` as the damage engine, but overrides stat calculation to match Champions' SP system (no EVs, no IVs, no natures). Pool is restricted to what the current draft is working with.

## Behavior

- **Trigger.** New "Calculator" button in the draft top bar. Opens a right sidebar (shadcn `Sidebar` side="right", collapsible). Works in Solo and Room modes; sidebar is local-only (does not sync to other players).
- **Scope.** Attacker/Defender dropdowns list only entries from `room.pool` (or Solo pool). Includes picked and unpicked entries and preserves Mega/regional/gender forms exactly as they appear in the pool.
- **Layout inside the sidebar.**
  1. **Attacker card** — species picker, ability (dropdown of that species' abilities), item (Champions item list, see below), Tera type, SP allocation (see below), status.
  2. **Defender card** — same fields.
  3. **Field bar** — Doubles by default, weather, terrain, screens (Reflect/Light Screen/Aurora Veil), Tailwind, hazards on defender side.
  4. **Move rows** — 4 slots per attacker, populated from the species' Champions-legal move list (already cached in `pokeapi.ts`). Each row shows damage %, min/max rolls, and OHKO/2HKO odds vs. the current defender.
  5. **Reverse button** — swap attacker/defender to quickly check both sides.

## Champions stat rules (research summary)

- Fixed **Level 50**, **perfect IVs** (all 31), **no natures**.
- Stat Points (SP) replace EVs. **Cap: 66 total, max 32 in any one stat.**
- Doubles format; spread moves apply the standard 0.75× multiplier.
- Held items exist but are a curated subset — we'll hardcode a Champions item list in `src/lib/champions-items.ts` (Life Orb, Choice Band/Specs/Scarf, Assault Vest, Leftovers, Sitrus Berry, Focus Sash, etc.). Same pattern as `pokemon-pool.ts`. The exact list is a follow-up detail; the calc engine already knows what each item does, we just filter which ones the dropdown offers.
- Mega evolution is in-battle; the sidebar exposes a "Mega evolve" toggle on any species whose pool entry has a `mega` slug — when on, the calc uses the mega form's base stats and ability.

## Engine strategy

- Install `@smogon/calc` and use its Gen 9 module.
- Do **not** rely on its default EV/IV/nature stat calc. Compute final stats ourselves from base stats + SP using the mainline formula with EV≡SP·k and IV=31, nature=neutral, then pass raw stats via the `Pokemon` constructor's `stats` override. This means the SP system stays isolated in one helper (`src/lib/champions-stats.ts`) and everything downstream — abilities, items, weather, crits, spread, Tera — runs through the reference implementation unchanged.
- Ability/item/move dropdowns are filtered client-side to the Champions-legal sets; the engine still evaluates their effects normally.
- Tree-shake to Gen 9 only, and lazy-load the whole `/calc` sidebar chunk so the draft page's initial bundle isn't affected.

## Complexity

- **Small:** engine wiring, sidebar shell, dropdowns populated from existing caches.
- **Medium:** SP allocator UI (six sliders + running total + per-stat cap), the Champions item list curation, mega-form toggle wiring.
- **Larger unknowns (deferred, not blocking a first cut):** exact SP-to-stat conversion constant, exact final item list, whether Champions changes any specific ability/move interaction vs. SV. These get placeholder-safe defaults now and can be tuned in a follow-up once you confirm.

## Files

- **New:** `src/lib/champions-stats.ts`, `src/lib/champions-items.ts`, `src/components/calc/CalcSidebar.tsx`, `src/components/calc/PokemonCard.tsx`, `src/components/calc/FieldBar.tsx`, `src/components/calc/MoveRow.tsx`, `src/hooks/useCalc.ts`.
- **Touched:** `src/routes/index.tsx` (mount the sidebar in both `SoloDraft` and `RoomDraft` shells + a toggle button), `src/components/draft/RoomDraft.tsx` and Solo equivalent (top-bar button), `package.json` (`@smogon/calc`).
- **Untouched:** DB schema, room sync, existing draft engine, PokéAPI cache.

## Out of scope for v1

- Team-wide "what threatens my team" matrix (Pikalytics-style). Doable later on top of the same engine once the single-matchup calc is solid.
- Persisting SP spreads per Pokémon across sessions.
- Sharing the calc state between players in a room.
