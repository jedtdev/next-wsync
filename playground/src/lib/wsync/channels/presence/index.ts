import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { PresenceEmit, PresenceMeta, PresenceReceive } from "./schema";

export const presenceChannel = channel("presence", {
  parameters: { emit: PresenceEmit, receive: PresenceReceive },
  meta: PresenceMeta,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      ctx.meta.set((prev) => ({
        ...prev,
        id: identity.id,
        username: identity.username,
        joinedAt: identity.joinedAt,
      }));

      const seen = new Set<string>();
      const users = ctx.clients
        .find({})
        .filter((c) => {
          const id = c.meta.id as string | undefined;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((c) => ({
          id: c.meta.id as string,
          username: c.meta.username as string,
          joinedAt: c.meta.joinedAt as string,
        }));

      ctx.reply({ type: "presence", users });

      const alreadyConnected =
        ctx.clients.find({}).filter((c) => c.meta.id === identity.id).length > 1;

      if (!alreadyConnected) {
        ctx.broadcast.others({ type: "joined", id: identity.id, username: identity.username, joinedAt: identity.joinedAt });
      }
    },

    onDisconnect(ctx) {
      const id = ctx.meta.get("id", "");
      const remaining = ctx.clients.find({}).filter((c) => c.meta.id === id).length;

      if (remaining === 0) {
        ctx.broadcast.others({ type: "left", id });
      }
    },
  },
});
