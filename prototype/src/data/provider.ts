import { mockProvider } from "./mock-provider";
import { sopProvider } from "./sop-provider";
import type { DataMode, SopDataProvider } from "./types";

export function getMode(): DataMode {
  const mode = new URL(window.location.href).searchParams.get("mode");
  return mode === "mock" ? "mock" : "real";
}

export function setMode(mode: DataMode) {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", mode);
  window.history.replaceState({}, "", url);
}

export function getProvider(mode: DataMode): SopDataProvider {
  return mode === "mock" ? mockProvider : sopProvider;
}

export function normalizeEndpoint(value: string) {
  return value.trim().replace(/\/+$/, "");
}
