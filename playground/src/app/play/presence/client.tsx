"use client";

import { useState } from "react";
import { useIdentity } from "@/lib/identity";
import { useRealtime } from "@/lib/wsync/client";

type PresenceUser = { id: string; username: string; joinedAt: string };

const COLORS = [
  ["#fef3c7", "#d97706"],
  ["#dbeafe", "#2563eb"],
  ["#fce7f3", "#db2777"],
  ["#dcfce7", "#16a34a"],
  ["#ede9fe", "#7c3aed"],
  ["#ffedd5", "#ea580c"],
  ["#cffafe", "#0891b2"],
  ["#fee2e2", "#dc2626"],
];

function colorsFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function initials(username: string) {
  return username
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ user, self }: { user: PresenceUser; self: boolean }) {
  const [bg, fg] = colorsFor(user.id);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex flex-col items-center gap-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="size-12 rounded-full flex items-center justify-center text-sm font-semibold select-none ring-2 ring-offset-2 transition-transform hover:scale-110"
        style={{ backgroundColor: bg, color: fg, "--tw-ring-color": fg } as React.CSSProperties}
      >
        {initials(user.username)}
      </div>

      {self && (
        <span className="absolute -top-1 -right-1 size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
      )}

      {hovered && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 text-white text-xs px-2 py-1 z-10 pointer-events-none">
          {user.username}{self && " (you)"}
          <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-zinc-900" />
        </div>
      )}

      <span className="text-[11px] text-zinc-500 max-w-[56px] truncate text-center">
        {user.username}
      </span>
    </div>
  );
}

export function PresenceView() {
  const { session } = useIdentity();
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useRealtime("presence", {
    events: {
      onMessage(data) {
        if (data.type === "presence") {
          setUsers(data.users);
        } else if (data.type === "joined") {
          setUsers((prev) => {
            if (prev.some((u) => u.id === data.id)) return prev;
            return [...prev, { id: data.id, username: data.username, joinedAt: data.joinedAt }];
          });
        } else if (data.type === "left") {
          setUsers((prev) => prev.filter((u) => u.id !== data.id));
        }
      },
    },
  });

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-xl font-semibold">Who&apos;s here</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {users.length} {users.length === 1 ? "person" : "people"} online right now
          </p>
        </div>

        {users.length === 0 ? (
          <p className="text-sm text-zinc-400">No one else here yet.</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {users.map((u) => (
              <Avatar key={u.id} user={u} self={u.id === session.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
