import { z } from "zod";
import type { DrawingEmit, DrawingReceive, DrawingMeta } from "./schema";

export type TDrawingEmit = z.infer<typeof DrawingEmit>;
export type TDrawingReceive = z.infer<typeof DrawingReceive>;
export type TDrawingMeta = z.infer<typeof DrawingMeta>;
