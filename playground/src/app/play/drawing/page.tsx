"use client";

import { useRealtime } from "@/lib/wsync/client";
import type {
  DrawingStroke,
  DrawingPoint,
} from "@/lib/wsync/channels/drawing/schema";
import { useEffect, useRef, useState } from "react";

const COLORS = [
  "#000000",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff",
];
const WIDTHS = [2, 5, 12, 24];

type ActiveStroke = {
  id: string;
  userId: string;
  color: string;
  width: number;
  points: DrawingPoint[];
};

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: { color: string; width: number; points: DrawingPoint[] },
) {
  const pts = stroke.points;
  if (pts.length === 0) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.color === "__eraser__") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0]!.x, pts[0]!.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fillStyle =
      stroke.color === "__eraser__" ? "rgba(0,0,0,1)" : stroke.color;
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
    const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
    ctx.quadraticCurveTo(pts[i]!.x, pts[i]!.y, mx, my);
  }
  ctx.lineTo(pts[pts.length - 1]!.x, pts[pts.length - 1]!.y);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";
}

export default function DrawingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const activeRef = useRef(new Map<string, ActiveStroke>());
  const ownRef = useRef<ActiveStroke | null>(null);
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const pendingRef = useRef<DrawingPoint | null>(null);
  const sendRafRef = useRef<number | null>(null);

  const [color, setColor] = useState("#000000");
  const [width, setWidth] = useState(5);
  const [eraser, setEraser] = useState(false);

  const { send, status } = useRealtime("drawing", {
    events: {
      onMessage(event) {
        if (event.type === "sync") {
          strokesRef.current = event.data.strokes;
          dirtyRef.current = true;
          return;
        }
        if (event.type === "begin") {
          const { id, userId, color, width, x, y } = event.data;
          activeRef.current.set(id, {
            id,
            userId,
            color,
            width,
            points: [{ x, y }],
          });
          dirtyRef.current = true;
          return;
        }
        if (event.type === "draw") {
          const stroke = activeRef.current.get(event.data.id);
          if (stroke) {
            stroke.points.push({ x: event.data.x, y: event.data.y });
            dirtyRef.current = true;
          }
          return;
        }
        if (event.type === "end") {
          const stroke = activeRef.current.get(event.data.id);
          if (stroke) {
            strokesRef.current.push(stroke as DrawingStroke);
            activeRef.current.delete(event.data.id);
            dirtyRef.current = true;
          }
          return;
        }
        if (event.type === "undo") {
          strokesRef.current = strokesRef.current.filter(
            (s) => s.id !== event.data.strokeId,
          );
          dirtyRef.current = true;
          return;
        }
        if (event.type === "redo") {
          strokesRef.current.push(event.data);
          dirtyRef.current = true;
          return;
        }
        if (event.type === "clear") {
          strokesRef.current = [];
          activeRef.current.clear();
          ownRef.current = null;
          dirtyRef.current = true;
        }
      },
    },
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (ownRef.current) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        send({ type: "undo" });
      }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        send({ type: "redo" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send]);

  // RAF render loop
  useEffect(() => {
    function render() {
      rafRef.current = requestAnimationFrame(render);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of strokesRef.current) drawStroke(ctx, s);
      for (const s of activeRef.current.values()) drawStroke(ctx, s);
      if (ownRef.current) drawStroke(ctx, ownRef.current);
    }
    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ResizeObserver — fixed: read contentRect before writing to avoid feedback loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      dirtyRef.current = true;
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Mouse events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const activeColor = eraser ? "__eraser__" : color;
    const activeWidth = eraser ? 24 : width;

    function pos(e: MouseEvent): DrawingPoint {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onDown(e: MouseEvent) {
      const { x, y } = pos(e);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      ownRef.current = {
        id,
        userId: "",
        color: activeColor,
        width: activeWidth,
        points: [{ x, y }],
      };
      dirtyRef.current = true;
      send({
        type: "begin",
        data: { id, color: activeColor, width: activeWidth, x, y },
      });
    }

    function onMove(e: MouseEvent) {
      if (!ownRef.current) return;
      const p = pos(e);
      ownRef.current.points.push(p);
      pendingRef.current = p;
      dirtyRef.current = true;
      if (sendRafRef.current !== null) return;
      sendRafRef.current = requestAnimationFrame(() => {
        sendRafRef.current = null;
        if (pendingRef.current && ownRef.current) {
          send({
            type: "draw",
            data: { id: ownRef.current.id, ...pendingRef.current },
          });
          pendingRef.current = null;
        }
      });
    }

    function onUp() {
      if (!ownRef.current) return;
      strokesRef.current.push(ownRef.current as DrawingStroke);
      send({ type: "end", data: { id: ownRef.current.id } });
      ownRef.current = null;
      dirtyRef.current = true;
    }

    // Touch support
    function touchPos(t: Touch): DrawingPoint {
      const r = canvas!.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const { x, y } = touchPos(t);
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      ownRef.current = {
        id,
        userId: "",
        color: activeColor,
        width: activeWidth,
        points: [{ x, y }],
      };
      dirtyRef.current = true;
      send({
        type: "begin",
        data: { id, color: activeColor, width: activeWidth, x, y },
      });
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (!ownRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const p = touchPos(t);
      ownRef.current.points.push(p);
      pendingRef.current = p;
      dirtyRef.current = true;
      if (sendRafRef.current !== null) return;
      sendRafRef.current = requestAnimationFrame(() => {
        sendRafRef.current = null;
        if (pendingRef.current && ownRef.current) {
          send({
            type: "draw",
            data: { id: ownRef.current.id, ...pendingRef.current },
          });
          pendingRef.current = null;
        }
      });
    }

    function onTouchEnd(e: TouchEvent) {
      e.preventDefault();
      onUp();
    }

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mouseleave", onUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [send, color, width, eraser]);

  function handleClear() {
    strokesRef.current = [];
    activeRef.current.clear();
    ownRef.current = null;
    dirtyRef.current = true;
    send({ type: "clear" });
  }

  return (
    <div className="flex flex-col p-4 gap-3 h-screen overflow-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Drawing</h1>
        <span className="text-xs text-zinc-400">{status}</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 flex-wrap shrink-0">
        {/* Colors */}
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                setEraser(false);
              }}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110 border border-zinc-200 dark:border-zinc-700"
              style={{
                backgroundColor: c,
                outline: !eraser && color === c ? "2px solid #6366f1" : "none",
                outlineOffset: "2px",
              }}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />

        {/* Brush sizes */}
        <div className="flex items-center gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => {
                setWidth(w);
                setEraser(false);
              }}
              className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                !eraser && width === w
                  ? "bg-indigo-50 dark:bg-indigo-950 ring-1 ring-indigo-300"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              <div
                className="rounded-full bg-zinc-800 dark:bg-zinc-200"
                style={{ width: Math.min(w, 22), height: Math.min(w, 22) }}
              />
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />

        {/* Eraser */}
        <button
          onClick={() => setEraser((e) => !e)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            eraser
              ? "bg-indigo-50 dark:bg-indigo-950 ring-1 ring-indigo-300 text-indigo-700 dark:text-indigo-300"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 20H7L3 16l10-10 7 7-3.5 3.5" />
            <path d="M6.5 17.5l4-4" />
          </svg>
          Eraser
        </button>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => send({ type: "undo" })}
            disabled={!!ownRef.current}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </svg>
            Undo
          </button>
          <button
            onClick={() => send({ type: "redo" })}
            disabled={!!ownRef.current}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 14 5-5-5-5" />
              <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
            </svg>
            Redo
          </button>
        </div>

        <div className="flex-1" />

        {/* Clear */}
        <button
          onClick={handleClear}
          className="text-xs px-3 py-1.5 rounded-lg border hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-red-500 border-red-200 dark:border-red-900"
        >
          Clear all
        </button>
      </div>

      {/* Canvas — block + w-full prevents it from influencing flex container size */}
      <canvas
        ref={canvasRef}
        className="block w-full flex-1 min-h-0 rounded-xl border bg-white dark:bg-zinc-950"
        style={{ cursor: eraser ? "cell" : "crosshair", touchAction: "none" }}
      />
    </div>
  );
}
