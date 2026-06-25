import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { CursorEmit, CursorMeta, CursorReceive } from "./schema";

export const cursorChannel = channel("cursor", {
  parameters: { emit: CursorEmit, receive: CursorReceive },
  meta: CursorMeta,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      ctx.meta.set((prev) => ({
        ...prev,
        id: identity.id,
        username: identity.username,
        x: 0,
        y: 0,
        grabbing: false,
      }));

      const cursors = ctx.clients
        .find({})
        .filter((c) => c.meta.id && c.meta.id !== identity.id)
        .map((c) => ({
          id: c.meta.id as string,
          username: c.meta.username as string,
          x: (c.meta.x as number) ?? 0,
          y: (c.meta.y as number) ?? 0,
          grabbing: (c.meta.grabbing as boolean) ?? false,
        }));

      ctx.reply({ type: "presence", cursors });
      ctx.broadcast.others({ type: "move", id: identity.id, username: identity.username, x: 0, y: 0 });
    },

    onMessage(ctx, data) {
      const id = ctx.meta.get("id", "");
      const username = ctx.meta.get("username", "");

      if (data.type === "move") {
        ctx.meta.set((prev) => ({ ...prev, x: data.x, y: data.y }));
        ctx.broadcast.others({ type: "move", id, username, x: data.x, y: data.y });
      } else if (data.type === "grab") {
        ctx.meta.set((prev) => ({ ...prev, x: data.x, y: data.y, grabbing: true }));
        ctx.broadcast.others({ type: "grab", id, username, x: data.x, y: data.y });
      } else if (data.type === "release") {
        ctx.meta.set((prev) => ({ ...prev, x: data.x, y: data.y, grabbing: false }));
        ctx.broadcast.others({ type: "release", id, username, x: data.x, y: data.y });
      } else if (data.type === "click") {
        ctx.broadcast.others({ type: "click", id, username, x: data.x, y: data.y });
      } else if (data.type === "select") {
        ctx.broadcast.others({ type: "select", id, username, x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2 });
      } else if (data.type === "select-end") {
        ctx.broadcast.others({ type: "select-end", id });
      }
    },

    onDisconnect(ctx) {
      ctx.broadcast.others({ type: "leave", id: ctx.meta.get("id", "") });
    },
  },
});
