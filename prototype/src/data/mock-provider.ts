import { baseRuns, nodeLog, runtimes as mockRuntimes, stages, stageState } from "../mock";
import type { RunMock } from "../mock";
import type { Dag, Instance, Run, Runtime, SopDataProvider, TriggerInput } from "./types";

const runsByRuntime = new Map<string, RunMock[]>(mockRuntimes.map((runtime) => [runtime.id, baseRuns.map((run) => ({ ...run }))]));

function runtime(id: string): Runtime {
  const item = mockRuntimes.find((candidate) => candidate.id === id) || mockRuntimes[0];
  return {
    id: item.id,
    name: item.name,
    machine: item.machine,
    endpoint: item.endpoint,
    status: "active",
    localStatus: item.health
  };
}

function instance(runtimeId: string): Instance {
  const item = mockRuntimes.find((candidate) => candidate.id === runtimeId) || mockRuntimes[0];
  return {
    id: item.instanceId,
    instanceId: item.instanceId,
    sopType: "youtube-research-wiki",
    title: "YouTube Wiki SOP",
    version: "2.0",
    repo: item.repo
  };
}

function mapRun(run: RunMock): Run {
  return {
    pipelineId: run.pipelineId,
    status: run.status,
    sourceUrl: run.sourceUrl,
    sourceType: "youtube",
    repo: "",
    nodes: stageState(run.profile, run.status),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt
  };
}

function mockDag(runtimeId: string): Dag {
  const target = instance(runtimeId);
  return {
    instanceId: target.instanceId,
    nodes: stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      mode: stage.mode,
      summary: stage.summary,
      inputs: stage.inputs,
      outputs: stage.outputs,
      optionalInputs: {}
    })),
    edges: [
      { source: "youtube-fetch", target: "notebooklm-research" },
      { source: "youtube-fetch", target: "youtube-deep-research" },
      { source: "notebooklm-research", target: "wiki-build" },
      { source: "wiki-build", target: "tg-notify" }
    ]
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
      executor: { type: "agent-script", skill: `sop-${nodeId}` },
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
        preview: `# ${stage.title}\n\n这是 ${output} 的 mock Artifact 预览，用于验证节点实际产物交互。`
      })),
      validation: { status: "passed", missingOutputs: [], unexpectedOutputs: [] },
      updatedAt: run.updatedAt,
      error: run.nodes[nodeId] === "failed" ? "Mock NotebookLM bridge error" : ""
    };
  },
  async getNodeLog(target, instanceId, pipelineId, nodeId) {
    const detail = await this.getNode(target, instanceId, pipelineId, nodeId);
    return { pipelineId, nodeId, log: nodeLog(nodeId, detail.status === "skipped" ? "waiting" : detail.status) };
  },
  async triggerRun(target, _instanceId, input: TriggerInput) {
    const now = new Date();
    const pipelineId = `mock-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
    const run: RunMock = {
      pipelineId,
      status: "running",
      sourceUrl: input.url,
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
  }
};

function mutateRun(runtimeId: string, pipelineId: string, status: RunMock["status"], profile: RunMock["profile"]) {
  const items = runsByRuntime.get(runtimeId) || [];
  runsByRuntime.set(
    runtimeId,
    items.map((run) => (run.pipelineId === pipelineId ? { ...run, status, profile, updatedAt: new Date().toISOString() } : run))
  );
}

async function delay() {
  await new Promise((resolve) => window.setTimeout(resolve, 180));
}
