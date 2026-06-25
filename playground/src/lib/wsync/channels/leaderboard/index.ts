import { channel } from "next-wsync";
import { Jwt } from "@/lib/jwt";
import { LeaderboardEmit, LeaderboardReceive, LeaderboardMeta } from "./schema";
import { leaderboardStore } from "./store";

export const leaderboardChannel = channel("leaderboard", {
  parameters: { emit: LeaderboardEmit, receive: LeaderboardReceive },
  meta: LeaderboardMeta,
  stores: [leaderboardStore],
  pubsub: true,
  events: {
    async onConnect(ctx) {
      const identity = await Jwt.parse(ctx.request);
      if (!identity) return ctx.disconnect(1008, "Unauthorized");

      ctx.meta.set((prev) => ({ ...prev, playerId: identity.id }));
      const { players, totals } = ctx.stores.leaderboard.board();
      ctx.reply({ type: "update", data: { players, totals, record: null } });
      ctx.reply({ type: "history", data: ctx.stores.leaderboard.historyPage("all", null) });
    },

    onMessage(ctx, data) {
      if (data.type === "loadHistory") {
        ctx.reply({ type: "history", data: ctx.stores.leaderboard.historyPage(data.data.kind, data.data.cursor) });
      }
    },
  },
});
