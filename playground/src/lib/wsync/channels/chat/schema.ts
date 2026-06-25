import { z } from "zod";

const ChatMessage = z.object({
  type: z.literal("message"),
  id: z.string(),
  username: z.string(),
  text: z.string(),
  at: z.string(),
});

export const ChatEmit = z.discriminatedUnion("type", [
  ChatMessage,
  z.object({
    type: z.literal("history"),
    messages: z.array(ChatMessage),
  }),
  z.object({ type: z.literal("joined"), id: z.string(), username: z.string() }),
  z.object({ type: z.literal("left"), id: z.string(), username: z.string() }),
  z.object({
    type: z.literal("presence"),
    users: z.array(z.object({ id: z.string(), username: z.string() })),
  }),
]);

export const ChatReceive = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    text: z.string().min(1).max(500),
  }),
]);

export const ChatMeta = z.object({
  id: z.string(),
  username: z.string(),
});
