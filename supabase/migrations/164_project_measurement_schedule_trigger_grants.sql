-- Trigger functions execute through their trigger and need no browser RPC grant.
REVOKE ALL ON FUNCTION public.project_measurements_emit_schedule_anchor_event()
  FROM PUBLIC, anon, authenticated;
