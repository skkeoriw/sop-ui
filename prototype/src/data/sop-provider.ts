import { normalizeEndpoint } from "./provider";
import type {
  Dag,
  Instance,
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
  Run,
  RuntimeManagementConfigSaveInput,
  RuntimeInheritancePreview,
  Runtime,
  SopDataProvider,
  StageStatus,
  TriggerInput,
  TriggerResult
} from "./types";

const TUNNEL_API = "https://tunnel-api.chxyka.ccwu.cc";

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

export const sopProvider: SopDataProvider = {
  mode: "real",

  async listRuntimes() {
    const data = await requestJson<{ tunnels?: Array<Record<string, unknown>> }>(`${TUNNEL_API}/admin/tunnels?limit=200`);
    return (data.tunnels || [])
      .flatMap((tunnel): Runtime[] => {
        const metadata = parseMetadata(tunnel.metadata);
        if (metadata?.type !== "sop-runtime" || tunnel.status !== "active") return [];
        const endpoint = normalizeEndpoint(String(metadata.channel_url || metadata.endpoint_url || ""));
        if (!endpoint) return [];
        const name = String(metadata.channel_name || tunnel.subdomain || metadata.runtime_id || endpoint);
        return [{
          id: String(metadata.runtime_id || name),
          name,
          endpoint,
          machine: name.match(/\d+/)?.[0],
          status: String(tunnel.status || "unknown"),
          localStatus: String(tunnel.local_status || "unknown"),
          displayName: String(metadata.display_name || metadata.runtime_id || name),
          clientIp: String(tunnel.client_ip || metadata.client_ip || ""),
          localPort: String(tunnel.local_port || metadata.local_port || ""),
          channelName: String(metadata.channel_name || name),
          channelUrl: endpoint,
          spiBaseUrl: String(metadata.spi_base_url || `${endpoint}/api/sop`),
          supportedSopTypes: Array.isArray(metadata.supported_sop_types) ? metadata.supported_sop_types.map(String) : [],
        }];
      })
      .sort((a, b) => {
        const healthA = a.localStatus === "ok" ? 0 : 1;
        const healthB = b.localStatus === "ok" ? 0 : 1;
        if (healthA !== healthB) return healthA - healthB;
        return a.name.localeCompare(b.name);
      });
  },

  async listInstances(runtime) {
    const data = await requestJson<{ sops?: Array<Record<string, unknown>>; instances?: Array<Record<string, unknown>>; runtime?: Record<string, unknown>; runtime_info?: Record<string, unknown> }>(
      `${runtime.endpoint}/api/sop/instances`
    );
    const items = data.instances || data.sops || [];
    return items.map(mapInstance);
  },

  async getDag(runtime, instanceId) {
    const data = await requestJson<{
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    }>(`${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/dag`);
    return mapDag(data, instanceId);
  },

  async getRunDag(runtime, instanceId, pipelineId) {
    const data = await requestJson<{ nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/dag`
    );
    return mapDag(data, instanceId);
  },

  async listRuns(runtime, instanceId) {
    let data: { runs?: Array<Record<string, unknown>>; executions?: Array<Record<string, unknown>> };
    try {
      data = await requestJson<{ runs?: Array<Record<string, unknown>>; executions?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/instances/${encodeURIComponent(instanceId)}/executions`
      );
    } catch {
      data = await requestJson<{ runs?: Array<Record<string, unknown>> }>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs`
      );
    }
    return (data.executions || data.runs || []).map(mapRun);
  },

  async getRun(runtime, instanceId, pipelineId) {
    try {
      return mapRun(await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/instances/${encodeURIComponent(instanceId)}/executions/${encodeURIComponent(pipelineId)}`
      ));
    } catch {
      return mapRun(await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}`
      ));
    }
  },

  async getRunEvents(runtime, instanceId, pipelineId) {
    const raw = await requestJson<{ events?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/events`
    );
    return (raw.events || []).map(mapEvent);
  },

  async getRunArtifacts(runtime, instanceId, pipelineId) {
    const raw = await requestJson<Array<Record<string, unknown>> | { artifacts?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/artifacts`
    );
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
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}`
    );
    const infraRaw = raw.infra as Record<string, unknown> | undefined;
    return {
      pipelineId: String(raw.pipeline_id || pipelineId),
      nodeId: String(raw.node_id || nodeId),
      title: raw.title ? String(raw.title) : undefined,
      purpose: raw.purpose ? String(raw.purpose) : undefined,
      branch: raw.branch ? String(raw.branch) : undefined,
      retryable: raw.retryable === undefined ? undefined : Boolean(raw.retryable),
      manualFixHint: raw.manual_fix_hint ? String(raw.manual_fix_hint) : raw.manualFixHint ? String(raw.manualFixHint) : undefined,
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
          "Authorization": `Bearer ${input.token}`,
        },
        body: JSON.stringify({ values: input.values }),
      }
    );
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
  },

  async initializeRuntimeManagementConfig(runtime, instanceId, input) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (input.token) headers.Authorization = `Bearer ${input.token}`;
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/config/management/init`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ overwrite: Boolean(input.overwrite) }),
      }
    );
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
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
