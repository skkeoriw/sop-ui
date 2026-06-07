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
  runDag: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "run", pipelineId, "dag"] as const,
  runEvents: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "run", pipelineId, "events"] as const,
  runArtifacts: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "run", pipelineId, "artifacts"] as const,
  runArtifactCandidates: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "run", pipelineId, "artifactCandidates"] as const,
  node: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string, nodeId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, pipelineId, "node", nodeId] as const,
  log: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, pipelineId: string, nodeId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, pipelineId, "log", nodeId] as const,
  nodeConfig: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, nodeId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodeConfig", nodeId] as const,
  nodes: (mode: DataMode, runtime: Runtime | undefined, instanceId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodes"] as const,
  nodeModules: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, nodeId: string, pipelineId = "") =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodeModules", nodeId, pipelineId] as const,
  nodeModule: (mode: DataMode, runtime: Runtime | undefined, instanceId: string, nodeId: string, moduleId: string, pipelineId = "") =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodeModule", nodeId, moduleId, pipelineId] as const,
  nodeDrafts: (mode: DataMode, runtime: Runtime | undefined, instanceId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodeDrafts"] as const,
  nodeDraftSchema: (mode: DataMode, runtime: Runtime | undefined, instanceId: string) =>
    ["sop", mode, ...runtimeKey(runtime), instanceId, "nodeDraftSchema"] as const,
};
