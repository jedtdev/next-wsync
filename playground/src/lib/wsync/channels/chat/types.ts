import { z } from "zod";
import type { ChatEmit, ChatReceive, ChatMeta } from "./schema";

export type TChatEmit = z.infer<typeof ChatEmit>;
export type TChatReceive = z.infer<typeof ChatReceive>;
export type TChatMeta = z.infer<typeof ChatMeta>;
