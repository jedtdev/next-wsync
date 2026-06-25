import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { DrawingEmit, DrawingReceive, DrawingMeta } from "./schema";
import { drawingStore } from "./stores";

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

function pickColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

export const drawingChannel = channel("drawing", {
  parameters: { emit: DrawingEmit, receive: DrawingReceive },
  meta: DrawingMeta,
  stores: [drawingStore],
  pubsub: true,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      const userId = ctx.client.id;
      const color = pickColor(identity.id);
      ctx.meta.set((prev) => ({ ...prev, userId, name: identity.username, color }));
      ctx.reply({ type: "sync", data: { strokes: ctx.stores.drawing.all() } });
    },

    onMessage(ctx, data) {
      const userId = ctx.client.id;

      if (data.type === "begin") {
        const { id, color, width, x, y } = data.data;
        ctx.stores.drawing.begin(id, userId, color, width, x, y);
        ctx.broadcast.others({ type: "begin", data: { id, userId, color, width, x, y } });
        return;
      }
      if (data.type === "draw") {
        const { id, x, y } = data.data;
        ctx.stores.drawing.addPoint(id, { x, y });
        ctx.broadcast.others({ type: "draw", data: { id, x, y } });
        return;
      }
      if (data.type === "end") {
        ctx.stores.drawing.end(data.data.id);
        ctx.broadcast.others({ type: "end", data: { id: data.data.id } });
        return;
      }
      if (data.type === "undo") {
        const strokeId = ctx.stores.drawing.undo(userId);
        if (strokeId) ctx.broadcast.all({ type: "undo", data: { strokeId } });
        return;
      }
      if (data.type === "redo") {
        const stroke = ctx.stores.drawing.redo(userId);
        if (stroke) ctx.broadcast.all({ type: "redo", data: stroke });
        return;
      }
      if (data.type === "clear") {
        ctx.stores.drawing.clear();
        ctx.broadcast.all({ type: "clear", data: { userId } });
      }
    },
  },
});
