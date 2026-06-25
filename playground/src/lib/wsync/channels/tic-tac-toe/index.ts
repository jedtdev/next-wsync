import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { TttEmit, TttReceive, TttMeta } from "./schema";
import { tictactoeStore } from "./stores";
import { leaderboardStore } from "../leaderboard/store";
import { roomsStore } from "../rooms/store";

export const ticTacToeChannel = channel("tic-tac-toe", {
  parameters: { emit: TttEmit, receive: TttReceive },
  meta: TttMeta,
  stores: [tictactoeStore, leaderboardStore, roomsStore],
  pubsub: false,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      const room = ctx.params.get("room") ?? "default";
      const userId = ctx.client.id;
      const playerId = identity.id;
      const name = identity.username;
      const password = ctx.params.get("password") ?? "";

      ctx.meta.set((prev) => ({ ...prev, userId, playerId, name, room, symbol: null }));

      const gate = ctx.stores.rooms.canEnter(room, playerId, password);
      if (!gate.ok) {
        ctx.reply({ type: "rejected", data: { reason: gate.reason ?? "denied" } });
        return;
      }

      if (!ctx.stores.rooms.get(room)) ctx.stores.rooms.ensurePublic(room, "tictactoe", name);

      const symbol = ctx.stores.tictactoe.join(room, userId, playerId, name);
      if (!symbol) {
        ctx.reply({ type: "rejected", data: { reason: "full" } });
        return;
      }

      ctx.stores.rooms.join(room, playerId, name);
      ctx.meta.set((prev) => ({ ...prev, symbol }));

      const game = ctx.stores.tictactoe.get(room);
      ctx.reply({ type: "init", data: { ...game, symbol } });
      ctx.broadcast.to({ room } as never, { type: "join", data: { symbol, name } }, { except: { id: userId } as never });
      ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("tictactoe") });
    },

    onMessage(ctx, data) {
      if (!ctx.meta.get("symbol")) return;
      const room = ctx.meta.get("room", "");
      const userId = ctx.client.id;

      if (data.type === "move") {
        const valid = ctx.stores.tictactoe.move(room, userId, data.data.cell);
        if (!valid) return;
        const next = ctx.stores.tictactoe.get(room);
        ctx.broadcast.to({ room } as never, { type: "state", data: next });

        if (next.status === "won" || next.status === "draw") {
          const seats = ctx.stores.tictactoe.seats(room);
          if (seats.X && seats.O) {
            const winnerId = next.status === "draw" ? null : next.winner === "X" ? seats.X.playerId : seats.O.playerId;
            const { record, board } = ctx.stores.leaderboard.record({ kind: "tictactoe", a: { ...seats.X, detail: "X" }, b: { ...seats.O, detail: "O" }, winnerId });
            ctx.broadcast.channel("leaderboard").all({ type: "update", data: { players: board.players, totals: board.totals, record } });
            ctx.stores.rooms.end(room, { scores: { [seats.X.playerId]: next.winner === "X" ? 1 : 0, [seats.O.playerId]: next.winner === "O" ? 1 : 0 }, winnerId });
            ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("tictactoe") });
          }
        }
        return;
      }

      if (data.type === "rematch") {
        let newId = ctx.stores.tictactoe.rematchRoom(room);
        let key = "";
        if (!newId) {
          const reg = ctx.stores.rooms.get(room);
          const view = ctx.stores.rooms.create({ game: "tictactoe", name: reg ? `${reg.name} (rematch)` : "Rematch", isPrivate: reg?.isPrivate ?? false, password: reg?.password ?? "", hostId: ctx.meta.get("playerId", ""), hostName: ctx.meta.get("name", ""), bestOf: 1 });
          newId = view.id;
          key = reg?.password ?? "";
          ctx.stores.tictactoe.setRematch(room, newId);
          const seats = ctx.stores.tictactoe.seats(room);
          ctx.stores.tictactoe.setPending(newId, { X: seats.O?.playerId ?? null, O: seats.X?.playerId ?? null });
          ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("tictactoe") });
        } else { key = ctx.stores.rooms.get(newId)?.password ?? ""; }
        ctx.broadcast.to({ room } as never, { type: "rematch", data: { room: newId, key } });
      }
    },

    onDisconnect(ctx) {
      if (!ctx.meta.get("symbol")) return;
      const room = ctx.meta.get("room", "");
      const userId = ctx.meta.get("userId", "");
      const playerId = ctx.meta.get("playerId", "");
      const game = ctx.stores.tictactoe.get(room);
      const symbol = game.players.X === userId ? "X" : game.players.O === userId ? "O" : null;
      ctx.stores.tictactoe.leave(room, userId);
      ctx.stores.rooms.leave(room, playerId);
      if (symbol) ctx.broadcast.to({ room } as never, { type: "leave", data: { symbol } });
      ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("tictactoe") });
    },
  },
});
