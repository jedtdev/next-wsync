import { z } from "zod";

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const StrokeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  color: z.string(),
  width: z.number(),
  points: z.array(PointSchema),
});

export const DrawingEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync"), data: z.object({ strokes: z.array(StrokeSchema) }) }),
  z.object({ type: z.literal("begin"), data: z.object({ id: z.string(), userId: z.string(), color: z.string(), width: z.number(), x: z.number(), y: z.number() }) }),
  z.object({ type: z.literal("draw"), data: z.object({ id: z.string(), x: z.number(), y: z.number() }) }),
  z.object({ type: z.literal("end"), data: z.object({ id: z.string() }) }),
  z.object({ type: z.literal("undo"), data: z.object({ strokeId: z.string() }) }),
  z.object({ type: z.literal("redo"), data: StrokeSchema }),
  z.object({ type: z.literal("clear"), data: z.object({ userId: z.string() }) }),
]);

export const DrawingReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), data: z.object({ id: z.string(), color: z.string(), width: z.number(), x: z.number(), y: z.number() }) }),
  z.object({ type: z.literal("draw"), data: z.object({ id: z.string(), x: z.number(), y: z.number() }) }),
  z.object({ type: z.literal("end"), data: z.object({ id: z.string() }) }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
  z.object({ type: z.literal("clear") }),
]);

export const DrawingMeta = z.object({ userId: z.string(), name: z.string(), color: z.string() });

export type DrawingStroke = z.infer<typeof StrokeSchema>;
export type DrawingPoint = z.infer<typeof PointSchema>;
