import { z } from "zod";

const SymbolSchema = z.enum(["X", "O"]);

export const TttGameStateSchema = z.object({
  board: z.array(z.union([z.null(), z.literal("X"), z.literal("O")])).length(9),
  turn: SymbolSchema,
  status: z.enum(["waiting", "playing", "won", "draw"]),
  winner: z.union([SymbolSchema, z.null()]),
  players: z.object({ X: z.string().nullable(), O: z.string().nullable() }),
  names: z.object({ X: z.string().nullable(), O: z.string().nullable() }),
});

export const TttEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), data: TttGameStateSchema.extend({ symbol: z.union([SymbolSchema, z.null()]) }) }),
  z.object({ type: z.literal("state"), data: TttGameStateSchema }),
  z.object({ type: z.literal("join"), data: z.object({ symbol: SymbolSchema, name: z.string() }) }),
  z.object({ type: z.literal("leave"), data: z.object({ symbol: SymbolSchema }) }),
  z.object({ type: z.literal("rematch"), data: z.object({ room: z.string(), key: z.string() }) }),
  z.object({ type: z.literal("rejected"), data: z.object({ reason: z.string() }) }),
]);

export const TttReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), data: z.object({ cell: z.number().min(0).max(8) }) }),
  z.object({ type: z.literal("rematch") }),
]);

export const TttMeta = z.object({
  userId: z.string(),
  playerId: z.string(),
  name: z.string(),
  room: z.string(),
  symbol: z.union([SymbolSchema, z.null()]),
});

export type TttGameState = z.infer<typeof TttGameStateSchema>;
export type TttSymbol = z.infer<typeof SymbolSchema>;
