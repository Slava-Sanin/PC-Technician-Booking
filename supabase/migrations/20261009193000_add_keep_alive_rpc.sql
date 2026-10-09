-- Lightweight keep-alive RPC for scheduled GitHub Actions (Supabase Free plan activity).
CREATE OR REPLACE FUNCTION public.keep_alive()
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT now();
$$;

REVOKE ALL ON FUNCTION public.keep_alive() FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.keep_alive()
TO anon;

GRANT EXECUTE
ON FUNCTION public.keep_alive()
TO authenticated;

COMMENT ON FUNCTION public.keep_alive()
IS 'Lightweight health/keep-alive RPC used by scheduled automation to generate database activity.';
