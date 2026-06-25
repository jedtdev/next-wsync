import { z } from "zod";

const PresenceUser = z.object({ id: z.string(), username: z.string(), joinedAt: z.string() });

export const PresenceEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence"), users: z.array(PresenceUser) }),
  z.object({ type: z.literal("joined"), ...PresenceUser.shape }),
  z.object({ type: z.literal("left"), id: z.string() }),
]);

export const PresenceReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
]);

export const PresenceMeta = z.object({
  id: z.string(),
  username: z.string(),
  joinedAt: z.string(),
});
