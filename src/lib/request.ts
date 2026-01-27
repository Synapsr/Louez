/**
 * Request utilities for handling HTTP requests
 * Provides consistent handling of client IP extraction across different reverse proxies
 */

/**
 * Extracts the real client IP address from request headers
 *
 * Supports the following reverse proxies and CDNs:
 * - Cloudflare: CF-Connecting-IP
 * - Traefik: X-Real-IP, X-Forwarded-For
 * - nginx: X-Real-IP, X-Forwarded-For
 * - Vercel: X-Forwarded-For
 * - AWS ALB/ELB: X-Forwarded-For
 * - Akamai: True-Client-IP
 *
 * Priority order (most specific to most generic):
 * 1. CF-Connecting-IP (Cloudflare - always contains single real IP)
 * 2. True-Client-IP (Akamai)
 * 3. X-Real-IP (nginx/Traefik - typically single IP)
 * 4. X-Forwarded-For (standard - first IP is the client)
 *
 * @param headers - Request headers object or Headers instance
 * @returns The client IP address or 'unknown' if not determinable
 */
export function getClientIp(
  headers: Headers | { get: (name: string) => string | null }
): string {
  // Cloudflare always provides the real client IP in this header
  const cfConnectingIp = headers.get('cf-connecting-ip')
  if (cfConnectingIp) {
    return cfConnectingIp.trim()
  }

  // Akamai provides the real client IP here
  const trueClientIp = headers.get('true-client-ip')
  if (trueClientIp) {
    return trueClientIp.trim()
  }

  // nginx/Traefik typically set this to the real client IP
  const realIp = headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // Standard proxy header - the first IP is typically the client
  // Format: "client, proxy1, proxy2, ..."
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) {
      return firstIp
    }
  }

  return 'unknown'
}

/**
 * Validates that an IP address is properly formatted
 * Supports both IPv4 and IPv6 addresses
 */
export function isValidIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false

  // IPv4 pattern
  const ipv4Pattern =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

  // IPv6 pattern (simplified - accepts common formats)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/

  return ipv4Pattern.test(ip) || ipv6Pattern.test(ip)
}

/**
 * Anonymizes an IP address for logging purposes
 * - IPv4: Masks the last octet (192.168.1.100 -> 192.168.1.xxx)
 * - IPv6: Masks the last 64 bits
 */
export function anonymizeIp(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown'

  // IPv4
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.')
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`
    }
  }

  // IPv6
  if (ip.includes(':')) {
    const parts = ip.split(':')
    if (parts.length >= 4) {
      return `${parts.slice(0, 4).join(':')}:xxxx:xxxx:xxxx:xxxx`
    }
  }

  return 'unknown'
}
