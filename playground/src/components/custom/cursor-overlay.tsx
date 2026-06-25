"use client";

import { useEffect, useRef } from "react";

export type RemoteCursor = {
  id: string;
  username: string;
  x: number;
  y: number;
  grabbing: boolean;
};

export type SelectionBox = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ClickRipple = {
  id: string;
  x: number;
  y: number;
  at: number;
};

const RIPPLE_DURATION = 600;

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

function colorFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function CursorSvg({ grabbing, color }: { grabbing: boolean; color: string }) {
  if (grabbing) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M8 9V6a2 2 0 1 1 4 0v3m-4 0a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0v-5a2 2 0 0 0-2-2m-8 0h8"
          stroke={color} strokeWidth="1.5" strokeLinecap="round" fill="white"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M4 2L16 10L10 11.5L7.5 18L4 2Z"
        fill={color} stroke="white" strokeWidth="1.2" strokeLinejoin="round"
      />
    </svg>
  );
}

export type SelfCursor = { x: number; y: number; grabbing: boolean; color: string };

export function CursorOverlay({
  cursors,
  ripples,
  selections,
  selfSelection,
  self,
}: {
  cursors: RemoteCursor[];
  ripples: ClickRipple[];
  selections: SelectionBox[];
  selfSelection?: SelectionBox | null;
  self?: SelfCursor;
}) {
  const rafRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // force a repaint each frame so cursor positions are smooth
  useEffect(() => {
    function loop() {
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  function renderBox(box: SelectionBox, color: string) {
    const left = Math.min(box.x1, box.x2) * 100;
    const top = Math.min(box.y1, box.y2) * 100;
    const width = Math.abs(box.x2 - box.x1) * 100;
    const height = Math.abs(box.y2 - box.y1) * 100;
    return (
      <div
        key={box.id}
        className="absolute rounded-sm"
        style={{
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
          border: `1.5px solid ${color}`,
          backgroundColor: `${color}18`,
        }}
      />
    );
  }

  return (
    <div ref={containerRef} className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {selfSelection && renderBox(selfSelection, self?.color ?? "#3b82f6")}
      {selections.map((s) => renderBox(s, colorFor(s.id)))}

      {self && self.x >= 0 && (
        <div
          className="absolute"
          style={{
            left: `${self.x * 100}%`,
            top: `${self.y * 100}%`,
            transform: "translate(-2px, -2px)",
            willChange: "left, top",
          }}
        >
          <CursorSvg grabbing={self.grabbing} color={self.color} />
          <span
            className="absolute top-5 left-3 text-[11px] font-medium px-1.5 py-0.5 rounded-full text-white whitespace-nowrap"
            style={{ backgroundColor: self.color }}
          >
            You
          </span>
        </div>
      )}
      {cursors.map((c) => {
        const color = colorFor(c.id);
        return (
          <div
            key={c.id}
            className="absolute transition-none"
            style={{
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              transform: "translate(-2px, -2px)",
              willChange: "left, top",
            }}
          >
            <CursorSvg grabbing={c.grabbing} color={color} />
            <span
              className="absolute top-5 left-3 text-[11px] font-medium px-1.5 py-0.5 rounded-full text-white whitespace-nowrap"
              style={{ backgroundColor: color }}
            >
              {c.username}
            </span>
          </div>
        );
      })}

      {ripples.map((r) => {
        const color = colorFor(r.id);
        return (
          <div
            key={`${r.id}-${r.at}`}
            className="absolute rounded-full"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: 28,
              height: 28,
              backgroundColor: color,
              animation: `ripple ${RIPPLE_DURATION}ms ease-out forwards`,
            }}
          />
        );
      })}
    </div>
  );
}
