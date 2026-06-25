"use client";

import { useRealtime } from "@/lib/wsync/client";
import { useIdentity } from "@/lib/identity";
import type { RpsPublicState, RpsMove, RpsSlot } from "@/lib/wsync/channels/rock-paper-scissors/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const MOVES: { id: RpsMove; label: string; emoji: string }[] = [
  { id: "rock", label: "Rock", emoji: "✊" },
  { id: "paper", label: "Paper", emoji: "🖐" },
  { id: "scissors", label: "Scissors", emoji: "✌️" },
];
const MOVE_EMOJI: Record<RpsMove, string> = { rock: "✊", paper: "🖐", scissors: "✌️" };
const REJECT_MSG: Record<string, string> = {
  full: "This room is already full.",
  password: "Wrong password for this private room.",
  ended: "This match has already ended.",
  busy: "You're already in another room for this game.",
  denied: "Unable to join this room.",
};

export default function RpsRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const router = useRouter();
  const { session } = useIdentity();

  const [key] = useState(() =>
    typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("k") ?? "") : ""
  );

  const [game, setGame] = useState<RpsPublicState | null>(null);
  const [mySlot, setMySlot] = useState<RpsSlot | null>(null);
  const [myChoice, setMyChoice] = useState<RpsMove | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { send, status } = useRealtime("rock-paper-scissors", {
    parameters: { room: roomId, password: key },
    events: {
      onMessage(event) {
        if (event.type === "rejected") { setRejected(event.data.reason); return; }
        if (event.type === "rematch") {
          const url = event.data.key
            ? `/play/rock-paper-scissors/${event.data.room}?k=${encodeURIComponent(event.data.key)}`
            : `/play/rock-paper-scissors/${event.data.room}`;
          router.replace(url);
          return;
        }
        if (event.type === "init") {
          const { slot, ...state } = event.data;
          setMySlot(slot);
          setGame(state);
          setMyChoice(null);
          return;
        }
        if (event.type === "state") {
          setGame(event.data);
          if (event.data.status === "choosing") setMyChoice(null);
          return;
        }
        if (event.type === "join") {
          setGame((p) => p ? { ...p, status: "choosing", players: { ...p.players, [event.data.slot]: "•" }, names: { ...p.names, [event.data.slot]: event.data.name } } : p);
          return;
        }
        if (event.type === "leave") {
          setGame((p) => p ? { ...p, players: { ...p.players, [event.data.slot]: null }, names: { ...p.names, [event.data.slot]: null } } : p);
        }
      },
    },
  });

  useEffect(() => {
    if (game?.status !== "result") return;
    const t = setTimeout(() => send({ type: "next" }), 2600);
    return () => clearTimeout(t);
  }, [game?.status, game?.roundResult, send]);

  function choose(move: RpsMove) {
    if (myChoice || game?.status !== "choosing") return;
    setMyChoice(move);
    send({ type: "choose", data: { move } });
  }

  function copyLink() {
    const url = `${window.location.origin}/play/rock-paper-scissors/${roomId}${key ? `?k=${encodeURIComponent(key)}` : ""}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (rejected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
        <p className="text-5xl">🚫</p>
        <p className="text-lg font-semibold">{REJECT_MSG[rejected] ?? rejected}</p>
        <Link href="/play/rock-paper-scissors" className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity">
          Back to lobby
        </Link>
      </div>
    );
  }

  const opSlot: RpsSlot | null = mySlot === "1" ? "2" : mySlot === "2" ? "1" : null;
  const myName = mySlot ? (game?.names[mySlot] ?? "…") : session.username;
  const opName = opSlot ? (game?.names[opSlot] ?? null) : null;
  const opReady = opSlot ? game?.chosen[opSlot] : false;
  const target = game ? Math.ceil(game.bestOf / 2) : 0;
  const rr = game?.roundResult ?? null;
  const myMove = mySlot && rr ? rr.choices[mySlot] : null;
  const opMove = opSlot && rr ? rr.choices[opSlot] : null;
  const matchWinner = game?.matchWinner ?? null;
  const iWonMatch = matchWinner === mySlot;

  return (
    <div className="flex flex-col items-center min-h-screen p-6 gap-6 select-none">
      <style>{`
        @keyframes bounce-in { 0%{transform:scale(.5) translateY(20px);opacity:0} 60%{transform:scale(1.1) translateY(-4px);opacity:1} 100%{transform:scale(1) translateY(0)} }
        @keyframes pop-in { 0%{transform:scale(0);opacity:0} 70%{transform:scale(1.15);opacity:1} 100%{transform:scale(1)} }
        @keyframes breathe { 0%,100%{opacity:.4;transform:scale(1)} 50%{opacity:1;transform:scale(1.06)} }
        .choice-btn{animation:bounce-in .35s cubic-bezier(.34,1.56,.64,1) both}
        .pop-in{animation:pop-in .4s cubic-bezier(.34,1.56,.64,1) both}
        .breathe{animation:breathe 1.6s ease-in-out infinite}
      `}</style>

      <div className="w-full max-w-md flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
        <span className="text-zinc-400">Room</span>
        <span className="font-mono font-semibold">{roomId}</span>
        {key && (<><span className="text-zinc-300 dark:text-zinc-600">·</span><span className="text-zinc-400">🔒 pw</span><span className="font-mono font-semibold">{key}</span></>)}
        <button onClick={copyLink} className="ml-auto px-2.5 py-1 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-medium hover:opacity-90">
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>

      <div className="text-center">
        <h1 className="text-xl font-bold">Rock Paper Scissors</h1>
        <p className="text-xs text-zinc-400">Best of {game?.bestOf ?? "…"} · first to {target} · {status}</p>
      </div>

      {game && (
        <div className="flex items-center gap-6 px-6 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          {(["1", "2"] as RpsSlot[]).map((slot) => {
            const isMe = slot === mySlot;
            return (
              <div key={slot} className="flex flex-col items-center min-w-20">
                <span className="text-xs text-zinc-400 truncate max-w-24">{game.names[slot] ?? "Waiting…"}{isMe ? " (you)" : ""}</span>
                <span className="text-4xl font-bold tabular-nums">{game.scores[slot]}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="w-full max-w-sm">
        {game?.status === "waiting" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="breathe text-5xl">🤜🤛</div>
            <p className="text-sm font-medium text-zinc-500">Waiting for an opponent…</p>
            <p className="text-xs text-zinc-400">Share the link above{key ? " and password" : ""} to invite a friend.</p>
          </div>
        )}

        {game?.status === "choosing" && (
          <div className="space-y-4">
            <div className={`flex items-center justify-center gap-2 text-sm ${opReady ? "text-green-500" : "text-zinc-400"}`}>
              {opReady ? (
                <span className="pop-in">{opName ?? "Opponent"} has chosen</span>
              ) : (
                <span className="breathe">Waiting for {opName ?? "opponent"}…</span>
              )}
            </div>
            {!myChoice ? (
              <div className="grid grid-cols-3 gap-3">
                {MOVES.map((m, i) => (
                  <button key={m.id} onClick={() => choose(m.id)} className="choice-btn flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:scale-105 active:scale-95 transition-all" style={{ animationDelay: `${i * 60}ms` }}>
                    <span className="text-4xl">{m.emoji}</span>
                    <span className="text-xs font-medium text-zinc-500">{m.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <div className="text-6xl pop-in">{MOVE_EMOJI[myChoice]}</div>
                <p className="text-sm text-zinc-500">You chose <span className="font-semibold">{myChoice}</span></p>
              </div>
            )}
          </div>
        )}

        {game?.status === "result" && rr && (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="flex items-center justify-center gap-5">
              <div className="text-6xl pop-in">{myMove ? MOVE_EMOJI[myMove] : "?"}</div>
              <span className="text-sm font-bold text-zinc-400">VS</span>
              <div className="text-6xl pop-in" style={{ animationDelay: "100ms" }}>{opMove ? MOVE_EMOJI[opMove] : "?"}</div>
            </div>
            <p className="text-lg font-bold pop-in" style={{ animationDelay: "200ms" }}>
              {rr.winner === "draw" ? "Draw round" : rr.winner === mySlot ? "You win the round!" : `${opName} wins the round`}
            </p>
            <p className="text-xs text-zinc-400">Next round…</p>
          </div>
        )}

        {game?.status === "matchOver" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-5xl pop-in">{iWonMatch ? "🏆" : "🫡"}</p>
            <p className={`text-2xl font-bold pop-in ${iWonMatch ? "text-green-500" : "text-rose-500"}`} style={{ animationDelay: "120ms" }}>
              {iWonMatch ? "You win the match!" : `${matchWinner ? game.names[matchWinner] : "Opponent"} wins`}
            </p>
            <p className="text-sm text-zinc-400">Final: {game.scores["1"]} – {game.scores["2"]} ({myName} is {mySlot})</p>
            <div className="flex gap-2 pop-in" style={{ animationDelay: "240ms" }}>
              <button onClick={() => send({ type: "rematch" })} className="px-5 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-semibold hover:opacity-90 active:scale-95 transition-all">
                Rematch
              </button>
              <Link href="/play/rock-paper-scissors" className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
                Lobby
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
