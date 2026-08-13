import { env } from '@/env';

const APP_DOMAIN = env.NEXT_PUBLIC_APP_DOMAIN;

/**
 * Extract the subdomain from a host header, relative to NEXT_PUBLIC_APP_DOMAIN.
 *
 * Examples (with APP_DOMAIN="example.com"):
 *   "app.example.com" → "app"
 *   "myboutique.example.com" → "myboutique"
 *   "example.com" → null
 *   "localhost:3000" → null (localhost has no subdomains)
 *
 * Shared by the proxy (routing) and the SEO metadata routes (robots.txt,
 * sitemap.xml), which must agree on which host serves which store.
 */
export function getSubdomain(host: string): string | null {
  // Remove port if present
  const hostname = host.split(':')[0];

  // Localhost and 127.0.0.1 don't support subdomains
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  // Extract subdomain by comparing with base domain
  const hostParts = hostname.split('.');
  const baseDomain = APP_DOMAIN.split(':')[0];
  const baseParts = baseDomain.split('.');

  // If hostname has more parts than base domain, extract subdomain(s)
  if (hostParts.length > baseParts.length) {
    return hostParts.slice(0, hostParts.length - baseParts.length).join('.');
  }

  return null;
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
