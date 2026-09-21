/*
  Close public access to bookings and create the atomic booking API.

  Anonymous and authenticated users without an active staff profile cannot
  select, insert, update, or delete bookings. Staff can select and update.
  Inserts happen only inside create_booking_atomic, which is granted to
  service_role and takes a transaction-scoped advisory lock.

  Slot rule (same for availability and create): an active booking conflicts
  when the absolute difference is strictly less than min_interval_minutes.
  Rows with deleted_at are ignored. Local appointment time is interpreted in
  booking_settings.timezone (Asia/Jerusalem), including Israel DST.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.booking_settings
  DROP CONSTRAINT IF EXISTS booking_settings_timezone_known;

UPDATE public.booking_settings
SET timezone = 'Asia/Jerusalem'
WHERE id = 1
  AND timezone IS DISTINCT FROM 'Asia/Jerusalem';

ALTER TABLE public.booking_settings
  DROP CONSTRAINT IF EXISTS booking_settings_timezone_jerusalem;

ALTER TABLE public.booking_settings
  ADD CONSTRAINT booking_settings_timezone_jerusalem
  CHECK (timezone = 'Asia/Jerusalem');

CREATE TABLE IF NOT EXISTS public.booking_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_hash text NOT NULL CHECK (char_length(subject_hash) BETWEEN 16 AND 128),
  limit_kind text NOT NULL CHECK (limit_kind IN ('source_attempt', 'phone_success')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_rate_limits_lookup_idx
  ON public.booking_rate_limits (limit_kind, subject_hash, created_at DESC);

ALTER TABLE public.booking_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.booking_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
BEGIN
  IF p_phone IS NULL THEN
    RETURN NULL;
  END IF;

  v := regexp_replace(trim(p_phone), '[^0-9+]', '', 'g');

  IF v ~ '^00' THEN
    v := '+' || substring(v from 3);
  ELSIF v ~ '^0[0-9]+$' THEN
    v := '+972' || substring(v from 2);
  ELSIF v ~ '^[1-9][0-9]+$' THEN
    v := '+' || v;
  END IF;

  IF v ~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN v;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.work_slot_times(p_start time, p_end time)
RETURNS TABLE(slot time)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (p_start + make_interval(secs => steps.step_seconds))::time AS slot
  FROM generate_series(
    0,
    GREATEST(EXTRACT(EPOCH FROM (p_end - p_start))::integer, 0),
    3600
  ) AS steps(step_seconds)
  WHERE (p_start + make_interval(secs => steps.step_seconds))::time <= p_end;
$$;

CREATE OR REPLACE FUNCTION public.booking_slot_conflicts(
  p_appointment timestamptz,
  p_interval_minutes integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.deleted_at IS NULL
      AND b.appointment_date > p_appointment - make_interval(mins => p_interval_minutes)
      AND b.appointment_date < p_appointment + make_interval(mins => p_interval_minutes)
  );
$$;

CREATE OR REPLACE FUNCTION public.active_bookings_on_date(p_date date, p_timezone text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.bookings b
  WHERE b.deleted_at IS NULL
    AND (b.appointment_date AT TIME ZONE p_timezone)::date = p_date;
$$;

CREATE OR REPLACE FUNCTION public.available_slots_for_date(p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.booking_settings%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO v_settings
  FROM public.booking_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_date < (now() AT TIME ZONE v_settings.timezone)::date
     OR p_date > (now() AT TIME ZONE v_settings.timezone)::date + 730 THEN
    RETURN '[]'::jsonb;
  END IF;

  IF EXTRACT(DOW FROM p_date)::smallint = ANY (v_settings.disabled_weekdays) THEN
    RETURN '[]'::jsonb;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_disabled_dates d
    WHERE d.disabled_date = p_date
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  v_count := public.active_bookings_on_date(p_date, v_settings.timezone);
  IF v_settings.max_bookings_per_day IS NOT NULL
     AND v_count >= v_settings.max_bookings_per_day THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(to_char(candidate.slot, 'HH24:MI') ORDER BY candidate.slot)
    FROM public.work_slot_times(v_settings.work_start_time, v_settings.work_end_time) AS candidate
    WHERE (p_date + candidate.slot) AT TIME ZONE v_settings.timezone > now()
      AND NOT public.booking_slot_conflicts(
        (p_date + candidate.slot) AT TIME ZONE v_settings.timezone,
        v_settings.min_interval_minutes
      )
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_booking_rate_limit(
  p_phone_hash text,
  p_source_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_phone_hash IS NULL OR p_phone_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN 'INVALID_INPUT';
  END IF;

  DELETE FROM public.booking_rate_limits
  WHERE created_at < now() - interval '48 hours';

  IF p_source_hash IS NOT NULL AND p_source_hash <> '' THEN
    IF p_source_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN 'INVALID_INPUT';
    END IF;

    INSERT INTO public.booking_rate_limits (subject_hash, limit_kind)
    VALUES (p_source_hash, 'source_attempt');

    SELECT count(*) INTO v_count
    FROM public.booking_rate_limits
    WHERE subject_hash = p_source_hash
      AND limit_kind = 'source_attempt'
      AND created_at > now() - interval '1 hour';

    IF v_count > 20 THEN
      RETURN 'RATE_LIMITED';
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.booking_rate_limits
  WHERE subject_hash = p_phone_hash
    AND limit_kind = 'phone_success'
    AND created_at > now() - interval '10 minutes';

  IF v_count >= 1 THEN
    RETURN 'RATE_LIMITED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.booking_rate_limits
  WHERE subject_hash = p_phone_hash
    AND limit_kind = 'phone_success'
    AND created_at > now() - interval '24 hours';

  IF v_count >= 3 THEN
    RETURN 'RATE_LIMITED';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_operating_system text,
  p_comments text,
  p_appointment_date text,
  p_appointment_time text,
  p_source_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.booking_settings%ROWTYPE;
  v_first text;
  v_last text;
  v_phone text;
  v_address text;
  v_city text;
  v_comments text;
  v_os text;
  v_date date;
  v_time time;
  v_local timestamp;
  v_appointment timestamptz;
  v_today date;
  v_phone_hash text;
  v_limit_code text;
  v_count integer;
  v_id uuid;
  v_number text;
  v_attempt integer;
  v_inserted boolean := false;
BEGIN
  v_first := trim(coalesce(p_first_name, ''));
  v_last := trim(coalesce(p_last_name, ''));
  v_address := trim(coalesce(p_address, ''));
  v_city := trim(coalesce(p_city, ''));
  v_comments := trim(coalesce(p_comments, ''));
  v_os := lower(trim(coalesce(p_operating_system, '')));

  IF char_length(v_first) < 1 OR char_length(v_first) > 80
     OR char_length(v_last) < 1 OR char_length(v_last) > 80
     OR char_length(v_address) < 1 OR char_length(v_address) > 200
     OR char_length(v_city) > 80
     OR char_length(v_comments) > 1000
     OR v_os NOT IN ('windows', 'linux', 'macos') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_phone := public.normalize_phone(p_phone);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF p_appointment_date IS NULL
     OR p_appointment_time IS NULL
     OR p_appointment_date !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_appointment_time !~ '^\d{2}:\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    v_date := p_appointment_date::date;
    v_time := p_appointment_time::time;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF to_char(v_date, 'YYYY-MM-DD') <> p_appointment_date
     OR to_char(v_time, 'HH24:MI') <> p_appointment_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pc-technician-booking-schedule')::bigint);

  SELECT * INTO v_settings
  FROM public.booking_settings
  WHERE id = 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  v_local := v_date + v_time;
  v_appointment := v_local AT TIME ZONE v_settings.timezone;

  IF (v_appointment AT TIME ZONE v_settings.timezone)::date IS DISTINCT FROM v_date
     OR to_char((v_appointment AT TIME ZONE v_settings.timezone)::time, 'HH24:MI')
        IS DISTINCT FROM to_char(v_time, 'HH24:MI') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_today := (now() AT TIME ZONE v_settings.timezone)::date;
  IF v_date > v_today + 730 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_date < v_today OR v_appointment <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DATE_IN_PAST');
  END IF;

  IF EXTRACT(DOW FROM v_date)::smallint = ANY (v_settings.disabled_weekdays) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_WEEKDAY');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_disabled_dates d WHERE d.disabled_date = v_date
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_DATE');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.work_slot_times(v_settings.work_start_time, v_settings.work_end_time) s
    WHERE s.slot = v_time
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_WORKING_HOURS');
  END IF;

  v_phone_hash := encode(extensions.digest(convert_to(v_phone, 'UTF8'), 'sha256'), 'hex');
  v_limit_code := public.enforce_booking_rate_limit(v_phone_hash, NULLIF(trim(coalesce(p_source_hash, '')), ''));
  IF v_limit_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_limit_code);
  END IF;

  IF public.booking_slot_conflicts(v_appointment, v_settings.min_interval_minutes) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
  END IF;

  IF v_settings.max_bookings_per_day IS NOT NULL THEN
    v_count := public.active_bookings_on_date(v_date, v_settings.timezone);
    IF v_count >= v_settings.max_bookings_per_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT_REACHED');
    END IF;
  END IF;

  FOR v_attempt IN 1..3 LOOP
    BEGIN
      INSERT INTO public.bookings (
        first_name,
        last_name,
        phone,
        address,
        city,
        operating_system,
        comments,
        appointment_date,
        status,
        completed
      ) VALUES (
        v_first,
        v_last,
        v_phone,
        v_address,
        NULLIF(v_city, ''),
        v_os,
        NULLIF(v_comments, ''),
        v_appointment,
        'new',
        false
      )
      RETURNING id, booking_number INTO v_id, v_number;

      v_inserted := true;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 3 THEN
          RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
        END IF;
    END;
  END LOOP;

  IF NOT v_inserted OR v_id IS NULL OR v_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  INSERT INTO public.booking_rate_limits (subject_hash, limit_kind)
  VALUES (v_phone_hash, 'phone_success');

  RETURN jsonb_build_object(
    'ok', true,
    'bookingId', v_id,
    'bookingNumber', v_number,
    'appointmentDate', to_char(v_date, 'YYYY-MM-DD'),
    'appointmentTime', to_char(v_time, 'HH24:MI'),
    'firstName', v_first,
    'phone', v_phone,
    'sendSms', v_settings.send_sms
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_booking_atomic failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_booking_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.booking_settings%ROWTYPE;
  v_dates jsonb;
BEGIN
  SELECT * INTO v_settings FROM public.booking_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  SELECT COALESCE(jsonb_agg(to_char(d.disabled_date, 'YYYY-MM-DD') ORDER BY d.disabled_date), '[]'::jsonb)
  INTO v_dates
  FROM public.booking_disabled_dates d;

  RETURN jsonb_build_object(
    'ok', true,
    'firstDayOfWeek', v_settings.first_day_of_week,
    'disabledWeekdays', to_jsonb(v_settings.disabled_weekdays),
    'disabledDates', v_dates,
    'workStartTime', to_char(v_settings.work_start_time, 'HH24:MI'),
    'workEndTime', to_char(v_settings.work_end_time, 'HH24:MI'),
    'minIntervalMinutes', v_settings.min_interval_minutes,
    'maxBookingsPerDay', v_settings.max_bookings_per_day,
    'timezone', v_settings.timezone
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_availability(p_date text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_tz text;
BEGIN
  IF p_date IS NULL OR p_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    v_date := p_date::date;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF to_char(v_date, 'YYYY-MM-DD') <> p_date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT timezone INTO v_tz FROM public.booking_settings WHERE id = 1;
  IF v_tz IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'timezone', v_tz,
    'availableSlots', public.available_slots_for_date(v_date)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_month_availability(p_month text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_cursor date;
  v_days jsonb := '{}'::jsonb;
  v_tz text;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    v_start := (p_month || '-01')::date;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF to_char(v_start, 'YYYY-MM') <> p_month THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  SELECT timezone INTO v_tz FROM public.booking_settings WHERE id = 1;
  IF v_tz IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  v_cursor := v_start;
  WHILE v_cursor <= v_end LOOP
    v_days := v_days || jsonb_build_object(
      to_char(v_cursor, 'YYYY-MM-DD'),
      public.available_slots_for_date(v_cursor)
    );
    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'month', to_char(v_start, 'YYYY-MM'),
    'timezone', v_tz,
    'days', v_days
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_booking_settings(
  p_first_day_of_week integer,
  p_disabled_weekdays integer[],
  p_disabled_dates date[],
  p_min_interval_minutes integer,
  p_work_start_time text,
  p_work_end_time text,
  p_max_bookings_per_day integer,
  p_send_sms boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start time;
  v_end time;
  v_weekdays smallint[];
  v_dates date[];
  v_saved public.booking_settings%ROWTYPE;
  v_disabled jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_first_day_of_week NOT IN (0, 1)
     OR p_min_interval_minutes IS NULL
     OR p_min_interval_minutes < 30
     OR p_min_interval_minutes > 1440
     OR p_send_sms IS NULL
     OR (p_max_bookings_per_day IS NOT NULL AND (p_max_bookings_per_day < 1 OR p_max_bookings_per_day > 100))
     OR p_work_start_time IS NULL
     OR p_work_end_time IS NULL
     OR p_work_start_time !~ '^\d{2}:\d{2}$'
     OR p_work_end_time !~ '^\d{2}:\d{2}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_disabled_weekdays, ARRAY[]::integer[])) AS weekday_value
    WHERE weekday_value < 0 OR weekday_value > 6
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    v_start := p_work_start_time::time;
    v_end := p_work_end_time::time;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF v_end <= v_start THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT COALESCE(array_agg(DISTINCT weekday_value::smallint ORDER BY weekday_value::smallint), '{}'::smallint[])
  INTO v_weekdays
  FROM unnest(COALESCE(p_disabled_weekdays, ARRAY[]::integer[])) AS weekday_value;

  SELECT COALESCE(array_agg(DISTINCT date_value ORDER BY date_value), ARRAY[]::date[])
  INTO v_dates
  FROM unnest(COALESCE(p_disabled_dates, ARRAY[]::date[])) AS date_value
  WHERE date_value IS NOT NULL;

  UPDATE public.booking_settings
  SET
    first_day_of_week = p_first_day_of_week,
    disabled_weekdays = v_weekdays,
    min_interval_minutes = p_min_interval_minutes,
    work_start_time = v_start,
    work_end_time = v_end,
    max_bookings_per_day = p_max_bookings_per_day,
    send_sms = p_send_sms,
    timezone = 'Asia/Jerusalem'
  WHERE id = 1
  RETURNING * INTO v_saved;

  DELETE FROM public.booking_disabled_dates
  WHERE disabled_date <> ALL (v_dates);

  INSERT INTO public.booking_disabled_dates (disabled_date)
  SELECT date_value
  FROM unnest(v_dates) AS date_value
  ON CONFLICT (disabled_date) DO NOTHING;

  SELECT COALESCE(jsonb_agg(to_char(d.disabled_date, 'YYYY-MM-DD') ORDER BY d.disabled_date), '[]'::jsonb)
  INTO v_disabled
  FROM public.booking_disabled_dates d;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'firstDayOfWeek', v_saved.first_day_of_week,
      'disabledWeekdays', to_jsonb(v_saved.disabled_weekdays),
      'disabledDates', v_disabled,
      'minIntervalMinutes', v_saved.min_interval_minutes,
      'workStartTime', to_char(v_saved.work_start_time, 'HH24:MI'),
      'workEndTime', to_char(v_saved.work_end_time, 'HH24:MI'),
      'maxBookingsPerDay', v_saved.max_bookings_per_day,
      'sendSms', v_saved.send_sms,
      'timezone', v_saved.timezone
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'save_booking_settings failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bookings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.bookings', policy_row.policyname);
  END LOOP;
END $$;

CREATE POLICY "Staff can read bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (public.is_staff());

CREATE POLICY "Staff can update bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

REVOKE ALL ON TABLE public.bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.bookings TO authenticated;

REVOKE ALL ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_slot_times(time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_slot_conflicts(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.active_bookings_on_date(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.available_slots_for_date(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_booking_rate_limit(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_booking_config() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_availability(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_month_availability(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_booking_settings(integer, integer[], date[], integer, text, text, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_booking_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;

GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_public_booking_config() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_availability(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_month_availability(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.available_slots_for_date(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_booking_rate_limit(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_booking_settings(integer, integer[], date[], integer, text, text, integer, boolean) TO authenticated;
