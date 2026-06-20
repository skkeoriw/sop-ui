import { normalizeEndpoint } from "./provider";
import { controlPlaneApiUrl } from "./control-plane-provider";
import type {
  CapabilityConfigPreview,
  CapabilityConfigSaveInput,
  Dag,
  Instance,
  InstanceList,
  NodeConfig,
  NodeDetail,
  NodeDraft,
  NodeDraftInput,
  NodeDraftSchema,
  NodeLog,
  NodeEvent,
  NodeModule,
  NodeModuleDetail,
  NodeRegistryItem,
  NodeClassification,
  NodeContract,
  NodeRunCreateInput,
  NodeRunEvent,
  NodeRunResult,
  NodePreflightInput,
  NodeTestInput,
  NodeTestPlan,
  NodeTestResult,
  NodeTestRunResult,
  Run,
  ListQueryOptions,
  RuntimeManagementConfigSaveInput,
  RuntimeInheritancePreview,
  Runtime,
  RuntimeList,
  RunList,
  SopDataProvider,
  StageStatus,
  TriggerInput,
  TriggerResult,
  WorkflowDefinition
} from "./types";

const TUNNEL_API = "https://tunnel-api.chxyka.ccwu.cc";

const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    workflowId: "runtime-management",
    name: "runtime-management",
    title: "Runtime Management",
    description: "管理 Runtime 与 Instance 生命周期。由 RuntimeManagementInterpreter 解释 action 分支和强副作用节点。",
    version: "0.2",
    sopType: "runtime-management",
    interpreter: "runtime-management",
    workflowType: "management",
    definitionSource: "agent-brain-plugins",
    definitionPath: "youtube-wiki/templates/runtime-management-sop/sop.yaml",
    actions: [
      { id: "create-runtime", title: "Create Runtime", scope: "runtime", description: "创建机器级 Runtime、Hermes、Runtime channel 和默认 runtime-management instance。" },
      { id: "create-instance", title: "Create Instance", scope: "instance", description: "在当前 Runtime 内创建 execution workspace，不安装 Hermes，不注册 Runtime channel。" },
      { id: "delete-instance", title: "Delete Instance", scope: "instance", description: "删除业务 workspace，不删除 Runtime。" },
      { id: "delete-runtime", title: "Delete Runtime", scope: "runtime", description: "下线 Runtime 机器服务和关联 channel。" },
    ],
  },
  {
    workflowId: "youtube-research-wiki",
    name: "youtube-research-wiki",
    title: "YouTube Research Wiki",
    description: "普通业务 SOP：抓取 YouTube、研究、构建 Wiki、发送通知。执行时选择 Runtime 和 Instance。",
    version: "2.0",
    sopType: "youtube-research-wiki",
    interpreter: "generic-dag",
    workflowType: "business",
    definitionSource: "agent-brain-plugins",
    definitionPath: "youtube-wiki/templates/wiki-repo/sop.yaml",
  },
];

function status(value?: string): StageStatus {
  const v = value ?? "";
  return (["done", "running", "failed", "skipped", "cancelled"].includes(v) ? v : "waiting") as StageStatus;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`接口没有返回 JSON：${url}`);
  }
}

function toQuery(options?: ListQueryOptions): string {
  const params = new URLSearchParams();
  if (!options) return "";
  if (options.page) params.set("page", String(options.page));
  if (options.pageSize) params.set("page_size", String(options.pageSize));
  if (options.q) params.set("q", options.q);
  if (options.status && options.status !== "all") params.set("status", options.status);
  if (options.sort) params.set("sort", options.sort);
  if (options.order) params.set("order", options.order);
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  }
}

async function postJsonResult<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const validation = data.validation as Record<string, unknown> | undefined;
      const errors = (validation?.errors as Array<Record<string, unknown>> | undefined) || [];
      if (errors.length) {
        throw new Error(`${response.status}: ${errors.map((error) => `${error.field}: ${error.message}`).join("; ")}`);
      }
      throw new Error(`${response.status}: ${String(data.detail || text).slice(0, 300)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${response.status}:`)) throw error;
      throw new Error(`${response.status}: ${text.slice(0, 300)}`);
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`接口没有返回 JSON：${url}`);
  }
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function normalizeMetadata(value: unknown): Record<string, string> {
  const metadata = typeof value === "object" && value ? value as Record<string, unknown> : parseMetadata(value);
  if (!metadata) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(metadata)) {
    if (item === undefined || item === null) continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      result[key] = String(item);
    } else {
      try {
        result[key] = JSON.stringify(item);
      } catch {
        result[key] = String(item);
      }
    }
  }
  return result;
}

function mapRun(raw: Record<string, unknown>): Run {
  const nodes: Record<string, StageStatus> = {};
  for (const [key, value] of Object.entries((raw.nodes as Record<string, string>) || {})) nodes[key] = status(value);
  const nodeStates = Object.fromEntries(Object.entries((raw.node_states as Record<string, Record<string, unknown>>) || {}).map(([nodeId, state]) => [nodeId, {
    status: status(String(state.status || nodes[nodeId] || "")),
    startedAt: String(state.started_at || ""),
    finishedAt: String(state.finished_at || ""),
    durationS: Number(state.duration_s || 0),
    attempt: Number(state.attempt || 0),
    progress: Number(state.progress || 0),
    artifactCount: Number(state.artifact_count || 0),
    error: String(state.error || ""),
  }]));
  return {
    executionId: String(raw.execution_id || raw.pipeline_id || ""),
    pipelineId: String(raw.pipeline_id || raw.execution_id || ""),
    runtimeId: raw.runtime_id ? String(raw.runtime_id) : undefined,
    instanceId: raw.instance_id ? String(raw.instance_id) : undefined,
    workflowId: raw.workflow_id ? String(raw.workflow_id) : undefined,
    workflowVersion: raw.workflow_version ? String(raw.workflow_version) : undefined,
    workflowSnapshot: (raw.workflow_snapshot as Record<string, unknown>) || {},
    status: status(String(raw.status || "")),
    sourceUrl: String(raw.source_url || ""),
    sourceType: String(raw.source_type || ""),
    input: (raw.input as Record<string, unknown>) || {},
    repo: String(raw.repo || ""),
    nodes,
    startedAt: String(raw.started_at || ""),
    updatedAt: String(raw.updated_at || ""),
    nodeCount: Number(raw.node_count || Object.keys(nodes).length),
    doneCount: Number(raw.done_count || 0),
    failedCount: Number(raw.failed_count || 0),
    runningNode: String(raw.running_node || ""),
    failedNode: String(raw.failed_node || ""),
    progress: Number(raw.progress || 0),
    artifactCount: Number(raw.artifact_count || 0),
    gitEventCount: Number(raw.git_event_count || 0),
    telegramEventCount: Number(raw.telegram_event_count || 0),
    eventCount: Number(raw.event_count || 0),
    pageCount: Number(raw.page_count || 0),
    durationS: Number(raw.duration_s || 0),
    nodeStates,
  };
}

function mapRuntimeInheritancePreview(raw: Record<string, unknown>): RuntimeInheritancePreview {
  const rawItems = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
  return {
    instanceId: String(raw.instance_id || raw.instanceId || ""),
    envFile: String(raw.env_file || raw.envFile || ""),
    groups: (raw.groups as Record<string, boolean>) || {},
    note: raw.note ? String(raw.note) : undefined,
    updatedAt: raw.updated_at ? String(raw.updated_at) : raw.updatedAt ? String(raw.updatedAt) : undefined,
    items: rawItems.map((item) => ({
      key: String(item.key || ""),
      aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
      matchedKey: item.matched_key ? String(item.matched_key) : item.matchedKey ? String(item.matchedKey) : "",
      source: String(item.source || "missing"),
      present: Boolean(item.present),
      maskedValue: String(item.masked_value || item.maskedValue || ""),
      secret: Boolean(item.secret),
      required: Boolean(item.required),
      category: String(item.category || "runtime"),
    })),
  };
}

function mapWorkflowBinding(raw: unknown) {
  const data = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
  return {
    workflowId: String(data.workflow_id || data.workflowId || ""),
    workflowName: String(data.workflow_name || data.workflowName || "Workflow"),
    workflowVersion: String(data.workflow_version || data.workflowVersion || ""),
    definitionSource: String(data.definition_source || data.definitionSource || ""),
    definitionPath: String(data.definition_path || data.definitionPath || ""),
    nodeCount: Number(data.node_count || data.nodeCount || 0),
    enabledNodeCount: Number(data.enabled_node_count || data.enabledNodeCount || 0),
    bindingStatus: String(data.binding_status || data.bindingStatus || "unknown"),
  };
}

function mapWorkflowDefinition(raw: unknown): WorkflowDefinition | null {
  const data = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
  const workflowId = String(data.workflow_id || data.workflowId || data.id || data.name || "").trim();
  if (!workflowId) return null;
  const actions = Array.isArray(data.actions) ? data.actions : Array.isArray(data.workflow_actions) ? data.workflow_actions : [];
  return {
    workflowId,
    name: String(data.name || workflowId),
    title: String(data.title || data.workflow_name || data.workflowName || data.name || workflowId),
    description: String(data.description || ""),
    version: data.version ? String(data.version) : data.workflow_version ? String(data.workflow_version) : undefined,
    sopType: data.sop_type ? String(data.sop_type) : data.sopType ? String(data.sopType) : undefined,
    interpreter: String(data.interpreter || data.workflow_interpreter || data.workflowInterpreter || "generic-dag"),
    workflowType: String(data.workflow_type || data.workflowType || "business"),
    definitionSource: String(data.definition_source || data.definitionSource || "runtime-spi"),
    definitionPath: String(data.definition_path || data.definitionPath || ""),
    nodeCount: Number(data.node_count || data.nodeCount || 0),
    enabledNodeCount: Number(data.enabled_node_count || data.enabledNodeCount || 0),
    actions: actions.filter((item): item is Record<string, unknown> => typeof item === "object" && Boolean(item)).map((item) => ({
      id: String(item.id || ""),
      title: String(item.title || item.id || ""),
      scope: String(item.scope || ""),
      description: item.description ? String(item.description) : undefined,
    })).filter((item) => item.id),
  };
}

function workflowDefinitionsFromInstances(items: Instance[]): WorkflowDefinition[] {
  const byId = new Map<string, WorkflowDefinition>();
  for (const item of BUILTIN_WORKFLOW_DEFINITIONS) byId.set(item.workflowId, item);
  for (const instance of items) {
    const binding = instance.workflowBinding;
    const workflowId = binding?.workflowId || instance.sopType || "";
    if (!workflowId || byId.has(workflowId)) continue;
    byId.set(workflowId, {
      workflowId,
      name: workflowId,
      title: binding?.workflowName || workflowId,
      description: "从当前 Runtime Instance 兼容数据推导的 Workflow Definition。",
      version: binding?.workflowVersion || "",
      sopType: instance.sopType || workflowId,
      interpreter: workflowId === "runtime-management" ? "runtime-management" : "generic-dag",
      workflowType: workflowId === "runtime-management" ? "management" : "business",
      definitionSource: binding?.definitionSource || "runtime-spi-instance",
      definitionPath: binding?.definitionPath || "",
      nodeCount: binding?.nodeCount || 0,
      enabledNodeCount: binding?.enabledNodeCount || 0,
    });
  }
  return Array.from(byId.values());
}

function mapInstance(item: Record<string, unknown>): Instance {
  const latest = typeof item.latest_execution === "object" && item.latest_execution
    ? mapRun(item.latest_execution as Record<string, unknown>)
    : undefined;
  return {
    id: String(item.id || item.instance_id || ""),
    instanceId: String(item.instance_id || item.id || ""),
    runtimeId: item.runtime_id ? String(item.runtime_id) : undefined,
    sopType: String(item.sop_type || ""),
    title: String(item.title || item.instance_id || item.id || "SOP"),
    description: item.description ? String(item.description) : undefined,
    version: String(item.version || ""),
    repo: String(item.repo || ""),
    enabled: item.enabled !== false,
    repoBranch: item.repo_branch ? String(item.repo_branch) : undefined,
    wikiLocalPath: item.wiki_local_path ? String(item.wiki_local_path) : undefined,
    workspaceStatus: item.workspace_status ? String(item.workspace_status) : undefined,
    runIndexStatus: item.run_index_status ? String(item.run_index_status) : undefined,
    workflowBinding: mapWorkflowBinding(item.workflow_binding),
    capabilities: (item.capabilities as Record<string, unknown>) || {},
    executionCount: Number(item.execution_count || 0),
    latestExecution: latest,
    artifactCount: Number(item.artifact_count || 0),
    pageCount: Number(item.page_count || 0),
    status: String(item.status || (item.enabled === false ? "disabled" : "ready")),
    channelUrl: item.channel_url ? String(item.channel_url) : undefined,
    spiBaseUrl: item.spi_base_url ? String(item.spi_base_url) : undefined,
    createdAt: item.created_at ? String(item.created_at) : undefined,
    updatedAt: item.updated_at ? String(item.updated_at) : undefined,
  };
}

function mapUi(raw: unknown) {
  const ui = typeof raw === "object" && raw ? raw as Record<string, unknown> : {};
  return {
    category: ui.category ? String(ui.category) : undefined,
    icon: ui.icon ? String(ui.icon) : undefined,
    stageLetter: ui.stage_letter ? String(ui.stage_letter) : ui.stageLetter ? String(ui.stageLetter) : undefined,
    order: typeof ui.order === "number" ? ui.order : undefined,
    colorRole: ui.color_role ? String(ui.color_role) : ui.colorRole ? String(ui.colorRole) : undefined,
  };
}

function mapDag(data: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }, instanceId: string): Dag {
  return {
    instanceId,
    nodes: (data.nodes || []).map((node) => ({
      id: String(node.id || ""),
      title: String(node.title || node.id || ""),
      mode: String(node.mode || "blocking"),
      summary: String(node.webhook_route || node.summary || ""),
      purpose: node.purpose ? String(node.purpose) : undefined,
      branch: node.branch ? String(node.branch) : undefined,
      inputs: (node.inputs as Record<string, string>) || {},
      outputs: (node.outputs as Record<string, string>) || {},
      optionalInputs: ((node.optional_inputs || node.optionalInputs) as Record<string, string>) || {},
      needs: (node.needs as string[]) || [],
      executor: (node.executor as Record<string, unknown>) || {},
      capabilities: (node.capabilities as Record<string, unknown>) || {},
      ui: mapUi(node.ui),
    })),
    edges: (data.edges || []).map((edge) => ({ source: String(edge.source || ""), target: String(edge.target || "") }))
  };
}

function mapEvent(ev: Record<string, unknown>): NodeEvent {
  return {
    sequence: typeof ev.sequence === "number" ? ev.sequence : undefined,
    ts: String(ev.ts || ""),
    event: String(ev.event || ""),
    stage: ev.stage ? String(ev.stage) : undefined,
    nodeId: ev.node_id ? String(ev.node_id) : undefined,
    runId: ev.run_id ? String(ev.run_id) : undefined,
    trigger: ev.trigger ? String(ev.trigger) : undefined,
    ok: typeof ev.ok === "boolean" ? ev.ok : undefined,
    error: ev.error ? String(ev.error) : undefined,
    duration_s: typeof ev.duration_s === "number" ? ev.duration_s : undefined,
    reason: ev.reason ? String(ev.reason) : undefined,
    data: (ev.data as Record<string, unknown>) || {},
  };
}

function mapArtifact(artifact: Record<string, unknown>) {
  return {
    id: String(artifact.id || ""),
    producer: String(artifact.producer || ""),
    output: String(artifact.output || ""),
    type: String(artifact.type || "file"),
    format: String(artifact.format || "binary"),
    path: String(artifact.path || ""),
    title: String(artifact.title || artifact.path || ""),
    size: Number(artifact.size || 0),
    mimeType: String(artifact.mime_type || "application/octet-stream"),
    tags: (artifact.tags as string[]) || [],
    resolution: String(artifact.resolution || ""),
    ownership: artifact.ownership ? String(artifact.ownership) : undefined,
    preview: artifact.preview ? String(artifact.preview) : undefined,
    previewTruncated: Boolean(artifact.preview_truncated)
  };
}

function mapNodeModule(raw: Record<string, unknown>): NodeModule {
  return {
    id: String(raw.id || ""),
    title: String(raw.title || raw.id || ""),
    lane: raw.lane ? String(raw.lane) : undefined,
    order: raw.order === undefined ? undefined : Number(raw.order),
    description: raw.description ? String(raw.description) : undefined,
    status: String(raw.status || "waiting"),
    summary: raw.summary ? String(raw.summary) : undefined,
    schema: ((raw.schema as string[]) || []).map(String),
    metrics: (raw.metrics as Record<string, unknown>) || {},
    contractVersion: raw.contract_version ? String(raw.contract_version) : raw.contractVersion ? String(raw.contractVersion) : undefined,
    detailUrl: raw.detail_url ? String(raw.detail_url) : raw.detailUrl ? String(raw.detailUrl) : undefined,
    runScoped: Boolean(raw.run_scoped ?? raw.runScoped),
  };
}

function mapNodeModuleDetail(raw: Record<string, unknown>): NodeModuleDetail {
  return {
    sopId: String(raw.sop_id || raw.sopId || ""),
    nodeId: String(raw.node_id || raw.nodeId || ""),
    pipelineId: raw.pipeline_id ? String(raw.pipeline_id) : raw.pipelineId ? String(raw.pipelineId) : undefined,
    module: mapNodeModule((raw.module as Record<string, unknown>) || {}),
    detail: (raw.detail as Record<string, unknown>) || {},
  };
}

function mapNodeConfig(raw: Record<string, unknown>, nodeId: string): NodeConfig {
  const infraRaw = raw.infra as Record<string, unknown> | undefined;
  return {
    nodeId: String(raw.node_id || raw.nodeId || nodeId),
    title: raw.title ? String(raw.title) : undefined,
    purpose: raw.purpose ? String(raw.purpose) : undefined,
    branch: raw.branch ? String(raw.branch) : undefined,
    retryable: raw.retryable === undefined ? undefined : Boolean(raw.retryable),
    mode: raw.mode ? String(raw.mode) : undefined,
    needs: (raw.needs as string[]) || [],
    executor: (raw.executor as Record<string, unknown>) || {},
    inputs: (raw.inputs as Record<string, unknown>) || {},
    outputs: (raw.outputs as Record<string, unknown>) || {},
    optionalInputs: ((raw.optional_inputs || raw.optionalInputs) as Record<string, unknown>) || {},
    infra: infraRaw ? {
      tgNotify: infraRaw.tg_notify !== false && infraRaw.tgNotify !== false,
      logRecord: infraRaw.log_record !== false && infraRaw.logRecord !== false,
    } : undefined,
    params: (raw.params as Record<string, unknown>) || {},
    skillScript: raw.skill_script ? String(raw.skill_script) : raw.skillScript ? String(raw.skillScript) : null,
    skillReadme: raw.skill_readme ? String(raw.skill_readme) : raw.skillReadme ? String(raw.skillReadme) : null,
    manifest: (raw.manifest as Record<string, unknown>) || {},
  };
}

function mapNodeValidation(raw: unknown) {
  const value = (raw as Record<string, unknown>) || {};
  return {
    status: String(value.status || "unknown"),
    missingOutputs: (value.missing_outputs as string[]) || (value.missingOutputs as string[]) || [],
    unexpectedOutputs: (value.unexpected_outputs as string[]) || (value.unexpectedOutputs as string[]) || []
  };
}

function mapNodeDefinition(raw: unknown) {
  const value = (raw as Record<string, unknown>) || {};
  return {
    title: value.title ? String(value.title) : undefined,
    titleZh: value.title_zh ? String(value.title_zh) : value.titleZh ? String(value.titleZh) : undefined,
    purpose: value.purpose ? String(value.purpose) : undefined,
    purposeZh: value.purpose_zh ? String(value.purpose_zh) : value.purposeZh ? String(value.purposeZh) : undefined,
    branch: value.branch ? String(value.branch) : undefined,
    executor: (value.executor as Record<string, unknown>) || {},
    retryable: value.retryable === undefined ? undefined : Boolean(value.retryable),
  };
}

function mapNodeInputModel(raw: unknown) {
  const value = (raw as Record<string, unknown>) || {};
  return {
    declared: (value.declared as Record<string, unknown>) || {},
    resolved: (value.resolved as Record<string, unknown>) || {},
    business: (value.business as Array<Record<string, unknown>>) || [],
    environment: (value.environment as Array<Record<string, unknown>>) || [],
    secrets: (value.secrets as Array<Record<string, unknown>>) || [],
  };
}

function mapNodeOutputModel(raw: unknown) {
  const value = (raw as Record<string, unknown>) || {};
  return {
    declared: (value.declared as Record<string, unknown>) || {},
    actual: (value.actual as Record<string, unknown>) || {},
    artifactExplanations: (value.artifact_explanations as Record<string, string>) || (value.artifactExplanations as Record<string, string>) || {},
    keyResults: (value.key_results as Array<Record<string, unknown>>) || (value.keyResults as Array<Record<string, unknown>>) || [],
  };
}

function mapNodeTroubleshooting(raw: unknown) {
  const value = (raw as Record<string, unknown>) || {};
  return {
    failureHints: (value.failure_hints as string[]) || (value.failureHints as string[]) || [],
    retryable: value.retryable === undefined ? undefined : Boolean(value.retryable),
    safeToRetry: value.safe_to_retry === undefined ? value.safeToRetry as boolean | string | undefined : value.safe_to_retry as boolean | string,
    error: value.error ? String(value.error) : undefined,
    validation: value.validation as Record<string, unknown> | undefined,
  };
}

function mapClassification(raw: Record<string, unknown> | undefined | null): NodeClassification | undefined {
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    depClass: (r.dep_class ?? r.depClass) as NodeClassification["depClass"],
    sideEffect: (r.side_effect ?? r.sideEffect) as NodeClassification["sideEffect"],
    testableStandalone: Boolean(r.testable_standalone ?? r.testableStandalone),
    requestInputs: ((r.request_inputs ?? r.requestInputs) as string[]) || [],
    artifactDeps: ((r.artifact_deps ?? r.artifactDeps) as NodeClassification["artifactDeps"]) || [],
    statePreconditions: ((r.state_preconditions ?? r.statePreconditions) as NodeClassification["statePreconditions"]) || [],
  };
}

function mapNodeContract(raw: Record<string, unknown>): NodeContract | null {
  const contract = (raw.contract as Record<string, unknown>) || raw;
  const nodeId = String(raw.node_id || raw.nodeId || contract.node_id || contract.nodeId || "");
  if (!nodeId) return null;
  const cls = mapClassification(contract) || {};
  return {
    nodeId,
    title: contract.title ? String(contract.title) : undefined,
    purpose: contract.purpose ? String(contract.purpose) : undefined,
    branch: contract.branch ? String(contract.branch) : undefined,
    ...cls,
  };
}

function mapNodeRegistryItem(raw: Record<string, unknown>): NodeRegistryItem {
  const nodeId = String(raw.node_id || raw.nodeId || "");
  const base = mapNodeConfig(raw, nodeId);
  return {
    ...base,
    description: raw.description ? String(raw.description) : undefined,
    case: raw.case ? String(raw.case) : undefined,
    skill: (raw.skill as Record<string, unknown>) || {},
    capabilities: (raw.capabilities as Record<string, unknown>) || {},
    actions: (raw.actions as Record<string, unknown>) || {},
    cli: (raw.cli as Record<string, string>) || {},
    modules: ((raw.modules as Array<Record<string, unknown>>) || []).map(mapNodeModule),
    editable: Boolean(raw.editable),
    publishEnabled: Boolean(raw.publish_enabled ?? raw.publishEnabled),
    missingFields: ((raw.missing_fields || raw.missingFields) as string[]) || [],
    ui: mapUi(raw.ui || (raw.manifest as Record<string, unknown> | undefined)?.ui),
    classification: mapClassification(raw.classification as Record<string, unknown>),
  };
}

function mapNodeTestResult(raw: Record<string, unknown>): NodeTestResult {
  return {
    status: String(raw.status || ""),
    mode: raw.mode ? String(raw.mode) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : undefined,
    pipelineId: raw.pipeline_id ? String(raw.pipeline_id) : undefined,
    namespace: raw.namespace ? String(raw.namespace) : undefined,
    depClass: (raw.dep_class as NodeTestResult["depClass"]) || undefined,
    sideEffect: (raw.side_effect as NodeTestResult["sideEffect"]) || undefined,
    reportPath: raw.report_path ? String(raw.report_path) : undefined,
    reason: raw.reason ? String(raw.reason) : undefined,
  };
}

function mapNodeTestPlanInput(raw: Record<string, unknown>) {
  return {
    name: String(raw.name || ""),
    source: raw.source ? String(raw.source) : undefined,
    required: raw.required === undefined ? undefined : Boolean(raw.required),
    resolved: raw.resolved === undefined ? undefined : Boolean(raw.resolved),
    value: raw.value,
    provenance: raw.provenance ? String(raw.provenance) : undefined,
    reason: raw.reason ? String(raw.reason) : undefined,
  };
}

function mapNodeTestPlan(raw: Record<string, unknown>): NodeTestPlan {
  return {
    sopId: raw.sop_id ? String(raw.sop_id) : undefined,
    workflowId: raw.workflow_id ? String(raw.workflow_id) : undefined,
    instanceId: raw.instance_id ? String(raw.instance_id) : undefined,
    nodeId: String(raw.node_id || ""),
    nodeTitle: raw.node_title ? String(raw.node_title) : undefined,
    mode: raw.mode ? String(raw.mode) : undefined,
    inputSource: (raw.input_source as NodeTestPlan["inputSource"]) || undefined,
    baseRunId: raw.base_run_id ? String(raw.base_run_id) : undefined,
    requiredInputs: ((raw.required_inputs as Array<Record<string, unknown>>) || []).map(mapNodeTestPlanInput),
    optionalInputs: ((raw.optional_inputs as Array<Record<string, unknown>>) || []).map(mapNodeTestPlanInput),
    resolvedInputs: ((raw.resolved_inputs as Array<Record<string, unknown>>) || []).map(mapNodeTestPlanInput),
    missingInputs: ((raw.missing_inputs as Array<Record<string, unknown>>) || []).map(mapNodeTestPlanInput),
    upstreamNodes: (raw.upstream_nodes as Array<Record<string, unknown>>) || [],
    availableExistingRuns: (raw.available_existing_runs as Array<Record<string, unknown>>) || [],
    sideEffects: (raw.side_effects as Record<string, unknown>) || {},
    actions: (raw.actions as Record<string, unknown>) || {},
    status: raw.status ? String(raw.status) : undefined,
  };
}

function mapNodeTestStep(raw: Record<string, unknown>) {
  return {
    id: String(raw.id || raw.step_id || ""),
    title: String(raw.title || raw.id || raw.step_id || "Step"),
    status: String(raw.status || "waiting"),
    summary: raw.summary ? String(raw.summary) : undefined,
    startedAt: raw.started_at ? String(raw.started_at) : undefined,
    finishedAt: raw.finished_at ? String(raw.finished_at) : undefined,
    elapsedMs: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : undefined,
    detail: (raw.detail as Record<string, unknown>) || {},
  };
}

function mapCapabilityConfigPreview(raw: Record<string, unknown>): CapabilityConfigPreview {
  const rawItems = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
  return {
    runtimeId: raw.runtime_id ? String(raw.runtime_id) : raw.runtimeId ? String(raw.runtimeId) : undefined,
    instanceId: raw.instance_id ? String(raw.instance_id) : raw.instanceId ? String(raw.instanceId) : undefined,
    workflowId: raw.workflow_id ? String(raw.workflow_id) : raw.workflowId ? String(raw.workflowId) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : raw.nodeId ? String(raw.nodeId) : undefined,
    backend: raw.backend ? String(raw.backend) : undefined,
    updatedAt: raw.updated_at ? String(raw.updated_at) : raw.updatedAt ? String(raw.updatedAt) : undefined,
    envFile: raw.env_file ? String(raw.env_file) : raw.envFile ? String(raw.envFile) : undefined,
    precedence: Array.isArray(raw.precedence) ? raw.precedence.map(String) : [],
    registryTotal: typeof raw.registry_total === "number" ? raw.registry_total : typeof raw.registryTotal === "number" ? raw.registryTotal : undefined,
    registryFilters: ((raw.registry_filters || raw.registryFilters || {}) as Record<string, string>) || {},
    groups: (raw.groups as Record<string, boolean>) || {},
    scopes: (raw.scopes as Record<string, string>) || {},
    note: raw.note ? String(raw.note) : undefined,
    items: rawItems.map((item) => {
      const valuesByScopeRaw = (item.values_by_scope || item.valuesByScope || {}) as Record<string, Record<string, unknown>>;
      const valuesByScope = Object.fromEntries(Object.entries(valuesByScopeRaw).map(([scope, value]) => [scope, {
        present: Boolean(value?.present),
        matchedKey: value?.matched_key ? String(value.matched_key) : value?.matchedKey ? String(value.matchedKey) : undefined,
        maskedValue: value?.masked_value ? String(value.masked_value) : value?.maskedValue ? String(value.maskedValue) : undefined,
        secret: typeof value?.secret === "boolean" ? value.secret : undefined,
      }]));
      return {
        key: String(item.key || ""),
        aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
        label: item.label ? String(item.label) : undefined,
        capability: item.capability ? String(item.capability) : undefined,
        category: item.category ? String(item.category) : undefined,
        workflowTags: Array.isArray(item.workflow_tags) ? item.workflow_tags.map(String) : Array.isArray(item.workflowTags) ? item.workflowTags.map(String) : [],
        nodeTags: Array.isArray(item.node_tags) ? item.node_tags.map(String) : Array.isArray(item.nodeTags) ? item.nodeTags.map(String) : [],
        capabilityTags: Array.isArray(item.capability_tags) ? item.capability_tags.map(String) : Array.isArray(item.capabilityTags) ? item.capabilityTags.map(String) : [],
        operationTags: Array.isArray(item.operation_tags) ? item.operation_tags.map(String) : Array.isArray(item.operationTags) ? item.operationTags.map(String) : [],
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        description: item.description ? String(item.description) : undefined,
        required: typeof item.required === "boolean" ? item.required : undefined,
        secret: typeof item.secret === "boolean" ? item.secret : undefined,
        editableScopes: Array.isArray(item.editable_scopes) ? item.editable_scopes.map(String) : Array.isArray(item.editableScopes) ? item.editableScopes.map(String) : [],
        matchedKey: item.matched_key ? String(item.matched_key) : item.matchedKey ? String(item.matchedKey) : undefined,
        source: item.source ? String(item.source) : undefined,
        sourceKind: item.source_kind ? String(item.source_kind) : item.sourceKind ? String(item.sourceKind) : undefined,
        present: typeof item.present === "boolean" ? item.present : undefined,
        maskedValue: item.masked_value ? String(item.masked_value) : item.maskedValue ? String(item.maskedValue) : undefined,
        valuesByScope,
      };
    }),
  };
}

function mapNodeTestEvent(raw: Record<string, unknown>) {
  return {
    sequence: typeof raw.sequence === "number" ? raw.sequence : undefined,
    event: String(raw.event || ""),
    testId: raw.test_id ? String(raw.test_id) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : undefined,
    stepId: raw.step_id ? String(raw.step_id) : undefined,
    ts: raw.ts ? String(raw.ts) : undefined,
    data: (raw.data as Record<string, unknown>) || {},
  };
}

function mapNodeTestRunResult(raw: Record<string, unknown>, nodeId: string, fallbackId: string): NodeTestRunResult {
  return {
    pipelineId: raw.pipeline_id ? String(raw.pipeline_id) : fallbackId,
    testId: raw.test_id ? String(raw.test_id) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : nodeId,
    status: raw.status ? String(raw.status) : undefined,
    mode: raw.mode ? String(raw.mode) : undefined,
    pending: Boolean(raw.pending),
    startedAt: raw.started_at ? String(raw.started_at) : undefined,
    finishedAt: raw.finished_at ? String(raw.finished_at) : undefined,
    reason: raw.reason ? String(raw.reason) : undefined,
    detail: (raw.detail as Record<string, unknown>) || {},
    steps: ((raw.steps as Array<Record<string, unknown>>) || []).map(mapNodeTestStep),
    events: ((raw.events as Array<Record<string, unknown>>) || []).map(mapNodeTestEvent),
    artifacts: ((raw.artifacts as Array<Record<string, unknown>>) || []).map(mapArtifact),
  };
}

function mapNodeRunEvent(raw: Record<string, unknown>): NodeRunEvent {
  return {
    sequence: typeof raw.sequence === "number" ? raw.sequence : undefined,
    event: String(raw.event || ""),
    nodeRunId: raw.node_run_id ? String(raw.node_run_id) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : undefined,
    stepId: raw.step_id ? String(raw.step_id) : undefined,
    ts: raw.ts ? String(raw.ts) : undefined,
    data: (raw.data as Record<string, unknown>) || {},
  };
}

function mapNodeRunEnvironmentItem(raw: Record<string, unknown>) {
  return {
    id: raw.id ? String(raw.id) : undefined,
    capability: raw.capability ? String(raw.capability) : undefined,
    key: String(raw.key || ""),
    label: raw.label ? String(raw.label) : undefined,
    source: raw.source ? String(raw.source) : undefined,
    sourceKind: raw.source_kind ? String(raw.source_kind) : undefined,
    present: typeof raw.present === "boolean" ? raw.present : undefined,
    required: typeof raw.required === "boolean" ? raw.required : undefined,
    secret: typeof raw.secret === "boolean" ? raw.secret : undefined,
    value: raw.value === undefined || raw.value === null ? undefined : String(raw.value),
    status: raw.status ? String(raw.status) : undefined,
    unit: raw.unit ? String(raw.unit) : undefined,
    category: raw.category ? String(raw.category) : undefined,
  };
}

function mapNodeRunCapabilityResult(raw: Record<string, unknown>) {
  return {
    key: String(raw.key || raw.capability || ""),
    capability: raw.capability ? String(raw.capability) : undefined,
    label: raw.label ? String(raw.label) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    required: typeof raw.required === "boolean" ? raw.required : undefined,
    source: raw.source ? String(raw.source) : undefined,
    reason: raw.reason ? String(raw.reason) : undefined,
    managedBy: raw.managed_by ? String(raw.managed_by) : undefined,
    detail: (raw.detail as Record<string, unknown>) || {},
  };
}

function mapNodeRunIssue(raw: Record<string, unknown>) {
  return {
    id: raw.id ? String(raw.id) : undefined,
    target: raw.target ? String(raw.target) : undefined,
    severity: raw.severity ? String(raw.severity) : undefined,
    title: raw.title ? String(raw.title) : undefined,
    message: raw.message ? String(raw.message) : undefined,
    action: raw.action ? String(raw.action) : undefined,
    source: raw.source ? String(raw.source) : undefined,
    relatedCapability: raw.related_capability ? String(raw.related_capability) : undefined,
    relatedConfigKeys: Array.isArray(raw.related_config_keys) ? raw.related_config_keys.map(String) : [],
  };
}

function mapNodeRunResult(raw: Record<string, unknown>, nodeId: string, fallbackId = ""): NodeRunResult {
  return {
    nodeRunId: String(raw.node_run_id || raw.nodeRunId || raw.pipeline_id || fallbackId || ""),
    pipelineId: raw.pipeline_id ? String(raw.pipeline_id) : undefined,
    runtimeId: raw.runtime_id ? String(raw.runtime_id) : undefined,
    instanceId: raw.instance_id ? String(raw.instance_id) : undefined,
    workflowId: raw.workflow_id ? String(raw.workflow_id) : undefined,
    nodeId: raw.node_id ? String(raw.node_id) : nodeId,
    nodeTitle: raw.node_title ? String(raw.node_title) : undefined,
    status: raw.status ? String(raw.status) : undefined,
    mode: raw.mode ? String(raw.mode) : undefined,
    inputSource: raw.input_source ? String(raw.input_source) : undefined,
    pending: Boolean(raw.pending),
    startedAt: raw.started_at ? String(raw.started_at) : undefined,
    finishedAt: raw.finished_at ? String(raw.finished_at) : undefined,
    elapsedMs: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : undefined,
    reason: raw.reason ? String(raw.reason) : undefined,
    createdFrom: raw.created_from ? String(raw.created_from) : undefined,
    retryOf: raw.retry_of ? String(raw.retry_of) : undefined,
    detail: (raw.detail as Record<string, unknown>) || {},
    steps: ((raw.steps as Array<Record<string, unknown>>) || []).map(mapNodeTestStep),
    innerSteps: ((raw.inner_steps as Array<Record<string, unknown>>) || ((raw.detail as Record<string, unknown>)?.inner_steps as Array<Record<string, unknown>>) || []).map(mapNodeTestStep),
    events: ((raw.events as Array<Record<string, unknown>>) || []).map(mapNodeRunEvent),
    artifacts: ((raw.artifacts as Array<Record<string, unknown>>) || []).map(mapArtifact),
    businessArtifacts: ((raw.business_artifacts as Array<Record<string, unknown>>) || []).map(mapArtifact),
    actualOutputs: (raw.actual_outputs as Record<string, unknown>) || {},
    validation: (raw.validation as Record<string, unknown>) || {},
    capabilities: (raw.capabilities as Record<string, unknown>) || {},
    runtimeContext: (raw.runtime_context as Record<string, unknown>) || {},
    instanceContext: (raw.instance_context as Record<string, unknown>) || {},
    definitionDefaults: (raw.definition_defaults as Record<string, unknown>) || {},
    capabilityOverrides: (raw.capability_overrides as Record<string, unknown>) || {},
    definitionScopeReports: (raw.definition_scope_reports as Record<string, unknown>) || {},
    environmentSnapshot: ((raw.environment_snapshot as Array<Record<string, unknown>>) || []).map(mapNodeRunEnvironmentItem),
    capabilityResults: ((raw.capability_results as Array<Record<string, unknown>>) || []).map(mapNodeRunCapabilityResult),
    issues: ((raw.issues as Array<Record<string, unknown>>) || []).map(mapNodeRunIssue),
  };
}

function mapNodeDraft(raw: Record<string, unknown>): NodeDraft {
  return {
    draftId: String(raw.draft_id || raw.draftId || ""),
    node: (raw.node as Record<string, unknown>) || {},
    validation: (raw.validation as Record<string, unknown>) || {},
  };
}

function mapNodeDraftSchema(raw: Record<string, unknown>): NodeDraftSchema {
  const schema = ((raw.schema as Record<string, unknown>) || raw) as Record<string, unknown>;
  return {
    schemaId: String(schema.schema_id || schema.schemaId || ""),
    title: String(schema.title || "Node Draft Schema"),
    description: schema.description ? String(schema.description) : undefined,
    fields: ((schema.fields as Array<Record<string, unknown>>) || []).map((field) => ({
      name: String(field.name || ""),
      label: String(field.label || field.name || ""),
      type: String(field.type || "string"),
      required: Boolean(field.required),
      default: field.default === undefined ? undefined : String(field.default),
      placeholder: field.placeholder ? String(field.placeholder) : undefined,
      mapsTo: field.maps_to ? String(field.maps_to) : field.mapsTo ? String(field.mapsTo) : undefined,
    })),
    defaults: (schema.defaults as Record<string, unknown>) || {},
    safety: (schema.safety as Record<string, unknown>) || {},
  };
}

function mapRuntime(raw: Record<string, unknown>): Runtime | null {
  const metadata = normalizeMetadata(raw.metadata);
  const endpoint = normalizeEndpoint(String(raw.endpoint || raw.channel_url || raw.channelUrl || metadata.channel_url || metadata.endpoint_url || ""));
  if (!endpoint) return null;
  const name = String(raw.name || raw.channel_name || raw.channelName || metadata.channel_name || raw.id || endpoint);
  return {
    id: String(raw.id || raw.runtime_id || metadata.runtime_id || name),
    name,
    endpoint,
    machine: name.match(/\d+/)?.[0],
    status: String(raw.status || "unknown"),
    localStatus: String(raw.local_status || raw.localStatus || "unknown"),
    displayName: String(raw.display_name || raw.displayName || metadata.display_name || metadata.runtime_id || name),
    clientIp: String(raw.client_ip || raw.clientIp || metadata.client_ip || ""),
    localPort: String(raw.local_port || raw.localPort || metadata.local_port || ""),
    channelName: String(raw.channel_name || raw.channelName || metadata.channel_name || name),
    channelUrl: endpoint,
    spiBaseUrl: String(raw.spi_base_url || raw.spiBaseUrl || metadata.spi_base_url || `${endpoint}/api/sop`),
    metadata,
    supportedSopTypes: Array.isArray(raw.supported_sop_types)
      ? raw.supported_sop_types.map(String)
      : Array.isArray(raw.supportedSopTypes)
      ? raw.supportedSopTypes.map(String)
      : metadata.supported_sop_types
      ? parseStringArray(metadata.supported_sop_types)
      : [],
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function sortRuntimeHosts(items: Runtime[]) {
  return [...items].sort((a, b) => {
    const healthA = a.localStatus === "ok" ? 0 : 1;
    const healthB = b.localStatus === "ok" ? 0 : 1;
    if (healthA !== healthB) return healthA - healthB;
    return a.name.localeCompare(b.name);
  });
}

async function listRuntimeHostsFromTunnelAdmin(page: number, pageSize: number, options?: ListQueryOptions): Promise<RuntimeList> {
  const fallbackLimit = Math.max(pageSize, 200);
  const data = await requestJson<{ tunnels?: Array<Record<string, unknown>> }>(`${TUNNEL_API}/admin/tunnels?limit=${fallbackLimit}`);
  const search = (options?.q || "").trim().toLowerCase();
  const statusFilter = options?.status && options.status !== "all" ? options.status : "active";
  const filtered = (data.tunnels || [])
    .flatMap((tunnel): Runtime[] => {
      const metadata = parseMetadata(tunnel.metadata);
      if (metadata?.type !== "sop-runtime") return [];
      if (statusFilter && tunnel.status !== statusFilter) return [];
      const runtime = mapRuntime({
        id: metadata.runtime_id || metadata.channel_name || tunnel.subdomain,
        name: metadata.channel_name || tunnel.subdomain,
        endpoint: metadata.channel_url || metadata.endpoint_url,
        status: tunnel.status,
        local_status: tunnel.local_status,
        display_name: metadata.display_name,
        client_ip: tunnel.client_ip || metadata.client_ip,
        local_port: tunnel.local_port || metadata.local_port,
        channel_name: metadata.channel_name,
        spi_base_url: metadata.spi_base_url,
        supported_sop_types: metadata.supported_sop_types,
        metadata,
      });
      return runtime ? [runtime] : [];
    })
    .filter((runtime) => {
      if (!search) return true;
      return [
        runtime.id,
        runtime.name,
        runtime.displayName,
        runtime.endpoint,
        runtime.clientIp,
        runtime.localStatus,
        runtime.status,
        runtime.metadata?.hermes_webhook_url,
        runtime.metadata?.webhook_public_host,
      ].filter(Boolean).join(" ").toLowerCase().includes(search);
    });
  const sorted = sortRuntimeHosts(filtered);
  const offset = (page - 1) * pageSize;
  const runtimes = sorted.slice(offset, offset + pageSize);
  return {
    runtimes,
    total: sorted.length,
    page,
    pageSize,
    hasMore: offset + runtimes.length < sorted.length,
    source: "tunnel-admin-fallback",
  };
}

async function listRuntimeHosts(options?: ListQueryOptions): Promise<RuntimeList> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 200;
  const query = toQuery({
    page,
    pageSize,
    q: options?.q,
    status: options?.status || "active",
    sort: options?.sort || "updated_at",
    order: options?.order || "desc",
  });
  try {
    const data = await requestJson<{
      runtimes?: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      total?: number;
      page?: number;
      page_size?: number;
      has_more?: boolean;
      source?: string;
    }>(`${controlPlaneApiUrl}/api/sop/v1/runtimes${query}`);
    const runtimes = sortRuntimeHosts((data.items || data.runtimes || []).flatMap((item) => {
      const runtime = mapRuntime(item);
      return runtime ? [runtime] : [];
    }));
    if (runtimes.length === 0) {
      return listRuntimeHostsFromTunnelAdmin(page, pageSize, options);
    }
    return {
      runtimes,
      total: Number(data.total ?? runtimes.length),
      page: Number(data.page || page),
      pageSize: Number(data.page_size || pageSize),
      hasMore: Boolean(data.has_more),
      source: data.source || "control-plane",
    };
  } catch {
    return listRuntimeHostsFromTunnelAdmin(page, pageSize, options);
  }
}

async function listWorkflowRuns(runtime: Runtime, instanceId: string, options?: ListQueryOptions): Promise<RunList> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 50;
  try {
    const data = await requestJson<{
      runs?: Array<Record<string, unknown>>;
      executions?: Array<Record<string, unknown>>;
      items?: Array<Record<string, unknown>>;
      total?: number;
      page?: number;
      page_size?: number;
      has_more?: boolean;
      source?: string;
    }>(
      `${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow/runs${toQuery(options)}`
    );
    const rawRuns = data.items || data.executions || data.runs || [];
    const runs = rawRuns.map(mapRun);
    return {
      runs,
      total: Number(data.total ?? runs.length),
      page: Number(data.page || page),
      pageSize: Number(data.page_size || pageSize),
      hasMore: Boolean(data.has_more),
      source: data.source || "runtime-spi-v1",
    };
  } catch {
    const legacyLimit = Math.max(page * pageSize, pageSize, 100);
    const query = new URLSearchParams();
    query.set("limit", String(legacyLimit));
    const data = await requestJson<{ runs?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs?${query.toString()}`
    );
    const search = (options?.q || "").trim().toLowerCase();
    const statusFilter = options?.status && options.status !== "all" ? options.status : "";
    const filtered = (data.runs || [])
      .map(mapRun)
      .filter((run) => {
        if (statusFilter && run.status !== statusFilter) return false;
        if (!search) return true;
        return [run.pipelineId, run.sourceUrl, run.repo, run.status, run.runningNode, run.failedNode]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search);
      });
    const offset = (page - 1) * pageSize;
    const runs = filtered.slice(offset, offset + pageSize);
    return {
      runs,
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + runs.length < filtered.length || filtered.length >= legacyLimit,
      source: "legacy-runtime-spi",
    };
  }
}

function filterInstances(items: Instance[], options?: ListQueryOptions) {
  const search = (options?.q || "").trim().toLowerCase();
  const statusFilter = options?.status && options.status !== "all" ? options.status : "";
  return items.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (!search) return true;
    return [item.instanceId, item.title, item.repo, item.sopType, item.status, item.workflowBinding?.workflowName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search);
  });
}

async function listRuntimeInstances(runtime: Runtime, options?: ListQueryOptions): Promise<InstanceList> {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 100;
  let data: {
    sops?: Array<Record<string, unknown>>;
    instances?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
    runtime?: Record<string, unknown>;
    runtime_info?: Record<string, unknown>;
    total?: number;
    page?: number;
    page_size?: number;
    has_more?: boolean;
    source?: string;
  };
  let source = "runtime-spi-v1";
  try {
    data = await requestJson<typeof data>(
      `${runtime.endpoint}/api/sop/v1/instances${toQuery(options)}`
    );
  } catch {
    source = "legacy-runtime-spi";
    data = await requestJson<typeof data>(
      `${runtime.endpoint}/api/sop/instances${toQuery(options)}`
    );
  }
  const rawItems = data.items || data.instances || data.sops || [];
  const mapped = rawItems.map(mapInstance);
  const backendHasPaging = data.total !== undefined || data.page !== undefined || data.page_size !== undefined || data.has_more !== undefined || Array.isArray(data.items);
  if (backendHasPaging) {
    const total = Number(data.total ?? mapped.length);
    return {
      instances: mapped,
      total,
      page: Number(data.page || page),
      pageSize: Number(data.page_size || pageSize),
      hasMore: Boolean(data.has_more ?? ((page - 1) * pageSize + mapped.length < total)),
      source: data.source || source,
    };
  }
  const filtered = filterInstances(mapped, options);
  const offset = (page - 1) * pageSize;
  const instances = filtered.slice(offset, offset + pageSize);
  const runtimeInfo = data.runtime || data.runtime_info || {};
  const runtimeInstanceCount = Number(runtimeInfo.instance_count || runtimeInfo.instanceCount || 0);
  const hasClientFilter = Boolean((options?.q || "").trim() || (options?.status && options.status !== "all"));
  const total = hasClientFilter ? filtered.length : (runtimeInstanceCount || filtered.length || mapped.length);
  return {
    instances,
    total,
    page,
    pageSize,
    hasMore: offset + instances.length < total,
    source: data.source || `${source}-local-page`,
  };
}

export const sopProvider: SopDataProvider = {
  mode: "real",

  listRuntimeHosts,

  async listRuntimes(options) {
    return (await listRuntimeHosts(options)).runtimes;
  },

  async listWorkflowDefinitions(runtime) {
    if (runtime) {
      try {
        const data = await requestJson<{
          workflows?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
        }>(`${runtime.endpoint}/api/sop/v1/workflows`);
        const rawItems = data.items || data.workflows || [];
        const mapped = rawItems.map(mapWorkflowDefinition).filter((item): item is WorkflowDefinition => Boolean(item));
        if (mapped.length) return mapped;
      } catch {
        // Older runtimes do not expose a catalog route yet; derive a safe catalog below.
      }
      try {
        const instanceList = await listRuntimeInstances(runtime, { page: 1, pageSize: 100 });
        return workflowDefinitionsFromInstances(instanceList.instances);
      } catch {
        return BUILTIN_WORKFLOW_DEFINITIONS;
      }
    }
    return BUILTIN_WORKFLOW_DEFINITIONS;
  },

  listRuntimeInstances,

  async listInstances(runtime, options) {
    return (await listRuntimeInstances(runtime, options)).instances;
  },

  async getDag(runtime, instanceId) {
    let data: {
      dag?: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> };
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    };
    try {
      data = await requestJson<{
        dag?: { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> };
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
      }>(`${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow`);
    } catch {
      data = await requestJson<{
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
      }>(`${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/dag`);
    }
    return mapDag(data.dag || data, instanceId);
  },

  async getRunDag(runtime, instanceId, pipelineId) {
    const data = await requestJson<{ nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/dag`
    );
    return mapDag(data, instanceId);
  },

  listWorkflowRuns,

  async listRuns(runtime, instanceId, options) {
    return (await listWorkflowRuns(runtime, instanceId, options)).runs;
  },

  async getRun(runtime, instanceId, pipelineId) {
    try {
      return mapRun(await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}`
      ));
    } catch {
      return mapRun(await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}`
      ));
    }
  },

  async getRunEvents(runtime, instanceId, pipelineId) {
    let raw: { events?: Array<Record<string, unknown>> };
    try {
      raw = await requestJson<{ events?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}/events`
      );
    } catch {
      raw = await requestJson<{ events?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/events`
      );
    }
    return (raw.events || []).map(mapEvent);
  },

  async getRunArtifacts(runtime, instanceId, pipelineId) {
    let raw: Array<Record<string, unknown>> | { artifacts?: Array<Record<string, unknown>> };
    try {
      raw = await requestJson<Array<Record<string, unknown>> | { artifacts?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}/artifacts`
      );
    } catch {
      raw = await requestJson<Array<Record<string, unknown>> | { artifacts?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/artifacts`
      );
    }
    const items = Array.isArray(raw) ? raw : raw.artifacts || [];
    return items.map(mapArtifact);
  },

  async getRunArtifactCandidates(runtime, instanceId, pipelineId) {
    const raw = await requestJson<{ artifacts?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/artifact-candidates`
    );
    return (raw.artifacts || []).map(mapArtifact);
  },

  async getNode(runtime, instanceId, pipelineId, nodeId) {
    let raw: Record<string, unknown>;
    try {
      raw = await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/v1/instances/${encodeURIComponent(instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}`
      );
    } catch {
      raw = await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}`
      );
    }
    const infraRaw = raw.infra as Record<string, unknown> | undefined;
    return {
      pipelineId: String(raw.pipeline_id || pipelineId),
      nodeId: String(raw.node_id || nodeId),
      title: raw.title ? String(raw.title) : undefined,
      purpose: raw.purpose ? String(raw.purpose) : undefined,
      branch: raw.branch ? String(raw.branch) : undefined,
      retryable: raw.retryable === undefined ? undefined : Boolean(raw.retryable),
      manualFixHint: raw.manual_fix_hint ? String(raw.manual_fix_hint) : raw.manualFixHint ? String(raw.manualFixHint) : undefined,
      reportReason: raw.report_reason ? String(raw.report_reason) : undefined,
      reportManualFixHint: raw.report_manual_fix_hint ? String(raw.report_manual_fix_hint) : undefined,
      reportDetail: (raw.report_detail as Record<string, unknown>) || undefined,
      runId: String(raw.run_id || ""),
      status: status(String(raw.status || "")),
      mode: String(raw.mode || ""),
      startedAt: String(raw.started_at || ""),
      finishedAt: String(raw.finished_at || ""),
      updatedAt: String(raw.updated_at || ""),
      error: String(raw.error || ""),
      inputs: (raw.inputs as Record<string, string>) || {},
      outputs: (raw.outputs as Record<string, string>) || {},
      optionalInputs: (raw.optional_inputs as Record<string, string>) || {},
      executor: (raw.executor as Record<string, unknown>) || {},
      declaredInputs: (raw.declared_inputs as Record<string, unknown>) || {},
      resolvedInputs: (raw.resolved_inputs as Record<string, unknown>) || {},
      declaredOutputs: (raw.declared_outputs as Record<string, unknown>) || {},
      actualOutputs: (raw.actual_outputs as Record<string, unknown>) || {},
      artifacts: ((raw.artifacts as Array<Record<string, unknown>>) || []).map(mapArtifact),
      discoveredCandidates: ((raw.discovered_candidates as Array<Record<string, unknown>>) || []).map(mapArtifact),
      capabilities: (raw.capabilities as Record<string, unknown>) || {},
      plan: (raw.plan as Record<string, unknown>) || null,
      validation: mapNodeValidation(raw.validation),
      infra: infraRaw ? {
        tgNotify: infraRaw.tg_notify !== false,
        logRecord: infraRaw.log_record !== false,
      } : undefined,
      definition: mapNodeDefinition(raw.definition || {
        title: raw.title,
        purpose: raw.purpose,
        branch: raw.branch,
        executor: raw.executor,
        retryable: raw.retryable,
      }),
      inputModel: mapNodeInputModel(raw.inputs || {
        declared: raw.declared_inputs,
        resolved: raw.resolved_inputs,
      }),
      actions: (raw.actions as string[]) || [],
      outputModel: mapNodeOutputModel(raw.outputs || {
        declared: raw.declared_outputs,
        actual: raw.actual_outputs,
      }),
      troubleshooting: mapNodeTroubleshooting(raw.troubleshooting || {
        failure_hints: raw.manual_fix_hint ? [raw.manual_fix_hint] : [],
        error: raw.error,
        validation: raw.validation,
        retryable: raw.retryable,
        safe_to_retry: raw.retryable,
      }),
    };
  },

  async getNodeLog(runtime, instanceId, pipelineId, nodeId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/logs/${encodeURIComponent(nodeId)}`
    );
    const rawEvents = (raw.events as Array<Record<string, unknown>>) || [];
    return {
      pipelineId: String(raw.pipeline_id || pipelineId),
      nodeId: String(raw.node_id || nodeId),
      log: String(raw.log || ""),
      events: rawEvents.map(mapEvent),
    };
  },

  async getNodeConfig(runtime, instanceId, nodeId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}`
    );
    return mapNodeConfig(raw, nodeId);
  },

  async getNodeContract(runtime, instanceId, nodeId): Promise<NodeContract | null> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/contract`;
    const response = await fetch(url);
    if (response.status === 404) return null; // node has no engine contract
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 200)}`);
    try {
      return mapNodeContract(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async getNodeTestPlan(runtime, instanceId, nodeId): Promise<NodeTestPlan | null> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/test-plan`;
    const response = await fetch(url);
    if (response.status === 404) return null;
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 200)}`);
    try {
      return mapNodeTestPlan(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return null;
    }
  },

  async runNodePreflight(runtime, instanceId, nodeId, input: NodePreflightInput): Promise<NodeTestRunResult> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/tests`;
    const raw = await postJsonResult<Record<string, unknown>>(url, {
      input_source: input.inputSource || "generated-fixture",
      pipeline_id: input.pipelineId || "",
      manual_inputs: input.manualInputs || {},
    });
    return mapNodeTestRunResult(raw, nodeId, String(raw.pipeline_id || raw.test_id || ""));
  },

  async triggerNodeTest(runtime, instanceId, nodeId, input: NodeTestInput): Promise<NodeTestResult> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/actions/trigger`;
    const body = {
      request_overrides: input.requestOverrides || {},
      seed_from_run_id: input.seedFromRunId || "",
      from_run_id: input.fromRunId || "",
      confirm_mutating: Boolean(input.confirmMutating),
      dry_run: Boolean(input.dryRun),
    };
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    // 202 = triggered, 409 = guard-blocked (both carry a structured body the UI surfaces).
    if (response.ok || response.status === 409) {
      try {
        return mapNodeTestResult(JSON.parse(text) as Record<string, unknown>);
      } catch {
        return { status: "error", reason: text.slice(0, 200) };
      }
    }
    throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  },

  async listNodeTests(runtime, instanceId, nodeId): Promise<NodeTestRunResult[]> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/tests`;
    const raw = await requestJson<{ tests?: Array<Record<string, unknown>> }>(url);
    return (raw.tests || []).map((item) => mapNodeTestRunResult(item, nodeId, String(item.pipeline_id || item.test_id || "")));
  },

  async getNodeTestResult(runtime, instanceId, nodeId, pipelineId): Promise<NodeTestRunResult> {
    const nextUrl = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/tests/${encodeURIComponent(pipelineId)}`;
    try {
      const raw = await requestJson<Record<string, unknown>>(nextUrl);
      return mapNodeTestRunResult(raw, nodeId, pipelineId);
    } catch (error) {
      const legacyUrl = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes/${encodeURIComponent(nodeId)}/test-result/${encodeURIComponent(pipelineId)}`;
      const raw = await requestJson<Record<string, unknown>>(legacyUrl);
      return mapNodeTestRunResult(raw, nodeId, pipelineId);
    }
  },

  async listNodeRuns(runtime, instanceId, workflowId, nodeId): Promise<NodeRunResult[]> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/runs`;
    const raw = await requestJson<{ runs?: Array<Record<string, unknown>> }>(url);
    return (raw.runs || []).map((item) => mapNodeRunResult(item, nodeId, String(item.node_run_id || item.pipeline_id || "")));
  },

  async createNodeRun(runtime, instanceId, workflowId, nodeId, input: NodeRunCreateInput): Promise<NodeRunResult> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/runs`;
    const raw = await postJsonResult<Record<string, unknown>>(url, {
      node_run_id: input.nodeRunId || "",
      mode: input.mode || "preflight",
      input_source: input.inputSource || "generated-fixture",
      pipeline_id: input.pipelineId || "",
      manual_inputs: input.manualInputs || {},
      overrides: input.overrides || {},
      capability_overrides: input.capabilityOverrides || {},
      retry_of: input.retryOf || "",
    });
    return mapNodeRunResult(raw, nodeId, String(raw.node_run_id || raw.pipeline_id || ""));
  },

  async getNodeRun(runtime, instanceId, workflowId, nodeId, nodeRunId): Promise<NodeRunResult> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/runs/${encodeURIComponent(nodeRunId)}`;
    const raw = await requestJson<Record<string, unknown>>(url);
    return mapNodeRunResult(raw, nodeId, nodeRunId);
  },

  async getNodeRunEvents(runtime, instanceId, workflowId, nodeId, nodeRunId): Promise<NodeRunEvent[]> {
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/workflows/${encodeURIComponent(workflowId)}/nodes/${encodeURIComponent(nodeId)}/runs/${encodeURIComponent(nodeRunId)}/events`;
    const raw = await requestJson<{ events?: Array<Record<string, unknown>> }>(url);
    return (raw.events || []).map(mapNodeRunEvent);
  },

  async listNodes(runtime, instanceId) {
    const raw = await requestJson<{ nodes?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/nodes`
    );
    return (raw.nodes || []).map(mapNodeRegistryItem);
  },

  async listNodeModules(runtime, instanceId, nodeId, pipelineId) {
    const prefix = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}`;
    const url = pipelineId
      ? `${prefix}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/modules`
      : `${prefix}/nodes/${encodeURIComponent(nodeId)}/modules`;
    const raw = await requestJson<{ modules?: Array<Record<string, unknown>> }>(url);
    return (raw.modules || []).map(mapNodeModule);
  },

  async getNodeModule(runtime, instanceId, nodeId, moduleId, pipelineId) {
    const prefix = `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}`;
    const url = pipelineId
      ? `${prefix}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/modules/${encodeURIComponent(moduleId)}`
      : `${prefix}/nodes/${encodeURIComponent(nodeId)}/modules/${encodeURIComponent(moduleId)}`;
    return mapNodeModuleDetail(await requestJson<Record<string, unknown>>(url));
  },

  async listNodeDrafts(runtime, instanceId) {
    const raw = await requestJson<{ drafts?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/node-drafts`
    );
    return (raw.drafts || []).map(mapNodeDraft);
  },

  async getNodeDraftSchema(runtime, instanceId) {
    return mapNodeDraftSchema(await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/node-drafts/schema`
    ));
  },

  async createNodeDraft(runtime, instanceId, input: NodeDraftInput) {
    const raw = await postJsonResult<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/node-drafts`,
      input
    );
    return mapNodeDraft(raw);
  },

  async getRuntimeInheritance(runtime, instanceId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/config/inheritance`
    );
    return mapRuntimeInheritancePreview(raw);
  },

  async getRuntimeManagementConfig(runtime, instanceId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/config/management`
    );
    return mapRuntimeInheritancePreview(raw);
  },

  async saveRuntimeManagementConfig(runtime, instanceId, input: RuntimeManagementConfigSaveInput) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/config/management`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: input.values }),
      }
    );
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
  },

  async initializeRuntimeManagementConfig(runtime, instanceId, input) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/config/management/init`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite: Boolean(input.overwrite) }),
      }
    );
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
  },

  async getSettingRegistry(runtime) {
    const endpoint = runtime?.endpoint || "";
    if (!endpoint) return { items: [] };
    const raw = await requestJson<Record<string, unknown>>(
      `${endpoint}/api/sop/settings/registry`
    );
    return mapCapabilityConfigPreview(raw);
  },

  async getCapabilityConfig(runtime, instanceId, nodeId) {
    const suffix = nodeId
      ? `/nodes/${encodeURIComponent(nodeId)}/config/resolved`
      : "/config/resolved";
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}${suffix}`
    );
    return mapCapabilityConfigPreview(raw);
  },

  async saveCapabilityConfig(runtime, instanceId, input: CapabilityConfigSaveInput) {
    const suffix = input.nodeId
      ? `/nodes/${encodeURIComponent(input.nodeId)}/config/values`
      : "/config/values";
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}${suffix}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: input.scope,
          values: input.values,
          node_id: input.nodeId || "",
        }),
      }
    );
    return mapCapabilityConfigPreview((raw.config as Record<string, unknown>) || raw);
  },

  async triggerRun(runtime, instanceId, input: TriggerInput): Promise<TriggerResult> {
    const payload = input.action || input.management_action
      ? { ...input, management_action: input.management_action || input.action }
      : { repo: input.repo, input: { url: input.url } };
    const data = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    return {
      status: String(data.status || "triggered"),
      pipelineId: data.pipeline_id ? String(data.pipeline_id) : undefined,
      message: data.message ? String(data.message) : undefined
    };
  },

  async retryNode(runtime, instanceId, pipelineId, nodeId) {
    await postJson(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/actions/retry`,
      { confirm: true }
    );
  },

  async cancelRun(runtime, instanceId, pipelineId, reason = "用户取消") {
    await postJson(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/cancel`,
      { reason }
    );
  },

  async cancelNode(runtime, instanceId, pipelineId, nodeId, reason = "用户取消节点") {
    await postJson(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/actions/cancel`,
      { reason }
    );
  },
};
