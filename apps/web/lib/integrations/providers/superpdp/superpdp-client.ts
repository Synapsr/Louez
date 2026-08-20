import { z } from "zod";

import { env } from "@/env";

export const SUPERPDP_PROVIDER_KEY = "superpdp";
export const SUPERPDP_CATEGORY = "payments";

const SUPERPDP_API_BASE_URL = "https://api.superpdp.tech/v1.beta";
const SUPERPDP_OAUTH_BASE_URL = "https://api.superpdp.tech/oauth2";

const providerIdSchema = z.union([z.string().min(1), z.number().int()]).transform(String);
const externalInvoiceIdSchema = z.string().min(1).max(36);
const moneySchema = z.union([z.string(), z.number()]).transform(String);

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

const oauthSessionSchema = z
  .object({
    company_id: providerIdSchema,
    company_verification_status: z.string().min(1),
  })
  .passthrough();

const directoryEntrySchema = z
  .object({
    id: providerIdSchema,
    identifier: z.string().min(1),
    directory: z.string().min(1),
    status: z.enum(["pending", "created", "error"]),
    status_message: z.string().nullish(),
  })
  .passthrough();

const directoryEntriesSchema = z
  .object({
    data: z.array(directoryEntrySchema),
    has_after: z.boolean().optional(),
  })
  .passthrough();

const invoiceEventSchema = z
  .object({
    id: providerIdSchema,
    invoice_id: providerIdSchema,
    status_code: z.string().min(1),
    status_text: z.string().optional(),
    created_at: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    details: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const invoiceEventsPageSchema = z
  .object({
    data: z.array(invoiceEventSchema),
    has_after: z.boolean(),
  })
  .passthrough();

const invoicePartySchema = z
  .object({
    name: z.string().min(1),
    legal_registration_identifier: z
      .object({
        scheme: z.string().optional(),
        value: z.string().min(1),
      })
      .passthrough()
      .optional(),
    identifiers: z
      .array(
        z
          .object({
            scheme: z.string().optional(),
            value: z.string().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const invoiceTotalsSchema = z
  .object({
    sum_invoice_line_net_amount: moneySchema.optional(),
    invoice_total_vat_amount: moneySchema.optional(),
    invoice_total_amount_with_vat: moneySchema.optional(),
    invoice_total_amount_without_vat: moneySchema.optional(),
    payable_amount: moneySchema.optional(),
  })
  .passthrough();

const en16931InvoiceSchema = z
  .object({
    number: z.string().min(1),
    issue_date: z.string().min(1),
    currency_code: z.string().min(3),
    seller: invoicePartySchema,
    invoice_totals: invoiceTotalsSchema.optional(),
    totals: invoiceTotalsSchema.optional(),
  })
  .passthrough();

const invoiceSchema = z
  .object({
    id: providerIdSchema,
    direction: z.enum(["in", "out"]),
    external_id: z.string().nullish(),
    en_invoice: en16931InvoiceSchema.optional(),
  })
  .passthrough();

const validationMessageSchema = z
  .object({
    location: z.string().optional(),
    message: z.string().optional(),
    raw: z.string().optional(),
  })
  .passthrough();

const validationSubreportSchema = z
  .object({
    checks_count: z.number().int().nonnegative().optional(),
    failures: z.array(validationMessageSchema).optional(),
    messages: z.array(validationMessageSchema).optional(),
    validator: z.string().optional(),
  })
  .passthrough();

const validationReportSchema = z
  .object({
    data: z.array(
      z
        .object({
          file_name: z.string(),
          is_valid: z.boolean(),
          error: z.string().nullish(),
          subreports: z.array(validationSubreportSchema).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type SuperPdpOAuthSession = z.infer<typeof oauthSessionSchema>;
export type SuperPdpDirectoryEntry = z.infer<typeof directoryEntrySchema>;
export type SuperPdpInvoiceEvent = z.infer<typeof invoiceEventSchema>;
export type SuperPdpInvoice = z.infer<typeof invoiceSchema>;
export type SuperPdpValidationReport = z.infer<typeof validationReportSchema>;

export class SuperPdpApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly operation: string,
  ) {
    super(message);
    this.name = "SuperPdpApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function getSuperPdpOAuthConfig(): { clientId: string; clientSecret: string } {
  if (!env.SUPERPDP_CLIENT_ID || !env.SUPERPDP_CLIENT_SECRET) {
    throw new Error("Super PDP OAuth is not configured");
  }

  return {
    clientId: env.SUPERPDP_CLIENT_ID,
    clientSecret: env.SUPERPDP_CLIENT_SECRET,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertPdf(bytes: Uint8Array, operation: string): void {
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error(`Super PDP ${operation} did not return a PDF`);
  }
}

export function getSuperPdpRedirectUri(): string {
  return (
    env.SUPERPDP_REDIRECT_URL ??
    `${env.NEXT_PUBLIC_APP_URL}/api/integrations/superpdp/oauth/callback`
  );
}

export function buildSuperPdpAuthorizationUrl(input: {
  state: string;
  companyNumber: string;
  companyNumberScheme: "fr_siren" | "be_bce";
  loginHint?: string | null;
}): string {
  const { clientId } = getSuperPdpOAuthConfig();
  const url = new URL(`${SUPERPDP_OAUTH_BASE_URL}/authorize`);
  const providerScheme =
    env.SUPERPDP_ENVIRONMENT === "sandbox"
      ? "sandbox"
      : input.companyNumberScheme === "fr_siren"
        ? "fr_siren"
        : "be_numero_entreprise";

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getSuperPdpRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("superpdp_company_number", input.companyNumber);
  url.searchParams.set("superpdp_company_number_scheme", providerScheme);
  url.searchParams.set("superpdp_send_and_receive", "any");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);

  return url.toString();
}

async function parseJsonResponse<T>(
  response: Response,
  operation: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    throw new SuperPdpApiError(
      `Super PDP ${operation} failed (${response.status})`,
      response.status,
      operation,
    );
  }

  return schema.parse(await response.json());
}

async function fetchProviderJson<T>(input: {
  accessToken: string;
  path: string;
  operation: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: BodyInit;
  headers?: HeadersInit;
}): Promise<T> {
  const response = await fetch(`${SUPERPDP_API_BASE_URL}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...input.headers,
    },
    body: input.body,
  });

  return parseJsonResponse(response, input.operation, input.schema);
}

export async function exchangeSuperPdpAuthorizationCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string | null;
}> {
  const { clientId, clientSecret } = getSuperPdpOAuthConfig();
  const response = await fetch(`${SUPERPDP_OAUTH_BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getSuperPdpRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const token = await parseJsonResponse(
    response,
    "authorization code exchange",
    tokenResponseSchema,
  );

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scopes: token.scope ?? null,
  };
}

export async function refreshSuperPdpTokens(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string | null;
}> {
  const { clientId, clientSecret } = getSuperPdpOAuthConfig();
  const response = await fetch(`${SUPERPDP_OAUTH_BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const token = await parseJsonResponse(response, "token refresh", tokenResponseSchema);

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scopes: token.scope ?? null,
  };
}

export async function revokeSuperPdpToken(token: string): Promise<void> {
  const { clientId, clientSecret } = getSuperPdpOAuthConfig();
  const response = await fetch(`${SUPERPDP_OAUTH_BASE_URL}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new SuperPdpApiError(
      `Super PDP token revocation failed (${response.status})`,
      response.status,
      "token revocation",
    );
  }
}

export function getSuperPdpOAuthSession(accessToken: string): Promise<SuperPdpOAuthSession> {
  return fetchProviderJson({
    accessToken,
    path: "/oauth2_sessions/me",
    operation: "OAuth session lookup",
    schema: oauthSessionSchema,
  });
}

export function listSuperPdpDirectoryEntries(
  accessToken: string,
): Promise<z.infer<typeof directoryEntriesSchema>> {
  return fetchProviderJson({
    accessToken,
    path: "/directory_entries",
    operation: "directory entry listing",
    schema: directoryEntriesSchema,
  });
}

export function createSuperPdpDirectoryEntry(input: {
  accessToken: string;
  identifier: string;
}): Promise<SuperPdpDirectoryEntry> {
  return fetchProviderJson({
    accessToken: input.accessToken,
    path: "/directory_entries",
    operation: "directory entry creation",
    schema: directoryEntrySchema,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directory: "peppol",
      identifier: input.identifier,
    }),
  });
}

export async function convertSuperPdpInvoiceToFacturX(input: {
  accessToken: string;
  pdf: Uint8Array;
  fileName: string;
  en16931: Record<string, unknown>;
}): Promise<Uint8Array> {
  const form = new FormData();
  form.append(
    "pdf",
    new Blob([toArrayBuffer(input.pdf)], { type: "application/pdf" }),
    input.fileName,
  );
  form.append(
    "en_invoice",
    new Blob([JSON.stringify(input.en16931)], {
      type: "application/json",
    }),
    `${input.fileName}.json`,
  );
  const query = new URLSearchParams({ from: "en16931", to: "facturx" });
  const response = await fetch(`${SUPERPDP_API_BASE_URL}/invoices/convert?${query.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: form,
  });

  if (!response.ok) {
    throw new SuperPdpApiError(
      `Super PDP invoice conversion failed (${response.status})`,
      response.status,
      "invoice conversion",
    );
  }

  const converted = new Uint8Array(await response.arrayBuffer());
  assertPdf(converted, "invoice conversion");
  return converted;
}

export function validateSuperPdpInvoice(input: {
  accessToken: string;
  invoice: Uint8Array;
  fileName: string;
}): Promise<SuperPdpValidationReport> {
  const form = new FormData();
  form.append(
    "file_name",
    new Blob([toArrayBuffer(input.invoice)], { type: "application/pdf" }),
    input.fileName,
  );

  return fetchProviderJson({
    accessToken: input.accessToken,
    path: "/validation_reports",
    operation: "invoice validation",
    schema: validationReportSchema,
    method: "POST",
    body: form,
  });
}

export function sendSuperPdpInvoice(input: {
  accessToken: string;
  invoice: Uint8Array;
  externalId: string;
}): Promise<SuperPdpInvoice> {
  const query = new URLSearchParams({
    external_id: externalInvoiceIdSchema.parse(input.externalId),
  });
  return fetchProviderJson({
    accessToken: input.accessToken,
    path: `/invoices?${query.toString()}`,
    operation: "invoice send",
    schema: invoiceSchema,
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: toArrayBuffer(input.invoice),
  });
}

export function getSuperPdpInvoice(input: {
  accessToken: string;
  invoiceId: string;
}): Promise<SuperPdpInvoice> {
  return fetchProviderJson({
    accessToken: input.accessToken,
    path: `/invoices/${encodeURIComponent(input.invoiceId)}?format=en16931`,
    operation: "invoice lookup",
    schema: invoiceSchema,
  });
}

export async function downloadSuperPdpInvoice(input: {
  accessToken: string;
  invoiceId: string;
}): Promise<{ content: Uint8Array; contentType: string }> {
  const response = await fetch(
    `${SUPERPDP_API_BASE_URL}/invoices/${encodeURIComponent(input.invoiceId)}/download`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/pdf",
      },
    },
  );

  if (!response.ok) {
    throw new SuperPdpApiError(
      `Super PDP invoice download failed (${response.status})`,
      response.status,
      "invoice download",
    );
  }

  return {
    content: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}

export function listSuperPdpInvoiceEvents(input: {
  accessToken: string;
  startingAfterId?: string | null;
  invoiceId?: string;
  limit?: number;
}): Promise<z.infer<typeof invoiceEventsPageSchema>> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 1000) });
  if (input.startingAfterId) {
    query.set("starting_after_id", input.startingAfterId);
  }
  if (input.invoiceId) query.set("invoice_id", input.invoiceId);

  return fetchProviderJson({
    accessToken: input.accessToken,
    path: `/invoice_events?${query.toString()}`,
    operation: "invoice event listing",
    schema: invoiceEventsPageSchema,
  });
}

export function createSuperPdpInvoiceEvent(input: {
  accessToken: string;
  invoiceId: string;
  statusCode: "fr:204" | "fr:205" | "fr:210" | "fr:212";
  reason?: string;
  details?: Array<Record<string, string>>;
}): Promise<SuperPdpInvoiceEvent> {
  const invoiceId = z.coerce.number().int().positive().parse(input.invoiceId);

  return fetchProviderJson({
    accessToken: input.accessToken,
    path: "/invoice_events",
    operation: "invoice event creation",
    schema: invoiceEventSchema,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoice_id: invoiceId,
      status_code: input.statusCode,
      ...(input.reason ? { data: { reason: input.reason } } : {}),
      ...(input.details ? { details: input.details } : {}),
    }),
  });
}
