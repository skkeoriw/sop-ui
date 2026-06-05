import { baseRuns, nodeLog, runtimes as mockRuntimes, stages, stageState } from "../mock";
import type { RunMock } from "../mock";
import type {
  Dag,
  Instance,
  NodeConfig,
  NodeDraft,
  NodeDraftInput,
  NodeLog,
  NodeRegistryItem,
  Run,
  Runtime,
  SopDataProvider,
  TriggerInput
} from "./types";

const runsByRuntime = new Map<string, RunMock[]>(mockRuntimes.map((runtime) => [runtime.id, baseRuns.map((run) => ({ ...run }))]));
const draftByRuntime = new Map<string, NodeDraft[]>();

function runtime(id: string): Runtime {
  const item = mockRuntimes.find((candidate) => candidate.id === id) || mockRuntimes[0];
  return { id: item.id, name: item.name, machine: item.machine, endpoint: item.endpoint, status: "active", localStatus: item.health };
}

function instance(runtimeId: string): Instance {
  const item = mockRuntimes.find((candidate) => candidate.id === runtimeId) || mockRuntimes[0];
  return { id: item.instanceId, instanceId: item.instanceId, sopType: "youtube-research-wiki", title: "YouTube Wiki SOP", version: "2.0", repo: item.repo };
}

function mapRun(run: RunMock): Run {
  return { pipelineId: run.pipelineId, status: run.status, sourceUrl: run.sourceUrl, sourceType: "youtube", repo: "", nodes: stageState(run.profile, run.status), startedAt: run.startedAt, updatedAt: run.updatedAt };
}

function mockDag(runtimeId: string): Dag {
  const target = instance(runtimeId);
  return {
    instanceId: target.instanceId,
    nodes: stages.map((stage) => ({ id: stage.id, title: stage.title, mode: stage.mode, summary: stage.summary, inputs: stage.inputs, outputs: stage.outputs, optionalInputs: {} })),
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
      telegram: { enabled: cfg.infra?.tgNotify !== false, role: "node_notification" },
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
    editable: true,
    publishEnabled: false,
    missingFields: [],
  };
}

export const mockProvider: SopDataProvider = {
  mode: "mock",

  async listRuntimes() {
    await delay();
    return mockRuntimes.map((item) => runtime(item.id));
  },

  async listInstances(target) {
    await delay();
    return [instance(target.id)];
  },

  async getDag(target) {
    await delay();
    return mockDag(target.id);
  },

  async listRuns(target) {
    await delay();
    return (runsByRuntime.get(target.id) || []).map(mapRun);
  },

  async getRun(target, _instanceId, pipelineId) {
    await delay();
    const run = (runsByRuntime.get(target.id) || []).find((item) => item.pipelineId === pipelineId);
    if (!run) throw new Error(`Mock run 不存在：${pipelineId}`);
    return mapRun(run);
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

  async listNodes(target): Promise<NodeRegistryItem[]> {
    await delay();
    return stages.map((stage) => registryItem(stage.id, target));
  },

  async listNodeDrafts(target): Promise<NodeDraft[]> {
    await delay();
    return draftByRuntime.get(target.id) || [];
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

  async triggerRun(target, _instanceId, input: TriggerInput) {
    const now = new Date();
    const pipelineId = `mock-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
    const run: RunMock = { pipelineId, status: "running", sourceUrl: input.url, startedAt: now.toISOString(), updatedAt: now.toISOString(), profile: "initial" };
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
