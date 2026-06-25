import { z } from "zod";

export const GameIdSchema = z.enum(["rps", "tictactoe"]);
export const RoomStatusSchema = z.enum(["waiting", "active", "ended"]);
export const RoomConfigSchema = z.object({ bestOf: z.number() });
export const RoomResultSchema = z.object({
  scores: z.record(z.string(), z.number()),
  winnerId: z.string().nullable(),
});
export const RoomViewSchema = z.object({
  id: z.string(),
  game: GameIdSchema,
  name: z.string(),
  isPrivate: z.boolean(),
  hasPassword: z.boolean(),
  hostId: z.string(),
  hostName: z.string(),
  config: RoomConfigSchema,
  status: RoomStatusSchema,
  createdAt: z.number(),
  endedAt: z.number().nullable(),
  members: z.array(z.string()),
  memberNames: z.record(z.string(), z.string()),
  result: RoomResultSchema.nullable(),
});

export const RoomsEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), data: z.array(RoomViewSchema) }),
  z.object({ type: z.literal("created"), data: RoomViewSchema }),
  z.object({ type: z.literal("error"), data: z.object({ reason: z.string(), message: z.string() }) }),
]);

export const RoomsReceive = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    data: z.object({ name: z.string(), isPrivate: z.boolean(), password: z.string(), bestOf: z.number() }),
  }),
  z.object({ type: z.literal("quick") }),
  z.object({ type: z.literal("refresh") }),
]);

export const RoomsMeta = z.object({ playerId: z.string(), name: z.string(), game: GameIdSchema });

export type GameId = z.infer<typeof GameIdSchema>;
export type RoomStatus = z.infer<typeof RoomStatusSchema>;
export type RoomView = z.infer<typeof RoomViewSchema>;
export type RoomResult = z.infer<typeof RoomResultSchema>;
