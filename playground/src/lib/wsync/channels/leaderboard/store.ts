import { storage } from "next-wsync";

export type GameKind = "rps" | "tictactoe";
export type HistoryFilter = "all" | GameKind;

export type PlayerStat = { playerId: string; name: string; wins: number; losses: number; draws: number; played: number; streak: number; best: number; updatedAt: number };
export type GameRecord = { id: string; kind: GameKind; at: number; a: { playerId: string; name: string; detail?: string }; b: { playerId: string; name: string; detail?: string }; winnerId: string | null };
type PairRecord = { x: string; y: string; xWins: number; yWins: number; draws: number };
export type Totals = { all: number; rps: number; tictactoe: number };
export type Board = { players: PlayerStat[]; totals: Totals };
export type HistoryPage = { kind: HistoryFilter; items: GameRecord[]; nextCursor: string | null };

const HISTORY_CAP = 1000;
const PAGE_SIZE = 20;

function pairKey(kind: GameKind, a: string, b: string): [string, string, string] {
  const [x, y] = a < b ? [a, b] : [b, a];
  return [`${kind}:${x}::${y}`, x, y];
}
function blankPlayer(playerId: string, name: string): PlayerStat {
  return { playerId, name, wins: 0, losses: 0, draws: 0, played: 0, streak: 0, best: 0, updatedAt: Date.now() };
}

export const leaderboardStore = storage("leaderboard", {
  store: () => ({ players: new Map<string, PlayerStat>(), pairs: new Map<string, PairRecord>(), history: [] as GameRecord[] }),
  methods: (store) => {
    function touch(playerId: string, name: string): PlayerStat {
      let p = store.players.get(playerId);
      if (!p) { p = blankPlayer(playerId, name); store.players.set(playerId, p); }
      if (name) p.name = name;
      p.updatedAt = Date.now();
      return p;
    }
    function rankedPlayers(topN: number): PlayerStat[] {
      return [...store.players.values()].sort((m, n) => n.wins - m.wins || n.wins / Math.max(1, n.played) - m.wins / Math.max(1, m.played) || n.best - m.best || m.losses - n.losses).slice(0, topN);
    }
    function totals(): Totals {
      let rps = 0; let ttt = 0;
      for (const g of store.history) { if (g.kind === "rps") rps++; else if (g.kind === "tictactoe") ttt++; }
      return { all: rps + ttt, rps, tictactoe: ttt };
    }
    function buildBoard(topN = 20): Board { return { players: rankedPlayers(topN), totals: totals() }; }

    return {
      pair(kind: GameKind, idA: string, idB: string) {
        const [key, x] = pairKey(kind, idA, idB);
        const rec = store.pairs.get(key);
        if (!rec) return { wins: 0, losses: 0, draws: 0 };
        const aIsX = idA === x;
        return { wins: aIsX ? rec.xWins : rec.yWins, losses: aIsX ? rec.yWins : rec.xWins, draws: rec.draws };
      },
      record(args: { kind: GameKind; a: { playerId: string; name: string; detail?: string }; b: { playerId: string; name: string; detail?: string }; winnerId: string | null }): { record: GameRecord; board: Board } {
        const { kind, a, b, winnerId } = args;
        const pa = touch(a.playerId, a.name);
        const pb = touch(b.playerId, b.name);
        pa.played++; pb.played++;
        if (winnerId === null) { pa.draws++; pb.draws++; pa.streak = 0; pb.streak = 0; }
        else {
          const winner = winnerId === a.playerId ? pa : pb;
          const loser = winnerId === a.playerId ? pb : pa;
          winner.wins++; winner.streak++; winner.best = Math.max(winner.best, winner.streak);
          loser.losses++; loser.streak = 0;
        }
        const [key, x, y] = pairKey(kind, a.playerId, b.playerId);
        const rec = store.pairs.get(key) ?? { x, y, xWins: 0, yWins: 0, draws: 0 };
        if (winnerId === null) rec.draws++;
        else if (winnerId === x) rec.xWins++;
        else rec.yWins++;
        store.pairs.set(key, rec);
        const record: GameRecord = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, kind, at: Date.now(), a, b, winnerId };
        store.history.unshift(record);
        if (store.history.length > HISTORY_CAP) store.history.length = HISTORY_CAP;
        return { record, board: buildBoard() };
      },
      board(topN = 20): Board { return buildBoard(topN); },
      historyPage(kind: HistoryFilter = "all", cursor: string | null = null, limit = PAGE_SIZE): HistoryPage {
        const filtered = kind === "all" ? store.history : store.history.filter((g) => g.kind === kind);
        let start = 0;
        if (cursor) { const idx = filtered.findIndex((g) => g.id === cursor); start = idx === -1 ? filtered.length : idx + 1; }
        const items = filtered.slice(start, start + limit);
        const nextCursor = start + limit < filtered.length && items.length > 0 ? items[items.length - 1]!.id : null;
        return { kind, items, nextCursor };
      },
    };
  },
});
