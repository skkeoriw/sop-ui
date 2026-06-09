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
  displayName?: string;
  channelName?: string;
  channelUrl?: string;
  spiBaseUrl?: string;
  supportedSopTypes?: string[];
  instanceCount?: number;
  health?: Record<string, unknown>;
  updatedAt?: string;
}

export interface WorkflowBinding {
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  definitionSource: string;
  definitionPath: string;
  nodeCount: number;
  enabledNodeCount: number;
  bindingStatus: string;
}

export interface Instance {
  id: string;
  instanceId: string;
  sopType?: string;
  title: string;
  version?: string;
  repo: string;
  runtimeId?: string;
  description?: string;
  enabled?: boolean;
  repoBranch?: string;
  wikiLocalPath?: string;
  workspaceStatus?: string;
  runIndexStatus?: string;
  workflowBinding?: WorkflowBinding;
  capabilities?: Record<string, unknown>;
  executionCount?: number;
  latestExecution?: Run;
  artifactCount?: number;
  pageCount?: number;
  status?: string;
  channelUrl?: string;
  spiBaseUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeInheritanceItem {
  key: string;
  aliases?: string[];
  matchedKey?: string;
  source: "environment" | "management_config" | "env_file" | "request" | "missing" | string;
  present: boolean;
  maskedValue: string;
  secret: boolean;
  required: boolean;
  category: string;
}

export interface RuntimeInheritancePreview {
  instanceId: string;
  envFile: string;
  items: RuntimeInheritanceItem[];
  groups: Record<string, boolean>;
  note?: string;
  updatedAt?: string;
}

export interface RuntimeManagementConfigSaveInput {
  token: string;
  values: Record<string, string>;
}

export interface DagNode {
  id: string;
  title: string;
  mode: string;
  summary?: string;
  purpose?: string;
  branch?: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  optionalInputs: Record<string, string>;
  needs?: string[];
  executor?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  ui?: NodeUi;
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
  executionId?: string;
  pipelineId: string;
  runtimeId?: string;
  instanceId?: string;
  workflowId?: string;
  workflowVersion?: string;
  workflowSnapshot?: Record<string, unknown>;
  status: StageStatus;
  sourceUrl: string;
  sourceType?: string;
  input?: Record<string, unknown>;
  repo: string;
  nodes: Record<string, StageStatus>;
  startedAt: string;
  updatedAt: string;
  nodeCount?: number;
  doneCount?: number;
  failedCount?: number;
  runningNode?: string;
  failedNode?: string;
  progress?: number;
  artifactCount?: number;
  gitEventCount?: number;
  telegramEventCount?: number;
  eventCount?: number;
  pageCount?: number;
  durationS?: number;
  nodeStates?: Record<string, RunNodeState>;
}

export interface RunNodeState {
  status: StageStatus;
  startedAt?: string;
  finishedAt?: string;
  durationS?: number;
  attempt?: number;
  progress?: number;
  artifactCount?: number;
  error?: string;
}

export interface NodeDetail {
  pipelineId: string;
  nodeId: string;
  title?: string;
  purpose?: string;
  branch?: string;
  retryable?: boolean;
  manualFixHint?: string;
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
  discoveredCandidates?: Artifact[];
  capabilities?: Record<string, unknown>;
  plan?: Record<string, unknown> | null;
  validation: NodeValidation;
  infra?: { tgNotify?: boolean; logRecord?: boolean };
  definition?: NodeDefinitionModel;
  inputModel?: NodeInputModel;
  actions?: string[];
  outputModel?: NodeOutputModel;
  troubleshooting?: NodeTroubleshootingModel;
}

export interface NodeDefinitionModel {
  title?: string;
  titleZh?: string;
  purpose?: string;
  purposeZh?: string;
  branch?: string;
  executor?: Record<string, unknown>;
  retryable?: boolean;
}

export interface NodeInputModel {
  declared?: Record<string, unknown>;
  resolved?: Record<string, unknown>;
  business?: Array<Record<string, unknown>>;
  environment?: Array<Record<string, unknown>>;
  secrets?: Array<Record<string, unknown>>;
}

export interface NodeOutputModel {
  declared?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  artifactExplanations?: Record<string, string>;
  keyResults?: Array<Record<string, unknown>>;
}

export interface NodeTroubleshootingModel {
  failureHints?: string[];
  retryable?: boolean;
  safeToRetry?: boolean | string;
  error?: string;
  validation?: NodeValidation | Record<string, unknown>;
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
  sequence?: number;
  ts: string;
  event: string;
  stage?: string;
  nodeId?: string;
  runId?: string;
  trigger?: string;
  ok?: boolean;
  error?: string;
  duration_s?: number;
  reason?: string;
  data?: Record<string, unknown>;
}

export interface NodeUi {
  category?: "input" | "research" | "build" | "notify" | "custom" | string;
  icon?: string;
  stageLetter?: string;
  order?: number;
  colorRole?: string;
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
  purpose?: string;
  branch?: string;
  retryable?: boolean;
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
  manifest?: Record<string, unknown>;
}

export interface NodeRegistryItem extends NodeConfig {
  description?: string;
  case?: string;
  skill?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  cli?: Record<string, string>;
  modules?: NodeModule[];
  editable?: boolean;
  publishEnabled?: boolean;
  missingFields?: string[];
  ui?: NodeUi;
}

export interface NodeModule {
  id: string;
  title: string;
  lane?: string;
  order?: number;
  description?: string;
  status: string;
  summary?: string;
  schema?: string[];
  metrics?: Record<string, unknown>;
  contractVersion?: string;
  detailUrl?: string;
  runScoped?: boolean;
}

export interface NodeModuleDetail {
  sopId: string;
  nodeId: string;
  pipelineId?: string;
  module: NodeModule;
  detail: Record<string, unknown>;
}

export interface NodeDraftInput {
  skill_install_command: string;
  skill_id: string;
  node_id: string;
  title: string;
  description?: string;
  upstream?: string;
  upstream_output?: string;
  input_name?: string;
  output_name?: string;
  output_path?: string;
}

export interface NodeDraftSchemaField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  default?: string;
  placeholder?: string;
  mapsTo?: string;
}

export interface NodeDraftSchema {
  schemaId: string;
  title: string;
  description?: string;
  fields: NodeDraftSchemaField[];
  defaults: Record<string, unknown>;
  safety: Record<string, unknown>;
}

export interface NodeDraft {
  draftId: string;
  node: Record<string, unknown>;
  validation: Record<string, unknown>;
}

export interface TriggerInput {
  [key: string]: unknown;
  repo?: string;
  url?: string;
  action?: "create-runtime" | "delete-runtime" | string;
  management_action?: string;
  ssh_command?: string;
  private_key?: string;
  private_key_b64?: string;
  ssh_private_key_b64?: string;
  runtime_id?: string;
  target_host?: string;
  channel_url?: string;
  force?: boolean;
  dry_run?: boolean;
  input?: Record<string, unknown>;
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
  getRunDag(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Dag>;
  listRuns(runtime: Runtime, instanceId: string): Promise<Run[]>;
  getRun(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Run>;
  getRunEvents(runtime: Runtime, instanceId: string, pipelineId: string): Promise<NodeEvent[]>;
  getRunArtifacts(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Artifact[]>;
  getRunArtifactCandidates(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Artifact[]>;
  getNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeDetail>;
  getNodeLog(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeLog>;
  getNodeConfig(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeConfig>;
  listNodes(runtime: Runtime, instanceId: string): Promise<NodeRegistryItem[]>;
  listNodeModules(runtime: Runtime, instanceId: string, nodeId: string, pipelineId?: string): Promise<NodeModule[]>;
  getNodeModule(runtime: Runtime, instanceId: string, nodeId: string, moduleId: string, pipelineId?: string): Promise<NodeModuleDetail>;
  listNodeDrafts(runtime: Runtime, instanceId: string): Promise<NodeDraft[]>;
  getNodeDraftSchema(runtime: Runtime, instanceId: string): Promise<NodeDraftSchema>;
  createNodeDraft(runtime: Runtime, instanceId: string, input: NodeDraftInput): Promise<NodeDraft>;
  getRuntimeInheritance(runtime: Runtime, instanceId: string): Promise<RuntimeInheritancePreview>;
  getRuntimeManagementConfig(runtime: Runtime, instanceId: string): Promise<RuntimeInheritancePreview>;
  saveRuntimeManagementConfig(runtime: Runtime, instanceId: string, input: RuntimeManagementConfigSaveInput): Promise<RuntimeInheritancePreview>;
  initializeRuntimeManagementConfig(runtime: Runtime, instanceId: string, input: { token?: string; overwrite?: boolean }): Promise<RuntimeInheritancePreview>;
  triggerRun(runtime: Runtime, instanceId: string, input: TriggerInput): Promise<TriggerResult>;
  retryNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<void>;
  cancelRun(runtime: Runtime, instanceId: string, pipelineId: string, reason?: string): Promise<void>;
  cancelNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string, reason?: string): Promise<void>;
}
