"use client";

import { cn } from "@/lib/utils";

export type ChatEvent =
  | { kind: "message"; id: string; username: string; text: string; at: string; self: boolean }
  | { kind: "joined"; username: string }
  | { kind: "left"; username: string };

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatFeed({ events }: { events: ChatEvent[] }) {
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < events.length) {
    const ev = events[i];

    if (ev.kind !== "message") {
      nodes.push(
        <div key={i} className="text-center text-xs text-zinc-400 py-1">
          {ev.username} {ev.kind === "joined" ? "joined" : "left"}
        </div>,
      );
      i++;
      continue;
    }

    // collect consecutive messages from the same sender
    const group: typeof ev[] = [ev];
    while (
      i + group.length < events.length &&
      events[i + group.length].kind === "message" &&
      (events[i + group.length] as typeof ev).id === ev.id
    ) {
      group.push(events[i + group.length] as typeof ev);
    }

    nodes.push(
      <div
        key={i}
        className={cn("flex flex-col gap-0.5", ev.self ? "items-end" : "items-start")}
      >
        {!ev.self && (
          <span className="text-xs font-medium text-zinc-500 px-1 mb-0.5">{ev.username}</span>
        )}
        {group.map((msg, j) => (
          <div key={j} className={cn("flex flex-col gap-0", ev.self ? "items-end" : "items-start")}>
            <div
              className={cn(
                "px-3.5 py-2 text-sm leading-snug max-w-xs break-words",
                ev.self
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-900",
                // round all corners, flatten adjacent corners
                group.length === 1
                  ? "rounded-2xl"
                  : j === 0
                  ? ev.self ? "rounded-2xl rounded-br-sm" : "rounded-2xl rounded-bl-sm"
                  : j === group.length - 1
                  ? ev.self ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"
                  : ev.self ? "rounded-l-2xl rounded-r-sm" : "rounded-r-2xl rounded-l-sm",
              )}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <span className="text-[10px] text-zinc-400 px-1 mt-0.5">
          {formatTime(group[group.length - 1].at)}
        </span>
      </div>,
    );

    i += group.length;
  }

  return <div className="flex flex-col gap-2 px-4 py-4">{nodes}</div>;
}
