import { storage } from "next-wsync";
import type { TttGameState, TttSymbol } from "./schema";

type Seat = { playerId: string; name: string } | null;
type RoomSeats = { X: Seat; O: Seat };

const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]] as const;

function checkWinner(board: TttGameState["board"]): TttSymbol | null {
  for (const [a, b, c] of WIN_LINES)
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a] as TttSymbol;
  return null;
}

function emptyGame(): TttGameState {
  return { board: Array(9).fill(null), turn: "X", status: "waiting", winner: null, players: { X: null, O: null }, names: { X: null, O: null } };
}

export const tictactoeStore = storage("tictactoe", {
  store: {
    rooms: new Map<string, TttGameState>(),
    seats: new Map<string, RoomSeats>(),
    rematch: new Map<string, string>(),
    pending: new Map<string, { X: string | null; O: string | null }>(),
  },
  methods: (store) => {
    function get(room: string): TttGameState {
      if (!store.rooms.has(room)) store.rooms.set(room, emptyGame());
      return store.rooms.get(room)!;
    }
    function getSeats(room: string): RoomSeats {
      if (!store.seats.has(room)) store.seats.set(room, { X: null, O: null });
      return store.seats.get(room)!;
    }
    return {
      get,
      seats: getSeats,
      join(room: string, userId: string, playerId: string, name: string): TttSymbol | null {
        const g = get(room);
        const seats = getSeats(room);
        const pending = store.pending.get(room);
        let sym: TttSymbol | null = null;
        if (pending?.X === playerId && !g.players.X) sym = "X";
        else if (pending?.O === playerId && !g.players.O) sym = "O";
        else if (!g.players.X) sym = "X";
        else if (!g.players.O) sym = "O";
        if (!sym) return null;
        g.players[sym] = userId;
        g.names[sym] = name;
        seats[sym] = { playerId, name };
        if (g.players.X && g.players.O) g.status = "playing";
        return sym;
      },
      setPending(room: string, seats: { X: string | null; O: string | null }) { store.pending.set(room, seats); },
      leave(room: string, userId: string) {
        const g = store.rooms.get(room);
        if (!g) return;
        const seats = getSeats(room);
        if (g.players.X === userId) { g.players.X = null; g.names.X = null; seats.X = null; }
        if (g.players.O === userId) { g.players.O = null; g.names.O = null; seats.O = null; }
        if (!g.players.X && !g.players.O) { store.rooms.delete(room); store.seats.delete(room); store.rematch.delete(room); store.pending.delete(room); }
      },
      move(room: string, userId: string, cell: number): boolean {
        const g = store.rooms.get(room);
        if (!g || g.status !== "playing" || g.board[cell] !== null) return false;
        const symbol = g.players.X === userId ? "X" : g.players.O === userId ? "O" : null;
        if (!symbol || g.turn !== symbol) return false;
        g.board[cell] = symbol;
        const winner = checkWinner(g.board);
        if (winner) { g.status = "won"; g.winner = winner; }
        else if (g.board.every((c) => c !== null)) { g.status = "draw"; }
        else { g.turn = symbol === "X" ? "O" : "X"; }
        return true;
      },
      setRematch(room: string, newRoomId: string) { store.rematch.set(room, newRoomId); },
      rematchRoom(room: string): string | null { return store.rematch.get(room) ?? null; },
    };
  },
});
