# Plan: Multiplayer Rooms + Sort/Filter + Cache Expansion

Big chunk of work. Splitting into three areas. Confirming scope before writing ~1000 lines of code.

## 1. Expand PokéAPI cache (foundation for sort/filter)

Extend `PokemonData` and the `/pokemon/{slug}` fetch to also persist:
- `stats`: `{ hp, attack, defense, specialAttack, specialDefense, speed }` (base_stat only, EVs dropped)
- `bst`: sum of the six stats
- `abilities`: `string[]` (names only, hidden flag kept as separate `hiddenAbilities`)
- `moves`: `string[]` — only moves whose `version_group_details[].version_group.name === "champions"`

Bumps cache prefix to `v3` so old entries get rebuilt once. No new endpoints (`/pokemon/{slug}` already returns all of this).

## 2. Sort + Filter UI (works in both solo and room modes, applies only to "remaining pool")

New `SortFilterBar` above the pool grid.

**Sort:** dropdown — Default (roll order), Alphabetical, BST, HP, Attack, Defense, Sp. Atk, Sp. Def, Speed, Type (groups by primary type).

**Filter:** filter-group builder.
- Top-level mode: `AND` / `OR` between groups
- Each group: mode `AND`/`OR` + list of conditions
- Condition: `{ kind: "type" | "ability" | "move", value: string }`
- "Add group" / "Add condition" / remove buttons
- Ability and move pickers are searchable comboboxes populated from the cached data of currently-loaded pool entries (so the dropdown is bounded by the actual pool, not the whole API).

Pool grid renders two sections when any filter is active:
- "Matches filters" (top)
- "Other pokémon" (bottom, collapsible)

Both sections share the same card component and respect the sort. Picked pokémon are still removed from both.

## 3. Multiplayer Rooms

### Mode switcher on the config screen
Three buttons at the top of the config: **Solo**, **Host Room**, **Join Room**.
- Solo: unchanged.
- Host Room: generates a 5-char A–Z 0–9 code; host edits the same config panel; lobby opens.
- Join Room: prompts for code; opens lobby with read-only config view.

Everyone (including host) is prompted for a username on entry.

### Backend (Lovable Cloud)

Tables (all GRANTed to `anon` + `authenticated` since this is anon-by-code, with `service_role` for the writer fn):

- `draft_rooms`
  - `id uuid pk`, `code text unique` (5 chars, indexed), `host_id uuid` (client-generated UUID stored in localStorage as the "device id"), `config jsonb`, `status text` (`lobby`|`drafting`|`complete`), `seed text`, `pool jsonb` (rolled `DraftEntry[]`), `picks jsonb` (`{playerId, entryId, ts}[]`), `order uuid[]` (player ids in turn order), `host_overrides_enabled bool`, `created_at`, `updated_at`
- `draft_players`
  - `id uuid pk` (client device id), `room_id uuid fk`, `username text`, `is_host bool`, `joined_at`

Realtime: subscribe to `draft_rooms` row + `draft_players` for the room.

### Writes via a single server function `applyRoomAction`
(Already noted in security memory — room code is the access token; no auth.)

Actions:
- `create_room(config, host)` → returns `{code, roomId, hostId}`
- `join_room(code, playerId, username)`
- `update_username(playerId, username)`
- `leave_room(playerId)`
- `update_config(hostId, patch)` (lobby only)
- `reorder_players(hostId, order[])`
- `randomize_order(hostId)`
- `kick_player(hostId, targetId)`
- `start_draft(hostId)` (rolls pool, locks)
- `cancel_draft(hostId)` → back to lobby
- `make_pick(playerId, entryId)` — must be active player's turn (or host w/ override)
- `undo_pick(hostId)` — only if host_overrides_enabled
- `override_active_player(hostId, playerId)` — only if host_overrides_enabled
- `toggle_host_overrides(hostId, bool)`
- `redraft(hostId)` — re-rolls pool, clears picks, keeps players + order

Server fn validates host-only actions by `hostId === room.host_id`. RLS denies direct table writes; reads allowed by `code` (anon SELECT scoped via policy `using (true)` since the code is the secret).

### Room UI

**Lobby view** (host):
- Big code display, copy-to-clipboard
- Player list with drag-handle reorder (use simple up/down arrows for v1 — faster to ship, no dnd lib) + "randomize order" button + kick button per player
- Config panel (same component as solo, editable)
- "Host overrides enabled" switch
- Start button (disabled until ≥2 players)
- Cancel room

**Lobby view** (player):
- Code display
- Read-only config summary
- Editable own username
- Player list (read-only)
- "Waiting for host…"

**Drafting view**: same layout as solo, but:
- Sidebar shows real usernames; active highlight from server `order[currentPickIndex]`
- Pool clicks open a **confirm dialog** ("Draft Charizard?" → Confirm / Cancel) before issuing `make_pick`
- Cards only clickable on your turn (or host if overrides on)
- Sidebar player rows only clickable for host w/ overrides on
- Undo (sprite click) only enabled for host w/ overrides on
- "Host overrides" switch visible to host during draft

**Complete view**: full-width grid of player teams (username + 6 sprites each), and below it a collapsible "Unpicked pool". Host sees a "Redraft (same players)" button.

### Solo mode

Unchanged behaviorally. All the existing turn/undo/active-override logic stays. Sort/filter applies. Confirm dialog is room-mode only.

## File structure

```text
src/lib/
  pokeapi.ts                      [expanded shape, v3 cache]
  draft-engine.ts                 [pure rollPool + types extracted from index.tsx]
  sort-filter.ts                  [sort + filter-group evaluator]
  room-client.ts                  [client wrapper around applyRoomAction + realtime sub]
  room.functions.ts               [createServerFn applyRoomAction]
  room.server.ts                  [DB helpers using supabaseAdmin]
src/components/draft/
  HoverSprite.tsx                 [extracted]
  PoolCard.tsx                    [extracted]
  TeamSlot.tsx                    [extracted]
  ConfigPanel.tsx                 [extracted, used in both solo + lobby]
  SortFilterBar.tsx               [new]
  PoolGrid.tsx                    [renders matches/non-matches sections]
  Sidebar.tsx                     [player teams]
  ConfirmPickDialog.tsx           [new, room only]
  Lobby.tsx                       [new]
  ResultsGrid.tsx                 [new, final teams view]
src/hooks/
  useRoom.ts                      [subscribe + actions]
src/routes/
  index.tsx                       [mode switcher; renders Solo / Host / Join]
supabase/migrations/
  <ts>_draft_rooms.sql
```

## Open questions before I build

1. **Drag-and-drop vs arrows for player ordering** — I'll ship arrows (↑/↓ per row) + a "Randomize" button. Faster, no extra dep. OK?
2. **Persistence of device identity** — I'll store a generated UUID in `localStorage` ("draft:deviceId") and use it as `player.id` / `host.id`. Reconnecting with the same browser keeps your seat. OK?
3. **Inactivity / disconnect handling** — out of scope for v1; players stay in the room until the host kicks them.
4. **Sort "Type"** — sorts by primary type alphabetically. OK?

Anything to adjust before I start writing?
