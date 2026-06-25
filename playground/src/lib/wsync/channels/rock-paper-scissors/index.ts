import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { RpsEmit, RpsReceive, RpsMeta } from "./schema";
import { rpsStore } from "./stores";
import { leaderboardStore } from "../leaderboard/store";
import { roomsStore } from "../rooms/store";

export const rpsChannel = channel("rock-paper-scissors", {
  parameters: { emit: RpsEmit, receive: RpsReceive },
  meta: RpsMeta,
  stores: [rpsStore, leaderboardStore, roomsStore],
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

      ctx.meta.set((prev) => ({ ...prev, userId, playerId, name, room, slot: null }));

      const gate = ctx.stores.rooms.canEnter(room, playerId, password);
      if (!gate.ok) {
        ctx.reply({ type: "rejected", data: { reason: gate.reason ?? "denied" } });
        return;
      }

      const reg = ctx.stores.rooms.get(room) ?? ctx.stores.rooms.ensurePublic(room, "rps", name);
      ctx.stores.rps.ensure(room, reg.config.bestOf);

      const slot = ctx.stores.rps.join(room, userId, playerId, name);
      if (!slot) {
        ctx.reply({ type: "rejected", data: { reason: "full" } });
        return;
      }

      ctx.stores.rooms.join(room, playerId, name);
      ctx.meta.set((prev) => ({ ...prev, slot }));

      ctx.reply({ type: "init", data: { ...ctx.stores.rps.toPublic(room), slot } });
      ctx.broadcast.to({ room } as never, { type: "join", data: { slot, name } }, { except: { id: userId } as never });
      ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("rps") });
    },

    onMessage(ctx, data) {
      if (!ctx.meta.get("slot")) return;
      const room = ctx.meta.get("room", "");
      const userId = ctx.client.id;

      if (data.type === "choose") {
        const outcome = ctx.stores.rps.choose(room, userId, data.data.move);
        if (!outcome) return;
        if (outcome.kind === "match") {
          const { record, board } = ctx.stores.leaderboard.record({ kind: "rps", a: outcome.a, b: outcome.b, winnerId: outcome.winnerId });
          ctx.broadcast.channel("leaderboard").all({ type: "update", data: { players: board.players, totals: board.totals, record } });
          ctx.stores.rooms.end(room, { scores: outcome.scores, winnerId: outcome.winnerId });
          ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("rps") });
        }
        ctx.broadcast.to({ room } as never, { type: "state", data: ctx.stores.rps.toPublic(room) });
        return;
      }

      if (data.type === "next") {
        if (ctx.stores.rps.next(room))
          ctx.broadcast.to({ room } as never, { type: "state", data: ctx.stores.rps.toPublic(room) });
        return;
      }

      if (data.type === "rematch") {
        let newId = ctx.stores.rps.rematchRoom(room);
        let key = "";
        if (!newId) {
          const reg = ctx.stores.rooms.get(room);
          const view = ctx.stores.rooms.create({ game: "rps", name: reg ? `${reg.name} (rematch)` : "Rematch", isPrivate: reg?.isPrivate ?? false, password: reg?.password ?? "", hostId: ctx.meta.get("playerId", ""), hostName: ctx.meta.get("name", ""), bestOf: ctx.stores.rps.bestOf(room) });
          newId = view.id;
          key = reg?.password ?? "";
          ctx.stores.rps.setRematch(room, newId);
          ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("rps") });
        } else { key = ctx.stores.rooms.get(newId)?.password ?? ""; }
        ctx.broadcast.to({ room } as never, { type: "rematch", data: { room: newId, key } });
      }
    },

    onDisconnect(ctx) {
      if (!ctx.meta.get("slot")) return;
      const room = ctx.meta.get("room", "");
      const userId = ctx.meta.get("userId", "");
      const playerId = ctx.meta.get("playerId", "");
      const slot = ctx.stores.rps.leave(room, userId);
      ctx.stores.rooms.leave(room, playerId);
      if (slot) ctx.broadcast.to({ room } as never, { type: "leave", data: { slot } });
      ctx.broadcast.channel("rooms").all({ type: "list", data: ctx.stores.rooms.list("rps") });
    },
  },
});
