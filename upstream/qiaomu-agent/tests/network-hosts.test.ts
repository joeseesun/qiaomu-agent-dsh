import { describe, expect, it } from "vitest";
import { isLocalHost, isLocalOrPrivateHost, isPrivateHttpUrl, isPrivateNetworkHost } from "../src/services/network-hosts";

describe("network-hosts utilities", () => {
  it("recognizes loopback addresses", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "sub.localhost"]) {
      expect(isLocalHost(host)).toBe(true);
      expect(isPrivateNetworkHost(host)).toBe(true);
      expect(isLocalOrPrivateHost(host)).toBe(true);
    }
    expect(isLocalHost("172.16.92.211")).toBe(false);
    expect(isLocalHost("example.com")).toBe(false);
  });

  it("recognizes IPv4 private networks (RFC 1918, CGNAT, link-local)", () => {
    // 172.16.0.0/12 (the user's IP range)
    expect(isPrivateNetworkHost("172.16.92.211")).toBe(true);
    expect(isPrivateNetworkHost("172.16.0.1")).toBe(true);
    expect(isPrivateNetworkHost("172.31.255.254")).toBe(true);
    expect(isPrivateNetworkHost("172.32.0.1")).toBe(false);
    expect(isPrivateNetworkHost("172.15.255.255")).toBe(false);

    // 10.0.0.0/8
    expect(isPrivateNetworkHost("10.0.0.1")).toBe(true);
    expect(isPrivateNetworkHost("10.254.1.2")).toBe(true);

    // 192.168.0.0/16
    expect(isPrivateNetworkHost("192.168.1.1")).toBe(true);
    expect(isPrivateNetworkHost("192.169.1.1")).toBe(false);

    // Carrier-Grade NAT (Tailscale / VPN)
    expect(isPrivateNetworkHost("100.64.0.1")).toBe(true);
    expect(isPrivateNetworkHost("100.127.255.254")).toBe(true);
    expect(isPrivateNetworkHost("100.128.0.1")).toBe(false);

    // Link-local
    expect(isPrivateNetworkHost("169.254.1.1")).toBe(true);

    // Public IPs
    expect(isPrivateNetworkHost("8.8.8.8")).toBe(false);
    expect(isPrivateNetworkHost("1.1.1.1")).toBe(false);
  });

  it("recognizes IPv6 private networks and local domains", () => {
    expect(isPrivateNetworkHost("fc00::1")).toBe(true);
    expect(isPrivateNetworkHost("fd12:3456:789a:1::1")).toBe(true);
    expect(isPrivateNetworkHost("fe80::1ff:fe00:1")).toBe(true);
    expect(isPrivateNetworkHost("2001:4860:4860::8888")).toBe(false);

    // Local domain suffixes
    expect(isPrivateNetworkHost("my-nas.local")).toBe(true);
    expect(isPrivateNetworkHost("server.lan")).toBe(true);
    expect(isPrivateNetworkHost("cluster.internal")).toBe(true);
    expect(isPrivateNetworkHost("router.home.arpa")).toBe(true);

    // Single label hostname
    expect(isPrivateNetworkHost("gpu-server")).toBe(true);
    expect(isPrivateNetworkHost("api.openai.com")).toBe(false);
  });

  it("identifies private HTTP URLs that require inline user confirmation", () => {
    // Loopback does NOT require special private confirmation (already trusted locally)
    expect(isPrivateHttpUrl("http://localhost:11434/v1")).toBe(false);
    expect(isPrivateHttpUrl("http://127.0.0.1:11434/v1")).toBe(false);

    // HTTPS does not require special HTTP warning
    expect(isPrivateHttpUrl("https://172.16.92.211:23323/v1")).toBe(false);
    expect(isPrivateHttpUrl("https://api.openai.com/v1")).toBe(false);

    // Non-private HTTP (public remote)
    expect(isPrivateHttpUrl("http://api.openai.com/v1")).toBe(false);

    // Non-loopback private HTTP triggers inline confirmation
    expect(isPrivateHttpUrl("http://172.16.92.211:23323/v1")).toBe(true);
    expect(isPrivateHttpUrl("http://192.168.1.50:8000/v1")).toBe(true);
    expect(isPrivateHttpUrl("http://10.0.0.5:11434/v1")).toBe(true);
    expect(isPrivateHttpUrl("http://gpu-server:8000/v1")).toBe(true);
  });
});
