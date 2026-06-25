import { z } from "zod";

export const RpsMoveSchema = z.enum(["rock", "paper", "scissors"]);
export const RpsSlotSchema = z.enum(["1", "2"]);

export const RpsPublicStateSchema = z.object({
  status: z.enum(["waiting", "choosing", "result", "matchOver"]),
  players: z.object({ "1": z.string().nullable(), "2": z.string().nullable() }),
  names: z.object({ "1": z.string().nullable(), "2": z.string().nullable() }),
  scores: z.object({ "1": z.number(), "2": z.number() }),
  chosen: z.object({ "1": z.boolean(), "2": z.boolean() }),
  bestOf: z.number(),
  roundResult: z.object({ winner: z.union([RpsSlotSchema, z.literal("draw")]), choices: z.object({ "1": RpsMoveSchema, "2": RpsMoveSchema }) }).nullable(),
  matchWinner: z.union([RpsSlotSchema, z.null()]),
});

export const RpsEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), data: RpsPublicStateSchema.extend({ slot: z.union([RpsSlotSchema, z.null()]) }) }),
  z.object({ type: z.literal("state"), data: RpsPublicStateSchema }),
  z.object({ type: z.literal("join"), data: z.object({ slot: RpsSlotSchema, name: z.string() }) }),
  z.object({ type: z.literal("leave"), data: z.object({ slot: RpsSlotSchema }) }),
  z.object({ type: z.literal("rematch"), data: z.object({ room: z.string(), key: z.string() }) }),
  z.object({ type: z.literal("rejected"), data: z.object({ reason: z.string() }) }),
]);

export const RpsReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choose"), data: z.object({ move: RpsMoveSchema }) }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("rematch") }),
]);

export const RpsMeta = z.object({
  userId: z.string(),
  playerId: z.string(),
  name: z.string(),
  room: z.string(),
  slot: z.union([RpsSlotSchema, z.null()]),
});

export type RpsPublicState = z.infer<typeof RpsPublicStateSchema>;
export type RpsMove = z.infer<typeof RpsMoveSchema>;
export type RpsSlot = z.infer<typeof RpsSlotSchema>;
