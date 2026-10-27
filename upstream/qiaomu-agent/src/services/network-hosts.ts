/**
 * Network host utilities for classifying local and private network addresses.
 */

/**
 * Checks whether a hostname is a loopback address.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

/**
 * Checks whether an IPv4 address string falls into private, local, or CGNAT ranges:
 * - 10.0.0.0/8 (RFC 1918)
 * - 172.16.0.0/12 (RFC 1918)
 * - 192.168.0.0/16 (RFC 1918)
 * - 127.0.0.0/8 (Loopback)
 * - 169.254.0.0/16 (Link-local)
 * - 100.64.0.0/10 (Carrier-Grade NAT / Shared address space, often used by Tailscale/VPNs)
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255 || (part.length > 1 && part.startsWith("0"))) return false;
    nums.push(n);
  }
  const a = nums[0] ?? -1;
  const b = nums[1] ?? -1;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Checks whether an IPv6 address string falls into private or local ranges:
 * - ::1 (Loopback)
 * - fc00::/7 (Unique Local Address - ULA, covers fc00... and fd00...)
 * - fe80::/10 (Link-local, covers fe80... - febf...)
 */
function isPrivateIPv6(ip: string): boolean {
  if (!ip.includes(":")) return false;
  try {
    // WHATWG URL validates and canonicalizes IPv6 in both desktop and mobile hosts.
    const host = new URL(`http://[${ip.replace(/^\[|\]$/g, "")}]`).hostname.slice(1, -1);
    return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  } catch { return false; }
}

/**
 * Checks whether a hostname belongs to a private or local network.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (isLocalHost(host)) return true;
  if (isPrivateIPv4(host)) return true;
  if (isPrivateIPv6(host)) return true;
  // Local network domain suffixes
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) {
    return true;
  }
  // Single-label hostnames without dots or colons (e.g. "nas", "gpu-server")
  if (!host.includes(".") && !host.includes(":") && /^[a-z0-9_-]+$/i.test(host)) {
    return true;
  }
  return false;
}

/**
 * Checks whether a host is either loopback or private network.
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
  return isLocalHost(hostname) || isPrivateNetworkHost(hostname);
}

/**
 * Returns true if the URL is an HTTP connection to a non-loopback private network host.
 */
export function isPrivateHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" && !isLocalHost(url.hostname) && isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
}

/** Approval belongs to one saved endpoint, never to every private host. */
export function hasPrivateHttpConsent(connection: { baseUrl: string; privateHttpApprovedUrl?: string }): boolean {
  if (!connection.privateHttpApprovedUrl || !isPrivateHttpUrl(connection.baseUrl)) return false;
  try {
    const normalize = (value: string) => new URL(value.trim()).href.replace(/\/+$/, "");
    return normalize(connection.baseUrl) === normalize(connection.privateHttpApprovedUrl);
  } catch { return false; }
}
