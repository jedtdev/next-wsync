"use client";

import { APP_NAME } from "@/constants/app/client";
import { Str } from "@/lib/string";

/**
 * Detects whether the page is currently loaded over HTTPS.
 * Used to set the `secure` cookie attribute automatically.
 */
function isHttps(): boolean {
  if (typeof window === "undefined") return false; // SSR / non-browser
  return window.location.protocol === "https:";
}

/**
 * Options accepted when writing a cookie from the browser.
 * Note: `httpOnly` is intentionally omitted — it cannot be set
 * (or read) from client-side JavaScript by design.
 */
export interface ClientCookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number; // seconds
  expires?: Date;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

/**
 * Cookie definition used when creating cookies
 */
export interface CookieDefinition {
  name: string;
  options: ClientCookieOptions;
}

/**
 * Internal raw cookie map (name -> value)
 */
export type CookieMap = Record<string, string>;

export class ClientCookie {
  // ---------------------------------------------
  // NAME HELPERS
  // ---------------------------------------------

  static alias(name: string): string {
    return Str.join(".", [Str.kebab(APP_NAME), name]);
  }

  static stripPrefix(name: string): string {
    const prefix = `${Str.kebab(APP_NAME)}.`;
    return name.startsWith(prefix) ? name.slice(prefix.length) : name;
  }

  static hasPrefix(name: string): boolean {
    return name.startsWith(`${Str.kebab(APP_NAME)}.`);
  }

  // ---------------------------------------------
  // COOKIE CREATION
  // ---------------------------------------------

  static create(
    name: string,
    options: Partial<ClientCookieOptions> = {},
  ): CookieDefinition {
    return {
      name: this.alias(name),
      options: {
        secure: isHttps(),
        path: "/",
        sameSite: "lax",
        ...options,
      },
    };
  }

  // ---------------------------------------------
  // PARSING CORE (document.cookie -> Map)
  // ---------------------------------------------

  /**
   * Parse `document.cookie` (or a provided raw cookie string) into a Map.
   * Falls back to an empty map when not running in a browser.
   */
  static parse(raw?: string): Map<string, string> {
    const map = new Map<string, string>();

    const source =
      raw ?? (typeof document !== "undefined" ? document.cookie : "");

    if (!source) return map;

    for (const pair of source.split(";")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const name = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();

      try {
        map.set(name, decodeURIComponent(value));
      } catch {
        map.set(name, value);
      }
    }

    return map;
  }

  /**
   * Parse cookies into a plain object
   */
  static parseObject(raw?: string): CookieMap {
    return Object.fromEntries(this.parse(raw));
  }

  /**
   * Read a single cookie by name
   */
  static get(name: string): string | undefined {
    return this.parse().get(name);
  }

  // ---------------------------------------------
  // WRITE / DELETE (browser only)
  // ---------------------------------------------

  /**
   * Set a cookie via document.cookie. No-op outside the browser.
   */
  static set(
    name: string,
    value: string,
    options: Partial<ClientCookieOptions> = {},
  ): void {
    if (typeof document === "undefined") return;

    document.cookie = this.stringify(name, value, {
      secure: isHttps(),
      ...options,
    });
  }

  /**
   * Remove a cookie by expiring it immediately.
   */
  static remove(
    name: string,
    options: Pick<ClientCookieOptions, "path" | "domain"> = {},
  ): void {
    if (typeof document === "undefined") return;

    document.cookie = this.stringify(name, "", {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    });
  }

  // ---------------------------------------------
  // STRINGIFY (SAFE HEADER BUILDER)
  // ---------------------------------------------

  static stringify(
    name: string,
    value: string,
    options: Partial<ClientCookieOptions> = {},
  ): string {
    const parts: string[] = [];

    parts.push(`${name}=${encodeURIComponent(value)}`);

    if (options.path) parts.push(`Path=${options.path}`);
    if (options.domain) parts.push(`Domain=${options.domain}`);
    if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
    if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
    if (options.secure) parts.push("Secure");
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);

    return parts.join("; ");
  }

  // ---------------------------------------------
  // VALIDATION
  // ---------------------------------------------

  static isValid(cookie: unknown): cookie is CookieDefinition {
    return (
      typeof cookie === "object" &&
      cookie !== null &&
      "name" in cookie &&
      "options" in cookie &&
      typeof (cookie as CookieDefinition).name === "string"
    );
  }
}
