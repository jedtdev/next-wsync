import { storage } from "next-wsync";
import { clampBestOf } from "../rooms/store";
import type { RpsMove, RpsSlot } from "./schema";

type Seat = { userId: string; playerId: string; name: string } | null;

type RpsGame = {
  status: "waiting" | "choosing" | "result" | "matchOver";
  bestOf: number;
  seats: { "1": Seat; "2": Seat };
  choices: { "1": RpsMove | null; "2": RpsMove | null };
  scores: { "1": number; "2": number };
  roundResult: { winner: RpsSlot | "draw"; choices: { "1": RpsMove; "2": RpsMove } } | null;
  matchWinner: RpsSlot | null;
  rematchRoom: string | null;
};

export type MatchOver = { kind: "match"; a: { playerId: string; name: string; detail: string }; b: { playerId: string; name: string; detail: string }; winnerId: string | null; scores: Record<string, number> };
export type ChooseOutcome = { kind: "wait" } | { kind: "round" } | MatchOver | null;

function beats(a: RpsMove, b: RpsMove): boolean {
  return (a === "rock" && b === "scissors") || (a === "scissors" && b === "paper") || (a === "paper" && b === "rock");
}

function emptyGame(bestOf: number): RpsGame {
  return { status: "waiting", bestOf, seats: { "1": null, "2": null }, choices: { "1": null, "2": null }, scores: { "1": 0, "2": 0 }, roundResult: null, matchWinner: null, rematchRoom: null };
}

export const rpsStore = storage("rps", {
  store: { rooms: new Map<string, RpsGame>() },
  methods: (store) => {
    function ensure(room: string, bestOf = 3): RpsGame {
      let g = store.rooms.get(room);
      if (!g) { g = emptyGame(clampBestOf(bestOf)); store.rooms.set(room, g); }
      return g;
    }
    return {
      ensure,
      toPublic(room: string) {
        const g = ensure(room);
        return {
          status: g.status,
          players: { "1": g.seats["1"]?.userId ?? null, "2": g.seats["2"]?.userId ?? null },
          names: { "1": g.seats["1"]?.name ?? null, "2": g.seats["2"]?.name ?? null },
          scores: g.scores,
          chosen: { "1": g.choices["1"] !== null, "2": g.choices["2"] !== null },
          bestOf: g.bestOf,
          roundResult: g.roundResult,
          matchWinner: g.matchWinner,
        };
      },
      join(room: string, userId: string, playerId: string, name: string): RpsSlot | null {
        const g = ensure(room);
        const seat: Seat = { userId, playerId, name };
        if (!g.seats["1"]) { g.seats["1"] = seat; return "1"; }
        if (!g.seats["2"]) { g.seats["2"] = seat; if (g.status === "waiting") g.status = "choosing"; return "2"; }
        return null;
      },
      leave(room: string, userId: string): RpsSlot | null {
        const g = store.rooms.get(room);
        if (!g) return null;
        let slot: RpsSlot | null = null;
        if (g.seats["1"]?.userId === userId) { slot = "1"; g.seats["1"] = null; }
        else if (g.seats["2"]?.userId === userId) { slot = "2"; g.seats["2"] = null; }
        if (!g.seats["1"] && !g.seats["2"]) store.rooms.delete(room);
        return slot;
      },
      choose(room: string, userId: string, move: RpsMove): ChooseOutcome {
        const g = store.rooms.get(room);
        if (!g || g.status !== "choosing") return null;
        const slot: RpsSlot | null = g.seats["1"]?.userId === userId ? "1" : g.seats["2"]?.userId === userId ? "2" : null;
        if (!slot || g.choices[slot] !== null) return null;
        g.choices[slot] = move;
        if (g.choices["1"] === null || g.choices["2"] === null) return { kind: "wait" };
        const m1 = g.choices["1"]!; const m2 = g.choices["2"]!;
        const winner: RpsSlot | "draw" = m1 === m2 ? "draw" : beats(m1, m2) ? "1" : "2";
        g.roundResult = { winner, choices: { "1": m1, "2": m2 } };
        if (winner !== "draw") g.scores[winner]++;
        const need = Math.ceil(g.bestOf / 2);
        if (winner !== "draw" && g.scores[winner] >= need) {
          g.status = "matchOver"; g.matchWinner = winner;
          const s1 = g.seats["1"]!; const s2 = g.seats["2"]!;
          return { kind: "match", a: { playerId: s1.playerId, name: s1.name, detail: `${g.scores["1"]}` }, b: { playerId: s2.playerId, name: s2.name, detail: `${g.scores["2"]}` }, winnerId: winner === "1" ? s1.playerId : s2.playerId, scores: { [s1.playerId]: g.scores["1"], [s2.playerId]: g.scores["2"] } };
        }
        g.status = "result";
        return { kind: "round" };
      },
      next(room: string): boolean {
        const g = store.rooms.get(room);
        if (!g || g.status !== "result") return false;
        g.choices = { "1": null, "2": null }; g.roundResult = null; g.status = "choosing";
        return true;
      },
      setRematch(room: string, newRoomId: string) { const g = store.rooms.get(room); if (g) g.rematchRoom = newRoomId; },
      rematchRoom(room: string): string | null { return store.rooms.get(room)?.rematchRoom ?? null; },
      bestOf(room: string): number { return store.rooms.get(room)?.bestOf ?? 3; },
    };
  },
});
