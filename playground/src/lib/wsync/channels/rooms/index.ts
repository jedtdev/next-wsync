import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { RoomsEmit, RoomsReceive, RoomsMeta } from "./schema";
import { roomsStore } from "./store";
import type { GameId } from "./store";

export const roomsChannel = channel("rooms", {
  parameters: { emit: RoomsEmit, receive: RoomsReceive },
  meta: RoomsMeta,
  stores: [roomsStore],
  pubsub: true,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      const game = (ctx.params.get("game") ?? "rps") as GameId;
      ctx.meta.set((prev) => ({ ...prev, playerId: identity.id, name: identity.username, game }));

      ctx.reply({ type: "list", data: ctx.stores.rooms.list(game) });
    },

    onMessage(ctx, data) {
      const game = ctx.meta.get("game", "rps" as GameId);
      const playerId = ctx.meta.get("playerId", "");
      const name = ctx.meta.get("name", "");

      if (data.type === "refresh") {
        ctx.reply({ type: "list", data: ctx.stores.rooms.list(game) });
        return;
      }
      if (data.type === "create") {
        const view = ctx.stores.rooms.create({
          game,
          name: data.data.name,
          isPrivate: data.data.isPrivate,
          password: data.data.password,
          hostId: playerId,
          hostName: name,
          bestOf: data.data.bestOf,
        });
        ctx.reply({ type: "created", data: view });
        ctx.broadcast.all({ type: "list", data: ctx.stores.rooms.list(game) });
        return;
      }
      if (data.type === "quick") {
        const id = ctx.stores.rooms.quickMatch(game);
        const view = ctx.stores.rooms.view(id);
        if (view) {
          ctx.reply({ type: "created", data: view });
          ctx.broadcast.all({ type: "list", data: ctx.stores.rooms.list(game) });
        }
      }
    },
  },
});
