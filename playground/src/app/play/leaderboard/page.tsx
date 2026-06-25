"use client";

import { useRealtime } from "@/lib/wsync/client";
import { useIdentity } from "@/lib/identity";
import type { LbFilter, PlayerStat, GameRecord, Totals } from "@/lib/wsync/channels/leaderboard/schema";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const MOVE_EMOJI: Record<string, string> = { rock: "✊", paper: "🖐", scissors: "✌️" };
const FILTERS: { id: LbFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "rps", label: "RPS" },
  { id: "tictactoe", label: "Tic-Tac-Toe" },
];
const MEDALS = ["🥇", "🥈", "🥉"];

function winRate(p: PlayerStat): number {
  return p.played === 0 ? 0 : Math.round((p.wins / p.played) * 100);
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function GameMoves({ g }: { g: GameRecord }) {
  if (g.kind === "rps") {
    return (
      <div className="flex items-center gap-1 text-lg shrink-0">
        <span title={g.a.detail}>{g.a.detail ? MOVE_EMOJI[g.a.detail] : "?"}</span>
        <span className="text-[10px] text-zinc-300 dark:text-zinc-600">vs</span>
        <span title={g.b.detail}>{g.b.detail ? MOVE_EMOJI[g.b.detail] : "?"}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-xs font-bold shrink-0">
      <span className="text-rose-500">X</span>
      <span className="text-[10px] text-zinc-300 dark:text-zinc-600">vs</span>
      <span className="text-blue-500">O</span>
    </div>
  );
}

export default function LeaderboardPage() {
  const { session } = useIdentity();

  const [players, setPlayers] = useState<PlayerStat[]>([]);
  const [totals, setTotals] = useState<Totals>({ all: 0, rps: 0, tictactoe: 0 });
  const [list, setList] = useState<GameRecord[]>([]);
  const [filter, setFilter] = useState<LbFilter>("all");
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const filterRef = useRef<LbFilter>("all");
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(true);
  const seenRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { send, status } = useRealtime("leaderboard", {
    events: {
      onMessage(event) {
        if (event.type === "update") {
          setPlayers(event.data.players);
          setTotals(event.data.totals);
          const rec = event.data.record;
          if (rec && (filterRef.current === "all" || filterRef.current === rec.kind)) {
            if (!seenRef.current.has(rec.id)) {
              seenRef.current.add(rec.id);
              setList((prev) => [rec, ...prev]);
              setFlashId(rec.id);
              setTimeout(() => setFlashId(null), 1500);
            }
          }
          return;
        }
        if (event.type === "history") {
          if (event.data.kind !== filterRef.current) return;
          setList((prev) => {
            const next = [...prev];
            for (const it of event.data.items) {
              if (!seenRef.current.has(it.id)) { seenRef.current.add(it.id); next.push(it); }
            }
            return next;
          });
          cursorRef.current = event.data.nextCursor;
          hasMoreRef.current = event.data.nextCursor !== null;
          setHasMore(event.data.nextCursor !== null);
          loadingRef.current = false;
          setLoading(false);
        }
      },
    },
  });

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    send({ type: "loadHistory", data: { kind: filterRef.current, cursor: cursorRef.current } });
  }, [send]);

  function changeFilter(kind: LbFilter) {
    if (kind === filterRef.current) return;
    filterRef.current = kind;
    cursorRef.current = null;
    hasMoreRef.current = true;
    loadingRef.current = true;
    seenRef.current = new Set();
    setFilter(kind);
    setList([]);
    setHasMore(true);
    setLoading(true);
    send({ type: "loadHistory", data: { kind, cursor: null } });
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) loadMore(); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen p-6 md:p-10 max-w-4xl mx-auto">
      <style>{`
        @keyframes row-flash { 0% { background-color: rgba(99,102,241,0.18); } 100% { background-color: transparent; } }
        @keyframes slide-in { 0% { transform: translateY(-8px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .row-flash { animation: row-flash 1.5s ease-out; }
        .slide-in { animation: slide-in 0.3s ease-out both; }
      `}</style>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-xs text-zinc-400 mt-0.5">RPS &amp; Tic-Tac-Toe · live · {status}</p>
        </div>
        <Link href="/" className="text-sm font-medium px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
          ← Home
        </Link>
      </div>

      <div className="grid md:grid-cols-[1.4fr_1fr] gap-6">
        <section>
          <h2 className="text-xs uppercase tracking-widest text-zinc-400 mb-3">Top players</h2>
          {players.length === 0 ? (
            <p className="text-sm text-zinc-400 py-12 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">No games played yet. Be the first!</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-900">
                    <th className="py-2.5 pl-4 pr-2 font-medium">#</th>
                    <th className="py-2.5 px-2 font-medium">Player</th>
                    <th className="py-2.5 px-2 font-medium text-center">W</th>
                    <th className="py-2.5 px-2 font-medium text-center">L</th>
                    <th className="py-2.5 px-2 font-medium text-center">D</th>
                    <th className="py-2.5 px-2 font-medium text-center">Win%</th>
                    <th className="py-2.5 pr-4 pl-2 font-medium text-center">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p, i) => {
                    const isMe = p.playerId === session.id;
                    return (
                      <tr key={p.playerId} className={`border-t border-zinc-100 dark:border-zinc-800/70 ${isMe ? "bg-indigo-50/60 dark:bg-indigo-950/40" : ""}`}>
                        <td className="py-2.5 pl-4 pr-2 text-zinc-400 tabular-nums">{MEDALS[i] ?? i + 1}</td>
                        <td className="py-2.5 px-2 font-medium truncate max-w-[150px]">
                          {p.name}
                          {isMe && <span className="ml-1 text-[10px] text-indigo-500">you</span>}
                        </td>
                        <td className="py-2.5 px-2 text-center tabular-nums text-green-600 dark:text-green-400">{p.wins}</td>
                        <td className="py-2.5 px-2 text-center tabular-nums text-zinc-400">{p.losses}</td>
                        <td className="py-2.5 px-2 text-center tabular-nums text-zinc-400">{p.draws}</td>
                        <td className="py-2.5 px-2 text-center tabular-nums">{winRate(p)}%</td>
                        <td className="py-2.5 pr-4 pl-2 text-center tabular-nums">
                          {p.streak > 1 ? <span className="text-orange-500">🔥{p.streak}</span> : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-widest text-zinc-400">Game history</h2>
          </div>
          <div className="flex gap-1 mb-3 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-xs">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              const count = f.id === "all" ? totals.all : f.id === "rps" ? totals.rps : totals.tictactoe;
              return (
                <button key={f.id} onClick={() => changeFilter(f.id)} className={`flex-1 py-1.5 rounded-lg font-medium transition-colors ${active ? "bg-white dark:bg-zinc-800 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
                  {f.label}
                  <span className="ml-1 text-zinc-400 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          {list.length === 0 && !loading ? (
            <p className="text-sm text-zinc-400 py-12 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl">No games yet.</p>
          ) : (
            <div className="space-y-2">
              {list.map((g) => {
                const draw = g.winnerId === null;
                const aWon = g.winnerId === g.a.playerId;
                const winnerName = draw ? null : aWon ? g.a.name : g.b.name;
                return (
                  <div key={g.id} className={`slide-in flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${flashId === g.id ? "row-flash" : ""}`}>
                    <GameMoves g={g} />
                    <div className="flex-1 min-w-0 text-xs">
                      <p className="truncate">
                        <span className={aWon ? "font-semibold" : "text-zinc-500"}>{g.a.name}</span>
                        <span className="text-zinc-300 dark:text-zinc-600"> · </span>
                        <span className={!draw && !aWon ? "font-semibold" : "text-zinc-500"}>{g.b.name}</span>
                      </p>
                      <p className="text-[11px] text-zinc-400">{draw ? "Draw" : `${winnerName} won`} · {timeAgo(g.at)}</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-zinc-300 dark:text-zinc-600 shrink-0">
                      {g.kind === "rps" ? "RPS" : "TTT"}
                    </span>
                  </div>
                );
              })}
              <div ref={sentinelRef} className="h-8 flex items-center justify-center">
                {loading && <span className="text-xs text-zinc-400">Loading…</span>}
                {!hasMore && list.length > 0 && <span className="text-[11px] text-zinc-300 dark:text-zinc-600">End of history</span>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
