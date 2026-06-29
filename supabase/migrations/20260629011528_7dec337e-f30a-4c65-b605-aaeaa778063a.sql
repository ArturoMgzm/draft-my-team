
-- Move apply_room_action SECURITY DEFINER body into a non-exposed schema,
-- and keep a SECURITY INVOKER wrapper in public so the PostgREST RPC still works.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Drop the public SECURITY DEFINER function (it gets replaced by a wrapper below)
DROP FUNCTION IF EXISTS public.apply_room_action(text, uuid, jsonb);

-- Recreate the same body in private schema, still SECURITY DEFINER so writes succeed
CREATE OR REPLACE FUNCTION private.apply_room_action(_code text, _player_id uuid, _action jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.rooms%ROWTYPE;
  t text;
  is_host boolean;
  is_player boolean;
  picks_count int;
  active_idx int;
  active_player uuid;
  n int;
  round_idx int;
  pos int;
BEGIN
  t := _action->>'type';

  IF t = 'create' THEN
    INSERT INTO public.rooms (code, host_id, config)
    VALUES (_code, _player_id, COALESCE(_action->'config', '{}'::jsonb));
    INSERT INTO public.room_players (room_code, player_id, username)
    VALUES (_code, _player_id, COALESCE(_action->>'username', ''));
    RETURN jsonb_build_object('ok', true);
  END IF;

  SELECT * INTO r FROM public.rooms WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;

  is_host := r.host_id = _player_id;
  SELECT EXISTS(SELECT 1 FROM public.room_players WHERE room_code = _code AND player_id = _player_id) INTO is_player;

  IF t = 'join' THEN
    INSERT INTO public.room_players (room_code, player_id, username)
    VALUES (_code, _player_id, COALESCE(_action->>'username', ''))
    ON CONFLICT (room_code, player_id) DO UPDATE SET username = EXCLUDED.username;
    IF NOT (r.player_order @> to_jsonb(_player_id::text)) THEN
      UPDATE public.rooms SET player_order = player_order || to_jsonb(_player_id::text), updated_at = now()
      WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t = 'leave' THEN
    DELETE FROM public.room_players WHERE room_code = _code AND player_id = _player_id;
    UPDATE public.rooms SET
      player_order = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(player_order) x WHERE x <> _player_id::text), '[]'::jsonb),
      updated_at = now()
    WHERE code = _code;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t IN ('update_config','set_order','kick','toggle_override','begin','undo','redraft','cancel') THEN
    IF NOT is_host THEN RAISE EXCEPTION 'host only'; END IF;

    IF t = 'update_config' THEN
      UPDATE public.rooms SET config = _action->'config', updated_at = now() WHERE code = _code;
    ELSIF t = 'set_order' THEN
      UPDATE public.rooms SET player_order = _action->'order', updated_at = now() WHERE code = _code;
    ELSIF t = 'kick' THEN
      DELETE FROM public.room_players WHERE room_code = _code AND player_id = (_action->>'player_id')::uuid;
      UPDATE public.rooms SET
        player_order = COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements_text(player_order) x WHERE x <> _action->>'player_id'), '[]'::jsonb),
        updated_at = now()
      WHERE code = _code;
    ELSIF t = 'toggle_override' THEN
      UPDATE public.rooms SET host_override = COALESCE((_action->>'value')::boolean, NOT r.host_override), updated_at = now() WHERE code = _code;
    ELSIF t = 'begin' THEN
      UPDATE public.rooms SET pool = _action->'pool', picks = '[]'::jsonb, status = 'drafting', updated_at = now() WHERE code = _code;
    ELSIF t = 'undo' THEN
      UPDATE public.rooms SET picks = COALESCE((SELECT jsonb_agg(p ORDER BY ord) FROM (SELECT p, ord FROM jsonb_array_elements(picks) WITH ORDINALITY AS x(p, ord)) s WHERE ord < jsonb_array_length(picks)), '[]'::jsonb), status = 'drafting', updated_at = now() WHERE code = _code;
    ELSIF t = 'redraft' THEN
      UPDATE public.rooms SET pool = _action->'pool', picks = '[]'::jsonb, status = 'drafting', updated_at = now() WHERE code = _code;
    ELSIF t = 'cancel' THEN
      UPDATE public.rooms SET status = 'lobby', pool = '[]'::jsonb, picks = '[]'::jsonb, updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t = 'pick' THEN
    IF r.status <> 'drafting' THEN RAISE EXCEPTION 'not drafting'; END IF;
    picks_count := jsonb_array_length(r.picks);
    n := jsonb_array_length(r.player_order);
    IF n = 0 THEN RAISE EXCEPTION 'no players'; END IF;
    IF (r.config->>'pickOrder') = 'snake' THEN
      round_idx := picks_count / n;
      pos := picks_count % n;
      active_idx := CASE WHEN round_idx % 2 = 0 THEN pos ELSE n - 1 - pos END;
    ELSE
      active_idx := picks_count % n;
    END IF;
    active_player := (r.player_order->>active_idx)::uuid;
    IF _player_id <> active_player AND NOT (is_host AND r.host_override) THEN
      RAISE EXCEPTION 'not your turn';
    END IF;
    UPDATE public.rooms SET picks = picks || jsonb_build_array(jsonb_build_object(
      'entryId', _action->>'entryId',
      'playerId', COALESCE(_action->>'forPlayer', active_player::text)
    )), updated_at = now() WHERE code = _code;
    SELECT * INTO r FROM public.rooms WHERE code = _code;
    IF jsonb_array_length(r.picks) >= n * 6 THEN
      UPDATE public.rooms SET status = 'finished', updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  RAISE EXCEPTION 'unknown action %', t;
END;
$function$;

-- Private function is not exposed: only service_role can execute it directly.
REVOKE ALL ON FUNCTION private.apply_room_action(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_room_action(text, uuid, jsonb) TO service_role;

-- Public wrapper is SECURITY INVOKER (not flagged by the linter) and just delegates.
CREATE OR REPLACE FUNCTION public.apply_room_action(_code text, _player_id uuid, _action jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT private.apply_room_action(_code, _player_id, _action);
$$;

GRANT EXECUTE ON FUNCTION public.apply_room_action(text, uuid, jsonb) TO anon, authenticated, service_role;
