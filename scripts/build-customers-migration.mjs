import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'supabase/migrations/20260922045000_address_required_city_optional.sql');
const preludePath = path.join(root, 'supabase/migrations/_customers_prelude.sql');
const outPath = path.join(root, 'supabase/migrations/20260926120000_customers_verification.sql');

let sql = fs.readFileSync(sourcePath, 'utf8');
sql = sql.replace(
  /p_source_hash text\s*\)/,
  'p_source_hash text,\n  p_customer_id uuid DEFAULT NULL\n)',
);
sql = sql.replace(
  '  v_offset numeric;\nBEGIN',
  '  v_offset numeric;\n  v_customer_id uuid;\nBEGIN',
);
sql = sql.replace(
  `  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;`,
  `  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;

  v_customer_id := p_customer_id;
  IF v_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers AS customer WHERE customer.id = v_customer_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  END IF;`,
);
sql = sql.replace(
  `        payment_status, payment_expires_at
      ) VALUES (`,
  `        payment_status, payment_expires_at, customer_id
      ) VALUES (`,
);
sql = sql.replace(
  `        v_payment_status, v_expires
      )`,
  `        v_payment_status, v_expires, v_customer_id
      )`,
);

sql = sql.replace(/^--[^\n]*\n/, '');

const dropOld = `DROP FUNCTION IF EXISTS public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text);

`;

const grants = `
REVOKE ALL ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid[], text, boolean, text, uuid) TO service_role;
`;

const prelude = fs.readFileSync(preludePath, 'utf8');
const output = `-- Customers, verification challenges, and booking confirmation flow.\n\n${prelude}\n${dropOld}${sql}${grants}`;
fs.writeFileSync(outPath, output);
console.log('Wrote', outPath);
