
-- The public wrapper is SECURITY INVOKER, so the caller's role must be able to
-- reach private.apply_room_action. Private schema is not exposed via PostgREST
-- (not in the API schemas), so granting EXECUTE here doesn't expose a privileged
-- function on the public API surface.
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_room_action(text, uuid, jsonb) TO anon, authenticated;
