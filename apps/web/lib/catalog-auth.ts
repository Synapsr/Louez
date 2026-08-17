const CATALOG_REPLAY_WINDOW_SECONDS = 300;
const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digestBytes = Uint8Array.from(bytes);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", digestBytes.buffer)));
}

export async function timingSafeEqualStrings(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest[index] ^ rightDigest[index];
  }
  return difference === 0;
}

export async function signCatalogRequest(params: {
  method: string;
  pathAndQuery: string;
  secret: string;
  timestamp: string;
  rawBody?: string | Uint8Array;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bodySuffix = params.rawBody === undefined ? "" : `.${await sha256Hex(params.rawBody)}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${params.timestamp}.${params.method}.${params.pathAndQuery}${bodySuffix}`),
  );
  return bytesToHex(new Uint8Array(signature));
}

export async function verifyCatalogRequest(params: {
  request: Request;
  rawBody?: string | Uint8Array;
  secret: string | undefined;
}): Promise<boolean> {
  if (!params.secret) return false;

  const timestamp = params.request.headers.get("x-catalog-timestamp");
  const providedSignature = params.request.headers.get("x-catalog-signature")?.trim().toLowerCase();
  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !providedSignature ||
    !/^[a-f0-9]{64}$/.test(providedSignature)
  ) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > CATALOG_REPLAY_WINDOW_SECONDS
  ) {
    return false;
  }

  const url = new URL(params.request.url);
  if (params.request.method.toUpperCase() === "POST" && params.rawBody === undefined) {
    return false;
  }
  const expectedSignature = await signCatalogRequest({
    method: params.request.method.toUpperCase(),
    pathAndQuery: `${url.pathname}${url.search}`,
    secret: params.secret,
    timestamp,
    ...(params.rawBody === undefined ? {} : { rawBody: params.rawBody }),
  });

  return timingSafeEqualStrings(expectedSignature, providedSignature);
}
