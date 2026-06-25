import type { Infer } from "next-wsync";
import { api } from ".";

export type AppRouter = Infer<typeof api>;
