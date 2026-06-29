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
  clientIp?: string;
  localPort?: string;
  channelName?: string;
  channelUrl?: string;
  spiBaseUrl?: string;
  supportedSopTypes?: string[];
  metadata?: Record<string, string>;
  instanceCount?: number;
  health?: Record<string, unknown>;
  updatedAt?: string;
}

export interface RuntimeList {
  runtimes: Runtime[];
  total: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  source?: string;
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

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  title: string;
  description: string;
  version?: string;
  sopType?: string;
  interpreter: "generic-dag" | "runtime-management" | string;
  workflowType: "business" | "management" | string;
  definitionSource: string;
  definitionPath: string;
  nodeCount?: number;
  enabledNodeCount?: number;
  actions?: Array<{ id: string; title: string; scope: string; description?: string }>;
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

export interface InstanceList {
  instances: Instance[];
  total: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  source?: string;
}

export interface ListQueryOptions {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: string;
  role?: string;
  authType?: string;
  sort?: string;
  order?: "asc" | "desc";
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
  values: Record<string, string>;
}

export interface CapabilityConfigScopeValue {
  present?: boolean;
  matchedKey?: string;
  maskedValue?: string;
  secret?: boolean;
}

export interface CapabilityConfigItem {
  key: string;
  aliases?: string[];
  label?: string;
  capability?: string;
  category?: string;
  workflowTags?: string[];
  nodeTags?: string[];
  capabilityTags?: string[];
  operationTags?: string[];
  tags?: string[];
  description?: string;
  required?: boolean;
  secret?: boolean;
  editableScopes?: string[];
  matchedKey?: string;
  source?: string;
  sourceKind?: string;
  present?: boolean;
  maskedValue?: string;
  valuesByScope?: Record<string, CapabilityConfigScopeValue>;
}

export interface CapabilityConfigPreview {
  runtimeId?: string;
  instanceId?: string;
  nodeId?: string;
  backend?: string;
  updatedAt?: string;
  envFile?: string;
  precedence?: string[];
  workflowId?: string;
  registryTotal?: number;
  registryFilters?: Record<string, string>;
  items: CapabilityConfigItem[];
  groups?: Record<string, boolean>;
  scopes?: Record<string, string>;
  note?: string;
}

export interface CapabilityConfigSaveInput {
  scope: "instance" | "runtime" | "global";
  values: Record<string, string>;
  nodeId?: string;
}

export interface MachineConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  sshCommand: string;
  authType: "private_key" | "password" | string;
  privateKeyPresent: boolean;
  privateKey?: string;
  passwordPresent: boolean;
  password?: string;
  labels: string[];
  role: string;
  status: string;
  lastCheckAt?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface MachineList {
  machines: MachineConfig[];
  total: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
}

export interface MachineSecretConfig extends MachineConfig {
  privateKey: string;
  password: string;
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
  id?: string;
  source: string;
  target: string;
  from?: string;
  to?: string;
  relay?: Record<string, unknown>;
  intent?: Record<string, unknown>;
  bindings?: unknown[];
  validation?: Record<string, unknown>;
  derivedFrom?: string;
}

export interface Dag {
  instanceId: string;
  nodes: DagNode[];
  edges: DagEdge[];
  workflowRevision?: Record<string, unknown>;
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

export interface RunList {
  runs: Run[];
  total: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  source?: string;
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
  source?: string;
  retryable?: boolean;
  manualFixHint?: string;
  reportReason?: string;
  reportManualFixHint?: string;
  reportDetail?: Record<string, unknown>;
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
  metadata?: Record<string, unknown>;
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
  source?: string;
  retryable?: boolean;
  mode?: string;
  needs?: string[];
  executor?: Record<string, unknown>;
  entryInputs?: Record<string, unknown>;
  handoff?: Record<string, unknown>;
  workflowInputs?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  optionalInputs?: Record<string, unknown>;
  infra?: { tgNotify?: boolean; logRecord?: boolean };
  params?: Record<string, unknown>;
  skillScript?: string | null;
  skillReadme?: string | null;
  manifest?: Record<string, unknown>;
  sourceDigest?: Record<string, unknown>;
  coverageReport?: Record<string, unknown>;
}

export type NodeDepClass = "independent" | "state_dependent" | "artifact_dependent";
export type NodeSideEffect = "read_only" | "mutating";

export interface NodeArtifactDep {
  file: string;
  produced_by?: string;
}

export interface NodeStatePrecondition {
  node: string;
  why?: string;
}

/** Engine-sourced classification axes (P1) used to render dependency badges and
 *  decide how a single-node test can be launched from either entry. */
export interface NodeClassification {
  depClass?: NodeDepClass;
  sideEffect?: NodeSideEffect;
  testableStandalone?: boolean;
  requestInputs?: string[];
  artifactDeps?: NodeArtifactDep[];
  statePreconditions?: NodeStatePrecondition[];
}

export interface NodeContract extends NodeClassification {
  nodeId: string;
  title?: string;
  purpose?: string;
  branch?: string;
}

export interface NodeRegistryItem extends NodeConfig {
  description?: string;
  case?: string;
  version?: string;
  skill?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  cli?: Record<string, string>;
  modules?: NodeModule[];
  editable?: boolean;
  publishEnabled?: boolean;
  missingFields?: string[];
  ui?: NodeUi;
  classification?: NodeClassification;
}

/** Input for a single-node isolated test (asset center or Run panel). */
export interface NodeTestInput {
  requestOverrides?: Record<string, unknown>;
  seedFromRunId?: string;
  fromRunId?: string;
  confirmMutating?: boolean;
  dryRun?: boolean;
}

export type NodeTestInputSource = "existing-run" | "existing-node-run" | "generated-fixture" | "manual" | "deepseek-mock";

export interface NodeTestPlanInputState {
  name: string;
  source?: string;
  required?: boolean;
  resolved?: boolean;
  value?: unknown;
  provenance?: string;
  reason?: string;
  resolutionState?: string;
  sourceNodeRunId?: string;
  sourceOutput?: string;
  sourceNode?: string;
  targetInput?: string;
}

export interface NodeTestPlan {
  sopId?: string;
  workflowId?: string;
  instanceId?: string;
  nodeId: string;
  nodeTitle?: string;
  mode?: string;
  inputSource?: NodeTestInputSource;
  baseRunId?: string;
  requiredInputs?: NodeTestPlanInputState[];
  optionalInputs?: NodeTestPlanInputState[];
  resolvedInputs?: NodeTestPlanInputState[];
  pendingMaterializationInputs?: NodeTestPlanInputState[];
  missingInputs?: NodeTestPlanInputState[];
  upstreamNodes?: Array<Record<string, unknown>>;
  availableExistingRuns?: Array<Record<string, unknown>>;
  sideEffects?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  status?: string;
}

export interface NodePreflightInput {
  inputSource?: NodeTestInputSource;
  pipelineId?: string;
  manualInputs?: Record<string, unknown>;
}

export interface NodeTestResult {
  status: string;
  mode?: string;
  nodeId?: string;
  pipelineId?: string;
  namespace?: string;
  depClass?: NodeDepClass;
  sideEffect?: NodeSideEffect;
  reportPath?: string;
  reason?: string;
}

export interface NodeTestStep {
  id: string;
  title: string;
  status: string;
  summary?: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
  detail?: Record<string, unknown>;
}

export interface NodeTestEvent {
  sequence?: number;
  event: string;
  testId?: string;
  nodeId?: string;
  stepId?: string;
  ts?: string;
  data?: Record<string, unknown>;
}

/** Polled outcome of an isolated single-node test run (nodetest namespace). */
export interface NodeTestRunResult {
  pipelineId?: string;
  testId?: string;
  nodeId?: string;
  status?: string;
  mode?: string;
  pending?: boolean;
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
  detail?: Record<string, unknown>;
  steps?: NodeTestStep[];
  events?: NodeTestEvent[];
  artifacts?: Artifact[];
}

export type NodeRunMode = "preflight" | "probe" | "dry-run" | "real-node";
export type NodeRunInputSource = NodeTestInputSource | "artifact";
export type NodeRunRelayMode = "auto_by_target_inputs" | "selected_outputs" | "all_outputs";

export interface NodeRunRelayMapping {
  sourceOutput: string;
  targetInput?: string;
  resolver?: string;
}

export interface NodeRunCreateInput {
  nodeRunId?: string;
  mode?: NodeRunMode;
  inputSource?: NodeRunInputSource;
  pipelineId?: string;
  sourceNodeRunId?: string;
  relayMode?: NodeRunRelayMode | string;
  selectedOutputs?: string[];
  relayMappings?: NodeRunRelayMapping[];
  relayInstruction?: string;
  manualInputs?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  capabilityOverrides?: Record<string, unknown>;
  retryOf?: string;
}

export interface NodeRunEvent {
  sequence?: number;
  event: string;
  nodeRunId?: string;
  nodeId?: string;
  stepId?: string;
  ts?: string;
  data?: Record<string, unknown>;
}

export interface NodeRunEnvironmentItem {
  id?: string;
  capability?: string;
  key: string;
  label?: string;
  source?: string;
  sourceKind?: string;
  present?: boolean;
  required?: boolean;
  secret?: boolean;
  value?: string;
  status?: string;
  unit?: string;
  category?: string;
}

export interface NodeRunCapabilityResult {
  key: string;
  capability?: string;
  label?: string;
  status?: string;
  enabled?: boolean;
  required?: boolean;
  source?: string;
  reason?: string;
  managedBy?: string;
  detail?: Record<string, unknown>;
}

export interface NodeRunIssue {
  id?: string;
  target?: string;
  severity?: string;
  title?: string;
  message?: string;
  action?: string;
  source?: string;
  relatedCapability?: string;
  relatedConfigKeys?: string[];
}

export interface NodeRunCoreOutput {
  name: string;
  kind?: string;
  type?: string;
  value?: unknown;
  files?: string[];
  artifacts?: Artifact[];
  declared?: Record<string, unknown>;
}

export interface NodeRunRelayItem {
  output: string;
  path: string;
  relativePath?: string;
  valueType?: string;
  source?: string;
  sourceNode?: string;
  sourceRunId?: string;
  sourcePath?: string;
  targetInput?: string;
  valuePreview?: string;
  artifact?: Artifact;
}

export interface NodeRunRelayPackage {
  kind?: string;
  outputDirectory?: string;
  manifestPath?: string;
  itemCount?: number;
  items?: NodeRunRelayItem[];
}

export interface NodeRunExecutionEvidence {
  count?: number;
  artifacts?: Artifact[];
}

export interface NodeRunResult {
  nodeRunId: string;
  pipelineId?: string;
  runtimeId?: string;
  instanceId?: string;
  workflowId?: string;
  nodeId: string;
  nodeTitle?: string;
  status?: string;
  mode?: NodeRunMode | string;
  inputSource?: NodeRunInputSource | string;
  relayMode?: NodeRunRelayMode | string;
  selectedOutputs?: string[];
  relayMappings?: NodeRunRelayMapping[];
  sourceNodeRunId?: string;
  relaySelection?: Record<string, unknown>;
  edgeContract?: Record<string, unknown>;
  nodeExecutionGuide?: Record<string, unknown>;
  workflowRevision?: Record<string, unknown>;
  relayContext?: Record<string, unknown>;
  relayContextBrief?: string;
  resolutionTrace?: Array<Record<string, unknown>>;
  inputResolution?: Record<string, unknown>;
  pending?: boolean;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
  reason?: string;
  createdFrom?: string;
  retryOf?: string;
  detail?: Record<string, unknown>;
  steps?: NodeTestStep[];
  innerSteps?: NodeTestStep[];
  events?: NodeRunEvent[];
  artifacts?: Artifact[];
  inputArtifacts?: Artifact[];
  businessArtifacts?: Artifact[];
  coreOutputs?: NodeRunCoreOutput[];
  relayPackage?: NodeRunRelayPackage;
  executionEvidence?: NodeRunExecutionEvidence;
  actualOutputs?: Record<string, unknown>;
  outputCategories?: Record<string, unknown>;
  validation?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  agentRequest?: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
  instanceContext?: Record<string, unknown>;
  definitionDefaults?: Record<string, unknown>;
  capabilityOverrides?: Record<string, unknown>;
  definitionScopeReports?: Record<string, unknown>;
  environmentSnapshot?: NodeRunEnvironmentItem[];
  capabilityResults?: NodeRunCapabilityResult[];
  issues?: NodeRunIssue[];
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
  draft_type?: "create_node" | "edit_node_definition" | string;
  skill_install_command?: string;
  user_instruction?: string;
  skill_id?: string;
  node_id?: string;
  title?: string;
  description?: string;
  mode?: string;
  needs?: string[] | string;
  executor?: Record<string, unknown>;
  skill?: string;
  entry?: string;
  agent?: string;
  webhook_route?: string;
  entry_input_name?: string;
  input_type?: string;
  input_value_type?: string;
  upstream?: string;
  upstream_output?: string;
  input_name?: string;
  output_name?: string;
  output_path?: string;
  inputs?: Record<string, unknown>;
  optional_inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  node_draft?: Record<string, unknown>;
  node_builder_evaluation?: Record<string, unknown>;
  request?: Record<string, unknown>;
  trace?: Record<string, unknown>;
}

export interface NodeBuilderInput {
  skill_install_command: string;
  user_instruction?: string;
  fetch_metadata?: boolean;
  allow_deterministic?: boolean;
}

export interface NodeBuilderResult {
  ok: boolean;
  mode?: string;
  request: Record<string, unknown>;
  config: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  trace: Record<string, unknown>;
  stderr?: string;
}

export interface NodeDraftLifecycleResult {
  status: string;
  draft_id?: string;
  node_id?: string;
  detail?: string;
  message?: string;
  steps?: Array<Record<string, unknown>>;
  runtime_catalog_path?: string;
  visible_in_nodes_api?: boolean;
  files?: string[];
  patch?: string;
  instructions?: string[];
  [key: string]: unknown;
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
  draftType?: string;
  draftPath?: string;
  node: Record<string, unknown>;
  request?: Record<string, unknown>;
  nodeBuilderEvaluation?: Record<string, unknown>;
  changeRequest?: Record<string, unknown>;
  validation: Record<string, unknown>;
  draftTest?: Record<string, unknown>;
  runtimePublish?: Record<string, unknown>;
  persistencePlan?: Record<string, unknown>;
  trace?: Record<string, unknown>;
}

export interface WorkflowEdgeRequest {
  [key: string]: unknown;
}

export interface WorkflowEdgeResult {
  [key: string]: unknown;
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

export interface WorkflowSettingsResolve {
  ok: boolean;
  backend?: string;
  source?: string;
  values?: Record<string, string>;
  payload: Record<string, string>;
  presentKeys?: string[];
  payloadKeys?: string[];
}

export interface GitHubRepoOption {
  fullName: string;
  name: string;
  owner: string;
  private?: boolean;
  defaultBranch?: string;
}

export interface TriggerResult {
  status: string;
  pipelineId?: string;
  message?: string;
}

export type WorkflowDraftRequest = Record<string, unknown>;
export type WorkflowDraftResult = Record<string, unknown>;

export interface SopDataProvider {
  mode: DataMode;
  listRuntimeHosts?(options?: ListQueryOptions): Promise<RuntimeList>;
  listRuntimes(options?: ListQueryOptions): Promise<Runtime[]>;
  listWorkflowDefinitions?(runtime?: Runtime): Promise<WorkflowDefinition[]>;
  listRuntimeInstances?(runtime: Runtime, options?: ListQueryOptions): Promise<InstanceList>;
  listInstances(runtime: Runtime, options?: ListQueryOptions): Promise<Instance[]>;
  getDag(runtime: Runtime, instanceId: string): Promise<Dag>;
  getRunDag(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Dag>;
  listWorkflowRuns?(runtime: Runtime, instanceId: string, options?: ListQueryOptions): Promise<RunList>;
  listRuns(runtime: Runtime, instanceId: string, options?: ListQueryOptions): Promise<Run[]>;
  getRun(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Run>;
  getRunEvents(runtime: Runtime, instanceId: string, pipelineId: string): Promise<NodeEvent[]>;
  getRunArtifacts(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Artifact[]>;
  getRunArtifactCandidates(runtime: Runtime, instanceId: string, pipelineId: string): Promise<Artifact[]>;
  getNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeDetail>;
  getNodeLog(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<NodeLog>;
  getNodeConfig(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeConfig>;
  getNodeContract(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeContract | null>;
  getNodeTestPlan(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeTestPlan | null>;
  runNodePreflight(runtime: Runtime, instanceId: string, nodeId: string, input: NodePreflightInput): Promise<NodeTestRunResult>;
  triggerNodeTest(runtime: Runtime, instanceId: string, nodeId: string, input: NodeTestInput): Promise<NodeTestResult>;
  listNodeTests(runtime: Runtime, instanceId: string, nodeId: string): Promise<NodeTestRunResult[]>;
  getNodeTestResult(runtime: Runtime, instanceId: string, nodeId: string, pipelineId: string): Promise<NodeTestRunResult>;
  listNodeRuns(runtime: Runtime, instanceId: string, workflowId: string, nodeId: string): Promise<NodeRunResult[]>;
  createNodeRun(runtime: Runtime, instanceId: string, workflowId: string, nodeId: string, input: NodeRunCreateInput): Promise<NodeRunResult>;
  getNodeRun(runtime: Runtime, instanceId: string, workflowId: string, nodeId: string, nodeRunId: string): Promise<NodeRunResult>;
  getNodeRunEvents(runtime: Runtime, instanceId: string, workflowId: string, nodeId: string, nodeRunId: string): Promise<NodeRunEvent[]>;
  listNodes(runtime: Runtime, instanceId: string): Promise<NodeRegistryItem[]>;
  listNodeModules(runtime: Runtime, instanceId: string, nodeId: string, pipelineId?: string): Promise<NodeModule[]>;
  getNodeModule(runtime: Runtime, instanceId: string, nodeId: string, moduleId: string, pipelineId?: string): Promise<NodeModuleDetail>;
  listNodeDrafts(runtime: Runtime, instanceId: string): Promise<NodeDraft[]>;
  getNodeDraft?(runtime: Runtime, instanceId: string, draftId: string): Promise<NodeDraft>;
  getNodeDraftSchema(runtime: Runtime, instanceId: string): Promise<NodeDraftSchema>;
  evaluateNodeBuilder?(runtime: Runtime, instanceId: string, input: NodeBuilderInput): Promise<NodeBuilderResult>;
  createNodeDraft(runtime: Runtime, instanceId: string, input: NodeDraftInput): Promise<NodeDraft>;
  testNodeDraft?(runtime: Runtime, instanceId: string, draftId: string): Promise<NodeDraftLifecycleResult>;
  publishNodeDraft?(runtime: Runtime, instanceId: string, draftId: string): Promise<NodeDraftLifecycleResult>;
  generateNodeDraftPersistencePlan?(runtime: Runtime, instanceId: string, draftId: string): Promise<NodeDraftLifecycleResult>;
  evaluateWorkflowEdge?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowEdgeRequest): Promise<WorkflowEdgeResult>;
  getWorkflowEdgeEvaluation?(runtime: Runtime, instanceId: string, workflowId: string, evaluationId: string): Promise<WorkflowEdgeResult>;
  simulateWorkflowEdge?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowEdgeRequest): Promise<WorkflowEdgeResult>;
  createWorkflowEdgeDraft?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowEdgeRequest): Promise<WorkflowEdgeResult>;
  generateWorkflowEdgeRuntimeSop?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowEdgeRequest): Promise<WorkflowEdgeResult>;
  applyWorkflowEdgeDraft?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowEdgeRequest): Promise<WorkflowEdgeResult>;
  saveWorkflowDraft?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowDraftRequest): Promise<WorkflowDraftResult>;
  generateWorkflowDraftRuntimeSop?(runtime: Runtime, instanceId: string, workflowId: string, input: WorkflowDraftRequest): Promise<WorkflowDraftResult>;
  runWorkflowDraft?(runtime: Runtime, instanceId: string, workflowId: string, draftId: string, input: WorkflowDraftRequest): Promise<WorkflowDraftResult>;
  publishWorkflowDraft?(runtime: Runtime, instanceId: string, workflowId: string, draftId: string, input: WorkflowDraftRequest): Promise<WorkflowDraftResult>;
  getRuntimeInheritance(runtime: Runtime, instanceId: string): Promise<RuntimeInheritancePreview>;
  getRuntimeManagementConfig(runtime: Runtime, instanceId: string): Promise<RuntimeInheritancePreview>;
  saveRuntimeManagementConfig(runtime: Runtime, instanceId: string, input: RuntimeManagementConfigSaveInput): Promise<RuntimeInheritancePreview>;
  initializeRuntimeManagementConfig(runtime: Runtime, instanceId: string, input: { overwrite?: boolean }): Promise<RuntimeInheritancePreview>;
  getSettingRegistry?(runtime?: Runtime): Promise<CapabilityConfigPreview>;
  getCapabilityConfig(runtime: Runtime, instanceId: string, nodeId?: string): Promise<CapabilityConfigPreview>;
  saveCapabilityConfig(runtime: Runtime, instanceId: string, input: CapabilityConfigSaveInput): Promise<CapabilityConfigPreview>;
  triggerRun(runtime: Runtime, instanceId: string, input: TriggerInput): Promise<TriggerResult>;
  retryNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string): Promise<void>;
  cancelRun(runtime: Runtime, instanceId: string, pipelineId: string, reason?: string): Promise<void>;
  cancelNode(runtime: Runtime, instanceId: string, pipelineId: string, nodeId: string, reason?: string): Promise<void>;
}
