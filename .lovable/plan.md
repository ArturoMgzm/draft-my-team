## Pokémon Champions Draft — v2 Plan

A refactor of the single-roll randomizer into an interactive shared-pool drafter with per-player teams, pick history, and richer form/mega controls.

### 1. Data model changes (`src/lib/pokemon-pool.ts`)

- Drop inline mega entries from `REG_MB_POOL`. Keep one entry per base species.
- Add an optional `forms?: { name: string; slug: string }[]` field for species with notable variants. Seed entries for: Ninetales (Kantonian/Alolan), Meowstic (Male/Female), Lycanroc (Midday/Midnight/Dusk), Basculegion (Male/Female), Tauros (Combat/Blaze/Aqua Paldean), Rotom (Normal/Heat/Wash/Frost/Fan/Mow), Maushold (Family of Three/Four), Palafin (Zero/Hero), Aegislash (Shield/Blade), Morpeko (Full Belly/Hangry).
- Export a separate `REG_MB_MEGAS: { name: string; baseSlug: string }[]` list (same set as today's mega entries) — sprites still pulled from base slug per the “show base forms” rule, but tagged `isMega: true`.

### 2. Configuration panel (pre-roll)

Inputs:
- Players (1–8)
- Extra options N (0–50)
- Megas in pool (0–N, capped by `REG_MB_MEGAS.length`)
- Pick order: **Sequential** (1,2,3,1,2,3…) or **Snake** (1,2,3,3,2,1,1,2,3…)
- Forms toggle: **Split forms** (each variant is its own pick, one variant max per species per player) vs **Unified** (one entry, labeled “Multiple forms”)
- "Roll Draft" button — generates the shared pool: `players × 6 + extras` total picks, with exactly `megas` mega entries mixed in, drawn from the configured base/forms expansion.

### 3. Drafting UI

Layout becomes two-column on ≥md:

```text
┌─────────────────┬────────────────────────────────────┐
│  Teams sidebar  │  Shared pool grid                  │
│  Player 1 (active)                                   │
│  [sprite][sprite]…                                   │
│  Player 2                                            │
│  [sprite]…                                           │
└─────────────────┴────────────────────────────────────┘
```

- **Sidebar (left)**: one card per player. Editable username input (placeholder `Player N`). Active player highlighted. Up to 6 sprite slots underneath; click a picked sprite to un-pick it (returns to pool). Click a player card to make them the active picker (out-of-order picks).
- **Pool grid (right)**: shows remaining undrafted entries. Click a card to assign it to the active player. Cards disabled when: active player has 6, or (split-forms mode) active player already owns another form of the same species. Mega entries show a “Mega” badge but render the base sprite/types.
- **Turn indicator**: shows whose turn it is next based on pick-order rule, advancing automatically after a pick unless the user clicked a different player.
- **Reset / Re-roll** buttons in header.

### 4. Pick-order logic

- Sequential: `nextPlayer = (totalPicks % players)`.
- Snake: round `r = floor(picks / players)`, position `p = picks % players`; player is `p` on even rounds, `players - 1 - p` on odd rounds.
- When the user manually selects a player, that player becomes active for the next pick; subsequent auto-advance resumes from the natural order based on total picks count.

### 5. Form handling

- Split-forms ON: pool expansion replaces a species entry with one entry per form (sharing a `speciesKey`). Per-player constraint: one entry per `speciesKey`.
- Split-forms OFF: species with `forms` render a single entry with `(Multiple forms)` subtitle; sprite uses the base slug.

### 6. Files touched

- `src/lib/pokemon-pool.ts` — remove mega entries, add `forms` data + `REG_MB_MEGAS`.
- `src/lib/pokeapi.ts` — unchanged.
- `src/routes/index.tsx` — full rewrite of `DraftPage` for the new flow (config screen, sidebar, pool grid, undo, manual player select).
- `src/styles.css` — minor: add an `--active-player` ring color if not already covered by `--accent`.

### Out of scope

- Persisting drafts across reloads.
- Real multi-user (still a single device, manual turn-taking).
- Drag-and-drop reordering of team slots.
