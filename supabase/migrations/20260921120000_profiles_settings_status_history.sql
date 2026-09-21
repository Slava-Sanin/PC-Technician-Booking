/*
  Staff roles, shared booking settings, booking status, and audit history.

  Existing bookings rows are preserved.
  completed remains as a deprecated compatibility column and is kept in sync with status.

  Bootstrap: every auth.users row that already exists WHEN this migration runs
  receives an active admin profile. Users created later are not assigned a role.
*/

DO $$
BEGIN
  CREATE TYPE public.staff_role AS ENUM ('admin', 'technician');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.booking_status AS ENUM (
    'new',
    'confirmed',
    'assigned',
    'on_the_way',
    'in_progress',
    'completed',
    'cancelled',
    'no_show'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.staff_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid()
      AND active = true
      AND role IN ('admin'::public.staff_role, 'technician'::public.staff_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = auth.uid()
      AND active = true
      AND role = 'admin'::public.staff_role
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

INSERT INTO public.profiles (user_id, role, active)
SELECT id, 'admin'::public.staff_role, true
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can read profiles" ON public.profiles;
CREATE POLICY "Admins can read profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
CREATE POLICY "Admins can insert profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.booking_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  first_day_of_week smallint NOT NULL DEFAULT 1 CHECK (first_day_of_week IN (0, 1)),
  disabled_weekdays smallint[] NOT NULL DEFAULT '{}',
  min_interval_minutes integer NOT NULL DEFAULT 180 CHECK (min_interval_minutes BETWEEN 30 AND 1440),
  work_start_time time NOT NULL DEFAULT '09:00',
  work_end_time time NOT NULL DEFAULT '20:00',
  max_bookings_per_day integer CHECK (max_bookings_per_day IS NULL OR max_bookings_per_day >= 1),
  send_sms boolean NOT NULL DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Jerusalem',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_settings_hours_order CHECK (work_end_time > work_start_time),
  CONSTRAINT booking_settings_weekdays_valid CHECK (
    disabled_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  CONSTRAINT booking_settings_timezone_known CHECK (char_length(timezone) BETWEEN 1 AND 64)
);

INSERT INTO public.booking_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_booking_settings_updated_at ON public.booking_settings;
CREATE TRIGGER update_booking_settings_updated_at
  BEFORE UPDATE ON public.booking_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.booking_disabled_dates (
  disabled_date date PRIMARY KEY,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_disabled_dates_reason_len CHECK (reason IS NULL OR char_length(reason) <= 200)
);

ALTER TABLE public.booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_disabled_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read booking settings" ON public.booking_settings;
CREATE POLICY "Staff can read booking settings"
  ON public.booking_settings
  FOR SELECT
  TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can update booking settings" ON public.booking_settings;
CREATE POLICY "Admins can update booking settings"
  ON public.booking_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read disabled dates" ON public.booking_disabled_dates;
CREATE POLICY "Staff can read disabled dates"
  ON public.booking_disabled_dates
  FOR SELECT
  TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can insert disabled dates" ON public.booking_disabled_dates;
CREATE POLICY "Admins can insert disabled dates"
  ON public.booking_disabled_dates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete disabled dates" ON public.booking_disabled_dates;
CREATE POLICY "Admins can delete disabled dates"
  ON public.booking_disabled_dates
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

REVOKE ALL ON TABLE public.booking_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booking_disabled_dates FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.booking_settings TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.booking_disabled_dates TO authenticated;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS status public.booking_status;

UPDATE public.bookings
SET status = CASE
  WHEN completed IS TRUE THEN 'completed'::public.booking_status
  ELSE 'new'::public.booking_status
END
WHERE status IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN status SET DEFAULT 'new'::public.booking_status;

ALTER TABLE public.bookings
  ALTER COLUMN status SET NOT NULL;

COMMENT ON COLUMN public.bookings.completed IS
  'Deprecated compatibility column. Source of truth is status. A trigger sets completed = (status = completed). Do not use completed in new code.';

CREATE TABLE IF NOT EXISTS public.booking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'created',
    'updated',
    'status_changed',
    'appointment_changed',
    'phone_changed',
    'address_changed',
    'city_changed',
    'comments_changed',
    'notes_changed',
    'soft_deleted'
  )),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_history_booking_id_idx
  ON public.booking_history (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bookings_active_appointment_idx
  ON public.bookings (appointment_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bookings_active_status_idx
  ON public.bookings (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bookings_deleted_idx
  ON public.bookings (deleted_at)
  WHERE deleted_at IS NOT NULL;

ALTER TABLE public.booking_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read booking history" ON public.booking_history;
CREATE POLICY "Staff can read booking history"
  ON public.booking_history
  FOR SELECT
  TO authenticated
  USING (public.is_staff());

REVOKE ALL ON TABLE public.booking_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.booking_history TO authenticated;

CREATE OR REPLACE FUNCTION public.booking_audit_snapshot(p public.bookings)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'status', p.status,
    'appointment_date', p.appointment_date,
    'phone', p.phone,
    'address', p.address,
    'city', p.city,
    'comments', p.comments,
    'technician_notes', p.technician_notes,
    'deleted_at', p.deleted_at,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'operating_system', p.operating_system,
    'booking_number', p.booking_number
  );
$$;

CREATE OR REPLACE FUNCTION public.protect_booking_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.booking_number := OLD.booking_number;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_booking_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.completed IS DISTINCT FROM OLD.completed THEN
    IF NEW.completed THEN
      NEW.status := 'completed'::public.booking_status;
    ELSIF OLD.status = 'completed'::public.booking_status THEN
      NEW.status := 'new'::public.booking_status;
    END IF;
  END IF;

  NEW.completed := (NEW.status = 'completed'::public.booking_status);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_booking_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text := 'updated';
  v_status boolean := false;
  v_appointment boolean := false;
  v_phone boolean := false;
  v_address boolean := false;
  v_city boolean := false;
  v_comments boolean := false;
  v_notes boolean := false;
  v_changes integer := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.booking_history (booking_id, action, old_data, new_data, changed_by)
    VALUES (NEW.id, 'created', NULL, public.booking_audit_snapshot(NEW), auth.uid());
    RETURN NEW;
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_action := 'soft_deleted';
  ELSE
    v_status := OLD.status IS DISTINCT FROM NEW.status;
    v_appointment := OLD.appointment_date IS DISTINCT FROM NEW.appointment_date;
    v_phone := OLD.phone IS DISTINCT FROM NEW.phone;
    v_address := OLD.address IS DISTINCT FROM NEW.address;
    v_city := OLD.city IS DISTINCT FROM NEW.city;
    v_comments := OLD.comments IS DISTINCT FROM NEW.comments;
    v_notes := OLD.technician_notes IS DISTINCT FROM NEW.technician_notes;

    v_changes :=
      (CASE WHEN v_status THEN 1 ELSE 0 END) +
      (CASE WHEN v_appointment THEN 1 ELSE 0 END) +
      (CASE WHEN v_phone THEN 1 ELSE 0 END) +
      (CASE WHEN v_address THEN 1 ELSE 0 END) +
      (CASE WHEN v_city THEN 1 ELSE 0 END) +
      (CASE WHEN v_comments THEN 1 ELSE 0 END) +
      (CASE WHEN v_notes THEN 1 ELSE 0 END) +
      (CASE WHEN OLD.first_name IS DISTINCT FROM NEW.first_name THEN 1 ELSE 0 END) +
      (CASE WHEN OLD.last_name IS DISTINCT FROM NEW.last_name THEN 1 ELSE 0 END) +
      (CASE WHEN OLD.operating_system IS DISTINCT FROM NEW.operating_system THEN 1 ELSE 0 END) +
      (CASE WHEN OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN 1 ELSE 0 END);

    IF v_changes = 0 THEN
      RETURN NEW;
    ELSIF v_changes = 1 AND v_status THEN
      v_action := 'status_changed';
    ELSIF v_changes = 1 AND v_appointment THEN
      v_action := 'appointment_changed';
    ELSIF v_changes = 1 AND v_phone THEN
      v_action := 'phone_changed';
    ELSIF v_changes = 1 AND v_address THEN
      v_action := 'address_changed';
    ELSIF v_changes = 1 AND v_city THEN
      v_action := 'city_changed';
    ELSIF v_changes = 1 AND v_comments THEN
      v_action := 'comments_changed';
    ELSIF v_changes = 1 AND v_notes THEN
      v_action := 'notes_changed';
    ELSE
      v_action := 'updated';
    END IF;
  END IF;

  INSERT INTO public.booking_history (booking_id, action, old_data, new_data, changed_by)
  VALUES (
    NEW.id,
    v_action,
    public.booking_audit_snapshot(OLD),
    public.booking_audit_snapshot(NEW),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_protect_columns ON public.bookings;
CREATE TRIGGER bookings_protect_columns
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_booking_columns();

DROP TRIGGER IF EXISTS bookings_sync_status ON public.bookings;
CREATE TRIGGER bookings_sync_status
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_status();

DROP TRIGGER IF EXISTS bookings_log_history ON public.bookings;
CREATE TRIGGER bookings_log_history
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_booking_history();

REVOKE ALL ON FUNCTION public.booking_audit_snapshot(public.bookings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_booking_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_booking_history() TO service_role;
