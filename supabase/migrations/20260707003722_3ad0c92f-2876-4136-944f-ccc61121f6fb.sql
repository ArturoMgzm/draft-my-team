ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS auction jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auction_ends_at timestamptz NULL;

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
  secs int;
  a jsonb;
  amount int;
  my_money int;
  my_picks int;
  allow_overdraft boolean;
  auction_secs int;
  cur_entry text;
  cur_bid int;
  cur_bidder text;
  q jsonb;
  q_len int;
  slots_needed int;
  winner uuid;
  is_random boolean;
  swap_entry text;
  team_size constant int := 6;
  folded jsonb;
  active_bidders int;
  income int;
  pid_txt text;
  pcount int;
  team_size_2 int;
BEGIN
  t := _action->>'type';

  IF t = 'create' THEN
    INSERT INTO public.rooms (code, host_id, config, player_order)
    VALUES (_code, _player_id, COALESCE(_action->'config', '{}'::jsonb), jsonb_build_array(_player_id::text));
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

  IF t IN ('update_config','set_order','kick','toggle_override','begin','undo','redraft','cancel','set_timer') THEN
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
      IF (r.config->>'draftMode') = 'auction' THEN
        a := jsonb_build_object(
          'queue', (SELECT COALESCE(jsonb_agg(e->>'id'), '[]'::jsonb) FROM jsonb_array_elements(_action->'pool') e),
          'current', NULL,
          'bid', 0,
          'bidder', NULL,
          'money', (SELECT COALESCE(jsonb_object_agg(x, COALESCE((r.config->>'startingBudget')::int, 100)), '{}'::jsonb)
                    FROM jsonb_array_elements_text(r.player_order) x),
          'pending_swap', NULL,
          'last', NULL,
          'folded', '[]'::jsonb,
          'pending_reveal', NULL,
          'seq', 0
        );
        a := jsonb_set(a, '{current}', COALESCE(a->'queue'->0, 'null'::jsonb));
        a := jsonb_set(a, '{queue}', COALESCE((SELECT jsonb_agg(v) FROM (SELECT v, ord FROM jsonb_array_elements(a->'queue') WITH ORDINALITY AS x(v, ord) WHERE ord > 1) s), '[]'::jsonb));
        UPDATE public.rooms SET pool = _action->'pool', picks = '[]'::jsonb, status = 'drafting',
          auction = a, auction_ends_at = now() + interval '10 seconds', updated_at = now()
        WHERE code = _code;
      ELSE
        UPDATE public.rooms SET pool = _action->'pool', picks = '[]'::jsonb, status = 'drafting',
          auction = '{}'::jsonb, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
      END IF;
    ELSIF t = 'undo' THEN
      IF (r.config->>'draftMode') = 'auction' THEN RAISE EXCEPTION 'undo not supported in auction mode'; END IF;
      UPDATE public.rooms SET picks = COALESCE((SELECT jsonb_agg(p ORDER BY ord) FROM (SELECT p, ord FROM jsonb_array_elements(picks) WITH ORDINALITY AS x(p, ord)) s WHERE ord < jsonb_array_length(picks)), '[]'::jsonb), status = 'drafting', updated_at = now() WHERE code = _code;
    ELSIF t = 'redraft' THEN
      UPDATE public.rooms SET pool = _action->'pool', picks = '[]'::jsonb, status = 'drafting',
        auction = '{}'::jsonb, auction_ends_at = NULL,
        timer_ends_at = NULL, timer_duration_seconds = NULL, updated_at = now() WHERE code = _code;
      IF (r.config->>'draftMode') = 'auction' THEN
        SELECT * INTO r FROM public.rooms WHERE code = _code;
        a := jsonb_build_object(
          'queue', (SELECT COALESCE(jsonb_agg(e->>'id'), '[]'::jsonb) FROM jsonb_array_elements(_action->'pool') e),
          'current', NULL, 'bid', 0, 'bidder', NULL,
          'money', (SELECT COALESCE(jsonb_object_agg(x, COALESCE((r.config->>'startingBudget')::int, 100)), '{}'::jsonb)
                    FROM jsonb_array_elements_text(r.player_order) x),
          'pending_swap', NULL, 'last', NULL, 'folded', '[]'::jsonb, 'pending_reveal', NULL, 'seq', 0
        );
        a := jsonb_set(a, '{current}', COALESCE(a->'queue'->0, 'null'::jsonb));
        a := jsonb_set(a, '{queue}', COALESCE((SELECT jsonb_agg(v) FROM (SELECT v, ord FROM jsonb_array_elements(a->'queue') WITH ORDINALITY AS x(v, ord) WHERE ord > 1) s), '[]'::jsonb));
        UPDATE public.rooms SET auction = a, auction_ends_at = now() + interval '10 seconds' WHERE code = _code;
      END IF;
    ELSIF t = 'cancel' THEN
      UPDATE public.rooms SET status = 'lobby', pool = '[]'::jsonb, picks = '[]'::jsonb,
        auction = '{}'::jsonb, auction_ends_at = NULL,
        timer_ends_at = NULL, timer_duration_seconds = NULL, updated_at = now() WHERE code = _code;
    ELSIF t = 'set_timer' THEN
      secs := NULLIF(_action->>'seconds', '')::int;
      IF secs IS NULL OR secs <= 0 THEN
        UPDATE public.rooms SET timer_ends_at = NULL, timer_duration_seconds = NULL, updated_at = now() WHERE code = _code;
      ELSE
        UPDATE public.rooms SET timer_ends_at = now() + (secs || ' seconds')::interval,
          timer_duration_seconds = secs, updated_at = now() WHERE code = _code;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t = 'bid' THEN
    IF r.status <> 'drafting' OR (r.config->>'draftMode') <> 'auction' THEN RAISE EXCEPTION 'no auction running'; END IF;
    IF NOT is_player THEN RAISE EXCEPTION 'not in room'; END IF;
    a := r.auction;
    IF a->'pending_swap' <> 'null'::jsonb AND a->'pending_swap' IS NOT NULL THEN RAISE EXCEPTION 'waiting for swap'; END IF;
    IF a->'pending_reveal' <> 'null'::jsonb AND a->'pending_reveal' IS NOT NULL THEN RAISE EXCEPTION 'waiting for reveal'; END IF;
    cur_entry := a->>'current';
    IF cur_entry IS NULL THEN RAISE EXCEPTION 'nothing on the block'; END IF;
    IF r.auction_ends_at IS NULL OR now() >= r.auction_ends_at THEN RAISE EXCEPTION 'auction over'; END IF;
    IF COALESCE(a->'folded', '[]'::jsonb) @> to_jsonb(_player_id::text) THEN RAISE EXCEPTION 'you folded on this one'; END IF;

    amount := NULLIF(_action->>'amount','')::int;
    cur_bid := COALESCE((a->>'bid')::int, 0);
    IF amount IS NULL OR amount < 1 THEN RAISE EXCEPTION 'minimum bid is 1'; END IF;
    IF amount <= cur_bid THEN RAISE EXCEPTION 'bid must be higher than %', cur_bid; END IF;

    my_money := COALESCE((a->'money'->>(_player_id::text))::int, 0);
    IF amount > my_money THEN RAISE EXCEPTION 'not enough money (you have %)', my_money; END IF;

    SELECT count(*) INTO my_picks FROM jsonb_array_elements(r.picks) p WHERE p->>'playerId' = _player_id::text;
    allow_overdraft := COALESCE((r.config->>'allowOverdraft')::boolean, false);
    IF my_picks >= team_size AND NOT allow_overdraft THEN RAISE EXCEPTION 'team is full'; END IF;

    a := jsonb_set(a, '{bid}', to_jsonb(amount));
    a := jsonb_set(a, '{bidder}', to_jsonb(_player_id::text));

    auction_secs := GREATEST(5, COALESCE((r.config->>'auctionTimerSeconds')::int, 30));
    IF cur_bid = 0 THEN
      UPDATE public.rooms SET auction = a, auction_ends_at = now() + (auction_secs || ' seconds')::interval, updated_at = now() WHERE code = _code;
    ELSIF r.auction_ends_at - now() < interval '10 seconds' THEN
      UPDATE public.rooms SET auction = a, auction_ends_at = now() + interval '10 seconds', updated_at = now() WHERE code = _code;
    ELSE
      UPDATE public.rooms SET auction = a, updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true, 'bid', amount);
  END IF;

  IF t = 'fold' THEN
    IF r.status <> 'drafting' OR (r.config->>'draftMode') <> 'auction' THEN RAISE EXCEPTION 'no auction running'; END IF;
    IF NOT is_player THEN RAISE EXCEPTION 'not in room'; END IF;
    a := r.auction;
    cur_entry := a->>'current';
    IF cur_entry IS NULL THEN RAISE EXCEPTION 'nothing on the block'; END IF;
    IF a->'pending_swap' <> 'null'::jsonb AND a->'pending_swap' IS NOT NULL THEN RAISE EXCEPTION 'waiting for swap'; END IF;
    IF a->'pending_reveal' <> 'null'::jsonb AND a->'pending_reveal' IS NOT NULL THEN RAISE EXCEPTION 'waiting for reveal'; END IF;
    IF (a->>'bidder') = _player_id::text THEN RAISE EXCEPTION 'you hold the top bid'; END IF;
    folded := COALESCE(a->'folded', '[]'::jsonb);
    IF NOT (folded @> to_jsonb(_player_id::text)) THEN
      folded := folded || to_jsonb(_player_id::text);
      a := jsonb_set(a, '{folded}', folded);
    END IF;

    allow_overdraft := COALESCE((r.config->>'allowOverdraft')::boolean, false);
    cur_bidder := a->>'bidder';
    active_bidders := 0;
    FOR pid_txt IN SELECT x FROM jsonb_array_elements_text(r.player_order) x LOOP
      IF pid_txt = cur_bidder THEN CONTINUE; END IF;
      IF folded @> to_jsonb(pid_txt) THEN CONTINUE; END IF;
      SELECT count(*) INTO pcount FROM jsonb_array_elements(r.picks) p WHERE p->>'playerId' = pid_txt;
      IF pcount >= team_size AND NOT allow_overdraft THEN CONTINUE; END IF;
      active_bidders := active_bidders + 1;
    END LOOP;

    IF active_bidders = 0 AND cur_bidder IS NOT NULL AND COALESCE((a->>'bid')::int,0) > 0 THEN
      UPDATE public.rooms SET auction = a, auction_ends_at = now(), updated_at = now() WHERE code = _code;
    ELSE
      UPDATE public.rooms SET auction = a, updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true, 'active_bidders', active_bidders);
  END IF;

  IF t = 'ack_reveal' THEN
    IF r.status <> 'drafting' OR (r.config->>'draftMode') <> 'auction' THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;
    a := r.auction;
    IF a->'pending_reveal' IS NULL OR a->'pending_reveal' = 'null'::jsonb THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;

    n := jsonb_array_length(r.player_order);
    SELECT COALESCE(n * team_size - count(*), 0) INTO slots_needed FROM jsonb_array_elements(r.picks);
    q := COALESCE(a->'queue', '[]'::jsonb);
    a := jsonb_set(a, '{pending_reveal}', 'null'::jsonb);
    IF slots_needed <= 0 OR jsonb_array_length(q) = 0 THEN
      a := jsonb_set(a, '{current}', 'null'::jsonb);
      UPDATE public.rooms SET status = 'finished', auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
    ELSE
      a := jsonb_set(a, '{current}', q->0);
      a := jsonb_set(a, '{queue}', COALESCE((SELECT jsonb_agg(v) FROM (SELECT v, ord FROM jsonb_array_elements(q) WITH ORDINALITY AS x(v, ord) WHERE ord > 1) s), '[]'::jsonb));
      a := jsonb_set(a, '{bid}', '0'::jsonb);
      a := jsonb_set(a, '{bidder}', 'null'::jsonb);
      a := jsonb_set(a, '{folded}', '[]'::jsonb);
      UPDATE public.rooms SET auction = a, auction_ends_at = now() + interval '10 seconds', updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t = 'resolve_auction' THEN
    IF r.status <> 'drafting' OR (r.config->>'draftMode') <> 'auction' THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;
    IF NOT is_player THEN RAISE EXCEPTION 'not in room'; END IF;
    a := r.auction;
    IF a->'pending_swap' <> 'null'::jsonb AND a->'pending_swap' IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;
    cur_entry := a->>'current';
    IF cur_entry IS NULL THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;
    IF r.auction_ends_at IS NULL OR now() < r.auction_ends_at THEN RETURN jsonb_build_object('ok', true, 'noop', true); END IF;

    cur_bid := COALESCE((a->>'bid')::int, 0);
    cur_bidder := a->>'bidder';
    q := COALESCE(a->'queue', '[]'::jsonb);
    q_len := jsonb_array_length(q);
    n := jsonb_array_length(r.player_order);
    SELECT COALESCE(n * team_size - count(*), 0) INTO slots_needed FROM jsonb_array_elements(r.picks);

    is_random := false;

    IF cur_bidder IS NOT NULL AND cur_bid > 0 THEN
      winner := cur_bidder::uuid;
      a := jsonb_set(a, ARRAY['money', cur_bidder],
        to_jsonb(GREATEST(0, COALESCE((a->'money'->>cur_bidder)::int, 0) - cur_bid)));
      SELECT count(*) INTO my_picks FROM jsonb_array_elements(r.picks) p WHERE p->>'playerId' = cur_bidder;
      IF my_picks >= team_size THEN
        a := jsonb_set(a, '{pending_swap}', jsonb_build_object('player', cur_bidder, 'won', cur_entry));
        a := jsonb_set(a, '{current}', 'null'::jsonb);
        a := jsonb_set(a, '{bid}', '0'::jsonb);
        a := jsonb_set(a, '{bidder}', 'null'::jsonb);
        a := jsonb_set(a, '{last}', jsonb_build_object('entry', cur_entry, 'player', cur_bidder, 'price', cur_bid, 'random', false, 'skipped', false));
        a := jsonb_set(a, '{seq}', to_jsonb(COALESCE((a->>'seq')::int,0) + 1));
        UPDATE public.rooms SET auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
        RETURN jsonb_build_object('ok', true, 'sold', true, 'overdraft', true);
      END IF;
      UPDATE public.rooms SET picks = picks || jsonb_build_array(jsonb_build_object('entryId', cur_entry, 'playerId', cur_bidder)), updated_at = now() WHERE code = _code;
      a := jsonb_set(a, '{last}', jsonb_build_object('entry', cur_entry, 'player', cur_bidder, 'price', cur_bid, 'random', false, 'skipped', false));
      slots_needed := slots_needed - 1;
    ELSE
      IF q_len >= slots_needed THEN
        a := jsonb_set(a, '{last}', jsonb_build_object('entry', cur_entry, 'player', NULL, 'price', 0, 'random', false, 'skipped', true));
      ELSE
        SELECT po.pid::uuid INTO winner
        FROM (
          SELECT x AS pid FROM jsonb_array_elements_text(r.player_order) x
        ) po
        WHERE (SELECT count(*) FROM jsonb_array_elements(r.picks) p WHERE p->>'playerId' = po.pid) < team_size
        ORDER BY random()
        LIMIT 1;
        IF winner IS NULL THEN
          a := jsonb_set(a, '{last}', jsonb_build_object('entry', cur_entry, 'player', NULL, 'price', 0, 'random', false, 'skipped', true));
        ELSE
          UPDATE public.rooms SET picks = picks || jsonb_build_array(jsonb_build_object('entryId', cur_entry, 'playerId', winner::text)), updated_at = now() WHERE code = _code;
          a := jsonb_set(a, '{last}', jsonb_build_object('entry', cur_entry, 'player', winner::text, 'price', 0, 'random', true, 'skipped', false));
          is_random := true;
          slots_needed := slots_needed - 1;
        END IF;
      END IF;
    END IF;

    a := jsonb_set(a, '{seq}', to_jsonb(COALESCE((a->>'seq')::int,0) + 1));

    income := GREATEST(0, COALESCE((r.config->>'auctionIncome')::int, 0));
    IF income > 0 THEN
      FOR pid_txt IN SELECT x FROM jsonb_array_elements_text(r.player_order) x LOOP
        IF winner IS NOT NULL AND pid_txt = winner::text THEN CONTINUE; END IF;
        SELECT count(*) INTO pcount FROM public.rooms rr, jsonb_array_elements(rr.picks) p
          WHERE rr.code = _code AND p->>'playerId' = pid_txt;
        IF pcount >= team_size THEN CONTINUE; END IF;
        a := jsonb_set(a, ARRAY['money', pid_txt],
          to_jsonb(COALESCE((a->'money'->>pid_txt)::int, 0) + income));
      END LOOP;
    END IF;

    IF is_random THEN
      a := jsonb_set(a, '{current}', 'null'::jsonb);
      a := jsonb_set(a, '{bid}', '0'::jsonb);
      a := jsonb_set(a, '{bidder}', 'null'::jsonb);
      a := jsonb_set(a, '{folded}', '[]'::jsonb);
      a := jsonb_set(a, '{pending_reveal}', 'true'::jsonb);
      UPDATE public.rooms SET auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
      RETURN jsonb_build_object('ok', true, 'random', true);
    END IF;

    IF slots_needed <= 0 THEN
      a := jsonb_set(a, '{current}', 'null'::jsonb);
      a := jsonb_set(a, '{bid}', '0'::jsonb);
      a := jsonb_set(a, '{bidder}', 'null'::jsonb);
      UPDATE public.rooms SET status = 'finished', auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
    ELSIF q_len = 0 THEN
      a := jsonb_set(a, '{current}', 'null'::jsonb);
      UPDATE public.rooms SET status = 'finished', auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
    ELSE
      a := jsonb_set(a, '{current}', q->0);
      a := jsonb_set(a, '{queue}', COALESCE((SELECT jsonb_agg(v) FROM (SELECT v, ord FROM jsonb_array_elements(q) WITH ORDINALITY AS x(v, ord) WHERE ord > 1) s), '[]'::jsonb));
      a := jsonb_set(a, '{bid}', '0'::jsonb);
      a := jsonb_set(a, '{bidder}', 'null'::jsonb);
      a := jsonb_set(a, '{folded}', '[]'::jsonb);
      UPDATE public.rooms SET auction = a, auction_ends_at = now() + interval '10 seconds', updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true, 'random', is_random);
  END IF;

  IF t = 'swap_out' THEN
    IF r.status <> 'drafting' OR (r.config->>'draftMode') <> 'auction' THEN RAISE EXCEPTION 'no auction running'; END IF;
    a := r.auction;
    IF a->'pending_swap' IS NULL OR a->'pending_swap' = 'null'::jsonb THEN RAISE EXCEPTION 'no swap pending'; END IF;
    IF a->'pending_swap'->>'player' <> _player_id::text THEN RAISE EXCEPTION 'not your swap'; END IF;
    swap_entry := _action->>'entryId';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.picks) p WHERE p->>'playerId' = _player_id::text AND p->>'entryId' = swap_entry) THEN
      RAISE EXCEPTION 'that pokemon is not on your team';
    END IF;
    cur_entry := a->'pending_swap'->>'won';
    UPDATE public.rooms SET picks = (
      SELECT COALESCE(jsonb_agg(p ORDER BY ord), '[]'::jsonb)
      FROM (SELECT p, ord FROM jsonb_array_elements(picks) WITH ORDINALITY AS x(p, ord)) s
      WHERE NOT (p->>'playerId' = _player_id::text AND p->>'entryId' = swap_entry)
    ) || jsonb_build_array(jsonb_build_object('entryId', cur_entry, 'playerId', _player_id::text)),
    updated_at = now() WHERE code = _code;

    a := jsonb_set(a, '{queue}', COALESCE(a->'queue', '[]'::jsonb) || to_jsonb(swap_entry));
    a := jsonb_set(a, '{pending_swap}', 'null'::jsonb);
    a := jsonb_set(a, '{seq}', to_jsonb(COALESCE((a->>'seq')::int,0) + 1));
    q := a->'queue';
    IF jsonb_array_length(q) = 0 THEN
      a := jsonb_set(a, '{current}', 'null'::jsonb);
      UPDATE public.rooms SET status = 'finished', auction = a, auction_ends_at = NULL, updated_at = now() WHERE code = _code;
    ELSE
      a := jsonb_set(a, '{current}', q->0);
      a := jsonb_set(a, '{queue}', COALESCE((SELECT jsonb_agg(v) FROM (SELECT v, ord FROM jsonb_array_elements(q) WITH ORDINALITY AS x(v, ord) WHERE ord > 1) s), '[]'::jsonb));
      a := jsonb_set(a, '{bid}', '0'::jsonb);
      a := jsonb_set(a, '{bidder}', 'null'::jsonb);
      a := jsonb_set(a, '{folded}', '[]'::jsonb);
      UPDATE public.rooms SET auction = a, auction_ends_at = now() + interval '10 seconds', updated_at = now() WHERE code = _code;
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF t = 'pick' THEN
    IF r.status <> 'drafting' THEN RAISE EXCEPTION 'not drafting'; END IF;
    IF (r.config->>'draftMode') = 'auction' THEN RAISE EXCEPTION 'use bids in auction mode'; END IF;
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