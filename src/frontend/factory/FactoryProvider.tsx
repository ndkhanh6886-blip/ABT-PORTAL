"use client";

import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { factoryQueryClient } from "./api";

/** Server-state cache for the factory modules (data always comes from the server, never from localStorage). */
export function FactoryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={factoryQueryClient}>{children}</QueryClientProvider>;
}
