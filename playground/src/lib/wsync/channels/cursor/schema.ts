import { z } from "zod";

const pos = { x: z.number(), y: z.number() };

const box = { x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() };

export const CursorReceive = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), ...pos }),
  z.object({ type: z.literal("click"), ...pos }),
  z.object({ type: z.literal("grab"), ...pos }),
  z.object({ type: z.literal("release"), ...pos }),
  z.object({ type: z.literal("select"), ...box }),
  z.object({ type: z.literal("select-end") }),
]);

const CursorUser = z.object({ id: z.string(), username: z.string(), ...pos, grabbing: z.boolean() });

export const CursorEmit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), id: z.string(), username: z.string(), ...pos }),
  z.object({ type: z.literal("click"), id: z.string(), username: z.string(), ...pos }),
  z.object({ type: z.literal("grab"), id: z.string(), username: z.string(), ...pos }),
  z.object({ type: z.literal("release"), id: z.string(), username: z.string(), ...pos }),
  z.object({ type: z.literal("select"), id: z.string(), username: z.string(), ...box }),
  z.object({ type: z.literal("select-end"), id: z.string() }),
  z.object({ type: z.literal("leave"), id: z.string() }),
  z.object({ type: z.literal("presence"), cursors: z.array(CursorUser) }),
]);

export const CursorMeta = z.object({
  id: z.string(),
  username: z.string(),
  x: z.number(),
  y: z.number(),
  grabbing: z.boolean(),
});
