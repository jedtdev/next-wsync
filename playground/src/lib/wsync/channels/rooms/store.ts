import { storage } from "next-wsync";
import { createMatchmaker, type Matchmaker } from "../utils";

export type GameId = "rps" | "tictactoe";
export type RoomStatus = "waiting" | "active" | "ended";
export type RoomConfig = { bestOf: number };
export type RoomResult = { scores: Record<string, number>; winnerId: string | null };

export type Room = {
  id: string;
  game: GameId;
  name: string;
  isPrivate: boolean;
  password: string;
  hostId: string;
  hostName: string;
  config: RoomConfig;
  status: RoomStatus;
  createdAt: number;
  endedAt: number | null;
  members: string[];
  memberNames: Record<string, string>;
  result: RoomResult | null;
};

export type RoomView = Omit<Room, "password"> & { hasPassword: boolean };

const CAPACITY = 2;
const ENDED_TTL = 60_000;

function shortId(): string { return Math.random().toString(36).slice(2, 8); }
function toView(r: Room): RoomView {
  const { password, ...rest } = r;
  return { ...rest, hasPassword: password.length > 0 };
}

export function clampBestOf(n: number): number {
  const allowed = [1, 3, 5, 7, 9];
  return allowed.includes(n) ? n : 3;
}

export const roomsStore = storage("rooms", {
  store: () => ({
    rooms: new Map<string, Room>(),
    playerRoom: new Map<string, string>(),
  }),
  methods: (store) => {
    const matchmakers = new Map<GameId, Matchmaker>();

    function pruneEnded() {
      const now = Date.now();
      for (const [id, r] of store.rooms) {
        if (r.status === "ended" && r.members.length === 0 && r.endedAt && now - r.endedAt > ENDED_TTL)
          store.rooms.delete(id);
      }
    }

    function matchmaker(game: GameId): Matchmaker {
      let m = matchmakers.get(game);
      if (!m) {
        m = createMatchmaker({
          roomIds: () => [...store.rooms.values()].filter((r) => r.game === game && !r.isPrivate && r.status === "waiting").map((r) => r.id),
          filled: (id) => store.rooms.get(id)?.members.length ?? 0,
          newRoomId: () => {
            const id = shortId();
            store.rooms.set(id, { id, game, name: "Quick match", isPrivate: false, password: "", hostId: "", hostName: "", config: { bestOf: 3 }, status: "waiting", createdAt: Date.now(), endedAt: null, members: [], memberNames: {}, result: null });
            return id;
          },
        });
        matchmakers.set(game, m);
      }
      return m;
    }

    return {
      get(id: string): Room | undefined { return store.rooms.get(id); },
      view(id: string): RoomView | undefined { const r = store.rooms.get(id); return r ? toView(r) : undefined; },
      list(game: GameId): RoomView[] {
        pruneEnded();
        const order: Record<RoomStatus, number> = { waiting: 0, active: 1, ended: 2 };
        return [...store.rooms.values()]
          .filter((r) => r.game === game)
          .sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
          .map(toView);
      },
      roomOf(game: GameId, playerId: string): string | undefined { return store.playerRoom.get(`${game}:${playerId}`); },
      create(args: { game: GameId; name: string; isPrivate: boolean; password: string; hostId: string; hostName: string; bestOf: number }): RoomView {
        const id = shortId();
        const room: Room = { id, game: args.game, name: args.name.trim() || `${args.hostName}'s room`, isPrivate: args.isPrivate, password: args.isPrivate ? args.password : "", hostId: args.hostId, hostName: args.hostName, config: { bestOf: clampBestOf(args.bestOf) }, status: "waiting", createdAt: Date.now(), endedAt: null, members: [], memberNames: {}, result: null };
        store.rooms.set(id, room);
        return toView(room);
      },
      ensurePublic(id: string, game: GameId, hostName: string): Room {
        let r = store.rooms.get(id);
        if (!r) {
          r = { id, game, name: `${hostName}'s room`, isPrivate: false, password: "", hostId: "", hostName, config: { bestOf: 3 }, status: "waiting", createdAt: Date.now(), endedAt: null, members: [], memberNames: {}, result: null };
          store.rooms.set(id, r);
        }
        return r;
      },
      canEnter(id: string, playerId: string, password: string): { ok: boolean; reason?: "ended" | "full" | "password" | "busy" } {
        const r = store.rooms.get(id);
        if (!r) return { ok: true };
        const already = r.members.includes(playerId);
        if (r.status === "ended" && !already) return { ok: false, reason: "ended" };
        if (r.isPrivate && r.password !== password && !already) return { ok: false, reason: "password" };
        if (r.members.length >= CAPACITY && !already) return { ok: false, reason: "full" };
        const occupied = store.playerRoom.get(`${r.game}:${playerId}`);
        if (occupied && occupied !== id) {
          const occ = store.rooms.get(occupied);
          if (occ && occ.status !== "ended") return { ok: false, reason: "busy" };
        }
        return { ok: true };
      },
      join(id: string, playerId: string, name: string): Room | undefined {
        const r = store.rooms.get(id);
        if (!r) return undefined;
        if (!r.members.includes(playerId)) {
          r.members.push(playerId);
          r.memberNames[playerId] = name;
          store.playerRoom.set(`${r.game}:${playerId}`, id);
          matchmaker(r.game).release(id);
        }
        if (r.members.length >= CAPACITY && r.status === "waiting") r.status = "active";
        return r;
      },
      leave(id: string, playerId: string): void {
        const r = store.rooms.get(id);
        if (!r) return;
        r.members = r.members.filter((m) => m !== playerId);
        delete r.memberNames[playerId];
        const key = `${r.game}:${playerId}`;
        if (store.playerRoom.get(key) === id) store.playerRoom.delete(key);
        if (r.members.length === 0 && r.status !== "ended") {
          store.rooms.delete(id);
        } else if (r.status === "active" && r.members.length < CAPACITY) {
          r.status = "ended";
          r.endedAt = Date.now();
          if (!r.result) r.result = { scores: {}, winnerId: r.members[0] ?? null };
        }
      },
      end(id: string, result: RoomResult): RoomView | undefined {
        const r = store.rooms.get(id);
        if (!r) return undefined;
        r.status = "ended";
        r.endedAt = Date.now();
        r.result = result;
        return toView(r);
      },
      quickMatch(game: GameId): string { return matchmaker(game).matchmake(); },
    };
  },
});
