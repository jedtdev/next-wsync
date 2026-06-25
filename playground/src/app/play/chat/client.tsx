"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/identity";
import { useRealtime } from "@/lib/wsync/client";
import { ChatFeed, type ChatEvent } from "@/components/custom/chat-feed";
import { Button } from "@/components/ui/button";

export function ChatView() {
  const { session, clearSession } = useIdentity();
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [users, setUsers] = useState<{ id: string; username: string; online: boolean }[]>([]);
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { send, status } = useRealtime("chat", {
    events: {
      onMessage(data) {
        if (data.type === "presence") {
          setUsers(data.users.map((u) => ({ ...u, online: true })));
        } else if (data.type === "history") {
          setEvents(
            data.messages.map((m) => ({
              kind: "message" as const,
              id: m.id,
              username: m.username,
              text: m.text,
              at: m.at,
              self: m.id === session.id,
            })),
          );
        } else if (data.type === "joined") {
          setUsers((prev) => {
            const exists = prev.some((u) => u.id === data.id);
            if (exists) return prev.map((u) => u.id === data.id ? { ...u, online: true } : u);
            return [...prev, { id: data.id, username: data.username, online: true }];
          });
          setEvents((prev) => [...prev, { kind: "joined", username: data.username }]);
        } else if (data.type === "left") {
          setUsers((prev) => prev.map((u) => u.id === data.id ? { ...u, online: false } : u));
          setEvents((prev) => [...prev, { kind: "left", username: data.username }]);
        } else if (data.type === "message") {
          setEvents((prev) => [
            ...prev,
            {
              kind: "message",
              id: data.id,
              username: data.username,
              text: data.text,
              at: data.at,
              self: data.id === session.id,
            },
          ]);
        }
      },
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || status !== "open") return;
    send({ type: "message", text: trimmed });
    setText("");
  }

  return (
    <div className="flex h-screen">
      {/* sidebar */}
      <aside className="w-52 shrink-0 border-r flex flex-col">
        <div className="h-12 px-4 flex items-center border-b shrink-0">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Online</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {users.map((u) => (
            <div key={u.id} className={`flex items-center gap-2 px-4 py-1.5 text-sm ${u.online ? "" : "opacity-40"}`}>
              <span className={`size-2 rounded-full shrink-0 ${u.online ? "bg-emerald-500" : "bg-zinc-400"}`} />
              <span className={u.id === session.id ? "font-semibold" : ""}>{u.username}</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t">
          <p className="text-xs text-zinc-500 mb-2">Signed in as <span className="font-medium">{session.username}</span></p>
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={clearSession}>
            Leave
          </Button>
        </div>
      </aside>

      {/* main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* header */}
        <header className="h-12 shrink-0 border-b px-4 flex items-center gap-2">
          <span className="font-semibold">Chat</span>
          <span
            className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
              status === "open"
                ? "bg-emerald-100 text-emerald-700"
                : status === "reconnecting"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-zinc-100 text-zinc-500"
            }`}
          >
            {status}
          </span>
        </header>

        {/* feed */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <ChatFeed events={events} />
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <div className="border-t px-4 py-3 flex gap-2 items-center">
          <input
            className="flex-1 h-9 rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400 bg-transparent"
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            maxLength={500}
          />
          <Button size="sm" onClick={submit} disabled={!text.trim() || status !== "open"}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
