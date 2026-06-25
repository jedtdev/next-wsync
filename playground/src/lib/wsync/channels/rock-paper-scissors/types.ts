import { z } from "zod";
import type { RpsEmit, RpsReceive, RpsMeta } from "./schema";

export type TRpsEmit = z.infer<typeof RpsEmit>;
export type TRpsReceive = z.infer<typeof RpsReceive>;
export type TRpsMeta = z.infer<typeof RpsMeta>;
