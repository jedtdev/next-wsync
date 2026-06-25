import { type Env } from "@/lib/env";
import { Str } from "@/lib/string";

export const JWT_SECURE = Boolean(
  process.env.NEXT_PUBLIC_JWT_SECURE,
) satisfies Env["JWT_SECURE"];
