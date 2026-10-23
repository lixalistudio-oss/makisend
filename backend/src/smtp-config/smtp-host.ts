import { MAX_SMTP_HOSTNAME_LENGTH } from "@/core/validation";

export const SMTP_SECURITIES = ["tls", "starttls"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

// Port 25 is deliberately absent: Cloudflare Workers block outbound SMTP on it.
export const SMTP_PORTS = [465, 587, 2465, 2525, 2587] as const;
export const DEFAULT_SMTP_PORT = 465;

/**
 * Cloudflare Email Service speaks SMTP at this host, but a Worker cannot open a socket to it
 * (workerd refuses: "proxy request failed, cannot connect to the specified address"). A
 * configuration that points here is sent through the Worker's `send_email` binding instead.
 */
export const CLOUDFLARE_EMAIL_HOST = "smtp.mx.cloudflare.net";

export function isCloudflareEmailHost(host: string): boolean {
  return host.trim().toLowerCase() === CLOUDFLARE_EMAIL_HOST;
}

export function isAllowedSmtpPort(port: number): boolean {
  return (SMTP_PORTS as readonly number[]).includes(port);
}

export function defaultSecurityFor(port: number): SmtpSecurity {
  return port === 465 || port === 2465 ? "tls" : "starttls";
}

export type HostnameCheck = { ok: true; hostname: string } | { ok: false; message: string };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateOrLocalIpv4(octets: number[]): boolean {
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function parseSmtpHostname(raw: string): HostnameCheck {
  const value = raw.trim().toLowerCase().replace(/\.$/, "");

  if (value.length === 0) return { ok: false, message: "SMTP hostname is required." };
  if (/\s/.test(value)) return { ok: false, message: "The hostname cannot contain spaces." };
  if (value.includes("://")) {
    return {
      ok: false,
      message: `Enter only the server name, without "${value.split("://")[0]}://" (for example smtp.zoho.com).`,
    };
  }
  if (value.includes("/") || value.includes("@") || value.includes("?")) {
    return { ok: false, message: "Enter only the server name: no path, no user name, no query." };
  }
  if (value.includes(":")) {
    return { ok: false, message: "Do not put the port in the hostname: use the Port field." };
  }
  if (value.length > MAX_SMTP_HOSTNAME_LENGTH) {
    return { ok: false, message: "The hostname is too long." };
  }

  const ipv4 = IPV4.exec(value);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) {
      return { ok: false, message: "That is not a valid IP address." };
    }
    if (isPrivateOrLocalIpv4(octets)) {
      return { ok: false, message: "A private or local address cannot be reached from the internet." };
    }
    return { ok: true, hostname: value };
  }

  const labels = value.split(".");
  if (labels.length < 2) {
    return { ok: false, message: "Enter the full server name (for example smtp.zoho.com), not a short name." };
  }
  if (!labels.every((label) => LABEL.test(label))) {
    return {
      ok: false,
      message: "The hostname has a character it cannot contain (letters, digits and hyphens only, between dots).",
    };
  }
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) {
    return { ok: false, message: "That is not a valid hostname." };
  }
  return { ok: true, hostname: value };
}
