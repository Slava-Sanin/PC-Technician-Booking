// Cardcom API v11 (LowProfile hosted payment page + refunds).
// Docs: https://secure.cardcom.solutions/Api/v11/Docs

import { isRecord } from './http.ts';

const BASE_URL = 'https://secure.cardcom.solutions/api/v11';

export interface CardcomConfig {
  terminalNumber: number;
  apiName: string;
  apiPassword: string;
}

export function cardcomConfig(): CardcomConfig | null {
  const terminal = Number(Deno.env.get('CARDCOM_TERMINAL_NUMBER') ?? '');
  const apiName = Deno.env.get('CARDCOM_API_NAME') ?? '';
  const apiPassword = Deno.env.get('CARDCOM_API_PASSWORD') ?? '';
  if (!Number.isInteger(terminal) || terminal <= 0 || !apiName || !apiPassword) return null;
  return { terminalNumber: terminal, apiName, apiPassword };
}

export function isCardcomConfigured(): boolean {
  return cardcomConfig() !== null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

async function postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('cardcom_http_failed', { path, status: response.status });
    throw new Error('CARDCOM_HTTP_FAILED');
  }
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!isRecord(parsed)) throw new Error('CARDCOM_BAD_RESPONSE');
  return parsed;
}

export interface CreateLowProfileInput {
  amount: number;
  currency: string;
  language: 'he' | 'en' | 'ru';
  productName: string;
  returnValue: string;
  successRedirectUrl: string;
  failedRedirectUrl: string;
  webHookUrl: string;
  cardOwnerEmail?: string | null;
  cardOwnerName?: string | null;
}

const ISO_COIN_IDS: Record<string, number> = { ILS: 1, USD: 2, EUR: 978 };

export async function createLowProfile(input: CreateLowProfileInput): Promise<{ lowProfileId: string; url: string }> {
  const config = cardcomConfig();
  if (!config) throw new Error('CARDCOM_UNCONFIGURED');

  const result = await postJson('LowProfile/Create', {
    TerminalNumber: config.terminalNumber,
    ApiName: config.apiName,
    Operation: 'ChargeOnly',
    Amount: Math.round(input.amount * 100) / 100,
    ISOCoinId: ISO_COIN_IDS[input.currency] ?? 1,
    Language: input.language,
    ProductName: input.productName.slice(0, 50),
    ReturnValue: input.returnValue.slice(0, 250),
    SuccessRedirectUrl: input.successRedirectUrl,
    FailedRedirectUrl: input.failedRedirectUrl,
    WebHookUrl: input.webHookUrl,
    UIDefinition: {
      CardOwnerEmailValue: input.cardOwnerEmail ?? undefined,
      CardOwnerNameValue: input.cardOwnerName ?? undefined,
      IsHideCardOwnerIdentityNumber: true,
    },
  });

  const responseCode = asNumber(result.ResponseCode);
  const lowProfileId = asText(result.LowProfileId);
  const url = asText(result.Url);
  if (responseCode !== 0 || !lowProfileId || !url) {
    console.error('cardcom_create_failed', { responseCode, description: result.Description });
    throw new Error('CARDCOM_CREATE_FAILED');
  }
  return { lowProfileId, url };
}

export interface LowProfileResult {
  responseCode: number | null;
  description: string | null;
  lowProfileId: string | null;
  transactionId: string | null;
  returnValue: string | null;
  amount: number | null;
  last4: string | null;
  raw: Record<string, unknown>;
}

export async function getLowProfileResult(lowProfileId: string): Promise<LowProfileResult> {
  const config = cardcomConfig();
  if (!config) throw new Error('CARDCOM_UNCONFIGURED');

  const query = new URLSearchParams({
    TerminalNumber: String(config.terminalNumber),
    ApiName: config.apiName,
    LowProfileId: lowProfileId,
  });
  const response = await fetch(`${BASE_URL}/LowProfile/GetLpResult?${query.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('cardcom_lp_result_http_failed', { status: response.status });
    throw new Error('CARDCOM_HTTP_FAILED');
  }
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!isRecord(parsed)) throw new Error('CARDCOM_BAD_RESPONSE');

  const info = isRecord(parsed.TranzactionInfo)
    ? parsed.TranzactionInfo
    : isRecord(parsed.TransactionInfo)
      ? parsed.TransactionInfo
      : {};

  const last4Raw = asText(info.Last4CardDigitsString) ?? asText(info.Last4CardDigits);
  const last4 = last4Raw ? last4Raw.padStart(4, '0').slice(-4) : null;

  return {
    responseCode: asNumber(parsed.ResponseCode),
    description: asText(parsed.Description),
    lowProfileId: asText(parsed.LowProfileId),
    transactionId: asText(parsed.TranzactionId) ?? asText(parsed.TransactionId) ?? asText(info.TranzactionId) ?? asText(info.TransactionId),
    returnValue: asText(parsed.ReturnValue),
    amount: asNumber(info.Amount) ?? asNumber(parsed.Amount),
    last4,
    raw: parsed,
  };
}

export async function refundByTransactionId(input: {
  transactionId: string;
  amount: number;
}): Promise<{ ok: boolean; refundTransactionId: string | null; description: string | null }> {
  const config = cardcomConfig();
  if (!config) throw new Error('CARDCOM_UNCONFIGURED');

  const transactionId = Number(input.transactionId);
  const result = await postJson('Transactions/RefundByTransactionId', {
    ApiName: config.apiName,
    ApiPassword: config.apiPassword,
    TransactionId: Number.isFinite(transactionId) ? transactionId : input.transactionId,
    PartialSum: Math.round(input.amount * 100) / 100,
    CancelOnly: false,
    AllowMultipleRefunds: false,
  });

  const responseCode = asNumber(result.ResponseCode);
  return {
    ok: responseCode === 0,
    refundTransactionId: asText(result.NewTranzactionId) ?? asText(result.NewTransactionId),
    description: asText(result.Description),
  };
}
