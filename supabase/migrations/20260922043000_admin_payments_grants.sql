/*
  Admin catalog and schedule RPCs, manual payment review, provider events, grants.
*/

DROP FUNCTION IF EXISTS public.save_booking_settings(integer, integer[], date[], integer, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.work_slot_times(time, time);
DROP FUNCTION IF EXISTS public.booking_slot_conflicts(timestamptz, integer);

CREATE OR REPLACE FUNCTION public.save_booking_settings(
  p_first_day_of_week integer,
  p_disabled_dates date[],
  p_max_bookings_per_day integer,
  p_send_sms boolean,
  p_slot_step_minutes integer,
  p_payment_hold_minutes integer,
  p_buffer_minutes integer,
  p_working_hours jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekdays smallint[] := '{}'::smallint[];
  v_dates date[];
  v_saved public.booking_settings%ROWTYPE;
  v_row jsonb;
  v_weekday integer;
  v_enabled boolean;
  v_start time;
  v_end time;
  v_seen smallint[] := '{}'::smallint[];
  v_min_start time;
  v_max_end time;
  v_hours jsonb;
  v_disabled jsonb;
  v_clean jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_first_day_of_week NOT IN (0, 1)
     OR p_send_sms IS NULL
     OR p_slot_step_minutes IS NULL
     OR p_slot_step_minutes < 5
     OR p_slot_step_minutes > 240
     OR p_payment_hold_minutes IS NULL
     OR p_payment_hold_minutes < 5
     OR p_payment_hold_minutes > 240
     OR p_buffer_minutes IS NULL
     OR p_buffer_minutes < 0
     OR p_buffer_minutes > 240
     OR (p_max_bookings_per_day IS NOT NULL AND (p_max_bookings_per_day < 1 OR p_max_bookings_per_day > 100))
     OR jsonb_typeof(p_working_hours) <> 'array'
     OR jsonb_array_length(p_working_hours) <> 7 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_working_hours) LOOP
    BEGIN
      v_weekday := (v_row->>'weekday')::integer;
      v_enabled := (v_row->>'enabled')::boolean;
      v_start := (v_row->>'startTime')::time;
      v_end := (v_row->>'endTime')::time;
    EXCEPTION
      WHEN others THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END;

    IF v_weekday IS NULL OR v_weekday < 0 OR v_weekday > 6
       OR v_enabled IS NULL OR v_start IS NULL OR v_end IS NULL OR v_end <= v_start
       OR v_weekday = ANY (v_seen)
       OR to_char(v_start, 'HH24:MI') IS DISTINCT FROM left(v_row->>'startTime', 5)
       OR to_char(v_end, 'HH24:MI') IS DISTINCT FROM left(v_row->>'endTime', 5) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;

    v_seen := v_seen || v_weekday::smallint;
    IF v_enabled THEN
      v_min_start := LEAST(COALESCE(v_min_start, v_start), v_start);
      v_max_end := GREATEST(COALESCE(v_max_end, v_end), v_end);
    ELSE
      v_weekdays := v_weekdays || v_weekday::smallint;
    END IF;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'weekday', v_weekday,
      'enabled', v_enabled,
      'startTime', to_char(v_start, 'HH24:MI'),
      'endTime', to_char(v_end, 'HH24:MI')
    ));
  END LOOP;

  IF cardinality(v_seen) <> 7 OR v_min_start IS NULL OR v_max_end IS NULL OR v_max_end <= v_min_start THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_clean) LOOP
    UPDATE public.working_hours
    SET
      enabled = (v_row->>'enabled')::boolean,
      start_time = (v_row->>'startTime')::time,
      end_time = (v_row->>'endTime')::time
    WHERE weekday = (v_row->>'weekday')::smallint;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT date_value ORDER BY date_value), ARRAY[]::date[])
  INTO v_dates
  FROM unnest(COALESCE(p_disabled_dates, ARRAY[]::date[])) AS date_value
  WHERE date_value IS NOT NULL;

  UPDATE public.booking_settings
  SET
    first_day_of_week = p_first_day_of_week,
    disabled_weekdays = v_weekdays,
    work_start_time = v_min_start,
    work_end_time = v_max_end,
    max_bookings_per_day = p_max_bookings_per_day,
    send_sms = p_send_sms,
    slot_step_minutes = p_slot_step_minutes,
    payment_hold_minutes = p_payment_hold_minutes,
    buffer_minutes = p_buffer_minutes,
    timezone = 'Asia/Jerusalem'
  WHERE id = 1
  RETURNING * INTO v_saved;

  DELETE FROM public.booking_disabled_dates
  WHERE disabled_date <> ALL (v_dates);

  INSERT INTO public.booking_disabled_dates (disabled_date)
  SELECT date_value FROM unnest(v_dates) AS date_value
  ON CONFLICT (disabled_date) DO NOTHING;

  SELECT COALESCE(jsonb_agg(to_char(disabled.disabled_date, 'YYYY-MM-DD') ORDER BY disabled.disabled_date), '[]'::jsonb)
  INTO v_disabled
  FROM public.booking_disabled_dates AS disabled;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'weekday', hours.weekday,
      'enabled', hours.enabled,
      'startTime', to_char(hours.start_time, 'HH24:MI'),
      'endTime', to_char(hours.end_time, 'HH24:MI')
    ) ORDER BY hours.weekday
  ), '[]'::jsonb)
  INTO v_hours
  FROM public.working_hours AS hours;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'firstDayOfWeek', v_saved.first_day_of_week,
      'disabledWeekdays', to_jsonb(v_weekdays),
      'disabledDates', v_disabled,
      'minIntervalMinutes', v_saved.min_interval_minutes,
      'workStartTime', to_char(v_saved.work_start_time, 'HH24:MI'),
      'workEndTime', to_char(v_saved.work_end_time, 'HH24:MI'),
      'slotStepMinutes', v_saved.slot_step_minutes,
      'paymentHoldMinutes', v_saved.payment_hold_minutes,
      'bufferMinutes', v_saved.buffer_minutes,
      'maxBookingsPerDay', v_saved.max_bookings_per_day,
      'sendSms', v_saved.send_sms,
      'timezone', v_saved.timezone,
      'workingHours', v_hours
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'save_booking_settings failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_category(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id uuid;
  v_code text;
  v_service jsonb;
  v_service_code text;
  v_service_id uuid;
  v_service_ids uuid[] := '{}'::uuid[];
  v_price_type text;
  v_price numeric;
  v_duration integer;
  v_name_ru text;
  v_name_he text;
  v_name_en text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  v_name_ru := trim(coalesce(p_payload->>'nameRu', ''));
  v_name_he := trim(coalesce(p_payload->>'nameHe', ''));
  v_name_en := trim(coalesce(p_payload->>'nameEn', ''));
  IF char_length(v_name_ru) < 1 OR char_length(v_name_ru) > 120
     OR char_length(v_name_he) < 1 OR char_length(v_name_he) > 120
     OR char_length(v_name_en) < 1 OR char_length(v_name_en) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_code := public.slug_code(coalesce(nullif(trim(coalesce(p_payload->>'code', '')), ''), v_name_en));
  IF char_length(v_code) < 2 THEN
    v_code := 'category';
  END IF;
  WHILE EXISTS (SELECT 1 FROM public.service_categories WHERE code = v_code) LOOP
    v_code := left(v_code, 40) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
  END LOOP;

  INSERT INTO public.service_categories (
    code, name_ru, name_he, name_en,
    description_ru, description_he, description_en,
    icon, active, sort_order
  ) VALUES (
    v_code,
    v_name_ru,
    v_name_he,
    v_name_en,
    nullif(trim(coalesce(p_payload->>'descriptionRu', '')), ''),
    nullif(trim(coalesce(p_payload->>'descriptionHe', '')), ''),
    nullif(trim(coalesce(p_payload->>'descriptionEn', '')), ''),
    nullif(trim(coalesce(p_payload->>'icon', '')), ''),
    COALESCE((p_payload->>'active')::boolean, true),
    COALESCE((p_payload->>'sortOrder')::integer, 0)
  )
  RETURNING id INTO v_category_id;

  IF p_payload ? 'services' AND jsonb_typeof(p_payload->'services') = 'array' THEN
    FOR v_service IN SELECT value FROM jsonb_array_elements(p_payload->'services') LOOP
      IF char_length(trim(coalesce(v_service->>'nameRu', ''))) < 1
         OR char_length(trim(coalesce(v_service->>'nameHe', ''))) < 1
         OR char_length(trim(coalesce(v_service->>'nameEn', ''))) < 1 THEN
        RAISE EXCEPTION 'invalid service name';
      END IF;

      v_price_type := coalesce(nullif(v_service->>'priceType', ''), 'fixed');
      IF v_price_type NOT IN ('fixed', 'from', 'hourly', 'quote', 'diagnostic') THEN
        RAISE EXCEPTION 'invalid price type';
      END IF;
      v_duration := COALESCE((v_service->>'durationMinutes')::integer, 60);
      IF v_duration < 15 OR v_duration > 720 THEN
        RAISE EXCEPTION 'invalid duration';
      END IF;
      v_price := NULLIF(v_service->>'price', '')::numeric;
      IF v_price_type NOT IN ('quote', 'diagnostic') AND (v_price IS NULL OR v_price < 0) THEN
        RAISE EXCEPTION 'invalid price';
      END IF;

      v_service_code := public.slug_code(coalesce(nullif(trim(coalesce(v_service->>'code', '')), ''), v_service->>'nameEn'));
      IF char_length(v_service_code) < 2 THEN
        v_service_code := 'service';
      END IF;
      WHILE EXISTS (SELECT 1 FROM public.services WHERE code = v_service_code) LOOP
        v_service_code := left(v_service_code, 40) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
      END LOOP;

      INSERT INTO public.services (
        category_id, code, name_ru, name_he, name_en,
        description_ru, description_he, description_en,
        default_duration_minutes, price, price_type, currency,
        onsite_available, remote_available, workshop_available,
        requires_device, requires_operating_system, payment_policy,
        active, sort_order
      ) VALUES (
        v_category_id,
        v_service_code,
        trim(v_service->>'nameRu'),
        trim(v_service->>'nameHe'),
        trim(v_service->>'nameEn'),
        nullif(trim(coalesce(v_service->>'descriptionRu', '')), ''),
        nullif(trim(coalesce(v_service->>'descriptionHe', '')), ''),
        nullif(trim(coalesce(v_service->>'descriptionEn', '')), ''),
        v_duration,
        v_price,
        v_price_type,
        COALESCE(nullif(upper(trim(coalesce(v_service->>'currency', ''))), ''), 'ILS'),
        COALESCE((v_service->>'onsiteAvailable')::boolean, true),
        COALESCE((v_service->>'remoteAvailable')::boolean, false),
        COALESCE((v_service->>'workshopAvailable')::boolean, false),
        COALESCE((v_service->>'requiresDevice')::boolean, false),
        COALESCE((v_service->>'requiresOperatingSystem')::boolean, false),
        COALESCE(nullif(v_service->>'paymentPolicy', ''), 'after_service'),
        COALESCE((v_service->>'active')::boolean, true),
        COALESCE((v_service->>'sortOrder')::integer, 0)
      )
      RETURNING id INTO v_service_id;

      INSERT INTO public.service_payment_methods (service_id, payment_method_id, enabled)
      SELECT v_service_id, method.id, true
      FROM public.payment_methods AS method
      WHERE method.archived_at IS NULL;

      v_service_ids := v_service_ids || v_service_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'categoryId', v_category_id, 'serviceIds', to_jsonb(v_service_ids));
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_create_category failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_staff(
  p_email text,
  p_role text,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_other_admins integer;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  v_email := lower(trim(coalesce(p_email, '')));
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     OR p_role NOT IN ('admin', 'technician')
     OR p_active IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT count(*)::integer INTO v_other_admins
  FROM public.profiles
  WHERE role = 'admin' AND active = true AND user_id <> v_user_id;

  IF v_other_admins = 0 AND (p_role <> 'admin' OR p_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  INSERT INTO public.profiles (user_id, role, active, email)
  VALUES (v_user_id, p_role::public.staff_role, p_active, v_email)
  ON CONFLICT (user_id) DO UPDATE
  SET role = EXCLUDED.role, active = EXCLUDED.active, email = EXCLUDED.email;

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'role', p_role, 'active', p_active);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_set_staff failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.review_manual_payment(
  p_payment_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_type text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_decision NOT IN ('paid', 'failed') OR p_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND OR v_payment.status NOT IN ('pending', 'awaiting_verification') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
  END IF;

  SELECT method.integration_type INTO v_type
  FROM public.payment_methods AS method
  WHERE method.id = v_payment.payment_method_id;

  IF v_type = 'automatic' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
  END IF;

  IF p_decision = 'paid' THEN
    UPDATE public.payments
    SET status = 'paid', paid_at = now()
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET
      status = CASE WHEN status = 'pending_payment' THEN 'confirmed'::public.booking_status ELSE status END,
      payment_status = 'paid',
      payment_expires_at = NULL
    WHERE id = v_payment.booking_id;
  ELSE
    UPDATE public.payments
    SET status = 'failed'
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET
      status = CASE
        WHEN status = 'pending_payment' THEN 'cancelled'::public.booking_status
        ELSE status
      END,
      payment_status = 'failed',
      payment_expires_at = NULL
    WHERE id = v_payment.booking_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'paymentId', v_payment.id, 'status', p_decision);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'review_manual_payment failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_provider_payment(
  p_provider text,
  p_provider_payment_id text,
  p_status text,
  p_event_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_provider IS NULL OR p_provider_payment_id IS NULL OR p_event_id IS NULL
     OR p_status NOT IN ('paid', 'failed', 'expired', 'cancelled', 'refunded', 'partially_refunded')
     OR char_length(p_event_id) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_webhook_events WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE provider = p_provider AND provider_payment_id = p_provider_payment_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
  END IF;

  INSERT INTO public.payment_webhook_events (event_id, provider, payload)
  VALUES (p_event_id, p_provider, COALESCE(p_payload, '{}'::jsonb));

  UPDATE public.payments
  SET
    status = p_status,
    paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
    refunded_at = CASE
      WHEN p_status IN ('refunded', 'partially_refunded') THEN COALESCE(refunded_at, now())
      ELSE refunded_at
    END
  WHERE id = v_payment.id;

  UPDATE public.bookings
  SET
    payment_status = p_status,
    payment_expires_at = CASE WHEN p_status = 'paid' THEN NULL ELSE payment_expires_at END,
    status = CASE
      WHEN p_status = 'paid' AND status = 'pending_payment' THEN 'confirmed'::public.booking_status
      WHEN p_status IN ('failed', 'expired', 'cancelled') AND status = 'pending_payment' THEN 'payment_expired'::public.booking_status
      ELSE status
    END
  WHERE id = v_payment.booking_id;

  RETURN jsonb_build_object('ok', true, 'paymentId', v_payment.id, 'status', p_status);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  WHEN OTHERS THEN
    RAISE WARNING 'apply_provider_payment failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE INDEX IF NOT EXISTS bookings_blocking_range_idx
  ON public.bookings (appointment_start, appointment_end)
  WHERE deleted_at IS NULL
    AND status NOT IN ('cancelled', 'payment_expired', 'no_show');

REVOKE ALL ON FUNCTION public.service_line_total(text, numeric, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slug_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_payment_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_range_conflicts(timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.blocking_bookings_on_date(date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.available_slots_for_date(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.catalog_duration_minutes(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_booking_config() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_service_catalog() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_availability(text, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_month_availability(text, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_booking_settings(integer, date[], integer, boolean, integer, integer, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_category(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_staff(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_provider_payment(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_audit_snapshot(public.bookings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_booking_history() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_public_booking_config() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_service_catalog() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_availability(text, uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_month_availability(text, uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.available_slots_for_date(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_provider_payment(text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_payment_holds() TO service_role;
GRANT EXECUTE ON FUNCTION public.save_booking_settings(integer, date[], integer, boolean, integer, integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_category(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_staff(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_booking_history() TO service_role;
