import { type Env, env } from "@/lib/env";
import { Str } from "@/lib/string";

export const JWT_SECRET = Str.convert(
  env.JWT_SECRET,
) satisfies Env["JWT_SECRET"];

export const JWT_SECURE = Boolean(env.JWT_SECURE) satisfies Env["JWT_SECURE"];

export const JWT_PREFIX = Str.convert(
  env.JWT_PREFIX,
) satisfies Env["JWT_PREFIX"];
