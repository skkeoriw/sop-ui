import { baseRuns, nodeLog, runtimes as mockRuntimes, stages, stageState } from "../mock";
import type { RunMock } from "../mock";
import type {
  Dag,
  Artifact,
  Instance,
  InstanceList,
  NodeConfig,
  NodeContract,
  NodeTestInput,
  NodeTestResult,
  NodeTestRunResult,
  NodeDraft,
  NodeDraftInput,
  NodeDraftSchema,
  NodeLog,
  NodeModule,
  NodeModuleDetail,
  NodeRegistryItem,
  Run,
  RuntimeManagementConfigSaveInput,
  RuntimeInheritancePreview,
  Runtime,
  RuntimeList,
  RunList,
  SopDataProvider,
  TriggerInput
} from "./types";

const runsByRuntime = new Map<string, RunMock[]>(mockRuntimes.map((runtime) => [runtime.id, baseRuns.map((run) => ({ ...run }))]));
const draftByRuntime = new Map<string, NodeDraft[]>();

const mockNodeDraftSchema: NodeDraftSchema = {
  schemaId: "node-draft-schema/v1",
  title: "Node Draft from Skill",
  description: "把一个 Skill 安装命令转换成可验证的 SOP 节点草稿；不会修改生产 DAG。",
  fields: [
    { name: "skill_install_command", label: "Skill install command", type: "string", required: true, mapsTo: "skill.install_command" },
    { name: "skill_id", label: "Skill ID", type: "slug", required: true, mapsTo: "skill.id" },
    { name: "node_id", label: "Node ID", type: "slug", required: true, mapsTo: "id" },
    { name: "title", label: "Title", type: "string", required: true, mapsTo: "title" },
    { name: "description", label: "Description", type: "text", required: false, mapsTo: "description" },
    { name: "upstream", label: "Upstream node", type: "node_id", required: false, mapsTo: "needs[0]" },
    { name: "upstream_output", label: "Upstream output", type: "string", required: false, default: "output", mapsTo: "inputs.*.from" },
    { name: "input_name", label: "Input name", type: "slug", required: false, default: "input", mapsTo: "inputs" },
    { name: "output_name", label: "Output name", type: "slug", required: false, default: "artifact", mapsTo: "outputs" },
    { name: "output_path", label: "Output path", type: "path_pattern", required: false, default: "raw/{node_id}/{pipeline_id}/{output_name}", mapsTo: "outputs.*.path" },
  ],
  defaults: { executor_type: "agent-skill", agent: "hermes", mode: "blocking" },
  safety: {
    production_dag_changed: false,
    writes: ["raw/node-drafts/{draft_id}/node.yaml", "raw/node-drafts/{draft_id}/validation.json"],
    publish_enabled: false,
  },
};

const mockRuntimeInheritancePreview: RuntimeInheritancePreview = {
  instanceId: "runtime-management",
  envFile: "/home/runtime/.agent-brain-plugins.env",
  note: "Secret-like values are masked; field names, source and presence are always shown.",
  updatedAt: "2026-06-08T00:00:00Z",
  groups: {
    github: true,
    hermes: true,
    llm: true,
    notebooklm: true,
    telegram: true,
    cloudflare: true,
    tunnel: true,
    runtime: true,
  },
  items: [
    { key: "GITHUB_TOKEN", aliases: ["github_token", "repo_token"], source: "env_file", present: true, maskedValue: "ghp***qtP", secret: true, required: true, category: "github" },
    { key: "DEEPSEEK_API_KEY", aliases: ["deepseek_api_key"], source: "environment", present: true, maskedValue: "sk-***eek", secret: true, required: true, category: "hermes" },
    { key: "WIKI_LLM_PROVIDER", aliases: [], source: "env_file", present: true, maskedValue: "vertex", secret: false, required: false, category: "llm" },
    { key: "WIKI_VERTEX_MODEL", aliases: ["vertex_model"], source: "env_file", present: true, maskedValue: "gemini-1.5-pro", secret: false, required: false, category: "llm" },
    { key: "NOTEBOOKLM_BRIDGE_URL", aliases: ["notebooklm_bridge_url"], source: "env_file", present: true, maskedValue: "https://notebooklm-bridge.example/run", secret: false, required: true, category: "notebooklm" },
    { key: "NOTEBOOKLM_BRIDGE_TOKEN", aliases: ["notebooklm_bridge_token"], source: "env_file", present: true, maskedValue: "v7A***NG6", secret: true, required: true, category: "notebooklm" },
    { key: "YOUTUBE_WIKI_TG_TOKEN", aliases: ["telegram_token"], source: "env_file", present: true, maskedValue: "787***JDA", secret: true, required: false, category: "telegram" },
    { key: "CLOUDFLARE_API_KEY", aliases: ["cf_api_key"], source: "env_file", present: true, maskedValue: "cfk***be7", secret: true, required: true, category: "cloudflare" },
    { key: "SOP_UI_URL", aliases: ["sop_ui_url"], source: "missing", present: false, maskedValue: "", secret: false, required: false, category: "runtime" },
  ],
};
let mockRuntimeManagementConfig: RuntimeInheritancePreview = {
  ...mockRuntimeInheritancePreview,
  items: mockRuntimeInheritancePreview.items.map((item) => ({
    ...item,
    source: item.key === "SOP_UI_URL" ? "missing" : "management_config",
    present: item.key === "SOP_UI_URL" ? false : item.present,
  })),
};

function runtime(id: string): Runtime {
  const item = mockRuntimes.find((candidate) => candidate.id === id) || mockRuntimes[0];
  return { id: item.id, name: item.name, machine: item.machine, endpoint: item.endpoint, status: "active", localStatus: item.health };
}

function instance(runtimeId: string): Instance {
  const item = mockRuntimes.find((candidate) => candidate.id === runtimeId) || mockRuntimes[0];
  return { id: item.instanceId, instanceId: item.instanceId, sopType: "youtube-research-wiki", title: "YouTube Wiki SOP", version: "2.0", repo: item.repo };
}

function mapRun(run: RunMock): Run {
  const nodes = stageState(run.profile, run.status);
  const doneCount = Object.values(nodes).filter((state) => state === "done").length;
  const failedCount = Object.values(nodes).filter((state) => state === "failed").length;
  return {
    pipelineId: run.pipelineId, status: run.status, sourceUrl: run.sourceUrl, sourceType: "youtube", repo: "",
    nodes, startedAt: run.startedAt, updatedAt: run.updatedAt,
    nodeCount: Object.keys(nodes).length,
    doneCount,
    failedCount,
    runningNode: Object.entries(nodes).find(([, state]) => state === "running")?.[0] || "",
    progress: Math.round(doneCount * 100 / Object.keys(nodes).length),
    artifactCount: run.profile === "done" ? 8 : 3,
    gitEventCount: run.profile === "done" ? 4 : 2,
    telegramEventCount: run.profile === "done" ? 7 : 3,
    pageCount: run.profile === "done" ? 34 : run.profile === "wiki-running" ? 27 : 0,
    durationS: run.profile === "done" ? 333 : 103,
    nodeStates: Object.fromEntries(Object.entries(nodes).map(([nodeId, state], index) => [nodeId, {
      status: state,
      startedAt: state === "waiting" ? "" : `2026-06-05T15:${String(10 + index).padStart(2, "0")}:00Z`,
      finishedAt: state === "done" ? `2026-06-05T15:${String(11 + index).padStart(2, "0")}:15Z` : "",
      durationS: state === "done" ? 75 + index * 12 : state === "running" ? 42 : 0,
      attempt: state === "waiting" ? 0 : 1,
      progress: state === "done" ? 100 : state === "running" ? 72 : 0,
      artifactCount: state === "done" ? index + 1 : 0,
      error: state === "failed" ? "NotebookLM bridge timeout" : "",
    }])),
  };
}

function mockDag(runtimeId: string): Dag {
  const target = instance(runtimeId);
  return {
    instanceId: target.instanceId,
    nodes: stages.map((stage, index) => ({
      id: stage.id, title: stage.title, mode: stage.mode, summary: stage.summary, inputs: stage.inputs,
      outputs: stage.outputs, optionalInputs: {},
      needs: stage.id === "youtube-fetch" ? [] : stage.id === "wiki-build" ? ["notebooklm-research"] : stage.id === "tg-notify" ? ["wiki-build"] : ["youtube-fetch"],
      executor: { type: stage.id === "youtube-deep-research" || stage.id === "tg-notify" ? "direct-skill" : "agent-skill" },
      capabilities: { git: { enabled: true }, telegram: { enabled: stage.id !== "wiki-build" }, sse: { enabled: true } },
      ui: {
        category: stage.id === "youtube-fetch" ? "input" : stage.id.includes("research") ? "research" : stage.id === "wiki-build" ? "build" : "notify",
        icon: stage.id === "youtube-fetch" ? "youtube" : stage.id === "wiki-build" ? "network" : stage.id === "tg-notify" ? "send" : "search",
        stageLetter: stage.id === "youtube-fetch" ? "A" : stage.id === "notebooklm-research" ? "B" : stage.id === "youtube-deep-research" ? "B2" : stage.id === "wiki-build" ? "C" : "D",
        order: (index + 1) * 10,
      },
    })),
    edges: [
      { source: "youtube-fetch", target: "notebooklm-research" },
      { source: "youtube-fetch", target: "youtube-deep-research" },
      { source: "notebooklm-research", target: "wiki-build" },
      { source: "wiki-build", target: "tg-notify" }
    ]
  };
}

function nodeConfigFromStage(nodeId: string): NodeConfig {
  const stage = stages.find((item) => item.id === nodeId) || stages[0];
  return {
    nodeId,
    title: stage.title,
    mode: stage.mode,
    needs: nodeId === "notebooklm-research" ? ["youtube-fetch"] : nodeId === "wiki-build" ? ["notebooklm-research"] : nodeId === "tg-notify" ? ["wiki-build"] : [],
    executor: { type: "agent-skill", skill: `sop-${nodeId}`, webhook_route: `sop-${nodeId}`, hermes_agent: "youtube-wiki" },
    inputs: Object.fromEntries(Object.entries(stage.inputs).map(([k, v]) => [k, { from: v, required: true }])),
    outputs: Object.fromEntries(Object.entries(stage.outputs).map(([k, v]) => [k, { path: v, type: "files" }])),
    optionalInputs: {},
    infra: { tgNotify: true, logRecord: true },
    params: {},
    skillScript: `youtube-wiki/skills/sop-${nodeId}/scripts/run_${nodeId.replace(/-/g, "_")}.sh`,
    skillReadme: `# ${stage.title}\n\nMock skill README：描述该节点的 Skill 用途、输入格式和输出产物。`,
  };
}

function registryItem(nodeId: string, target: Runtime): NodeRegistryItem {
  const cfg = nodeConfigFromStage(nodeId);
  const dagNode = mockDag(target.id).nodes.find((node) => node.id === nodeId);
  return {
    ...cfg,
    description: String(stages.find((stage) => stage.id === nodeId)?.summary || ""),
    case: "agent-skill",
    skill: {
      id: String(cfg.executor?.skill || `sop-${nodeId}`),
      install_command: `bash <(curl -fsSL https://skill.vyibc.com/install-${nodeId}.sh)`,
      retry_cli: `bash <(curl -fsSL https://skill.vyibc.com/sop-node.sh) --endpoint=${target.endpoint} --instance=${instance(target.id).instanceId} --node=${nodeId} --action=retry --pipeline-id=<pipeline_id> --confirm`,
    },
    capabilities: {
      github: { enabled: true, role: "artifact_persistence" },
      telegram: { enabled: Boolean((dagNode?.capabilities?.telegram as Record<string, unknown> | undefined)?.enabled), role: "node_notification" },
      sse: { enabled: true, role: "runtime_events" },
      http_action: { enabled: true, role: "remote_node_operation" },
    },
    actions: {
      inspect: { method: "GET", path: `/api/sop/{instance}/nodes/${nodeId}`, destructive: false, enabled: true },
      status: { method: "GET", path: `/api/sop/{instance}/runs/{pipeline_id}/nodes/${nodeId}`, destructive: false, enabled: true },
      retry: { method: "POST", path: `/api/sop/{instance}/runs/{pipeline_id}/nodes/${nodeId}/actions/retry`, destructive: true, enabled: true },
      cancel: { method: "POST", path: `/api/sop/{instance}/runs/{pipeline_id}/nodes/${nodeId}/actions/cancel`, destructive: true, enabled: true },
      trigger: { method: "POST", path: `/api/sop/{instance}/nodes/${nodeId}/actions/trigger`, destructive: true, enabled: false },
    },
    cli: {
      inspect: `bash <(curl -fsSL https://skill.vyibc.com/sop-node.sh) --endpoint=${target.endpoint} --instance=${instance(target.id).instanceId} --node=${nodeId} --action=inspect`,
      actions: `bash <(curl -fsSL https://skill.vyibc.com/sop-node.sh) --endpoint=${target.endpoint} --instance=${instance(target.id).instanceId} --node=${nodeId} --action=actions`,
      retry_dry_run: `bash <(curl -fsSL https://skill.vyibc.com/sop-node.sh) --endpoint=${target.endpoint} --instance=${instance(target.id).instanceId} --node=${nodeId} --pipeline-id=<pipeline_id> --action=retry --dry-run`,
    },
    modules: mockNodeModules(nodeId),
    editable: true,
    publishEnabled: false,
    missingFields: [],
    ui: dagNode?.ui,
  };
}

function mockNodeModules(nodeId: string, runScoped = false): NodeModule[] {
  return [
    ["basic", "Basic", "definition", "节点身份、分类和发布状态", "node_id,title,mode,needs"],
    ["executor", "Executor", "execution", "执行器、Agent、Webhook 和操作入口", "executor.type,executor.skill,actions,cli"],
    ["skill", "Skill", "execution", "节点背后的 Skill 安装、说明和来源", "skill.id,skill.source,skill.install_command"],
    ["inputs", "Inputs", "contract", "输入契约和当前 Run 的 resolved inputs", "declared_inputs,optional_inputs,resolved_inputs"],
    ["outputs", "Outputs", "contract", "输出契约、实际输出和校验结果", "declared_outputs,actual_outputs,validation"],
    ["artifacts", "Artifacts", "artifact", "当前 Run 的记录产物和候选产物", "artifacts,discovered_candidates"],
    ["capabilities", "Capabilities", "capability", "Git、TG、SSE 和日志附属能力", "declared_capabilities,run_capabilities"],
    ["runtime", "Runtime State", "execution", "节点运行状态、进度、耗时和错误", "status,attempt,progress,duration_s,error"],
    ["actions", "Actions", "operation", "Inspect、Retry、Cancel、Validate 和 Publish", "actions,cli,publish_enabled"],
    ["logs", "Logs / Events", "observability", "节点日志、事件和错误线索", "log,events"],
  ].map(([id, title, lane, description, schema], index) => ({
    id,
    title,
    lane,
    order: (index + 1) * 10,
    description,
    status: id === "runtime" && runScoped ? "done" : "ready",
    summary: id === "skill" ? `sop-${nodeId}` : id === "executor" ? "agent-skill · hermes" : id === "artifacts" ? "2 recorded artifacts" : `${title} module`,
    schema: schema.split(","),
    metrics: { contract: "mock", runScoped },
    contractVersion: "node-module-contract/v1",
    detailUrl: runScoped ? `/runs/mock/nodes/${nodeId}/modules/${id}` : `/nodes/${nodeId}/modules/${id}`,
    runScoped,
  }));
}

function mockNodeModuleDetail(target: Runtime, pipelineId: string | undefined, nodeId: string, moduleId: string): NodeModuleDetail {
  const item = registryItem(nodeId, target);
  const module = mockNodeModules(nodeId, Boolean(pipelineId)).find((candidate) => candidate.id === moduleId) || mockNodeModules(nodeId)[0];
  const detailByModule: Record<string, Record<string, unknown>> = {
    basic: { node_id: item.nodeId, title: item.title, description: item.description, ui: item.ui, missing_fields: item.missingFields },
    executor: { executor: item.executor, actions: item.actions, cli: item.cli },
    skill: { skill: item.skill, skill_script: item.skillScript, skill_readme: item.skillReadme },
    inputs: { declared_inputs: item.inputs, optional_inputs: item.optionalInputs, resolved_inputs: { source_url: "https://youtube.example/watch?v=mock", reports: ["raw/mock/report.md"] } },
    outputs: { declared_outputs: item.outputs, actual_outputs: { pages: ["wiki/entities/Agent.md"], index: ["index.md"] }, validation: { status: "passed" } },
    artifacts: { artifacts: mockArtifacts(nodeId), discovered_candidates: [] },
    capabilities: { declared_capabilities: item.capabilities, run_capabilities: { git: { status: "done", commit: "mock123" }, telegram: { status: "sent" }, sse: { status: "live" } } },
    runtime: { status: "done", progress: 100, attempt: 1, duration_s: 96, error: "" },
    actions: { actions: item.actions, cli: item.cli, publish_enabled: false },
    logs: { log: nodeLog(nodeId, "done"), events: [{ ts: new Date().toISOString(), event: "node.completed", node_id: nodeId }] },
  };
  return {
    sopId: instance(target.id).instanceId,
    nodeId,
    pipelineId,
    module,
    detail: detailByModule[moduleId] || detailByModule.basic,
  };
}

function mockArtifacts(nodeId = "wiki-build"): Artifact[] {
  return [
    { id: `${nodeId}-report`, producer: nodeId, output: "report", type: "research.report", format: "markdown", path: `raw/pipeline-runs/mock/artifacts/${nodeId}-report.md`, title: `${nodeId} report.md`, size: 4096, mimeType: "text/markdown", tags: ["run-scoped"], resolution: "recorded", preview: "# 核心摘要\n当前 Run 的确认产物。" },
    { id: `${nodeId}-index`, producer: nodeId, output: "index", type: "wiki.page", format: "markdown", path: "index.md", title: "Knowledge Map", size: 8192, mimeType: "text/markdown", tags: ["wiki"], resolution: "recorded", preview: "# Knowledge Map\n- 34 pages\n- 8 clusters" },
  ];
}

export const mockProvider: SopDataProvider = {
  mode: "mock",

  async listRuntimeHosts(options): Promise<RuntimeList> {
    await delay();
    const query = (options?.q || "").trim().toLowerCase();
    const statusFilter = options?.status && options.status !== "all" ? options.status : "";
    const page = options?.page || 1;
    const pageSize = options?.pageSize || mockRuntimes.length;
    const filtered = mockRuntimes
      .map((item) => runtime(item.id))
      .filter((item) => {
        const matchedStatus = !statusFilter || item.status === statusFilter;
        const searchable = [item.id, item.name, item.displayName, item.endpoint, item.clientIp, item.localStatus, item.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return matchedStatus && (!query || searchable.includes(query));
      });
    const offset = (page - 1) * pageSize;
    const runtimes = filtered.slice(offset, offset + pageSize);
    return {
      runtimes,
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + runtimes.length < filtered.length,
      source: "mock",
    };
  },

  async listRuntimes(options) {
    return (await this.listRuntimeHosts!(options)).runtimes;
  },

  async listRuntimeInstances(target, options): Promise<InstanceList> {
    await delay();
    const query = (options?.q || "").trim().toLowerCase();
    const statusFilter = options?.status && options.status !== "all" ? options.status : "";
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 100;
    const filtered = [instance(target.id)].filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (!query) return true;
      return [item.instanceId, item.title, item.repo, item.sopType, item.status, item.workflowBinding?.workflowName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    const offset = (page - 1) * pageSize;
    const instances = filtered.slice(offset, offset + pageSize);
    return {
      instances,
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + instances.length < filtered.length,
      source: "mock",
    };
  },

  async listInstances(target, options) {
    return (await this.listRuntimeInstances!(target, options)).instances;
  },

  async getDag(target) {
    await delay();
    return mockDag(target.id);
  },

  async getRunDag(target) {
    await delay();
    return mockDag(target.id);
  },

  async listWorkflowRuns(target, _instanceId, options): Promise<RunList> {
    await delay();
    const query = (options?.q || "").trim().toLowerCase();
    const statusFilter = options?.status && options.status !== "all" ? options.status : "";
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 50;
    const filtered = (runsByRuntime.get(target.id) || [])
      .map(mapRun)
      .filter((run) => {
        if (statusFilter && run.status !== statusFilter) return false;
        if (!query) return true;
        return [run.pipelineId, run.sourceUrl, run.repo, run.status]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      });
    const offset = (page - 1) * pageSize;
    const runs = filtered.slice(offset, offset + pageSize);
    return {
      runs,
      total: filtered.length,
      page,
      pageSize,
      hasMore: offset + runs.length < filtered.length,
      source: "mock",
    };
  },

  async listRuns(target, instanceId, options) {
    return (await this.listWorkflowRuns!(target, instanceId, options)).runs;
  },

  async getRun(target, _instanceId, pipelineId) {
    await delay();
    const run = (runsByRuntime.get(target.id) || []).find((item) => item.pipelineId === pipelineId);
    if (!run) throw new Error(`Mock run 不存在：${pipelineId}`);
    return mapRun(run);
  },

  async getRunEvents(_target, _instanceId, pipelineId) {
    await delay();
    return [
      { sequence: 1, ts: "2026-06-05T15:12:01Z", event: "node.started", nodeId: "wiki-build", runId: pipelineId, data: { progress: 0 } },
      { sequence: 2, ts: "2026-06-05T15:12:18Z", event: "git.committed", nodeId: "wiki-build", runId: pipelineId, ok: true, data: { commit: "a19f35d" } },
      { sequence: 3, ts: "2026-06-05T15:13:02Z", event: "telegram.sent", nodeId: "wiki-build", runId: pipelineId, ok: true, data: { trigger: "done" } },
    ];
  },

  async getRunArtifacts() {
    await delay();
    return mockArtifacts();
  },

  async getRunArtifactCandidates() {
    await delay();
    return [{ ...mockArtifacts("legacy")[0], id: "legacy-candidate", path: "raw/shared/legacy-report.md", resolution: "pattern", ownership: "unconfirmed" }];
  },

  async getNode(target, _instanceId, pipelineId, nodeId) {
    await delay();
    const run = await this.getRun(target, "", pipelineId);
    const stage = stages.find((item) => item.id === nodeId) || stages[0];
    return {
      pipelineId,
      nodeId,
      runId: `mock-${nodeId}`,
      status: run.nodes[nodeId] || "waiting",
      mode: stage.mode,
      inputs: stage.inputs,
      outputs: stage.outputs,
      optionalInputs: {},
      executor: { type: "skill", skill: `sop-${nodeId}`, webhook_route: `sop-${nodeId}` },
      declaredInputs: Object.fromEntries(Object.entries(stage.inputs).map(([key, value]) => [key, { from: value, required: true }])),
      resolvedInputs: Object.fromEntries(Object.keys(stage.inputs).map((key) => [key, key === "source_url" ? run.sourceUrl : [`raw/mock/${key}.md`]])),
      declaredOutputs: Object.fromEntries(Object.entries(stage.outputs).map(([key, value]) => [key, { path: value, type: "files" }])),
      actualOutputs: Object.fromEntries(Object.keys(stage.outputs).map((key) => [key, [`raw/mock/${nodeId}-${key}.md`]])),
      artifacts: Object.keys(stage.outputs).map((output, index) => ({
        id: `mock-${nodeId}-${output}`,
        producer: nodeId,
        output,
        type: output.includes("image") ? "image" : "research.report",
        format: "markdown",
        path: `raw/mock/${nodeId}-${output}.md`,
        title: `${stage.title} ${output}`,
        size: 2048 + index * 321,
        mimeType: "text/markdown",
        tags: ["mock", "wiki-source"],
        resolution: "recorded",
        preview: `# ${stage.title}\n\n这是 ${output} 的 mock Artifact 预览。`
      })),
      validation: { status: "passed", missingOutputs: [], unexpectedOutputs: [] },
      infra: { tgNotify: true, logRecord: true },
      updatedAt: run.updatedAt,
      error: run.nodes[nodeId] === "failed" ? "Mock bridge error: connection timeout" : ""
    };
  },

  async getNodeLog(target, instanceId, pipelineId, nodeId): Promise<NodeLog> {
    const detail = await this.getNode(target, instanceId, pipelineId, nodeId);
    const st = detail.status === "skipped" ? "waiting" : detail.status;
    const now = new Date().toISOString();
    const events = st === "done" || st === "failed" ? [
      { ts: now, event: "stage_start", stage: nodeId, trigger: undefined, ok: undefined },
      { ts: now, event: "tg_notify_sent", stage: nodeId, trigger: "start", ok: true },
      { ts: now, event: st === "done" ? "stage_done" : "stage_failed", stage: nodeId, duration_s: 42 },
      { ts: now, event: "tg_notify_sent", stage: nodeId, trigger: st === "done" ? "done" : "failed", ok: true },
    ] : [];
    return { pipelineId, nodeId, log: nodeLog(nodeId, st), events };
  },

  async getNodeConfig(_target, _instanceId, nodeId): Promise<NodeConfig> {
    await delay();
    return nodeConfigFromStage(nodeId);
  },

  async getNodeContract(_target, _instanceId, nodeId): Promise<NodeContract | null> {
    await delay();
    return {
      nodeId,
      depClass: "independent",
      sideEffect: "read_only",
      testableStandalone: true,
      requestInputs: [],
      artifactDeps: [],
      statePreconditions: [],
    };
  },

  async triggerNodeTest(_target, _instanceId, nodeId, _input: NodeTestInput): Promise<NodeTestResult> {
    await delay();
    return {
      status: "triggered",
      mode: "node-test",
      nodeId,
      pipelineId: `nodetest-${nodeId}-MOCK`,
      namespace: "nodetest",
    };
  },

  async getNodeTestResult(_target, _instanceId, nodeId, pipelineId): Promise<NodeTestRunResult> {
    await delay();
    return {
      pipelineId,
      nodeId,
      status: "done",
      pending: false,
      detail: { ok: true, ssh_ok: true, disk_ok: true, stdout: "mock-host\nmock-user" },
    };
  },

  async listNodes(target): Promise<NodeRegistryItem[]> {
    await delay();
    return stages.map((stage) => registryItem(stage.id, target));
  },

  async listNodeModules(_target, _instanceId, nodeId, pipelineId): Promise<NodeModule[]> {
    await delay();
    return mockNodeModules(nodeId, Boolean(pipelineId));
  },

  async getNodeModule(target, _instanceId, nodeId, moduleId, pipelineId): Promise<NodeModuleDetail> {
    await delay();
    return mockNodeModuleDetail(target, pipelineId, nodeId, moduleId);
  },

  async listNodeDrafts(target): Promise<NodeDraft[]> {
    await delay();
    return draftByRuntime.get(target.id) || [];
  },

  async getNodeDraftSchema(): Promise<NodeDraftSchema> {
    await delay();
    return mockNodeDraftSchema;
  },

  async createNodeDraft(target, _instanceId, input: NodeDraftInput): Promise<NodeDraft> {
    await delay();
    const draftId = `${input.node_id || "node"}-${Date.now()}`;
    const draft: NodeDraft = {
      draftId,
      node: {
        id: input.node_id,
        title: input.title,
        description: input.description,
        needs: input.upstream ? [input.upstream] : [],
        executor: { type: "agent-skill", skill: input.skill_id, install_command: input.skill_install_command },
        inputs: { [input.input_name || "input"]: { from: `${input.upstream || "upstream"}.outputs.${input.upstream_output || "output"}` } },
        outputs: { [input.output_name || "output"]: { path: input.output_path || `raw/${input.node_id}/output.md` } },
      },
      validation: {
        status: "draft",
        production_dag_changed: false,
        publish_enabled: false,
        warnings: ["Mock draft only. 正式 DAG 未改变。"],
      },
    };
    draftByRuntime.set(target.id, [draft, ...(draftByRuntime.get(target.id) || [])]);
    return draft;
  },

  async getRuntimeInheritance(): Promise<RuntimeInheritancePreview> {
    await delay();
    return mockRuntimeInheritancePreview;
  },

  async getRuntimeManagementConfig(): Promise<RuntimeInheritancePreview> {
    await delay();
    return mockRuntimeManagementConfig;
  },

  async saveRuntimeManagementConfig(_target, _instanceId, input: RuntimeManagementConfigSaveInput): Promise<RuntimeInheritancePreview> {
    await delay();
    const savedKeys = new Set(Object.entries(input.values).filter(([, value]) => value.trim()).map(([key]) => key));
    mockRuntimeManagementConfig = {
      ...mockRuntimeManagementConfig,
      updatedAt: new Date().toISOString(),
      items: mockRuntimeManagementConfig.items.map((item) => savedKeys.has(item.key)
        ? { ...item, source: "management_config", present: true, maskedValue: item.secret ? "new***ved" : input.values[item.key], matchedKey: item.key }
        : item
      ),
    };
    return mockRuntimeManagementConfig;
  },

  async initializeRuntimeManagementConfig(): Promise<RuntimeInheritancePreview> {
    await delay();
    mockRuntimeManagementConfig = {
      ...mockRuntimeInheritancePreview,
      updatedAt: new Date().toISOString(),
      items: mockRuntimeInheritancePreview.items.map((item) => item.present
        ? { ...item, source: "management_config", matchedKey: item.key }
        : item
      ),
    };
    return mockRuntimeManagementConfig;
  },

  async triggerRun(target, _instanceId, input: TriggerInput) {
    const now = new Date();
    const pipelineId = `mock-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
    const run: RunMock = {
      pipelineId,
      status: "running",
      sourceUrl: input.url || input.target_host || input.runtime_id || input.action || "",
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      profile: "initial"
    };
    const items = runsByRuntime.get(target.id) || [];
    runsByRuntime.set(target.id, [run, ...items]);
    window.setTimeout(() => mutateRun(target.id, pipelineId, "running", "wiki-running"), 1600);
    window.setTimeout(() => mutateRun(target.id, pipelineId, "done", "done"), 3600);
    return { status: "triggered", pipelineId };
  },

  async retryNode(target, _instanceId, pipelineId) {
    mutateRun(target.id, pipelineId, "running", "wiki-running");
    window.setTimeout(() => mutateRun(target.id, pipelineId, "done", "done"), 1800);
  },

  async cancelRun(target, _instanceId, pipelineId) {
    mutateRun(target.id, pipelineId, "cancelled", "initial");
  },

  async cancelNode(_target, _instanceId, _pipelineId, _nodeId) {
    // mock: no-op
  },
};

function mutateRun(runtimeId: string, pipelineId: string, status: RunMock["status"], profile: RunMock["profile"]) {
  const items = runsByRuntime.get(runtimeId) || [];
  runsByRuntime.set(runtimeId, items.map((run) => (run.pipelineId === pipelineId ? { ...run, status, profile, updatedAt: new Date().toISOString() } : run)));
}

async function delay() {
  await new Promise((resolve) => window.setTimeout(resolve, 180));
}
