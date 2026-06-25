"use client";

import { type Env } from "@/lib/env";
import { Str } from "@/lib/string";

export const APP_NAME = Str.convert(
  process.env.NEXT_PUBLIC_APP_NAME,
) satisfies Env["APP_NAME"];

export const APP_DESCRIPTION = Str.convert(
  process.env.NEXT_PUBLIC_APP_DESCRIPTION,
) satisfies Env["APP_DESCRIPTION"];

export const APP_URL = Str.convert(
  process.env.NEXT_PUBLIC_APP_URL,
) satisfies Env["APP_URL"];

export const APP_AUTHOR = Str.convert(
  process.env.NEXT_PUBLIC_APP_AUTHOR,
) satisfies Env["APP_AUTHOR"];

export const NODE_ENV = Str.convert(process.env.NODE_ENV);
/**
 * Indicates if the current environment is "production".
 */
export const IS_PRODUCTION: boolean = NODE_ENV === "production";

/**
 * Indicates if the current environment is "development".
 */
export const IS_DEVELOPMENT: boolean = NODE_ENV === "development";

/**
 * Indicates if the current environment is "test".
 */
export const IS_TEST: boolean = NODE_ENV === "test";
