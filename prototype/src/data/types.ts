export type DataMode = "real" | "mock";
export type StageStatus = "done" | "running" | "waiting" | "failed" | "skipped" | "cancelled";

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
  executor: Record<string, unknown>;
  declaredInputs: Record<string, unknown>;
  resolvedInputs: Record<string, unknown>;
  declaredOutputs: Record<string, unknown>;
  actualOutputs: Record<string, unknown>;
  artifacts: Artifact[];
  validation: NodeValidation;
  infra?: { tgNotify?: boolean; logRecord?: boolean };
}

export interface Artifact {
  id: string;
  producer: string;
  output: string;
  type: string;
  format: string;
  path: string;
  title: string;
  size: number;
  mimeType: string;
  tags: string[];
  resolution: string;
  ownership?: string;
  preview?: string;
  previewTruncated?: boolean;
}

export interface NodeValidation {
  status: string;
  missingOutputs: string[];
  unexpectedOutputs: string[];
}

export interface NodeEvent {
  ts: string;
  event: string;
  stage?: string;
  trigger?: string;
  ok?: boolean;
  error?: string;
  duration_s?: number;
  reason?: string;
}

export interface NodeLog {
  pipelineId: string;
  nodeId: string;
  log: string;
  events?: NodeEvent[];
}

export interface NodeConfig {
  nodeId: string;
  title?: string;
  mode?: string;
  needs?: string[];
  executor?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  optionalInputs?: Record<string, unknown>;
  infra?: { tgNotify?: boolean; logRecord?: boolean };
  params?: Record<string, unknown>;
  skillScript?: string | null;
  skillReadme?: string | null;
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
  getNodeConfig(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeConfig>;
  triggerRun(runtime: Runtime, instanceId: string, input: TriggerInput): Promise<TriggerResult>;
  retryNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<void>;
  cancelRun(runtime: Runtime, instanceId: string, pipelineId: string, reason?: string): Promise<void>;
  cancelNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string, reason?: string): Promise<void>;
}
