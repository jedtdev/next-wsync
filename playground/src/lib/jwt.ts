import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";
import { JWT_SECRET, JWT_SECURE } from "@/constants/jwt";
import { Cookie } from "@/lib/cookie";

export type JwtPayload = {
  id: string;
  username: string;
  joinedAt: string;
};

export class Jwt {
  static readonly cookie = Cookie.create("session", {
    httpOnly: false,
    secure: JWT_SECURE,
    maxAge: 60 * 60 * 24 * 365,
  });

  private static secret() {
    return new TextEncoder().encode(JWT_SECRET);
  }

  static async sign(username: string): Promise<string> {
    const joinedAt = new Date().toISOString();
    const payload: JwtPayload = {
      id: crypto.randomUUID(),
      username,
      joinedAt,
    };
    return new SignJWT(payload as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1y")
      .sign(this.secret());
  }

  static async verify(token: string): Promise<JwtPayload | null> {
    try {
      const { payload } = await jwtVerify<JwtPayload>(token, this.secret());
      return payload;
    } catch {
      return null;
    }
  }

  static async parse(request: NextRequest): Promise<JwtPayload | null> {
    const value = request.cookies.get(this.cookie.name)?.value;
    if (!value) return null;
    return this.verify(value);
  }
}
