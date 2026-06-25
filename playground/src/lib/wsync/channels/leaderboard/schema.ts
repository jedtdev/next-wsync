import { z } from "zod";

export const LbKindSchema = z.enum(["rps", "tictactoe"]);
export const LbFilterSchema = z.enum(["all", "rps", "tictactoe"]);

export const PlayerStatSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  played: z.number(),
  streak: z.number(),
  best: z.number(),
  updatedAt: z.number(),
});

export const GameRecordSchema = z.object({
  id: z.string(),
  kind: LbKindSchema,
  at: z.number(),
  a: z.object({ playerId: z.string(), name: z.string(), detail: z.string().optional() }),
  b: z.object({ playerId: z.string(), name: z.string(), detail: z.string().optional() }),
  winnerId: z.string().nullable(),
});

export const TotalsSchema = z.object({ all: z.number(), rps: z.number(), tictactoe: z.number() });

export const LeaderboardEmit = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update"),
    data: z.object({ players: z.array(PlayerStatSchema), totals: TotalsSchema, record: GameRecordSchema.nullable() }),
  }),
  z.object({
    type: z.literal("history"),
    data: z.object({ kind: LbFilterSchema, items: z.array(GameRecordSchema), nextCursor: z.string().nullable() }),
  }),
]);

export const LeaderboardReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("loadHistory"), data: z.object({ kind: LbFilterSchema, cursor: z.string().nullable() }) }),
]);

export const LeaderboardMeta = z.object({ playerId: z.string() });

export type LbKind = z.infer<typeof LbKindSchema>;
export type LbFilter = z.infer<typeof LbFilterSchema>;
export type PlayerStat = z.infer<typeof PlayerStatSchema>;
export type GameRecord = z.infer<typeof GameRecordSchema>;
export type Totals = z.infer<typeof TotalsSchema>;
