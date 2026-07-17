import { getCountryByCode } from "@/lib/utils/countries";

const REQUEST_COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
] as const;

export type RequestCountrySource = (typeof REQUEST_COUNTRY_HEADERS)[number];

export interface RequestCountryDetection {
  country: string;
  source: RequestCountrySource;
}

export function detectCountryFromRequestHeaders(
  requestHeaders: Pick<Headers, "get">,
): RequestCountryDetection | null {
  for (const header of REQUEST_COUNTRY_HEADERS) {
    const country = requestHeaders.get(header)?.trim().toUpperCase();

    if (country && getCountryByCode(country)) {
      return { country, source: header };
    }
  }

  return null;
}
