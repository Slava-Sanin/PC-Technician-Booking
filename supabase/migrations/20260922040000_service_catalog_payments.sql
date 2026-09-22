/*
  Service catalog, multi-service bookings, working hours, and payments.

  Existing booking rows are kept. New columns are nullable or backfilled.
  New booking_status values are added here and used only in the next migration,
  because PostgreSQL cannot use a freshly added enum value in the same transaction.
*/

ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'pending_payment';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'waiting_for_parts';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'waiting_for_customer';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'payment_expired';

ALTER TABLE public.booking_settings
  ADD COLUMN IF NOT EXISTS slot_step_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_hold_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS buffer_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_slot_step_range;
ALTER TABLE public.booking_settings
  ADD CONSTRAINT booking_settings_slot_step_range CHECK (slot_step_minutes BETWEEN 5 AND 240);

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_payment_hold_range;
ALTER TABLE public.booking_settings
  ADD CONSTRAINT booking_settings_payment_hold_range CHECK (payment_hold_minutes BETWEEN 5 AND 240);

ALTER TABLE public.booking_settings DROP CONSTRAINT IF EXISTS booking_settings_buffer_range;
ALTER TABLE public.booking_settings
  ADD CONSTRAINT booking_settings_buffer_range CHECK (buffer_minutes BETWEEN 0 AND 240);

CREATE TABLE IF NOT EXISTS public.working_hours (
  weekday smallint PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),
  enabled boolean NOT NULL DEFAULT true,
  start_time time NOT NULL DEFAULT '09:00',
  end_time time NOT NULL DEFAULT '18:00',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT working_hours_order CHECK (end_time > start_time)
);

INSERT INTO public.working_hours (weekday, enabled, start_time, end_time)
SELECT
  day_number::smallint,
  NOT (day_number::smallint = ANY (settings.disabled_weekdays)),
  settings.work_start_time,
  settings.work_end_time
FROM public.booking_settings AS settings
CROSS JOIN generate_series(0, 6) AS day_number
ON CONFLICT (weekday) DO NOTHING;

DROP TRIGGER IF EXISTS update_working_hours_updated_at ON public.working_hours;
CREATE TRIGGER update_working_hours_updated_at
  BEFORE UPDATE ON public.working_hours
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,64}$'),
  name_ru text NOT NULL CHECK (char_length(name_ru) BETWEEN 1 AND 120),
  name_he text NOT NULL CHECK (char_length(name_he) BETWEEN 1 AND 120),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 120),
  description_ru text CHECK (description_ru IS NULL OR char_length(description_ru) <= 500),
  description_he text CHECK (description_he IS NULL OR char_length(description_he) <= 500),
  description_en text CHECK (description_en IS NULL OR char_length(description_en) <= 500),
  icon text CHECK (icon IS NULL OR char_length(icon) <= 40),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.service_categories(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,64}$'),
  name_ru text NOT NULL CHECK (char_length(name_ru) BETWEEN 1 AND 160),
  name_he text NOT NULL CHECK (char_length(name_he) BETWEEN 1 AND 160),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 160),
  description_ru text CHECK (description_ru IS NULL OR char_length(description_ru) <= 800),
  description_he text CHECK (description_he IS NULL OR char_length(description_he) <= 800),
  description_en text CHECK (description_en IS NULL OR char_length(description_en) <= 800),
  default_duration_minutes integer NOT NULL CHECK (default_duration_minutes BETWEEN 15 AND 720),
  price numeric(12, 2) CHECK (price IS NULL OR price >= 0),
  price_type text NOT NULL CHECK (price_type IN ('fixed', 'from', 'hourly', 'quote', 'diagnostic')),
  currency text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  onsite_available boolean NOT NULL DEFAULT true,
  remote_available boolean NOT NULL DEFAULT false,
  workshop_available boolean NOT NULL DEFAULT false,
  requires_device boolean NOT NULL DEFAULT false,
  requires_operating_system boolean NOT NULL DEFAULT false,
  payment_policy text NOT NULL DEFAULT 'none' CHECK (
    payment_policy IN (
      'none',
      'optional',
      'required_before_booking',
      'required_before_service',
      'deposit',
      'after_service'
    )
  ),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT services_mode_available CHECK (onsite_available OR remote_available OR workshop_available),
  CONSTRAINT services_priced_when_listed CHECK (
    price_type IN ('quote', 'diagnostic')
    OR price IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  name_ru text NOT NULL CHECK (char_length(name_ru) BETWEEN 1 AND 80),
  name_he text NOT NULL CHECK (char_length(name_he) BETWEEN 1 AND 80),
  name_en text NOT NULL CHECK (char_length(name_en) BETWEEN 1 AND 80),
  integration_type text NOT NULL CHECK (integration_type IN ('automatic', 'external_link', 'manual')),
  instructions_ru text CHECK (instructions_ru IS NULL OR char_length(instructions_ru) <= 800),
  instructions_he text CHECK (instructions_he IS NULL OR char_length(instructions_he) <= 800),
  instructions_en text CHECK (instructions_en IS NULL OR char_length(instructions_en) <= 800),
  external_url text CHECK (external_url IS NULL OR char_length(external_url) <= 400),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.service_payment_methods (
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  payment_method_id uuid NOT NULL REFERENCES public.payment_methods(id),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (service_id, payment_method_id)
);

CREATE TABLE IF NOT EXISTS public.bank_transfer_profiles (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name text CHECK (bank_name IS NULL OR char_length(bank_name) <= 120),
  branch text CHECK (branch IS NULL OR char_length(branch) <= 40),
  account_number text CHECK (account_number IS NULL OR char_length(account_number) <= 40),
  beneficiary text CHECK (beneficiary IS NULL OR char_length(beneficiary) <= 160),
  iban text CHECK (iban IS NULL OR char_length(iban) <= 42),
  instructions_ru text CHECK (instructions_ru IS NULL OR char_length(instructions_ru) <= 800),
  instructions_he text CHECK (instructions_he IS NULL OR char_length(instructions_he) <= 800),
  instructions_en text CHECK (instructions_en IS NULL OR char_length(instructions_en) <= 800),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bank_transfer_profiles (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS service_mode text,
  ADD COLUMN IF NOT EXISTS device_type text,
  ADD COLUMN IF NOT EXISTS device_brand text,
  ADD COLUMN IF NOT EXISTS device_model text,
  ADD COLUMN IF NOT EXISTS problem_description text,
  ADD COLUMN IF NOT EXISTS appointment_start timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_end timestamptz,
  ADD COLUMN IF NOT EXISTS subtotal numeric(12, 2),
  ADD COLUMN IF NOT EXISTS total_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;

UPDATE public.bookings
SET appointment_start = appointment_date
WHERE appointment_start IS NULL;

UPDATE public.bookings
SET appointment_end = appointment_start + interval '180 minutes'
WHERE appointment_end IS NULL
  AND appointment_start IS NOT NULL;

UPDATE public.bookings
SET currency = 'ILS'
WHERE currency IS NULL;

ALTER TABLE public.bookings ALTER COLUMN appointment_start SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN appointment_end SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN currency SET DEFAULT 'ILS';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_service_mode_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_mode_check CHECK (
    service_mode IS NULL OR service_mode IN ('onsite', 'remote', 'workshop')
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_device_type_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_device_type_check CHECK (
    device_type IS NULL OR device_type IN (
      'desktop', 'laptop', 'mac', 'server', 'printer', 'router', 'nas', 'smart_home', 'smartphone', 'other'
    )
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_email_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_email_check CHECK (
    email IS NULL OR email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_text_lengths;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_text_lengths CHECK (
    (email IS NULL OR char_length(email) <= 120)
    AND (device_brand IS NULL OR char_length(device_brand) <= 80)
    AND (device_model IS NULL OR char_length(device_model) <= 80)
    AND (problem_description IS NULL OR char_length(problem_description) <= 2000)
    AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_amounts_nonnegative;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_amounts_nonnegative CHECK (
    (subtotal IS NULL OR subtotal >= 0)
    AND (total_amount IS NULL OR total_amount >= 0)
  );

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_appointment_range;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_appointment_range CHECK (appointment_end > appointment_start);

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_payment_status_check CHECK (
    payment_status IS NULL OR payment_status IN (
      'pending',
      'awaiting_verification',
      'paid',
      'failed',
      'expired',
      'cancelled',
      'refunded',
      'partially_refunded'
    )
  );

CREATE TABLE IF NOT EXISTS public.booking_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id),
  service_name_snapshot jsonb NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 720),
  unit_price numeric(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  price_type_snapshot text NOT NULL CHECK (price_type_snapshot IN ('fixed', 'from', 'hourly', 'quote', 'diagnostic')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  total_price numeric(12, 2) CHECK (total_price IS NULL OR total_price >= 0),
  currency text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, service_id)
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES public.payment_methods(id),
  provider text CHECK (provider IS NULL OR char_length(provider) <= 40),
  provider_payment_id text CHECK (provider_payment_id IS NULL OR char_length(provider_payment_id) <= 120),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (
    status IN (
      'pending',
      'awaiting_verification',
      'paid',
      'failed',
      'expired',
      'cancelled',
      'refunded',
      'partially_refunded'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz,
  refunded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_idx
  ON public.payments (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE CHECK (char_length(event_id) BETWEEN 4 AND 160),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 40),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.booking_history'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.booking_history DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.booking_history
  ADD CONSTRAINT booking_history_action_check CHECK (action IN (
    'created',
    'updated',
    'status_changed',
    'appointment_changed',
    'phone_changed',
    'address_changed',
    'city_changed',
    'comments_changed',
    'notes_changed',
    'soft_deleted',
    'services_changed',
    'price_changed',
    'payment_changed',
    'customer_changed'
  ));

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.booking_rate_limits'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%limit_kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.booking_rate_limits DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE public.booking_rate_limits
  ADD CONSTRAINT booking_rate_limits_kind_check CHECK (
    limit_kind IN ('source_attempt', 'phone_success', 'payment_attempt', 'webhook_attempt')
  );

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

UPDATE public.profiles AS profile
SET email = users.email
FROM auth.users AS users
WHERE profile.user_id = users.id
  AND profile.email IS NULL;

DROP TRIGGER IF EXISTS update_service_categories_updated_at ON public.service_categories;
CREATE TRIGGER update_service_categories_updated_at
  BEFORE UPDATE ON public.service_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_services_updated_at ON public.services;
CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_bank_transfer_profiles_updated_at ON public.bank_transfer_profiles;
CREATE TRIGGER update_bank_transfer_profiles_updated_at
  BEFORE UPDATE ON public.bank_transfer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_booking_appointment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_duration interval;
BEGIN
  IF NEW.appointment_start IS NULL THEN
    NEW.appointment_start := NEW.appointment_date;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.appointment_date IS DISTINCT FROM OLD.appointment_date
     AND NEW.appointment_start IS NOT DISTINCT FROM OLD.appointment_start THEN
    v_duration := OLD.appointment_end - OLD.appointment_start;
    NEW.appointment_start := NEW.appointment_date;
    NEW.appointment_end := NEW.appointment_start + COALESCE(v_duration, interval '60 minutes');
  END IF;

  IF NEW.appointment_end IS NULL OR NEW.appointment_end <= NEW.appointment_start THEN
    NEW.appointment_end := NEW.appointment_start + interval '60 minutes';
  END IF;

  NEW.appointment_date := NEW.appointment_start;
  IF NEW.currency IS NULL THEN
    NEW.currency := 'ILS';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_sync_appointment ON public.bookings;
CREATE TRIGGER bookings_sync_appointment
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_appointment();

CREATE INDEX IF NOT EXISTS bookings_active_start_idx
  ON public.bookings (appointment_start)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS bookings_payment_status_idx
  ON public.bookings (payment_status)
  WHERE payment_status IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS booking_services_booking_idx
  ON public.booking_services (booking_id);

CREATE INDEX IF NOT EXISTS services_category_sort_idx
  ON public.services (category_id, sort_order);

CREATE INDEX IF NOT EXISTS services_public_idx
  ON public.services (category_id, sort_order)
  WHERE active = true AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS service_categories_public_idx
  ON public.service_categories (sort_order)
  WHERE active = true AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_booking_idx
  ON public.payments (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status_idx
  ON public.payments (status, created_at DESC);

INSERT INTO public.service_categories (
  code, name_ru, name_he, name_en, description_ru, description_he, description_en, icon, sort_order
) VALUES
  ('diagnostics', 'Диагностика', 'אבחון', 'Diagnostics', 'Проверка компьютера, ноутбука или сети', 'בדיקת מחשב, מחשב נייד או רשת', 'Check a computer, laptop, or network', 'activity', 10),
  ('new_computer', 'Новый компьютер', 'מחשב חדש', 'New computer', 'Первичная настройка нового компьютера', 'הגדרה ראשונית של מחשב חדש', 'First-time setup for a new computer', 'laptop', 20),
  ('operating_systems', 'Операционные системы', 'מערכות הפעלה', 'Operating systems', 'Установка и настройка операционных систем', 'התקנה והגדרה של מערכות הפעלה', 'Install and configure operating systems', 'monitor', 30),
  ('data', 'Данные', 'נתונים', 'Data', 'Перенос, резервные копии и восстановление', 'העברה, גיבוי ושחזור', 'Transfer, backup, and recovery', 'database', 40),
  ('network', 'Сеть и интернет', 'רשת ואינטרנט', 'Network and internet', 'Wi-Fi, роутер, LAN, NAS и офисная сеть', 'Wi-Fi, ראוטר, LAN, NAS ורשת משרדית', 'Wi-Fi, router, LAN, NAS, and office networks', 'wifi', 50),
  ('peripherals', 'Периферия', 'ציוד היקפי', 'Peripherals', 'Принтеры, сканеры и другие устройства', 'מדפסות, סורקים ומכשירים נוספים', 'Printers, scanners, and other devices', 'printer', 60),
  ('security', 'Безопасность', 'אבטחה', 'Security', 'Вирусы, malware и защита компьютера', 'וירוסים, נוזקות והגנת מחשב', 'Viruses, malware, and computer protection', 'shield', 70),
  ('email', 'Электронная почта', 'דואר אלקטרוני', 'Email', 'Outlook, Gmail и другая почта', 'Outlook, Gmail ודואר אחר', 'Outlook, Gmail, and other mail', 'mail', 80),
  ('software', 'Программы', 'תוכנות', 'Software', 'Установка, настройка и ошибки программ', 'התקנה, הגדרה ותיקון תוכנות', 'Install, configure, and fix software', 'package', 90),
  ('repair', 'Ремонт и модернизация', 'תיקון ושדרוג', 'Repair and upgrade', 'Ремонт, SSD, память и апгрейд', 'תיקון, SSD, זיכרון ושדרוג', 'Repair, SSD, memory, and upgrades', 'wrench', 100),
  ('remote_help', 'Удалённая помощь', 'סיוע מרחוק', 'Remote help', 'Помощь по удалённому подключению', 'עזרה בחיבור מרחוק', 'Help over a remote connection', 'headphones', 110),
  ('training', 'Обучение', 'הדרכה', 'Training', 'Обучение компьютеру, почте и безопасности', 'הדרכה למחשב, דואר ואבטחה', 'Training for computers, email, and security', 'book-open', 120),
  ('smart_home', 'Умный дом', 'בית חכם', 'Smart home', 'Камеры, розетки и Home Assistant', 'מצלמות, שקעים ו-Home Assistant', 'Cameras, plugs, and Home Assistant', 'home', 130)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.services (
  category_id, code, name_ru, name_he, name_en,
  default_duration_minutes, price, price_type, currency,
  onsite_available, remote_available, workshop_available,
  requires_device, requires_operating_system, payment_policy, sort_order
)
SELECT
  category.id,
  seed.code,
  seed.name_ru,
  seed.name_he,
  seed.name_en,
  seed.duration_minutes,
  seed.price,
  seed.price_type,
  'ILS',
  seed.onsite_available,
  seed.remote_available,
  seed.workshop_available,
  seed.requires_device,
  seed.requires_operating_system,
  seed.payment_policy,
  seed.sort_order
FROM (
  VALUES
    ('diagnostics', 'computer_diagnostics', 'Диагностика компьютера', 'אבחון מחשב', 'Computer diagnostics', 60, NULL::numeric, 'diagnostic', true, false, true, true, true, 'none', 10),
    ('diagnostics', 'laptop_diagnostics', 'Диагностика ноутбука', 'אבחון מחשב נייד', 'Laptop diagnostics', 60, NULL::numeric, 'diagnostic', true, false, true, true, true, 'none', 20),
    ('diagnostics', 'network_diagnostics', 'Диагностика сети', 'אבחון רשת', 'Network diagnostics', 60, NULL::numeric, 'diagnostic', true, true, false, true, false, 'none', 30),
    ('new_computer', 'new_pc_setup', 'Настройка нового компьютера', 'הגדרת מחשב חדש', 'New computer setup', 120, 350, 'fixed', true, true, false, true, true, 'optional', 10),
    ('new_computer', 'initial_os_setup', 'Первичная настройка Windows/macOS', 'הגדרה ראשונית של Windows/macOS', 'Initial Windows/macOS setup', 90, 280, 'fixed', true, true, false, true, true, 'optional', 20),
    ('new_computer', 'driver_install', 'Установка драйверов', 'התקנת מנהלי התקנים', 'Driver installation', 60, 180, 'fixed', true, true, true, true, true, 'optional', 30),
    ('new_computer', 'initial_software', 'Первоначальная установка программ', 'התקנה ראשונית של תוכנות', 'Initial software installation', 60, 180, 'fixed', true, true, false, true, true, 'optional', 40),
    ('operating_systems', 'windows_install', 'Установка Windows', 'התקנת Windows', 'Windows installation', 120, 350, 'fixed', true, true, true, true, true, 'optional', 10),
    ('operating_systems', 'windows_reinstall', 'Переустановка Windows', 'התקנה מחדש של Windows', 'Windows reinstallation', 120, 400, 'fixed', true, false, true, true, true, 'after_service', 20),
    ('operating_systems', 'linux_install', 'Установка Linux', 'התקנת Linux', 'Linux installation', 150, 400, 'fixed', true, true, true, true, true, 'optional', 30),
    ('operating_systems', 'macos_setup', 'Настройка macOS', 'הגדרת macOS', 'macOS setup', 90, 320, 'fixed', true, true, false, true, true, 'optional', 40),
    ('data', 'data_transfer', 'Перенос данных', 'העברת נתונים', 'Data transfer', 90, 250, 'from', true, false, true, true, false, 'after_service', 10),
    ('data', 'backup', 'Резервное копирование', 'גיבוי', 'Backup', 60, 200, 'fixed', true, true, false, true, false, 'optional', 20),
    ('data', 'data_recovery', 'Восстановление данных', 'שחזור נתונים', 'Data recovery', 180, NULL::numeric, 'quote', true, false, true, true, false, 'after_service', 30),
    ('network', 'wifi_setup', 'Настройка Wi-Fi', 'הגדרת Wi-Fi', 'Wi-Fi setup', 60, 180, 'fixed', true, true, false, true, false, 'after_service', 10),
    ('network', 'router_setup', 'Настройка роутера', 'הגדרת ראוטר', 'Router setup', 60, 220, 'fixed', true, false, false, true, false, 'after_service', 20),
    ('network', 'internet_issues', 'Решение проблем с интернетом', 'פתרון בעיות אינטרנט', 'Internet troubleshooting', 60, 180, 'from', true, true, false, false, false, 'after_service', 30),
    ('network', 'lan_setup', 'Настройка LAN', 'הגדרת LAN', 'LAN setup', 90, 280, 'fixed', true, false, false, true, false, 'after_service', 40),
    ('network', 'home_network', 'Настройка домашней сети', 'הגדרת רשת ביתית', 'Home network setup', 120, 350, 'fixed', true, false, false, true, false, 'after_service', 50),
    ('network', 'office_network', 'Настройка офисной сети', 'הגדרת רשת משרדית', 'Office network setup', 180, 500, 'from', true, false, false, true, false, 'after_service', 60),
    ('network', 'nas_setup', 'Настройка NAS', 'הגדרת NAS', 'NAS setup', 180, 450, 'fixed', true, false, true, true, false, 'after_service', 70),
    ('peripherals', 'printer_setup', 'Настройка принтера', 'הגדרת מדפסת', 'Printer setup', 45, 150, 'fixed', true, true, false, true, false, 'after_service', 10),
    ('peripherals', 'scanner_setup', 'Настройка сканера', 'הגדרת סורק', 'Scanner setup', 45, 150, 'fixed', true, false, false, true, false, 'after_service', 20),
    ('peripherals', 'other_peripheral', 'Настройка другой периферии', 'הגדרת ציוד היקפי אחר', 'Other peripheral setup', 45, 150, 'from', true, false, true, true, false, 'after_service', 30),
    ('security', 'virus_removal', 'Удаление вирусов', 'הסרת וירוסים', 'Virus removal', 90, 250, 'fixed', true, true, true, true, true, 'optional', 10),
    ('security', 'malware_removal', 'Удаление malware', 'הסרת נוזקות', 'Malware removal', 90, 280, 'fixed', true, true, true, true, true, 'optional', 20),
    ('security', 'computer_protection', 'Настройка защиты компьютера', 'הגדרת הגנת מחשב', 'Computer protection setup', 60, 200, 'fixed', true, true, false, true, true, 'optional', 30),
    ('email', 'outlook_setup', 'Настройка Outlook', 'הגדרת Outlook', 'Outlook setup', 45, 150, 'fixed', true, true, false, true, true, 'optional', 10),
    ('email', 'gmail_setup', 'Настройка Gmail', 'הגדרת Gmail', 'Gmail setup', 30, 120, 'fixed', true, true, false, true, false, 'optional', 20),
    ('email', 'email_setup', 'Настройка электронной почты', 'הגדרת דואר אלקטרוני', 'Email setup', 45, 150, 'fixed', true, true, false, true, false, 'optional', 30),
    ('software', 'software_install', 'Установка программ', 'התקנת תוכנות', 'Software installation', 45, 150, 'fixed', true, true, false, true, true, 'optional', 10),
    ('software', 'software_setup', 'Настройка программ', 'הגדרת תוכנות', 'Software configuration', 60, 180, 'fixed', true, true, false, true, true, 'optional', 20),
    ('software', 'software_errors', 'Устранение ошибок программ', 'תיקון שגיאות בתוכנות', 'Software error fixes', 60, 180, 'from', true, true, false, true, true, 'optional', 30),
    ('repair', 'pc_repair', 'Ремонт компьютера', 'תיקון מחשב', 'Computer repair', 120, NULL::numeric, 'quote', true, false, true, true, false, 'after_service', 10),
    ('repair', 'laptop_repair', 'Ремонт ноутбука', 'תיקון מחשב נייד', 'Laptop repair', 120, NULL::numeric, 'quote', true, false, true, true, false, 'after_service', 20),
    ('repair', 'ssd_replace', 'Замена SSD', 'החלפת SSD', 'SSD replacement', 60, 200, 'from', true, false, true, true, false, 'after_service', 30),
    ('repair', 'ram_install', 'Установка RAM', 'התקנת זיכרון RAM', 'RAM installation', 45, 150, 'fixed', true, false, true, true, false, 'after_service', 40),
    ('repair', 'component_replace', 'Замена компонентов', 'החלפת רכיבים', 'Component replacement', 90, 200, 'from', true, false, true, true, false, 'after_service', 50),
    ('repair', 'pc_upgrade', 'Апгрейд компьютера', 'שדרוג מחשב', 'Computer upgrade', 120, 250, 'from', true, false, true, true, false, 'after_service', 60),
    ('remote_help', 'remote_diagnostics', 'Удалённая диагностика', 'אבחון מרחוק', 'Remote diagnostics', 45, 120, 'fixed', false, true, false, true, true, 'required_before_booking', 10),
    ('remote_help', 'remote_windows', 'Удалённая настройка Windows', 'הגדרת Windows מרחוק', 'Remote Windows setup', 60, 180, 'fixed', false, true, false, true, true, 'required_before_booking', 20),
    ('remote_help', 'remote_software', 'Удалённая настройка программ', 'הגדרת תוכנות מרחוק', 'Remote software setup', 45, 150, 'fixed', false, true, false, true, true, 'required_before_booking', 30),
    ('remote_help', 'remote_email', 'Удалённая настройка электронной почты', 'הגדרת דואר אלקטרוני מרחוק', 'Remote email setup', 30, 120, 'fixed', false, true, false, true, false, 'required_before_booking', 40),
    ('training', 'train_windows', 'Обучение работе с Windows', 'הדרכה לעבודה עם Windows', 'Windows training', 60, 150, 'hourly', true, true, false, true, true, 'required_before_booking', 10),
    ('training', 'train_computer', 'Обучение работе с компьютером', 'הדרכה לעבודה עם מחשב', 'Computer training', 60, 150, 'hourly', true, true, false, true, false, 'required_before_booking', 20),
    ('training', 'train_email', 'Обучение электронной почте', 'הדרכה לדואר אלקטרוני', 'Email training', 45, 150, 'hourly', true, true, false, false, false, 'required_before_booking', 30),
    ('training', 'train_office', 'Обучение Microsoft Office', 'הדרכה ל-Microsoft Office', 'Microsoft Office training', 60, 160, 'hourly', true, true, false, true, true, 'required_before_booking', 40),
    ('training', 'train_security', 'Обучение безопасности в интернете', 'הדרכה לאבטחה באינטרנט', 'Internet safety training', 45, 150, 'hourly', true, true, false, false, false, 'required_before_booking', 50),
    ('training', 'train_smartphone', 'Обучение работе со смартфоном', 'הדרכה לעבודה עם סמארטפון', 'Smartphone training', 45, 150, 'hourly', true, false, false, true, false, 'required_before_booking', 60),
    ('training', 'train_cloud', 'Обучение облачным сервисам', 'הדרכה לשירותי ענן', 'Cloud services training', 60, 160, 'hourly', true, true, false, false, false, 'required_before_booking', 70),
    ('smart_home', 'camera_setup', 'Настройка камер', 'הגדרת מצלמות', 'Camera setup', 90, 300, 'from', true, false, false, true, false, 'after_service', 10),
    ('smart_home', 'smart_plug_setup', 'Настройка умных розеток', 'הגדרת שקעים חכמים', 'Smart plug setup', 60, 200, 'fixed', true, false, false, true, false, 'after_service', 20),
    ('smart_home', 'home_assistant_setup', 'Настройка Home Assistant', 'הגדרת Home Assistant', 'Home Assistant setup', 180, 450, 'from', true, false, false, true, false, 'after_service', 30)
) AS seed (
  category_code, code, name_ru, name_he, name_en,
  duration_minutes, price, price_type,
  onsite_available, remote_available, workshop_available,
  requires_device, requires_operating_system, payment_policy, sort_order
)
JOIN public.service_categories AS category ON category.code = seed.category_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.payment_methods (
  code, name_ru, name_he, name_en, integration_type, sort_order,
  instructions_ru, instructions_he, instructions_en
) VALUES
  ('bit', 'Bit', 'Bit', 'Bit', 'manual', 10, 'Оплатите в приложении Bit. Администратор подтвердит поступление.', 'שלמו באפליקציית Bit. המנהל יאשר את הקבלה.', 'Pay in the Bit app. An administrator will confirm the payment.'),
  ('paybox', 'PayBox', 'PayBox', 'PayBox', 'manual', 20, 'Оплатите через PayBox. Администратор подтвердит поступление.', 'שלמו ב-PayBox. המנהל יאשר את הקבלה.', 'Pay with PayBox. An administrator will confirm the payment.'),
  ('paysend', 'Paysend', 'Paysend', 'Paysend', 'manual', 30, 'Отправьте перевод через Paysend. Администратор подтвердит поступление.', 'שלחו העברה ב-Paysend. המנהל יאשר את הקבלה.', 'Send the transfer with Paysend. An administrator will confirm it.'),
  ('paypal', 'PayPal', 'PayPal', 'PayPal', 'external_link', 40, 'Ссылка на оплату появится, когда будет указан адрес PayPal.', 'קישור התשלום יופיע לאחר שיוגדר כתובת PayPal.', 'A PayPal link appears after a payment URL is configured.'),
  ('credit_card', 'Банковская карта', 'כרטיס אשראי', 'Credit card', 'automatic', 50, 'Оплата картой откроется на странице платёжного провайдера. Номер карты здесь не сохраняется.', 'תשלום בכרטיס ייפתח אצל ספק הסליקה. מספר הכרטיס לא נשמר כאן.', 'Card payment opens on the provider page. The card number is not stored here.'),
  ('bank_transfer', 'Банковский перевод', 'העברה בנקאית', 'Bank transfer', 'manual', 60, 'Реквизиты будут показаны после создания заявки. Оплата ждёт подтверждения.', 'הפרטים יוצגו לאחר יצירת ההזמנה. התשלום ממתין לאישור.', 'Account details are shown after the booking is created. Payment waits for confirmation.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.service_payment_methods (service_id, payment_method_id, enabled)
SELECT service.id, method.id, true
FROM public.services AS service
CROSS JOIN public.payment_methods AS method
ON CONFLICT (service_id, payment_method_id) DO NOTHING;

ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transfer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.working_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can read categories" ON public.service_categories;
CREATE POLICY "Staff can read categories"
  ON public.service_categories FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can insert categories" ON public.service_categories;
CREATE POLICY "Admins can insert categories"
  ON public.service_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update categories" ON public.service_categories;
CREATE POLICY "Admins can update categories"
  ON public.service_categories FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read services" ON public.services;
CREATE POLICY "Staff can read services"
  ON public.services FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can insert services" ON public.services;
CREATE POLICY "Admins can insert services"
  ON public.services FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update services" ON public.services;
CREATE POLICY "Admins can update services"
  ON public.services FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read payment methods" ON public.payment_methods;
CREATE POLICY "Staff can read payment methods"
  ON public.payment_methods FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can insert payment methods" ON public.payment_methods;
CREATE POLICY "Admins can insert payment methods"
  ON public.payment_methods FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update payment methods" ON public.payment_methods;
CREATE POLICY "Admins can update payment methods"
  ON public.payment_methods FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read service payment methods" ON public.service_payment_methods;
CREATE POLICY "Staff can read service payment methods"
  ON public.service_payment_methods FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can insert service payment methods" ON public.service_payment_methods;
CREATE POLICY "Admins can insert service payment methods"
  ON public.service_payment_methods FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update service payment methods" ON public.service_payment_methods;
CREATE POLICY "Admins can update service payment methods"
  ON public.service_payment_methods FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete service payment methods" ON public.service_payment_methods;
CREATE POLICY "Admins can delete service payment methods"
  ON public.service_payment_methods FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read bank profile" ON public.bank_transfer_profiles;
CREATE POLICY "Admins can read bank profile"
  ON public.bank_transfer_profiles FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update bank profile" ON public.bank_transfer_profiles;
CREATE POLICY "Admins can update bank profile"
  ON public.bank_transfer_profiles FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read working hours" ON public.working_hours;
CREATE POLICY "Staff can read working hours"
  ON public.working_hours FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Admins can update working hours" ON public.working_hours;
CREATE POLICY "Admins can update working hours"
  ON public.working_hours FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff can read booking services" ON public.booking_services;
CREATE POLICY "Staff can read booking services"
  ON public.booking_services FOR SELECT TO authenticated
  USING (public.is_staff());

DROP POLICY IF EXISTS "Staff can read payments" ON public.payments;
CREATE POLICY "Staff can read payments"
  ON public.payments FOR SELECT TO authenticated
  USING (public.is_staff());

REVOKE ALL ON TABLE public.service_categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_methods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.service_payment_methods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bank_transfer_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.working_hours FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.booking_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.service_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.services TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.service_payment_methods TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.bank_transfer_profiles TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.working_hours TO authenticated;
GRANT SELECT ON TABLE public.booking_services TO authenticated;
GRANT SELECT ON TABLE public.payments TO authenticated;
