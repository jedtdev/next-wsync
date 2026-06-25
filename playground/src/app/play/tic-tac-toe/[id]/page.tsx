"use client";

import { useRealtime } from "@/lib/wsync/client";
import { useIdentity } from "@/lib/identity";
import type { TttGameState, TttSymbol } from "@/lib/wsync/channels/tic-tac-toe/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";

const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] as const;

function winningCells(board: TttGameState["board"]): Set<number> {
  for (const [a, b, c] of WIN_LINES)
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return new Set([a, b, c]);
  return new Set();
}

const SYMBOL_COLOR: Record<TttSymbol, string> = { X: "text-rose-500", O: "text-blue-500" };

const REJECT_MSG: Record<string, string> = {
  full: "This room is already full.",
  password: "Wrong password for this private room.",
  ended: "This match has already ended.",
  busy: "You're already in another room for this game.",
  denied: "Unable to join this room.",
};

export default function TttRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const { session } = useIdentity();

  const [key] = useState(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("k") ?? "") : ""
  );

  const [game, setGame] = useState<TttGameState | null>(null);
  const [mySymbol, setSymbol] = useState<TttSymbol | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [copied, setCopied] = useState(false);

  const { send, status } = useRealtime("tic-tac-toe", {
    parameters: { room: roomId, password: key },
    events: {
      onMessage(event) {
        if (event.type === "rejected") { setRejected(event.data.reason); return; }
        if (event.type === "rematch") {
          const url = event.data.key
            ? `/play/tic-tac-toe/${event.data.room}?k=${encodeURIComponent(event.data.key)}`
            : `/play/tic-tac-toe/${event.data.room}`;
          router.replace(url);
          return;
        }
        if (event.type === "init") { const { symbol, ...g } = event.data; setSymbol(symbol); setGame(g); return; }
        if (event.type === "state") { setGame(event.data); return; }
        if (event.type === "join") {
          setGame((prev) => prev ? { ...prev, status: "playing", players: { ...prev.players, [event.data.symbol]: "•" }, names: { ...prev.names, [event.data.symbol]: event.data.name } } : prev);
          return;
        }
        if (event.type === "leave") { setOpponentLeft(true); }
      },
    },
  });

  function handleMove(cell: number) {
    if (!game || game.status !== "playing" || game.turn !== mySymbol) return;
    if (game.board[cell] !== null) return;
    send({ type: "move", data: { cell } });
  }

  function copyLink() {
    const url = `${window.location.origin}/play/tic-tac-toe/${roomId}${key ? `?k=${encodeURIComponent(key)}` : ""}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (rejected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
        <p className="text-5xl">🚫</p>
        <p className="text-lg font-semibold">{REJECT_MSG[rejected] ?? rejected}</p>
        <Link href="/play/tic-tac-toe" className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity">
          Back to lobby
        </Link>
      </div>
    );
  }

  const cells = game?.board ?? Array(9).fill(null);
  const winning = game?.status === "won" ? winningCells(cells) : new Set<number>();
  const isMyTurn = game?.status === "playing" && game.turn === mySymbol && !opponentLeft;
  const opSymbol = (mySymbol === "X" ? "O" : mySymbol === "O" ? "X" : null) as TttSymbol | null;
  const myName = mySymbol ? (game?.names[mySymbol] ?? session.username) : session.username;
  const opName = opSymbol ? (game?.names[opSymbol] ?? "Waiting…") : "…";
  const over = game?.status === "won" || game?.status === "draw";

  return (
    <div className="flex flex-col items-center min-h-screen p-6 gap-6">
      <div className="w-full max-w-md flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
        <span className="text-zinc-400">Room</span>
        <span className="font-mono font-semibold">{roomId}</span>
        {key && (<><span className="text-zinc-300 dark:text-zinc-600">·</span><span className="text-zinc-400">🔒 pw</span><span className="font-mono font-semibold">{key}</span></>)}
        <button onClick={copyLink} className="ml-auto px-2.5 py-1 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium hover:opacity-90">
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <div className="text-center">
        <h1 className="text-xl font-bold">Tic-Tac-Toe</h1>
        <p className="text-xs text-zinc-400">{status}</p>
      </div>

      <div className="flex items-center gap-6 w-full max-w-xs">
        {(["X", "O"] as TttSymbol[]).map((sym) => {
          const isMe = sym === mySymbol;
          const active = game?.status === "playing" && game.turn === sym;
          return (
            <div key={sym} className={`flex-1 flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${active ? "border-zinc-400 bg-zinc-50 dark:bg-zinc-900 shadow-sm" : "border-transparent"}`}>
              <span className={`text-2xl font-bold ${SYMBOL_COLOR[sym]}`}>{sym}</span>
              <span className="text-xs text-zinc-500 truncate max-w-full">{isMe ? myName : opName}{isMe ? " (you)" : ""}</span>
              {active && <span className="text-xs text-zinc-400">← turn</span>}
            </div>
          );
        })}
      </div>

      <div className="relative">
        <div className="grid grid-cols-3 gap-2">
          {cells.map((cell, i) => {
            const isWin = winning.has(i);
            const canClick = isMyTurn && !cell && game?.status === "playing";
            return (
              <button
                key={i}
                onClick={() => handleMove(i)}
                disabled={!canClick}
                className={`w-24 h-24 rounded-xl text-4xl font-bold transition-all border ${isWin ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-300" : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"} ${canClick ? "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer" : "cursor-default"}`}
              >
                {cell && <span className={SYMBOL_COLOR[cell as TttSymbol]}>{cell}</span>}
              </button>
            );
          })}
        </div>

        {game?.status === "waiting" && !opponentLeft && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm">
            <div className="text-center space-y-2 px-4">
              <div className="w-6 h-6 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-medium">Waiting for opponent…</p>
              <p className="text-xs text-zinc-400">Share the link above{key ? " and password" : ""}.</p>
            </div>
          </div>
        )}

        {opponentLeft && !over && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
            <div className="text-center space-y-3">
              <p className="text-lg font-bold">Opponent left</p>
              <Link href="/play/tic-tac-toe" className="inline-block px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90">
                Back to lobby
              </Link>
            </div>
          </div>
        )}

        {over && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/90 dark:bg-zinc-950/90 backdrop-blur-sm">
            <div className="text-center space-y-3">
              {game.status === "won" ? (
                <>
                  <p className={`text-3xl font-bold ${SYMBOL_COLOR[game.winner!]}`}>{game.winner} wins!</p>
                  <p className="text-sm text-zinc-500">{game.winner === mySymbol ? "🎉 You won" : `${opName} won`}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-zinc-500">Draw!</p>
              )}
              <div className="flex gap-2 justify-center">
                <button onClick={() => send({ type: "rematch" })} className="px-4 py-2 text-sm font-medium rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity">
                  Rematch
                </button>
                <Link href="/play/tic-tac-toe" className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                  Lobby
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {game?.status === "playing" && !opponentLeft && (
        <p className="text-sm text-zinc-400">{isMyTurn ? "Your turn" : `${opName}'s turn`}</p>
      )}
    </div>
  );
}
