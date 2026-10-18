/*
  Customer self-service booking edit.

  - bookings.customer_edited_at: when the customer last changed the booking.
    A customer may change a booking at most once per 24 hours.
  - payments.kind: 'charge' (money in) or 'refund' (money owed back to the customer).
  - Customers can read payments of their own bookings.
  - Availability helpers accept an optional booking id to exclude, so a customer
    can move a booking to a slot that is only blocked by that same booking.
  - customer_update_booking(): atomic edit with price recalculation and
    payment reconciliation (refund of the difference or an extra charge).
  - review_manual_payment() understands refund rows.
*/

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_edited_at timestamptz;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'charge';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_check CHECK (kind IN ('charge', 'refund'));

CREATE INDEX IF NOT EXISTS payments_booking_idx ON public.payments (booking_id);

DROP POLICY IF EXISTS "Customers read own payments" ON public.payments;
CREATE POLICY "Customers read own payments"
  ON public.payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings AS booking
      JOIN public.customers AS customer ON customer.id = booking.customer_id
      WHERE booking.id = payments.booking_id
        AND customer.user_id = auth.uid()
    )
  );

GRANT SELECT ON TABLE public.payments TO authenticated;

DROP POLICY IF EXISTS "Customers read own booking services" ON public.booking_services;
CREATE POLICY "Customers read own booking services"
  ON public.booking_services
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bookings AS booking
      JOIN public.customers AS customer ON customer.id = booking.customer_id
      WHERE booking.id = booking_services.booking_id
        AND customer.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Availability helpers with an excluded booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_range_conflicts(
  p_start timestamptz,
  p_end timestamptz,
  p_buffer_minutes integer,
  p_exclude_booking_id uuid
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
      AND (p_exclude_booking_id IS NULL OR booking.id <> p_exclude_booking_id)
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

CREATE OR REPLACE FUNCTION public.blocking_bookings_on_date(
  p_date date,
  p_timezone text,
  p_exclude_booking_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.bookings AS booking
  WHERE booking.deleted_at IS NULL
    AND (p_exclude_booking_id IS NULL OR booking.id <> p_exclude_booking_id)
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
  p_duration_minutes integer,
  p_exclude_booking_id uuid
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

  v_count := public.blocking_bookings_on_date(p_date, v_settings.timezone, p_exclude_booking_id);
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
       AND NOT public.booking_range_conflicts(v_start, v_end, v_settings.buffer_minutes, p_exclude_booking_id) THEN
      v_slots := v_slots || to_jsonb(to_char(v_cursor, 'HH24:MI'));
    END IF;

    v_cursor := v_cursor + make_interval(mins => v_settings.slot_step_minutes);
    EXIT WHEN v_cursor <= v_hours.start_time;
  END LOOP;

  RETURN v_slots;
END;
$$;

-- Keep the two-argument form as a thin wrapper so existing callers keep working.
CREATE OR REPLACE FUNCTION public.available_slots_for_date(
  p_date date,
  p_duration_minutes integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.available_slots_for_date(p_date, p_duration_minutes, NULL::uuid);
$$;

DROP FUNCTION IF EXISTS public.get_availability(text, uuid[], text);
CREATE OR REPLACE FUNCTION public.get_availability(
  p_date text,
  p_service_ids uuid[],
  p_service_mode text,
  p_exclude_booking_id uuid DEFAULT NULL
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
    'availableSlots', public.available_slots_for_date(v_date, v_duration, p_exclude_booking_id)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_month_availability(text, uuid[], text);
CREATE OR REPLACE FUNCTION public.get_month_availability(
  p_month text,
  p_service_ids uuid[],
  p_service_mode text,
  p_exclude_booking_id uuid DEFAULT NULL
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
      public.available_slots_for_date(v_cursor, v_duration, p_exclude_booking_id)
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

-- ---------------------------------------------------------------------------
-- Customer edit of an own booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_update_booking(
  p_booking_id uuid,
  p_customer_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_settings public.booking_settings%ROWTYPE;
  v_hours public.working_hours%ROWTYPE;
  v_service public.services%ROWTYPE;
  v_paid_charge public.payments%ROWTYPE;
  v_pending_charge public.payments%ROWTYPE;
  v_method_type text;
  v_first text;
  v_last text;
  v_phone text;
  v_email text;
  v_address text;
  v_city text;
  v_comments text;
  v_problem text;
  v_brand text;
  v_model text;
  v_os text;
  v_device text;
  v_mode text;
  v_date_text text;
  v_time_text text;
  v_date date;
  v_time time;
  v_local timestamp;
  v_start timestamptz;
  v_end timestamptz;
  v_end_local timestamp;
  v_today date;
  v_offset numeric;
  v_service_ids uuid[];
  v_old_ids uuid[];
  v_new_ids uuid[];
  v_count integer;
  v_distinct integer;
  v_lines jsonb := '[]'::jsonb;
  v_old_lines jsonb;
  v_line jsonb;
  v_line_total numeric;
  v_duration integer := 0;
  v_total numeric;
  v_currency text;
  v_requires_device boolean := false;
  v_requires_os boolean := false;
  v_requires_payment boolean := false;
  v_services_changed boolean := false;
  v_schedule_changed boolean := false;
  v_fields_changed boolean := false;
  v_date_changed boolean := false;
  v_net_paid numeric := 0;
  v_delta numeric := 0;
  v_refund numeric := 0;
  v_extra numeric := 0;
  v_status public.booking_status;
  v_payment_status text;
  v_expires timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_booking_id IS NULL OR p_customer_id IS NULL
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pc-technician-booking-schedule')::bigint);
  PERFORM public.expire_stale_payment_holds();

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.deleted_at IS NOT NULL
     OR v_booking.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF v_booking.status NOT IN ('new', 'pending_payment', 'confirmed', 'assigned')
     OR v_booking.appointment_start <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_EDITABLE');
  END IF;

  IF v_booking.customer_edited_at IS NOT NULL
     AND v_booking.customer_edited_at > now() - interval '24 hours' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'EDIT_LIMIT_REACHED',
      'nextEditAt', v_booking.customer_edited_at + interval '24 hours'
    );
  END IF;

  SELECT * INTO v_settings FROM public.booking_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  v_first := trim(coalesce(p_payload->>'firstName', ''));
  v_last := trim(coalesce(p_payload->>'lastName', ''));
  v_address := trim(coalesce(p_payload->>'address', ''));
  v_city := trim(coalesce(p_payload->>'city', ''));
  v_comments := trim(coalesce(p_payload->>'comments', ''));
  v_problem := trim(coalesce(p_payload->>'problemDescription', ''));
  v_brand := trim(coalesce(p_payload->>'deviceBrand', ''));
  v_model := trim(coalesce(p_payload->>'deviceModel', ''));
  v_email := trim(coalesce(p_payload->>'email', ''));
  v_mode := lower(trim(coalesce(p_payload->>'serviceMode', '')));
  v_device := lower(trim(coalesce(p_payload->>'deviceType', '')));
  v_os := lower(trim(coalesce(p_payload->>'operatingSystem', '')));
  v_date_text := trim(coalesce(p_payload->>'appointmentDate', ''));
  v_time_text := trim(coalesce(p_payload->>'appointmentTime', ''));
  IF v_os = '' THEN
    v_os := 'not_applicable';
  END IF;

  IF jsonb_typeof(p_payload->'serviceIds') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF char_length(v_first) < 1 OR char_length(v_first) > 80
     OR char_length(v_last) < 1 OR char_length(v_last) > 80
     OR char_length(v_address) < 1 OR char_length(v_address) > 200
     OR char_length(v_city) > 80
     OR char_length(v_comments) > 1000
     OR char_length(v_problem) > 2000
     OR char_length(v_brand) > 80
     OR char_length(v_model) > 80
     OR char_length(v_email) > 120
     OR v_mode NOT IN ('onsite', 'remote', 'workshop')
     OR v_os NOT IN ('windows', 'macos', 'linux', 'chromeos', 'other', 'unknown', 'not_applicable')
     OR (v_email <> '' AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     OR (v_device <> '' AND v_device NOT IN (
       'desktop', 'laptop', 'mac', 'server', 'printer', 'router', 'nas', 'smart_home', 'smartphone', 'other'
     ))
     OR v_date_text !~ '^\d{4}-\d{2}-\d{2}$'
     OR v_time_text !~ '^\d{2}:\d{2}$'
     OR jsonb_array_length(p_payload->'serviceIds') < 1
     OR jsonb_array_length(p_payload->'serviceIds') > 12 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_phone := public.normalize_phone(p_payload->>'phone');
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  BEGIN
    SELECT array_agg(value::uuid) INTO v_service_ids
    FROM jsonb_array_elements_text(p_payload->'serviceIds') AS value;
    v_date := v_date_text::date;
    v_time := v_time_text::time;
  EXCEPTION
    WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END;

  IF to_char(v_date, 'YYYY-MM-DD') <> v_date_text
     OR to_char(v_time, 'HH24:MI') <> v_time_text THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT count(*)::integer, count(DISTINCT service_id)::integer
  INTO v_count, v_distinct
  FROM unnest(v_service_ids) AS service_id;

  IF v_count <> v_distinct THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  -- Current service lines.
  SELECT
    COALESCE(array_agg(line.service_id ORDER BY line.service_id) FILTER (WHERE line.service_id IS NOT NULL), '{}'::uuid[]),
    COALESCE(jsonb_agg(jsonb_build_object(
      'serviceId', line.service_id,
      'name', line.service_name_snapshot,
      'duration', line.duration_minutes,
      'unitPrice', line.unit_price,
      'priceType', line.price_type_snapshot,
      'total', line.total_price,
      'currency', line.currency
    ) ORDER BY line.created_at), '[]'::jsonb)
  INTO v_old_ids, v_old_lines
  FROM public.booking_services AS line
  WHERE line.booking_id = v_booking.id;

  SELECT array_agg(service_id ORDER BY service_id) INTO v_new_ids FROM unnest(v_service_ids) AS service_id;
  v_services_changed := v_old_ids IS DISTINCT FROM v_new_ids;

  -- Catalog data for the requested services (prices only matter when the set changed).
  FOR v_service IN
    SELECT service.*
    FROM public.services AS service
    JOIN public.service_categories AS category ON category.id = service.category_id
    WHERE service.id = ANY (v_service_ids)
      AND service.active
      AND service.archived_at IS NULL
      AND category.active
      AND category.archived_at IS NULL
  LOOP
    v_line_total := public.service_line_total(
      v_service.price_type,
      v_service.price,
      v_service.default_duration_minutes,
      1
    );
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'serviceId', v_service.id,
      'name', jsonb_build_object('ru', v_service.name_ru, 'he', v_service.name_he, 'en', v_service.name_en),
      'duration', v_service.default_duration_minutes,
      'unitPrice', v_service.price,
      'priceType', v_service.price_type,
      'total', v_line_total,
      'currency', v_service.currency,
      'onsite', v_service.onsite_available,
      'remote', v_service.remote_available,
      'workshop', v_service.workshop_available,
      'requiresDevice', v_service.requires_device,
      'requiresOs', v_service.requires_operating_system,
      'paymentPolicy', v_service.payment_policy
    ));
  END LOOP;

  IF jsonb_array_length(v_lines) <> v_distinct THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SERVICE_UNAVAILABLE');
  END IF;

  IF (v_mode = 'onsite' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE (line->>'onsite')::boolean IS DISTINCT FROM true))
     OR (v_mode = 'remote' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE (line->>'remote')::boolean IS DISTINCT FROM true))
     OR (v_mode = 'workshop' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE (line->>'workshop')::boolean IS DISTINCT FROM true)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SERVICE_MODE');
  END IF;

  SELECT bool_or((line->>'requiresDevice')::boolean), bool_or((line->>'requiresOs')::boolean),
         bool_or(line->>'paymentPolicy' IN ('required_before_booking', 'deposit'))
  INTO v_requires_device, v_requires_os, v_requires_payment
  FROM jsonb_array_elements(v_lines) AS line;

  IF v_requires_device AND v_device = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_requires_os AND v_os IN ('not_applicable', '') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF v_services_changed THEN
    -- New set of services: current catalog prices and durations.
    SELECT COALESCE(sum((line->>'duration')::integer), 0)::integer
    INTO v_duration
    FROM jsonb_array_elements(v_lines) AS line;

    SELECT sum((line->>'total')::numeric)
    INTO v_total
    FROM jsonb_array_elements(v_lines) AS line
    WHERE line->>'total' IS NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE line->>'total' IS NOT NULL
    ) THEN
      v_total := NULL;
    END IF;

    SELECT min(line->>'currency') INTO v_currency FROM jsonb_array_elements(v_lines) AS line;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_lines) AS line WHERE line->>'currency' IS DISTINCT FROM v_currency
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;
  ELSE
    -- Same services: keep the prices the customer agreed to.
    SELECT COALESCE(sum(line.duration_minutes), 0)::integer
    INTO v_duration
    FROM public.booking_services AS line
    WHERE line.booking_id = v_booking.id;
    IF v_duration < 15 THEN
      v_duration := GREATEST(15, EXTRACT(EPOCH FROM (v_booking.appointment_end - v_booking.appointment_start))::integer / 60);
    END IF;
    v_total := v_booking.total_amount;
    v_currency := COALESCE(v_booking.currency, 'ILS');
    v_lines := v_old_lines;
  END IF;

  -- Schedule.
  v_local := v_date + v_time;
  v_start := v_local AT TIME ZONE v_settings.timezone;
  v_end := v_start + make_interval(mins => v_duration);
  v_end_local := v_end AT TIME ZONE v_settings.timezone;
  v_schedule_changed := v_start IS DISTINCT FROM v_booking.appointment_start
    OR v_end IS DISTINCT FROM v_booking.appointment_end;
  v_date_changed := (v_booking.appointment_start AT TIME ZONE v_settings.timezone)::date IS DISTINCT FROM v_date;

  IF v_schedule_changed THEN
    IF (v_start AT TIME ZONE v_settings.timezone)::date IS DISTINCT FROM v_date
       OR to_char((v_start AT TIME ZONE v_settings.timezone)::time, 'HH24:MI') IS DISTINCT FROM to_char(v_time, 'HH24:MI') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;

    v_today := (now() AT TIME ZONE v_settings.timezone)::date;
    IF v_date > v_today + 730 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;
    IF v_date < v_today OR v_start <= now() THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DATE_IN_PAST');
    END IF;

    SELECT * INTO v_hours
    FROM public.working_hours
    WHERE weekday = EXTRACT(DOW FROM v_date)::smallint;

    IF NOT FOUND OR NOT v_hours.enabled THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_WEEKDAY');
    END IF;

    IF EXISTS (SELECT 1 FROM public.booking_disabled_dates AS disabled WHERE disabled.disabled_date = v_date) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DISABLED_DATE');
    END IF;

    v_offset := EXTRACT(EPOCH FROM (v_time - v_hours.start_time));
    IF v_time < v_hours.start_time
       OR v_end_local::date IS DISTINCT FROM v_date
       OR v_end_local::time > v_hours.end_time
       OR v_offset < 0
       OR mod(v_offset, (v_settings.slot_step_minutes * 60)::numeric) <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_WORKING_HOURS');
    END IF;

    IF public.booking_range_conflicts(v_start, v_end, v_settings.buffer_minutes, v_booking.id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SLOT_UNAVAILABLE');
    END IF;

    IF v_date_changed AND v_settings.max_bookings_per_day IS NOT NULL THEN
      v_count := public.blocking_bookings_on_date(v_date, v_settings.timezone, v_booking.id);
      IF v_count >= v_settings.max_bookings_per_day THEN
        RETURN jsonb_build_object('ok', false, 'code', 'DAILY_LIMIT_REACHED');
      END IF;
    END IF;
  END IF;

  v_fields_changed :=
    v_first IS DISTINCT FROM v_booking.first_name
    OR v_last IS DISTINCT FROM v_booking.last_name
    OR v_phone IS DISTINCT FROM v_booking.phone
    OR NULLIF(v_email, '') IS DISTINCT FROM v_booking.email
    OR v_address IS DISTINCT FROM v_booking.address
    OR NULLIF(v_city, '') IS DISTINCT FROM v_booking.city
    OR v_os IS DISTINCT FROM v_booking.operating_system
    OR NULLIF(v_comments, '') IS DISTINCT FROM v_booking.comments
    OR NULLIF(v_problem, '') IS DISTINCT FROM v_booking.problem_description
    OR v_mode IS DISTINCT FROM v_booking.service_mode
    OR NULLIF(v_device, '') IS DISTINCT FROM v_booking.device_type
    OR NULLIF(v_brand, '') IS DISTINCT FROM v_booking.device_brand
    OR NULLIF(v_model, '') IS DISTINCT FROM v_booking.device_model;

  IF NOT v_fields_changed AND NOT v_services_changed AND NOT v_schedule_changed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'bookingId', v_booking.id,
      'totalAmount', v_booking.total_amount,
      'currency', v_booking.currency,
      'refundAmount', 0,
      'extraAmount', 0,
      'status', v_booking.status,
      'paymentStatus', v_booking.payment_status,
      'nextEditAt', v_booking.customer_edited_at + interval '24 hours'
    );
  END IF;

  -- Payment reconciliation (only when the price could have changed).
  v_status := v_booking.status;
  v_payment_status := v_booking.payment_status;
  v_expires := v_booking.payment_expires_at;

  IF v_services_changed AND v_total IS DISTINCT FROM v_booking.total_amount THEN
    IF v_booking.status = 'pending_payment' THEN
      -- The customer has not paid yet: the hold simply follows the new price.
      SELECT * INTO v_pending_charge
      FROM public.payments
      WHERE booking_id = v_booking.id AND kind = 'charge' AND status IN ('pending', 'awaiting_verification')
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_total IS NULL OR v_total <= 0 THEN
        IF v_requires_payment THEN
          RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
        END IF;
        IF FOUND THEN
          UPDATE public.payments SET status = 'cancelled' WHERE id = v_pending_charge.id;
        END IF;
        v_status := 'new';
        v_payment_status := NULL;
        v_expires := NULL;
      ELSIF FOUND THEN
        UPDATE public.payments SET amount = v_total WHERE id = v_pending_charge.id;
      END IF;
    ELSE
      -- Drop unprocessed adjustments from earlier edits; they are recomputed below.
      UPDATE public.payments
      SET status = 'cancelled'
      WHERE booking_id = v_booking.id
        AND (
          (kind = 'charge' AND status IN ('pending', 'awaiting_verification') AND expires_at IS NULL)
          OR (kind = 'refund' AND status = 'pending')
        );

      SELECT COALESCE(sum(CASE
        WHEN kind = 'charge' AND status = 'paid' THEN amount
        WHEN kind = 'refund' AND status = 'refunded' THEN -amount
        ELSE 0
      END), 0)
      INTO v_net_paid
      FROM public.payments
      WHERE booking_id = v_booking.id;

      IF v_net_paid <= 0 THEN
        IF v_requires_payment THEN
          -- Prepaid services cannot be added to an unpaid booking from the edit form.
          RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_REQUIRED');
        END IF;
      ELSIF v_total IS NOT NULL THEN
        SELECT * INTO v_paid_charge
        FROM public.payments
        WHERE booking_id = v_booking.id AND kind = 'charge' AND status = 'paid'
        ORDER BY paid_at DESC NULLS LAST, created_at DESC
        LIMIT 1;

        SELECT method.integration_type INTO v_method_type
        FROM public.payment_methods AS method
        WHERE method.id = v_paid_charge.payment_method_id;

        v_delta := round(v_total - v_net_paid, 2);
        IF v_delta < 0 THEN
          v_refund := -v_delta;
          INSERT INTO public.payments (
            booking_id, payment_method_id, provider, amount, currency, status, kind
          ) VALUES (
            v_booking.id, v_paid_charge.payment_method_id, v_paid_charge.provider,
            v_refund, COALESCE(v_currency, v_paid_charge.currency, 'ILS'), 'pending', 'refund'
          );
          v_payment_status := CASE WHEN v_total <= 0 THEN 'refunded' ELSE 'partially_refunded' END;
        ELSIF v_delta > 0 THEN
          v_extra := v_delta;
          v_payment_status := CASE WHEN v_method_type = 'automatic' THEN 'pending' ELSE 'awaiting_verification' END;
          INSERT INTO public.payments (
            booking_id, payment_method_id, provider, amount, currency, status, kind
          ) VALUES (
            v_booking.id, v_paid_charge.payment_method_id, v_paid_charge.provider,
            v_extra, COALESCE(v_currency, v_paid_charge.currency, 'ILS'), v_payment_status, 'charge'
          );
        ELSE
          v_payment_status := 'paid';
        END IF;
      END IF;
      -- v_total IS NULL with money already paid: the payment stays as a prepayment.
    END IF;
  END IF;

  UPDATE public.bookings
  SET
    first_name = v_first,
    last_name = v_last,
    phone = v_phone,
    email = NULLIF(v_email, ''),
    address = v_address,
    city = NULLIF(v_city, ''),
    operating_system = v_os,
    comments = NULLIF(v_comments, ''),
    problem_description = NULLIF(v_problem, ''),
    service_mode = v_mode,
    device_type = NULLIF(v_device, ''),
    device_brand = NULLIF(v_brand, ''),
    device_model = NULLIF(v_model, ''),
    appointment_date = v_start,
    appointment_start = v_start,
    appointment_end = v_end,
    subtotal = v_total,
    total_amount = v_total,
    currency = COALESCE(v_currency, 'ILS'),
    status = v_status,
    payment_status = v_payment_status,
    payment_expires_at = v_expires,
    customer_edited_at = now()
  WHERE id = v_booking.id;

  IF v_services_changed THEN
    DELETE FROM public.booking_services WHERE booking_id = v_booking.id;

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      INSERT INTO public.booking_services (
        booking_id, service_id, service_name_snapshot, duration_minutes,
        unit_price, price_type_snapshot, quantity, total_price, currency
      ) VALUES (
        v_booking.id,
        (v_line->>'serviceId')::uuid,
        v_line->'name',
        (v_line->>'duration')::integer,
        (v_line->>'unitPrice')::numeric,
        v_line->>'priceType',
        1,
        (v_line->>'total')::numeric,
        v_line->>'currency'
      );
    END LOOP;

    INSERT INTO public.booking_history (booking_id, action, old_data, new_data, changed_by)
    VALUES (
      v_booking.id,
      'services_changed',
      jsonb_build_object('services', v_old_lines, 'totalAmount', v_booking.total_amount),
      jsonb_build_object(
        'services', v_lines,
        'totalAmount', v_total,
        'refundAmount', v_refund,
        'extraAmount', v_extra,
        'editedByCustomer', true
      ),
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'servicesChanged', v_services_changed,
    'scheduleChanged', v_schedule_changed,
    'bookingId', v_booking.id,
    'totalAmount', v_total,
    'previousTotalAmount', v_booking.total_amount,
    'currency', COALESCE(v_currency, 'ILS'),
    'netPaid', v_net_paid,
    'refundAmount', v_refund,
    'extraAmount', v_extra,
    'status', v_status,
    'paymentStatus', v_payment_status,
    'nextEditAt', now() + interval '24 hours'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'customer_update_booking failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin review understands refund rows
-- ---------------------------------------------------------------------------

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
  v_booking public.bookings%ROWTYPE;
  v_type text;
  v_open_refunds integer;
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

  IF v_payment.kind = 'refund' THEN
    -- Refunds are always settled by the administrator, whatever the original method.
    SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id;

    IF p_decision = 'paid' THEN
      UPDATE public.payments
      SET status = 'refunded', refunded_at = now()
      WHERE id = v_payment.id;

      UPDATE public.bookings
      SET payment_status = CASE
        WHEN total_amount IS NULL OR total_amount <= 0 THEN 'refunded'
        ELSE 'partially_refunded'
      END
      WHERE id = v_payment.booking_id;
    ELSE
      UPDATE public.payments
      SET status = 'failed'
      WHERE id = v_payment.id;

      SELECT count(*)::integer INTO v_open_refunds
      FROM public.payments
      WHERE booking_id = v_payment.booking_id AND kind = 'refund' AND status IN ('pending', 'refunded');

      UPDATE public.bookings
      SET payment_status = CASE WHEN v_open_refunds = 0 THEN 'paid' ELSE payment_status END
      WHERE id = v_payment.booking_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'paymentId', v_payment.id, 'status', p_decision, 'kind', 'refund');
  END IF;

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
  ELSIF v_payment.expires_at IS NULL AND EXISTS (
    SELECT 1 FROM public.payments AS paid
    WHERE paid.booking_id = v_payment.booking_id AND paid.kind = 'charge' AND paid.status = 'paid'
  ) THEN
    -- Rejected top-up for an already paid booking: the booking itself stays paid.
    UPDATE public.payments
    SET status = 'failed'
    WHERE id = v_payment.id;

    UPDATE public.bookings
    SET payment_status = 'paid'
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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.booking_range_conflicts(timestamptz, timestamptz, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.blocking_bookings_on_date(date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.available_slots_for_date(date, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.available_slots_for_date(date, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_availability(text, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_month_availability(text, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.customer_update_booking(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_manual_payment(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.available_slots_for_date(date, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.available_slots_for_date(date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_availability(text, uuid[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_month_availability(text, uuid[], text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.customer_update_booking(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_manual_payment(uuid, text) TO authenticated;
