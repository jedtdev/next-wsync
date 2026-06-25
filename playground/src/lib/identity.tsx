"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { clearSessionCookie, setSessionCookie } from "@/lib/actions";
import type { JwtPayload } from "@/lib/jwt";

// ── Client-side JWT decode (display only — server verifies) ───────
function decodeJwt(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Context ───────────────────────────────────────────────────────
type IdentityCtx = {
  session: JwtPayload;
  setUsername: (username: string) => Promise<void>;
  clearSession: () => Promise<void>;
};

const IdentityContext = createContext<IdentityCtx | null>(null);

export function useIdentity(): IdentityCtx {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be inside <IdentityProvider>");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────
export function IdentityProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  initialSession?: JwtPayload | null;
}) {
  const [session, setSession] = useState<JwtPayload | null>(initialSession);
  const [username, setUsernameInput] = useState("");
  const [pending, setPending] = useState(false);

  const setUsername = useCallback(async (name: string) => {
    setPending(true);
    const token = await setSessionCookie(name);
    setSession(decodeJwt(token));
    setPending(false);
  }, []);

  const clearSession = useCallback(async () => {
    await clearSessionCookie();
    setSession(null);
  }, []);

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col gap-3 w-64">
          <p className="text-sm font-medium">Choose a username to join</p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && username.trim()) setUsername(username.trim());
            }}
            placeholder="Username"
            maxLength={24}
            className="border rounded px-3 py-2 text-sm outline-none focus:border-zinc-400"
          />
          <button
            disabled={!username.trim() || pending}
            onClick={() => setUsername(username.trim())}
            className="px-4 py-2 rounded bg-zinc-900 text-white text-sm disabled:opacity-40"
          >
            {pending ? "Joining..." : "Join"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <IdentityContext.Provider value={{ session, setUsername, clearSession }}>
      {children}
    </IdentityContext.Provider>
  );
}
