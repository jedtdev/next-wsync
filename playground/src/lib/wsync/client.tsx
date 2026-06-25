"use client";

import { create } from "next-wsync/client";
import type { AppRouter } from "./types";

export const { RealtimeProvider, useRealtime } =
  create<AppRouter>("/api/wsync");
