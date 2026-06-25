"use client";

import { useRealtime } from "@/lib/wsync/client";
import { useIdentity } from "@/lib/identity";
import type { RoomView } from "@/lib/wsync/channels/rooms/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const BEST_OF = [1, 3, 5, 7, 9];

const STATUS_BADGE: Record<RoomView["status"], { label: string; cls: string }> = {
  waiting: { label: "Waiting", cls: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" },
  active: { label: "In match", cls: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" },
  ended: { label: "Ended", cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

export function GameLobby({
  game,
  basePath,
  title,
  showBestOf = false,
}: {
  game: "rps" | "tictactoe";
  basePath: string;
  title: string;
  showBestOf?: boolean;
}) {
  const router = useRouter();
  const { session } = useIdentity();

  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", isPrivate: false, password: "", bestOf: showBestOf ? 3 : 1 });
  const pendingKey = useRef("");

  const roomUrl = (id: string, key: string) =>
    key ? `${basePath}/${id}?k=${encodeURIComponent(key)}` : `${basePath}/${id}`;

  const { send, status } = useRealtime("rooms", {
    parameters: { game },
    events: {
      onMessage(event) {
        if (event.type === "list") setRooms(event.data);
        if (event.type === "created") router.push(roomUrl(event.data.id, pendingKey.current));
      },
    },
  });

  function createRoom() {
    pendingKey.current = form.isPrivate ? form.password : "";
    send({ type: "create", data: { name: form.name, isPrivate: form.isPrivate, password: form.isPrivate ? form.password : "", bestOf: form.bestOf } });
  }

  function quickMatch() {
    pendingKey.current = "";
    send({ type: "quick" });
  }

  function joinRoom(r: RoomView) {
    if (r.status !== "waiting") return;
    let key = "";
    if (r.hasPassword) {
      key = window.prompt(`"${r.name}" is private. Enter the password:`) ?? "";
      if (!key) return;
    }
    router.push(roomUrl(r.id, key));
  }

  const canCreate = !form.isPrivate || form.password.trim().length > 0;

  return (
    <div className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Lobby · {session.username} · {status}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/play/leaderboard" className="text-sm font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            🏆 Leaderboard
          </Link>
          <Link href="/" className="text-sm font-medium px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
            ← Home
          </Link>
        </div>
      </div>

      <div className="mb-8 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {!creating ? (
          <div className="flex items-center gap-3">
            <button onClick={() => setCreating(true)} className="flex-1 py-3 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all">
              + Create lobby
            </button>
            <button onClick={quickMatch} className="flex-1 py-3 rounded-xl border border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-sm font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950 active:scale-[0.99] transition-all">
              ⚡ Quick match
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Create a lobby</h2>
              <button onClick={() => setCreating(false)} className="text-xs text-zinc-400 hover:text-zinc-600">Cancel</button>
            </div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={`${session.username}'s room`}
              maxLength={32}
              className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            />
            {showBestOf && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 w-16">Best of</span>
                <div className="flex gap-1">
                  {BEST_OF.map((n) => (
                    <button key={n} onClick={() => setForm({ ...form, bestOf: n })} className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${form.bestOf === n ? "bg-indigo-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} className="accent-indigo-500" />
                Private
              </label>
              {form.isPrivate && (
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Room password"
                  maxLength={32}
                  className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                />
              )}
            </div>
            <button onClick={createRoom} disabled={!canCreate} className="w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all">
              Create &amp; enter
            </button>
          </div>
        )}
      </div>

      <h2 className="text-xs uppercase tracking-widest text-zinc-400 mb-3">Active rooms</h2>
      {rooms.length === 0 ? (
        <p className="text-sm text-zinc-400 py-12 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">
          No rooms yet. Create one or quick-match.
        </p>
      ) : (
        <div className="space-y-2">
          {rooms.map((r) => {
            const badge = STATUS_BADGE[r.status];
            const scoreLine = r.status === "ended" && r.result ? Object.values(r.result.scores).join(" – ") : null;
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{r.name}</span>
                    {r.hasPassword && <span title="Private">🔒</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {showBestOf && `Best of ${r.config.bestOf} · `}
                    {r.members.length}/2 players
                    {scoreLine && ` · final ${scoreLine}`}
                  </p>
                </div>
                {r.status === "waiting" ? (
                  <button onClick={() => joinRoom(r)} className="text-xs font-medium px-4 py-2 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 active:scale-95 transition-all">
                    Join
                  </button>
                ) : (
                  <span className="text-xs text-zinc-400 px-2">{r.status === "active" ? "Full" : "Done"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
