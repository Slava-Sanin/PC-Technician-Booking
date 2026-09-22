/*
  Duration-based availability and atomic multi-service booking.

  The schedule lock is the same advisory key as before. Overlapping active
  bookings are rejected inside that lock. Expired payment holds do not block
  a slot. Prices and durations are read from the catalog, never from the client.
*/

DROP FUNCTION IF EXISTS public.get_month_availability(text);
DROP FUNCTION IF EXISTS public.get_availability(text);
DROP FUNCTION IF EXISTS public.available_slots_for_date(date);

CREATE OR REPLACE FUNCTION public.service_line_total(
  p_price_type text,
  p_price numeric,
  p_duration integer,
  p_quantity integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_price_type IN ('quote', 'diagnostic') OR p_price IS NULL THEN NULL
    WHEN p_price_type = 'hourly' THEN round(p_price * p_duration / 60.0 * p_quantity, 2)
    ELSE round(p_price * p_quantity, 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.slug_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT left(
    trim(both '_' FROM regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '_', 'g')),
    48
  );
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_payment_holds()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payments
  SET status = 'expired'
  WHERE status IN ('pending', 'awaiting_verification')
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  UPDATE public.bookings
  SET
    status = 'payment_expired',
    payment_status = 'expired'
  WHERE deleted_at IS NULL
    AND status = 'pending_payment'
    AND payment_expires_at IS NOT NULL
    AND payment_expires_at <= now();
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_range_conflicts(
  p_start timestamptz,
  p_end timestamptz,
  p_buffer_minutes integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bookings AS booking
    WHERE booking.deleted_at IS NULL
      AND booking.status NOT IN ('cancelled', 'payment_expired', 'no_show')
      AND NOT (
        booking.status = 'pending_payment'
        AND booking.payment_expires_at IS NOT NULL
        AND booking.payment_expires_at <= now()
      )
      AND booking.appointment_start < p_end + make_interval(mins => p_buffer_minutes)
      AND booking.appointment_end + make_interval(mins => p_buffer_minutes) > p_start
  );
$$;

CREATE OR REPLACE FUNCTION public.blocking_bookings_on_date(p_date date, p_timezone text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.bookings AS booking
  WHERE booking.deleted_at IS NULL
    AND (booking.appointment_start AT TIME ZONE p_timezone)::date = p_date
    AND booking.status NOT IN ('cancelled', 'payment_expired', 'no_show')
    AND NOT (
      booking.status = 'pending_payment'
      AND booking.payment_expires_at IS NOT NULL
      AND booking.payment_expires_at <= now()
    );
$$;

CREATE OR REPLACE FUNCTION public.available_slots_for_date(
  p_date date,
  p_duration_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.booking_settings%ROWTYPE;
  v_hours public.working_hours%ROWTYPE;
  v_cursor time;
  v_start timestamptz;
  v_end timestamptz;
  v_slots jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 1440 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT * INTO v_settings FROM public.booking_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p_date < (now() AT TIME ZONE v_settings.timezone)::date
     OR p_date > (now() AT TIME ZONE v_settings.timezone)::date + 730 THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT * INTO v_hours
  FROM public.working_hours
  WHERE weekday = EXTRACT(DOW FROM p_date)::smallint;

  IF NOT FOUND OR NOT v_hours.enabled THEN
    RETURN '[]'::jsonb;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_disabled_dates AS disabled
    WHERE disabled.disabled_date = p_date
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  v_count := public.blocking_bookings_on_date(p_date, v_settings.timezone);
  IF v_settings.max_bookings_per_day IS NOT NULL AND v_count >= v_settings.max_bookings_per_day THEN
    RETURN '[]'::jsonb;
  END IF;

  v_cursor := v_hours.start_time;
  WHILE v_cursor < v_hours.end_time LOOP
    v_start := (p_date + v_cursor) AT TIME ZONE v_settings.timezone;
    v_end := v_start + make_interval(mins => p_duration_minutes);

    EXIT WHEN (v_end AT TIME ZONE v_settings.timezone)::date IS DISTINCT FROM p_date
      OR (v_end AT TIME ZONE v_settings.timezone)::time > v_hours.end_time;

    IF v_start > now()
       AND NOT public.booking_range_conflicts(v_start, v_end, v_settings.buffer_minutes) THEN
      v_slots := v_slots || to_jsonb(to_char(v_cursor, 'HH24:MI'));
    END IF;

    v_cursor := v_cursor + make_interval(mins => v_settings.slot_step_minutes);
    EXIT WHEN v_cursor <= v_hours.start_time;
  END LOOP;

  RETURN v_slots;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_duration_minutes(p_service_ids uuid[])
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum(service.default_duration_minutes), 0)::integer
  FROM public.services AS service
  JOIN public.service_categories AS category ON category.id = service.category_id
  WHERE service.id = ANY (p_service_ids)
    AND service.active
    AND service.archived_at IS NULL
    AND category.active
    AND category.archived_at IS NULL;
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
  v_hours jsonb;
  v_closed smallint[];
BEGIN
  SELECT * INTO v_settings FROM public.booking_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  SELECT COALESCE(jsonb_agg(to_char(disabled.disabled_date, 'YYYY-MM-DD') ORDER BY disabled.disabled_date), '[]'::jsonb)
  INTO v_dates
  FROM public.booking_disabled_dates AS disabled;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'weekday', hours.weekday,
      'enabled', hours.enabled,
      'startTime', to_char(hours.start_time, 'HH24:MI'),
      'endTime', to_char(hours.end_time, 'HH24:MI')
    )
    ORDER BY hours.weekday
  ), '[]'::jsonb)
  INTO v_hours
  FROM public.working_hours AS hours;

  SELECT COALESCE(array_agg(hours.weekday ORDER BY hours.weekday), '{}'::smallint[])
  INTO v_closed
  FROM public.working_hours AS hours
  WHERE NOT hours.enabled;

  RETURN jsonb_build_object(
    'ok', true,
    'firstDayOfWeek', v_settings.first_day_of_week,
    'disabledWeekdays', to_jsonb(v_closed),
    'disabledDates', v_dates,
    'workStartTime', to_char(v_settings.work_start_time, 'HH24:MI'),
    'workEndTime', to_char(v_settings.work_end_time, 'HH24:MI'),
    'minIntervalMinutes', v_settings.min_interval_minutes,
    'slotStepMinutes', v_settings.slot_step_minutes,
    'paymentHoldMinutes', v_settings.payment_hold_minutes,
    'bufferMinutes', v_settings.buffer_minutes,
    'maxBookingsPerDay', v_settings.max_bookings_per_day,
    'timezone', v_settings.timezone,
    'workingHours', v_hours
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_service_catalog()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_categories jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(category_row.payload ORDER BY category_row.sort_order, category_row.code), '[]'::jsonb)
  INTO v_categories
  FROM (
    SELECT
      category.sort_order,
      category.code,
      jsonb_build_object(
        'id', category.id,
        'code', category.code,
        'name', jsonb_build_object('ru', category.name_ru, 'he', category.name_he, 'en', category.name_en),
        'description', jsonb_build_object('ru', category.description_ru, 'he', category.description_he, 'en', category.description_en),
        'icon', category.icon,
        'sortOrder', category.sort_order,
        'services', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', service.id,
              'code', service.code,
              'name', jsonb_build_object('ru', service.name_ru, 'he', service.name_he, 'en', service.name_en),
              'description', jsonb_build_object('ru', service.description_ru, 'he', service.description_he, 'en', service.description_en),
              'durationMinutes', service.default_duration_minutes,
              'price', service.price,
              'priceType', service.price_type,
              'currency', service.currency,
              'modes', (
                SELECT COALESCE(jsonb_agg(mode ORDER BY mode), '[]'::jsonb)
                FROM (
                  SELECT 'onsite' AS mode WHERE service.onsite_available
                  UNION ALL SELECT 'remote' WHERE service.remote_available
                  UNION ALL SELECT 'workshop' WHERE service.workshop_available
                ) AS modes
              ),
              'requiresDevice', service.requires_device,
              'requiresOperatingSystem', service.requires_operating_system,
              'paymentPolicy', service.payment_policy,
              'sortOrder', service.sort_order,
              'paymentMethods', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'code', method.code,
                    'name', jsonb_build_object('ru', method.name_ru, 'he', method.name_he, 'en', method.name_en),
                    'integrationType', method.integration_type,
                    'instructions', jsonb_build_object('ru', method.instructions_ru, 'he', method.instructions_he, 'en', method.instructions_en),
                    'externalUrl', method.external_url,
                    'sortOrder', method.sort_order
                  )
                  ORDER BY method.sort_order, method.code
                )
                FROM public.service_payment_methods AS link
                JOIN public.payment_methods AS method ON method.id = link.payment_method_id
                WHERE link.service_id = service.id
                  AND link.enabled
                  AND method.active
                  AND method.archived_at IS NULL
              ), '[]'::jsonb)
            )
            ORDER BY service.sort_order, service.code
          )
          FROM public.services AS service
          WHERE service.category_id = category.id
            AND service.active
            AND service.archived_at IS NULL
        ), '[]'::jsonb)
      ) AS payload
    FROM public.service_categories AS category
    WHERE category.active
      AND category.archived_at IS NULL
  ) AS category_row;

  RETURN jsonb_build_object('ok', true, 'categories', COALESCE(v_categories, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_availability(
  p_date text,
  p_service_ids uuid[],
  p_service_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_tz text;
  v_duration integer;
  v_requested integer;
BEGIN
  IF p_date IS NULL OR p_date !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_service_mode NOT IN ('onsite', 'remote', 'workshop')
     OR p_service_ids IS NULL
     OR cardinality(p_service_ids) < 1
     OR cardinality(p_service_ids) > 12 THEN
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

  SELECT count(*)::integer INTO v_requested FROM unnest(p_service_ids) AS service_id;
  v_duration := public.catalog_duration_minutes(p_service_ids);
  IF v_duration IS NULL OR v_duration < 15 OR (
    SELECT count(*) FROM public.services AS service
    JOIN public.service_categories AS category ON category.id = service.category_id
    WHERE service.id = ANY (p_service_ids)
      AND service.active AND service.archived_at IS NULL
      AND category.active AND category.archived_at IS NULL
      AND (
        (p_service_mode = 'onsite' AND service.onsite_available)
        OR (p_service_mode = 'remote' AND service.remote_available)
        OR (p_service_mode = 'workshop' AND service.workshop_available)
      )
  ) <> v_requested THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SERVICE_UNAVAILABLE');
  END IF;

  PERFORM public.expire_stale_payment_holds();
  SELECT timezone INTO v_tz FROM public.booking_settings WHERE id = 1;
  IF v_tz IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'timezone', v_tz,
    'durationMinutes', v_duration,
    'availableSlots', public.available_slots_for_date(v_date, v_duration)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_month_availability(
  p_month text,
  p_service_ids uuid[],
  p_service_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_cursor date;
  v_days jsonb := '{}'::jsonb;
  v_tz text;
  v_duration integer;
  v_requested integer;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$'
     OR p_service_mode NOT IN ('onsite', 'remote', 'workshop')
     OR p_service_ids IS NULL
     OR cardinality(p_service_ids) < 1 THEN
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

  SELECT count(*)::integer INTO v_requested FROM unnest(p_service_ids) AS service_id;
  v_duration := public.catalog_duration_minutes(p_service_ids);
  IF v_duration IS NULL OR v_duration < 15 OR (
    SELECT count(*) FROM public.services AS service
    JOIN public.service_categories AS category ON category.id = service.category_id
    WHERE service.id = ANY (p_service_ids)
      AND service.active AND service.archived_at IS NULL
      AND category.active AND category.archived_at IS NULL
      AND (
        (p_service_mode = 'onsite' AND service.onsite_available)
        OR (p_service_mode = 'remote' AND service.remote_available)
        OR (p_service_mode = 'workshop' AND service.workshop_available)
      )
  ) <> v_requested THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SERVICE_UNAVAILABLE');
  END IF;

  PERFORM public.expire_stale_payment_holds();
  v_end := (v_start + interval '1 month' - interval '1 day')::date;
  SELECT timezone INTO v_tz FROM public.booking_settings WHERE id = 1;
  IF v_tz IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  v_cursor := v_start;
  WHILE v_cursor <= v_end LOOP
    v_days := v_days || jsonb_build_object(
      to_char(v_cursor, 'YYYY-MM-DD'),
      public.available_slots_for_date(v_cursor, v_duration)
    );
    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'month', to_char(v_start, 'YYYY-MM'),
    'timezone', v_tz,
    'durationMinutes', v_duration,
    'days', v_days
  );
END;
$$;
