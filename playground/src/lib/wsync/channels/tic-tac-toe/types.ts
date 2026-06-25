import { z } from "zod";
import type { TttEmit, TttReceive, TttMeta } from "./schema";

export type TTicTacToeEmit = z.infer<typeof TttEmit>;
export type TTicTacToeReceive = z.infer<typeof TttReceive>;
export type TTicTacToeMeta = z.infer<typeof TttMeta>;
