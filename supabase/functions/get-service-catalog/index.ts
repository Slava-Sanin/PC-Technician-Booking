import { corsHeaders, isRecord, json, statusForCode } from '../_shared/http.ts';
import { supabaseRpc } from '../_shared/supabaseRpc.ts';

function automaticReady(): boolean {
  return Boolean(Deno.env.get('CARD_CHECKOUT_SECRET'));
}

function hideUnreadyMethods(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.categories)) return value;
  const ready = automaticReady();
  return {
    ...value,
    categories: value.categories.map((category) => {
      if (!isRecord(category) || !Array.isArray(category.services)) return category;
      return {
        ...category,
        services: category.services.map((service) => {
          if (!isRecord(service) || !Array.isArray(service.paymentMethods)) return service;
          return {
            ...service,
            paymentMethods: service.paymentMethods.filter((method) => {
              if (!isRecord(method)) return false;
              return method.integrationType !== 'automatic' || ready;
            }),
          };
        }),
      };
    }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'INVALID_INPUT' }, 400);
  }

  try {
    const result = await supabaseRpc('get_service_catalog', {});
    if (!isRecord(result) || result.ok !== true) {
      const code = isRecord(result) && typeof result.code === 'string' ? result.code : 'INTERNAL_ERROR';
      return json({ error: code }, statusForCode(code));
    }

    const catalog = hideUnreadyMethods(result);
    if (!isRecord(catalog)) {
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
    delete catalog.ok;
    delete catalog.code;
    return json(catalog);
  } catch {
    console.error('get_service_catalog_failed');
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
});
