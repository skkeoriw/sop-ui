import type { DataMode, Runtime } from "./types";

function runtimeKey(runtime?: Runtime) {
  return runtime ? [runtime.id, runtime.endpoint] : ["none"];
}

export const queryKeys = {
  runtimes: (mode: DataMode) => ["sop", mode, "runtimes"] as const,
  instances: (mode: DataMode, runtime?: Runtime) => ["sop", mode, ...runtimeKey(runtime), "instances"] as const,
  dag: (mode: DataMode, runtime: Runtime | undefined, instanceId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "dag"] as const,
  runs: (mode: DataMode, runtime: Runtime | undefined, instanceId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "runs"] as const,
  run: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "run", pipelineId] as const,
  node: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string, nodeId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, pipelineId, "node", nodeId] as const,
  log: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string, nodeId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, pipelineId, "log", nodeId] as const
};
