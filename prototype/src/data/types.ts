export type DataMode = "real" | "mock";
export type StageStatus = "done" | "running" | "waiting" | "failed" | "skipped";

export interface Runtime {
  id: string;
  name: string;
  endpoint: string;
  machine?: string;
  status: string;
  localStatus: string;
  manual?: boolean;
}

export interface Instance {
  id: string;
  instanceId: string;
  sopType?: string;
  title: string;
  version?: string;
  repo: string;
}

export interface DagNode {
  id: string;
  title: string;
  mode: string;
  summary?: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  optionalInputs: Record<string, string>;
}

export interface DagEdge {
  source: string;
  target: string;
}

export interface Dag {
  instanceId: string;
  nodes: DagNode[];
  edges: DagEdge[];
}

export interface Run {
  pipelineId: string;
  status: StageStatus;
  sourceUrl: string;
  sourceType?: string;
  repo: string;
  nodes: Record<string, StageStatus>;
  startedAt: string;
  updatedAt: string;
}

export interface NodeDetail {
  pipelineId: string;
  nodeId: string;
  runId?: string;
  status: StageStatus;
  mode?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
  error?: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  optionalInputs: Record<string, string>;
}

export interface NodeLog {
  pipelineId: string;
  nodeId: string;
  log: string;
}

export interface TriggerInput {
  repo: string;
  url: string;
}

export interface TriggerResult {
  status: string;
  pipelineId?: string;
  message?: string;
}

export interface SopDataProvider {
  mode: DataMode;
  listRuntimes(): Promise<Runtime[]>;
  listInstances(runtime: Runtime): Promise<Instance[]>;
  getDag(runtime: Runtime, instanceId: string): Promise<Dag>;
  listRuns(runtime: Runtime, instanceId: string): Promise<Run[]>;
  getRun(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Run>;
  getNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeDetail>;
  getNodeLog(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeLog>;
  triggerRun(runtime: Runtime, instanceId: string, input: TriggerInput): Promise<TriggerResult>;
  retryNode?(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<void>;
}
