"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIdentity } from "@/lib/identity";
import { useRealtime } from "@/lib/wsync/client";
import { CursorOverlay, type ClickRipple, type RemoteCursor, type SelectionBox, type SelfCursor } from "@/components/custom/cursor-overlay";

const RIPPLE_TTL = 700;

export function CursorView() {
  const { session } = useIdentity();
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const [self, setSelf] = useState<SelfCursor>({ x: -1, y: -1, grabbing: false, color: "#3b82f6" });
  const [selections, setSelections] = useState<Map<string, SelectionBox>>(new Map());
  const [selfSelection, setSelfSelection] = useState<SelectionBox | null>(null);

  // pending position update — flushed on next RAF
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const rafMove = useRef<number | null>(null);
  const isGrabbing = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);
  const pendingSelect = useRef<SelectionBox | null>(null);
  const rafSelect = useRef<number | null>(null);

  const { send, status } = useRealtime("cursor", {
    events: {
      onMessage(data) {
        if (data.type === "presence") {
          setCursors(new Map(data.cursors.map((c) => [c.id, c])));
        } else if (data.type === "leave") {
          setCursors((prev) => { const m = new Map(prev); m.delete(data.id); return m; });
        } else if (data.type === "move") {
          setCursors((prev) => new Map(prev).set(data.id, {
            id: data.id, username: data.username,
            x: data.x, y: data.y,
            grabbing: prev.get(data.id)?.grabbing ?? false,
          }));
        } else if (data.type === "grab") {
          setCursors((prev) => new Map(prev).set(data.id, {
            ...(prev.get(data.id) ?? { id: data.id, username: data.username, grabbing: false }),
            x: data.x, y: data.y, grabbing: true,
          }));
        } else if (data.type === "release") {
          setCursors((prev) => {
            const entry = prev.get(data.id);
            if (!entry) return prev;
            return new Map(prev).set(data.id, { ...entry, x: data.x, y: data.y, grabbing: false });
          });
        } else if (data.type === "click") {
          const ripple: ClickRipple = { id: data.id, x: data.x, y: data.y, at: Date.now() };
          setRipples((prev) => [...prev, ripple]);
          setTimeout(() => setRipples((prev) => prev.filter((r) => r !== ripple)), RIPPLE_TTL);
        } else if (data.type === "select") {
          setSelections((prev) => new Map(prev).set(data.id, { id: data.id, x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2 }));
        } else if (data.type === "select-end") {
          setSelections((prev) => { const m = new Map(prev); m.delete(data.id); return m; });
        }
      },
    },
  });

  const flushSelect = useCallback(() => {
    if (!pendingSelect.current) return;
    const s = pendingSelect.current;
    pendingSelect.current = null;
    send({ type: "select", x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
    rafSelect.current = null;
  }, [send]);

  const flushMove = useCallback(() => {
    if (!pendingMove.current) return;
    const { x, y } = pendingMove.current;
    pendingMove.current = null;
    send(isGrabbing.current ? { type: "grab", x, y } : { type: "move", x, y });
    rafMove.current = null;
  }, [send]);

  const scheduleMove = useCallback((x: number, y: number) => {
    pendingMove.current = { x, y };
    if (!rafMove.current) rafMove.current = requestAnimationFrame(flushMove);
  }, [flushMove]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      setSelf((prev) => ({ ...prev, x, y }));
      scheduleMove(x, y);

      if (isGrabbing.current && dragStart.current) {
        hasDragged.current = true;
        const box: SelectionBox = { id: session.id, x1: dragStart.current.x, y1: dragStart.current.y, x2: x, y2: y };
        setSelfSelection(box);
        pendingSelect.current = box;
        if (!rafSelect.current) rafSelect.current = requestAnimationFrame(flushSelect);
      }
    }
    function onDown(e: MouseEvent) {
      isGrabbing.current = true;
      hasDragged.current = false;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      dragStart.current = { x, y };
      setSelf((prev) => ({ ...prev, x, y, grabbing: true }));
      send({ type: "grab", x, y });
    }
    function onUp(e: MouseEvent) {
      isGrabbing.current = false;
      dragStart.current = null;
      setSelfSelection(null);
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      setSelf((prev) => ({ ...prev, x, y, grabbing: false }));
      send({ type: "release", x, y });
      send({ type: "select-end" });
    }
    function onClick(e: MouseEvent) {
      if (hasDragged.current) return;
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      const ripple: ClickRipple = { id: session.id, x, y, at: Date.now() };
      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r !== ripple)), RIPPLE_TTL);
      send({ type: "click", x, y });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("click", onClick);
      if (rafMove.current) cancelAnimationFrame(rafMove.current);
      if (rafSelect.current) cancelAnimationFrame(rafSelect.current);
    };
  }, [send, scheduleMove]);

  const COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899"];
  const selfColor = (() => {
    let hash = 0;
    for (let i = 0; i < session.id.length; i++) hash = (hash * 31 + session.id.charCodeAt(i)) >>> 0;
    return COLORS[hash % COLORS.length];
  })();

  const cursorList = Array.from(cursors.values());

  return (
    <div className="relative h-screen w-full overflow-hidden select-none cursor-none">
      <CursorOverlay
        cursors={cursorList}
        ripples={ripples}
        selections={Array.from(selections.values())}
        selfSelection={selfSelection}
        self={{ ...self, color: selfColor }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
        <p className="text-2xl font-semibold text-zinc-800">Move your cursor</p>
        <p className="text-sm text-zinc-400">Click, grab, and release — others see it all</p>
        <span className={`mt-4 text-xs px-2 py-0.5 rounded-full ${
          status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
        }`}>
          {status} · {cursorList.length} other{cursorList.length !== 1 ? "s" : ""} online
        </span>
        <p className="text-xs text-zinc-400 mt-1">You are <span className="font-medium">{session.username}</span></p>
      </div>
    </div>
  );
}
