import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { ChatEmit, ChatMeta, ChatReceive } from "./schema";
import { historyStore } from "./stores";

export const chatChannel = channel("chat", {
  parameters: { emit: ChatEmit, receive: ChatReceive },
  meta: ChatMeta,
  stores: [historyStore],
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      ctx.meta.set((prev) => ({ ...prev, id: identity.id, username: identity.username }));

      const users = ctx.clients
        .find({})
        .map((c) => ({ id: c.meta.id as string, username: c.meta.username as string }));

      ctx.reply({ type: "presence", users });

      const messages = ctx.stores.history.getAll();
      if (messages.length > 0) ctx.reply({ type: "history", messages });

      ctx.broadcast.others({ type: "joined", id: identity.id, username: identity.username });
    },

    onMessage(ctx, data) {
      const msg = {
        type: "message" as const,
        id: ctx.meta.get("id", ""),
        username: ctx.meta.get("username", ""),
        text: data.text,
        at: new Date().toISOString(),
      };
      ctx.stores.history.push(msg);
      ctx.broadcast.all(msg);
    },

    onDisconnect(ctx) {
      ctx.broadcast.others({
        type: "left",
        id: ctx.meta.get("id", ""),
        username: ctx.meta.get("username", ""),
      });
    },
  },
});
