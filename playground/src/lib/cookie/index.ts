import { APP_NAME, NODE_ENV } from "@/constants/app";
import { Str } from "@/lib/string";

import { parseSetCookie } from "set-cookie-parser";
import type { SetCookie, SerializeOptions } from "cookie";

/**
 * Cookie definition used when creating cookies
 */
export interface CookieDefinition {
  name: string;
  options: SerializeOptions;
}

/**
 * Runtime cookie (normalized)
 */
export interface ServerCookie extends SetCookie {
  toString(): string;
}

/**
 * Internal raw cookie map
 */
export type CookieMap = Record<string, ServerCookie>;

export class Cookie {
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
    options: Partial<SerializeOptions> = {},
  ): CookieDefinition {
    return {
      name: this.alias(name),
      options: {
        httpOnly: true,
        secure: NODE_ENV === "production",
        path: "/",
        sameSite: "lax",
        ...options,
      },
    };
  }

  // ---------------------------------------------
  // PARSING CORE (SAFE + DETERMINISTIC)
  // ---------------------------------------------

  /**
   * Normalize a loosely-typed sameSite string into the strict literal
   * union expected by the `cookie` package's SetCookie type.
   */
  private static normalizeSameSite(
    value: string | boolean | undefined,
  ): boolean | "lax" | "strict" | "none" | undefined {
    if (typeof value === "boolean" || value === undefined) return value;

    const lower = value.toLowerCase();
    if (lower === "lax" || lower === "strict" || lower === "none") {
      return lower;
    }

    return undefined;
  }

  /**
   * Parse Set-Cookie headers into a Map
   */
  static parse(input: string | string[] | null): Map<string, ServerCookie> {
    const map = new Map<string, ServerCookie>();
    if (!input) return map;

    const cookies = Array.isArray(input)
      ? input.flatMap((c) => parseSetCookie(c, { map: false }))
      : parseSetCookie(input, { map: false });

    for (const cookie of cookies) {
      const key = cookie.name.toLowerCase();

      const base: SetCookie = {
        ...cookie,
        sameSite: Cookie.normalizeSameSite(cookie.sameSite),
      };

      const normalized: ServerCookie = {
        ...base,
        toString: () => Cookie.stringify(base),
      };

      map.set(key, normalized);
    }

    return map;
  }

  /**
   * Parse Set-Cookie headers into a plain object
   */
  static parseObject(input: string | string[] | null): CookieMap {
    return Object.fromEntries(this.parse(input));
  }

  /**
   * Parse single cookie by name
   */
  static get(
    input: string | string[] | null,
    name: string,
  ): ServerCookie | undefined {
    return this.parse(input).get(name.toLowerCase());
  }

  // ---------------------------------------------
  // STRINGIFY (SAFE HEADER BUILDER)
  // ---------------------------------------------

  static stringify(cookie: SetCookie): string {
    const parts: string[] = [];

    parts.push(`${cookie.name}=${cookie.value ?? ""}`);

    if (cookie.path) parts.push(`Path=${cookie.path}`);
    if (cookie.domain) parts.push(`Domain=${cookie.domain}`);
    if (cookie.maxAge != null) parts.push(`Max-Age=${cookie.maxAge}`);
    if (cookie.expires) parts.push(`Expires=${cookie.expires.toUTCString()}`);

    if (cookie.httpOnly) parts.push("HttpOnly");
    if (cookie.secure) parts.push("Secure");
    if (cookie.sameSite) parts.push(`SameSite=${cookie.sameSite}`);

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
