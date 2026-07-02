## Two fixes

### 1. Host missing from draft (bug fix)

In `private.apply_room_action`, the `create` branch inserts the host into `room_players` but never appends them to `rooms.player_order`. Only `join` appends. Result: in a 2-player room, `player_order` contains only the guest, so `RoomDraft` renders one team and treats the guest as the sole drafter.

**Migration:** update `private.apply_room_action` so the `create` branch initializes `player_order` with `[host_id]`:

```sql
INSERT INTO public.rooms (code, host_id, config, player_order)
VALUES (_code, _player_id, COALESCE(_action->'config','{}'::jsonb),
        jsonb_build_array(_player_id::text));
```

No client changes needed — `Lobby`/`RoomDraft` already read `player_order` as the source of truth.

### 2. 24h pruning of rooms and players

`rooms.updated_at` already bumps on every action, and `room_players.room_code` has `ON DELETE CASCADE` to `rooms`, so deleting stale rooms also cleans up their players.

**Migration:** create a small SQL cleanup function + enable `pg_cron`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION private.prune_stale_rooms()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.rooms WHERE updated_at < now() - interval '24 hours';
$$;
```

**Schedule (via `supabase--insert`, not migration — user-specific cron state):**

```sql
SELECT cron.schedule(
  'prune-stale-rooms',
  '0 * * * *',  -- hourly
  $$ SELECT private.prune_stale_rooms(); $$
);
```

Pure SQL, no HTTP call needed — cheapest option.

### Notes

- Uses `updated_at` (not `created_at`) so an active 30-hour draft isn't wiped out mid-game; only truly idle rooms get pruned.
- `room_players` disappears automatically via the existing FK cascade — no separate cleanup needed.
- If you'd prefer a shorter (e.g. 6h idle) or longer window, say the number and I'll swap the interval.
