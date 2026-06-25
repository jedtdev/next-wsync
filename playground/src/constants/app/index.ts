import { type Env, env } from "@/lib/env";
import { Str } from "@/lib/string";

export const APP_NAME = Str.convert(env.APP_NAME) satisfies Env["APP_NAME"];

export const APP_DESCRIPTION = Str.convert(
  env.APP_DESCRIPTION,
) satisfies Env["APP_DESCRIPTION"];

export const APP_AUTHOR = Str.convert(
  env.APP_AUTHOR,
) satisfies Env["APP_AUTHOR"];

export const APP_URL = Str.convert(env.APP_URL) satisfies Env["APP_URL"];

export const NODE_ENV = process.env.NODE_ENV;
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
