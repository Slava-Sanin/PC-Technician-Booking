/*
  Technician subscriptions (Cardcom), self-registration, and admin payout details.

  - profiles.subscription_exempt: technicians created before this migration keep access.
  - is_staff(): technicians need an active paid subscription (or exemption).
  - subscription_plans / subscription_discounts: monthly price and discount tiers (3+ months).
  - technician_subscriptions: one pending or active subscription per technician.
  - admin_payout_profiles: where the administrator wants to receive money (bank or card).
    The card number lives in Supabase Vault; the table keeps only the secret id and last 4 digits.
*/

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS supabase_vault;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'supabase_vault extension not created: %', SQLERRM;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_exempt boolean NOT NULL DEFAULT false;

UPDATE public.profiles
SET subscription_exempt = true
WHERE role = 'technician'::public.staff_role
  AND subscription_exempt = false;

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_price numeric(12, 2) NOT NULL DEFAULT 99.00 CHECK (monthly_price >= 0),
  currency text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_plans (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subscription_discounts (
  min_months integer PRIMARY KEY CHECK (min_months >= 3 AND min_months <= 1200),
  discount_percent numeric(5, 2) NOT NULL CHECK (discount_percent >= 0 AND discount_percent <= 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.subscription_discounts (min_months, discount_percent)
VALUES (3, 5), (6, 10), (12, 20)
ON CONFLICT (min_months) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.technician_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  months integer NOT NULL CHECK (months >= 1 AND months <= 1200),
  monthly_price_snapshot numeric(12, 2) NOT NULL CHECK (monthly_price_snapshot >= 0),
  discount_percent_snapshot numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent_snapshot BETWEEN 0 AND 100),
  amount_total numeric(12, 2) NOT NULL CHECK (amount_total >= 0),
  currency text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('pending_payment', 'active', 'cancelled', 'failed')),
  starts_at timestamptz,
  ends_at timestamptz,
  cancelled_at timestamptz,
  refund_amount numeric(12, 2) CHECK (refund_amount IS NULL OR refund_amount >= 0),
  refund_status text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none', 'refunded', 'failed')),
  provider text NOT NULL DEFAULT 'cardcom' CHECK (char_length(provider) <= 40),
  provider_low_profile_id text CHECK (provider_low_profile_id IS NULL OR char_length(provider_low_profile_id) <= 120),
  provider_transaction_id text CHECK (provider_transaction_id IS NULL OR char_length(provider_transaction_id) <= 120),
  provider_refund_transaction_id text CHECK (provider_refund_transaction_id IS NULL OR char_length(provider_refund_transaction_id) <= 120),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CONSTRAINT technician_subscriptions_period CHECK (
    status <> 'active' OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS technician_subscriptions_low_profile_idx
  ON public.technician_subscriptions (provider, provider_low_profile_id)
  WHERE provider_low_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS technician_subscriptions_one_open_idx
  ON public.technician_subscriptions (user_id)
  WHERE status IN ('pending_payment', 'active');

CREATE INDEX IF NOT EXISTS technician_subscriptions_user_idx
  ON public.technician_subscriptions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_payout_profiles (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payout_method text NOT NULL DEFAULT 'bank' CHECK (payout_method IN ('bank', 'card')),
  bank_name text CHECK (bank_name IS NULL OR char_length(bank_name) <= 120),
  branch text CHECK (branch IS NULL OR char_length(branch) <= 40),
  account_number text CHECK (account_number IS NULL OR char_length(account_number) <= 40),
  beneficiary text CHECK (beneficiary IS NULL OR char_length(beneficiary) <= 160),
  iban text CHECK (iban IS NULL OR char_length(iban) <= 42),
  swift text CHECK (swift IS NULL OR char_length(swift) <= 16),
  card_holder text CHECK (card_holder IS NULL OR char_length(card_holder) <= 160),
  card_last4 text CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint CHECK (card_exp_month IS NULL OR card_exp_month BETWEEN 1 AND 12),
  card_exp_year smallint CHECK (card_exp_year IS NULL OR card_exp_year BETWEEN 2000 AND 2100),
  card_number_secret_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_payout_profiles (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscription_discounts_updated_at ON public.subscription_discounts;
CREATE TRIGGER update_subscription_discounts_updated_at
  BEFORE UPDATE ON public.subscription_discounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_technician_subscriptions_updated_at ON public.technician_subscriptions;
CREATE TRIGGER update_technician_subscriptions_updated_at
  BEFORE UPDATE ON public.technician_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_admin_payout_profiles_updated_at ON public.admin_payout_profiles;
CREATE TRIGGER update_admin_payout_profiles_updated_at
  BEFORE UPDATE ON public.admin_payout_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technician_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_payout_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.subscription_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subscription_discounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.technician_subscriptions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.admin_payout_profiles FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.subscription_plans TO service_role;
GRANT ALL ON TABLE public.subscription_discounts TO service_role;
GRANT ALL ON TABLE public.technician_subscriptions TO service_role;
GRANT ALL ON TABLE public.admin_payout_profiles TO service_role;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_active_subscription(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = p_user_id
      AND profile.subscription_exempt = true
  )
  OR EXISTS (
    SELECT 1
    FROM public.technician_subscriptions AS subscription
    WHERE subscription.user_id = p_user_id
      AND subscription.status = 'active'
      AND subscription.ends_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.user_id = auth.uid()
      AND profile.active = true
      AND (
        profile.role = 'admin'::public.staff_role
        OR (
          profile.role = 'technician'::public.staff_role
          AND public.has_active_subscription(profile.user_id)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.subscription_discount_for_months(p_months integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT tier.discount_percent
    FROM public.subscription_discounts AS tier
    WHERE tier.min_months <= p_months
    ORDER BY tier.min_months DESC
    LIMIT 1
  ), 0)::numeric;
$$;

REVOKE ALL ON FUNCTION public.subscription_discount_for_months(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscription_discount_for_months(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.subscription_discount_tiers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('minMonths', tier.min_months, 'discountPercent', tier.discount_percent)
    ORDER BY tier.min_months
  ), '[]'::jsonb)
  FROM public.subscription_discounts AS tier;
$$;

REVOKE ALL ON FUNCTION public.subscription_discount_tiers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscription_discount_tiers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_subscription(p_months integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_discount numeric;
  v_total numeric;
BEGIN
  IF p_months IS NULL OR p_months < 1 OR p_months > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
  END IF;

  v_discount := public.subscription_discount_for_months(p_months);
  v_total := round(p_months * v_plan.monthly_price * (1 - v_discount / 100), 2);

  RETURN jsonb_build_object(
    'ok', true,
    'months', p_months,
    'monthlyPrice', v_plan.monthly_price,
    'discountPercent', v_discount,
    'amountTotal', v_total,
    'currency', v_plan.currency,
    'enabled', v_plan.enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.quote_subscription(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_subscription(integer) TO authenticated, service_role;

-- Pro-rata refund by whole days: the started day counts as used.
CREATE OR REPLACE FUNCTION public.subscription_refund_amount(
  p_amount numeric,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_total_days integer;
  v_used_days integer;
  v_remaining_days integer;
  v_refund numeric;
BEGIN
  IF p_amount IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('refundAmount', 0, 'totalDays', 0, 'remainingDays', 0);
  END IF;

  v_total_days := greatest(ceil(extract(epoch FROM (p_ends_at - p_starts_at)) / 86400)::integer, 1);
  v_used_days := greatest(ceil(extract(epoch FROM (p_now - p_starts_at)) / 86400)::integer, 0);
  v_remaining_days := greatest(v_total_days - v_used_days, 0);
  v_refund := round(p_amount * v_remaining_days / v_total_days, 2);

  RETURN jsonb_build_object(
    'refundAmount', v_refund,
    'totalDays', v_total_days,
    'remainingDays', v_remaining_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_refund_amount(numeric, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.subscription_refund_amount(numeric, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.subscription_to_json(p_row public.technician_subscriptions)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'userId', p_row.user_id,
    'months', p_row.months,
    'monthlyPrice', p_row.monthly_price_snapshot,
    'discountPercent', p_row.discount_percent_snapshot,
    'amountTotal', p_row.amount_total,
    'currency', p_row.currency,
    'status', CASE
      WHEN p_row.status = 'active' AND p_row.ends_at <= now() THEN 'expired'
      ELSE p_row.status
    END,
    'startsAt', p_row.starts_at,
    'endsAt', p_row.ends_at,
    'cancelledAt', p_row.cancelled_at,
    'paidAt', p_row.paid_at,
    'refundAmount', p_row.refund_amount,
    'refundStatus', p_row.refund_status,
    'provider', p_row.provider,
    'lowProfileId', p_row.provider_low_profile_id,
    'transactionId', p_row.provider_transaction_id,
    'refundTransactionId', p_row.provider_refund_transaction_id,
    'cardLast4', p_row.card_last4,
    'createdAt', p_row.created_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Subscription state (technician + edge functions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.subscription_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_current public.technician_subscriptions%ROWTYPE;
  v_refund jsonb := NULL;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = 1;

  SELECT * INTO v_current
  FROM public.technician_subscriptions
  WHERE user_id = p_user_id
    AND status IN ('pending_payment', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_current
    FROM public.technician_subscriptions
    WHERE user_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_current.id IS NOT NULL AND v_current.status = 'active' AND v_current.ends_at > now() THEN
    v_refund := public.subscription_refund_amount(v_current.amount_total, v_current.starts_at, v_current.ends_at, now());
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'role', v_profile.role,
    'active', v_profile.active,
    'exempt', v_profile.subscription_exempt,
    'hasAccess', v_profile.active AND (
      v_profile.role = 'admin'::public.staff_role OR public.has_active_subscription(p_user_id)
    ),
    'plan', jsonb_build_object(
      'monthlyPrice', v_plan.monthly_price,
      'currency', v_plan.currency,
      'enabled', v_plan.enabled
    ),
    'discounts', public.subscription_discount_tiers(),
    'subscription', CASE WHEN v_current.id IS NULL THEN NULL ELSE public.subscription_to_json(v_current) END,
    'refundQuote', v_refund
  );
END;
$$;

REVOKE ALL ON FUNCTION public.subscription_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_state(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_subscription()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.subscription_state(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.get_my_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;

-- ---------------------------------------------------------------------------
-- Technician self-registration (service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_technician_registration_eligibility(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
BEGIN
  IF v_email = '' OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT users.id INTO v_user_id
  FROM auth.users AS users
  WHERE lower(users.email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'linkExistingAuth', false);
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = v_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
  END IF;

  -- The email belongs to a customer account: the technician profile can be linked
  -- to the same auth user after the password is verified.
  RETURN jsonb_build_object('ok', true, 'linkExistingAuth', true, 'userId', v_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.check_technician_registration_eligibility(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_technician_registration_eligibility(text) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_technician_registration(
  p_user_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
BEGIN
  IF p_user_id IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles AS profile WHERE profile.user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
  END IF;

  INSERT INTO public.profiles (user_id, role, active, email, first_name, last_name, phone, subscription_exempt)
  VALUES (
    p_user_id,
    'technician'::public.staff_role,
    true,
    v_email,
    nullif(left(trim(coalesce(p_first_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_last_name, '')), 120), ''),
    nullif(left(trim(coalesce(p_phone, '')), 32), ''),
    false
  );

  RETURN jsonb_build_object('ok', true, 'userId', p_user_id, 'role', 'technician');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_REGISTERED');
  WHEN OTHERS THEN
    RAISE WARNING 'complete_technician_registration failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.complete_technician_registration(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_technician_registration(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Subscription lifecycle (service_role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_subscription_order(p_user_id uuid, p_months integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_quote jsonb;
  v_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_months IS NULL OR p_months < 1 OR p_months > 1200 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = p_user_id;
  IF NOT FOUND OR v_profile.active IS NOT TRUE OR v_profile.role <> 'technician'::public.staff_role THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  v_quote := public.quote_subscription(p_months);
  IF (v_quote->>'ok')::boolean IS NOT TRUE THEN
    RETURN v_quote;
  END IF;
  IF (v_quote->>'enabled')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_UNAVAILABLE');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('technician-subscription:' || p_user_id::text)::bigint);

  IF EXISTS (
    SELECT 1 FROM public.technician_subscriptions
    WHERE user_id = p_user_id AND status = 'active' AND ends_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_ACTIVE');
  END IF;

  -- Expired "active" rows and abandoned checkouts are closed before a new order.
  UPDATE public.technician_subscriptions
  SET status = 'failed'
  WHERE user_id = p_user_id
    AND status = 'pending_payment';

  UPDATE public.technician_subscriptions
  SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ends_at)
  WHERE user_id = p_user_id
    AND status = 'active'
    AND ends_at <= now();

  INSERT INTO public.technician_subscriptions (
    user_id, months, monthly_price_snapshot, discount_percent_snapshot, amount_total, currency, status
  ) VALUES (
    p_user_id,
    p_months,
    (v_quote->>'monthlyPrice')::numeric,
    (v_quote->>'discountPercent')::numeric,
    (v_quote->>'amountTotal')::numeric,
    v_quote->>'currency',
    'pending_payment'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'months', p_months,
    'amountTotal', (v_quote->>'amountTotal')::numeric,
    'currency', v_quote->>'currency'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'create_subscription_order failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.create_subscription_order(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_subscription_order(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.attach_subscription_checkout(p_id uuid, p_low_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.technician_subscriptions
  SET provider_low_profile_id = nullif(trim(coalesce(p_low_profile_id, '')), '')
  WHERE id = p_id AND status = 'pending_payment';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'attach_subscription_checkout failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.attach_subscription_checkout(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_subscription_checkout(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.discard_subscription_order(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.technician_subscriptions
  SET status = 'failed'
  WHERE id = p_id AND status = 'pending_payment';
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.discard_subscription_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_subscription_order(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_subscription_payment(
  p_low_profile_id text,
  p_status text,
  p_transaction_id text,
  p_amount numeric,
  p_card_last4 text,
  p_event_id text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.technician_subscriptions%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_low_profile_id IS NULL OR trim(p_low_profile_id) = ''
     OR p_status NOT IN ('paid', 'failed')
     OR p_event_id IS NULL OR char_length(p_event_id) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_webhook_events WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  SELECT * INTO v_row
  FROM public.technician_subscriptions
  WHERE provider = 'cardcom' AND provider_low_profile_id = trim(p_low_profile_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
  END IF;

  INSERT INTO public.payment_webhook_events (event_id, provider, payload)
  VALUES (p_event_id, 'cardcom', COALESCE(p_payload, '{}'::jsonb));

  IF v_row.status <> 'pending_payment' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', v_row.status);
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.technician_subscriptions
    SET status = 'failed', provider_transaction_id = COALESCE(nullif(trim(coalesce(p_transaction_id, '')), ''), provider_transaction_id)
    WHERE id = v_row.id;
    RETURN jsonb_build_object('ok', true, 'status', 'failed');
  END IF;

  IF p_amount IS NULL OR abs(p_amount - v_row.amount_total) > 0.01 THEN
    RAISE WARNING 'subscription amount mismatch: expected %, got %', v_row.amount_total, p_amount;
    RETURN jsonb_build_object('ok', false, 'code', 'PAYMENT_FAILED');
  END IF;

  UPDATE public.technician_subscriptions
  SET status = 'active',
      starts_at = v_now,
      ends_at = v_now + make_interval(months => v_row.months),
      paid_at = v_now,
      provider_transaction_id = nullif(trim(coalesce(p_transaction_id, '')), ''),
      card_last4 = CASE WHEN p_card_last4 ~ '^[0-9]{4}$' THEN p_card_last4 ELSE NULL END
  WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'status', 'active', 'id', v_row.id, 'userId', v_row.user_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  WHEN OTHERS THEN
    RAISE WARNING 'apply_subscription_payment failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_payment(text, text, text, numeric, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_payment(text, text, text, numeric, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.compute_subscription_refund(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.technician_subscriptions%ROWTYPE;
  v_refund jsonb;
BEGIN
  SELECT * INTO v_row FROM public.technician_subscriptions WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;
  IF v_row.status <> 'active' OR v_row.ends_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_ACTIVE');
  END IF;

  v_refund := public.subscription_refund_amount(v_row.amount_total, v_row.starts_at, v_row.ends_at, now());

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'userId', v_row.user_id,
    'amountTotal', v_row.amount_total,
    'currency', v_row.currency,
    'transactionId', v_row.provider_transaction_id,
    'refundAmount', (v_refund->>'refundAmount')::numeric,
    'totalDays', (v_refund->>'totalDays')::integer,
    'remainingDays', (v_refund->>'remainingDays')::integer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_subscription_refund(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_subscription_refund(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_subscription_cancelled(
  p_id uuid,
  p_refund_amount numeric,
  p_refund_status text,
  p_refund_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.technician_subscriptions%ROWTYPE;
BEGIN
  IF p_refund_status NOT IN ('none', 'refunded', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  UPDATE public.technician_subscriptions
  SET status = 'cancelled',
      cancelled_at = now(),
      refund_amount = COALESCE(p_refund_amount, 0),
      refund_status = p_refund_status,
      provider_refund_transaction_id = nullif(trim(coalesce(p_refund_transaction_id, '')), '')
  WHERE id = p_id AND status = 'active'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUBSCRIPTION_NOT_ACTIVE');
  END IF;

  RETURN jsonb_build_object('ok', true, 'subscription', public.subscription_to_json(v_row));
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'mark_subscription_cancelled failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_subscription_cancelled(uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_subscription_cancelled(uuid, numeric, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin: plan, discounts, subscriptions list, payout details
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_save_subscription_plan(
  p_monthly_price numeric,
  p_currency text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF p_monthly_price IS NULL OR p_monthly_price < 0 OR p_monthly_price > 1000000
     OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  UPDATE public.subscription_plans
  SET monthly_price = round(p_monthly_price, 2),
      currency = p_currency,
      enabled = COALESCE(p_enabled, true)
  WHERE id = 1;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_save_subscription_plan failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_subscription_plan(numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_subscription_plan(numeric, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_subscription_discounts(p_tiers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier jsonb;
  v_months integer;
  v_percent numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' OR jsonb_array_length(p_tiers) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tiers) LOOP
    v_months := (v_tier->>'minMonths')::integer;
    v_percent := (v_tier->>'discountPercent')::numeric;
    IF v_months IS NULL OR v_months < 3 OR v_months > 1200
       OR v_percent IS NULL OR v_percent < 0 OR v_percent > 100 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    END IF;
  END LOOP;

  DELETE FROM public.subscription_discounts;

  INSERT INTO public.subscription_discounts (min_months, discount_percent)
  SELECT DISTINCT ON ((tier->>'minMonths')::integer)
    (tier->>'minMonths')::integer,
    round((tier->>'discountPercent')::numeric, 2)
  FROM jsonb_array_elements(p_tiers) AS tier
  ORDER BY (tier->>'minMonths')::integer;

  RETURN jsonb_build_object('ok', true, 'discounts', public.subscription_discount_tiers());
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_save_subscription_discounts failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_subscription_discounts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_subscription_discounts(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_subscriptions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_admin() THEN jsonb_build_object('ok', false, 'code', 'FORBIDDEN')
    ELSE jsonb_build_object(
      'ok', true,
      'items', COALESCE((
        SELECT jsonb_agg(
          public.subscription_to_json(subscription) || jsonb_build_object(
            'email', profile.email,
            'firstName', profile.first_name,
            'lastName', profile.last_name,
            'phone', profile.phone
          )
          ORDER BY subscription.created_at DESC
        )
        FROM public.technician_subscriptions AS subscription
        JOIN public.profiles AS profile ON profile.user_id = subscription.user_id
      ), '[]'::jsonb)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_subscriptions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_payout_profile()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.is_admin() THEN jsonb_build_object('ok', false, 'code', 'FORBIDDEN')
    ELSE (
      SELECT jsonb_build_object(
        'ok', true,
        'payoutMethod', profile.payout_method,
        'bankName', profile.bank_name,
        'branch', profile.branch,
        'accountNumber', profile.account_number,
        'beneficiary', profile.beneficiary,
        'iban', profile.iban,
        'swift', profile.swift,
        'cardHolder', profile.card_holder,
        'cardLast4', profile.card_last4,
        'cardExpMonth', profile.card_exp_month,
        'cardExpYear', profile.card_exp_year,
        'cardStored', profile.card_number_secret_id IS NOT NULL,
        'updatedAt', profile.updated_at
      )
      FROM public.admin_payout_profiles AS profile
      WHERE profile.id = 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_payout_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_payout_profile() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_payout_profile(
  p_payout_method text,
  p_bank jsonb,
  p_card jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.admin_payout_profiles%ROWTYPE;
  v_card_number text;
  v_secret_id uuid;
  v_last4 text;
  v_exp_month smallint;
  v_exp_year smallint;
  v_holder text;
  v_clear_card boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF p_payout_method NOT IN ('bank', 'card') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  SELECT * INTO v_row FROM public.admin_payout_profiles WHERE id = 1 FOR UPDATE;

  v_secret_id := v_row.card_number_secret_id;
  v_last4 := v_row.card_last4;
  v_exp_month := v_row.card_exp_month;
  v_exp_year := v_row.card_exp_year;
  v_holder := v_row.card_holder;

  IF p_card IS NOT NULL AND jsonb_typeof(p_card) = 'object' THEN
    v_clear_card := COALESCE((p_card->>'clear')::boolean, false);
    v_holder := nullif(left(trim(coalesce(p_card->>'holder', '')), 160), '');
    v_card_number := regexp_replace(coalesce(p_card->>'number', ''), '[^0-9]', '', 'g');

    IF p_card ? 'expMonth' THEN
      v_exp_month := nullif(p_card->>'expMonth', '')::smallint;
    END IF;
    IF p_card ? 'expYear' THEN
      v_exp_year := nullif(p_card->>'expYear', '')::smallint;
      IF v_exp_year IS NOT NULL AND v_exp_year < 100 THEN
        v_exp_year := v_exp_year + 2000;
      END IF;
    END IF;

    IF v_clear_card THEN
      IF v_secret_id IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE id = v_secret_id;
      END IF;
      v_secret_id := NULL;
      v_last4 := NULL;
      v_exp_month := NULL;
      v_exp_year := NULL;
      v_holder := NULL;
    ELSIF v_card_number <> '' THEN
      IF char_length(v_card_number) < 12 OR char_length(v_card_number) > 19 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
      END IF;
      IF v_secret_id IS NULL THEN
        v_secret_id := vault.create_secret(v_card_number, 'admin_payout_card_' || gen_random_uuid()::text, 'Administrator payout card number');
      ELSE
        PERFORM vault.update_secret(v_secret_id, v_card_number);
      END IF;
      v_last4 := right(v_card_number, 4);
    END IF;
  END IF;

  UPDATE public.admin_payout_profiles
  SET payout_method = p_payout_method,
      bank_name = nullif(left(trim(coalesce(p_bank->>'bankName', bank_name, '')), 120), ''),
      branch = nullif(left(trim(coalesce(p_bank->>'branch', branch, '')), 40), ''),
      account_number = nullif(left(trim(coalesce(p_bank->>'accountNumber', account_number, '')), 40), ''),
      beneficiary = nullif(left(trim(coalesce(p_bank->>'beneficiary', beneficiary, '')), 160), ''),
      iban = nullif(left(trim(coalesce(p_bank->>'iban', iban, '')), 42), ''),
      swift = nullif(left(trim(coalesce(p_bank->>'swift', swift, '')), 16), ''),
      card_holder = v_holder,
      card_last4 = v_last4,
      card_exp_month = v_exp_month,
      card_exp_year = v_exp_year,
      card_number_secret_id = v_secret_id
  WHERE id = 1;

  RETURN public.admin_get_payout_profile();
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_save_payout_profile failed: % %', SQLSTATE, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_payout_profile(text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_payout_profile(text, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_reveal_payout_card()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id uuid;
  v_number text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT card_number_secret_id INTO v_secret_id FROM public.admin_payout_profiles WHERE id = 1;
  IF v_secret_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'cardNumber', NULL);
  END IF;

  SELECT decrypted_secret INTO v_number FROM vault.decrypted_secrets WHERE id = v_secret_id;
  RETURN jsonb_build_object('ok', true, 'cardNumber', v_number);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_reveal_payout_card failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reveal_payout_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reveal_payout_card() TO authenticated;

-- ---------------------------------------------------------------------------
-- admin_set_staff: subscription exemption flag
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_set_staff(text, text, boolean, text, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_set_staff(
  p_email text,
  p_role text,
  p_active boolean,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_subscription_exempt boolean DEFAULT NULL
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
  v_first_name text;
  v_last_name text;
  v_phone text;
  v_address text;
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

  v_first_name := nullif(left(trim(coalesce(p_first_name, '')), 120), '');
  v_last_name := nullif(left(trim(coalesce(p_last_name, '')), 120), '');
  v_phone := nullif(left(trim(coalesce(p_phone, '')), 32), '');
  v_address := nullif(left(trim(coalesce(p_address, '')), 500), '');

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = v_email;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STAFF_USER_NOT_FOUND');
  END IF;

  SELECT count(*)::integer INTO v_other_admins
  FROM public.profiles
  WHERE role = 'admin' AND active = true AND user_id <> v_user_id;

  IF v_other_admins = 0 AND (p_role <> 'admin' OR p_active IS NOT TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  INSERT INTO public.profiles (user_id, role, active, email, first_name, last_name, phone, address, subscription_exempt)
  VALUES (
    v_user_id, p_role::public.staff_role, p_active, v_email, v_first_name, v_last_name, v_phone, v_address,
    -- Technicians created by an administrator keep access without a subscription unless told otherwise.
    COALESCE(p_subscription_exempt, true)
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    email = EXCLUDED.email,
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    phone = EXCLUDED.phone,
    address = EXCLUDED.address,
    subscription_exempt = COALESCE(p_subscription_exempt, public.profiles.subscription_exempt);

  RETURN jsonb_build_object('ok', true, 'userId', v_user_id, 'role', p_role, 'active', p_active);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'admin_set_staff failed: %', SQLSTATE;
    RETURN jsonb_build_object('ok', false, 'code', 'INTERNAL_ERROR');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff(text, text, boolean, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff(text, text, boolean, text, text, text, text, boolean) TO authenticated;
