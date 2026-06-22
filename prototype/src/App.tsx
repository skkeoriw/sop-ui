import { FormEvent, ReactNode, memo, useEffect, useMemo, useState } from "react";
import { Background, Controls, Edge, Handle, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  Cloud,
  Copy,
  Edit3,
  Github,
  GitBranch,
  Info,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Network,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Workflow,
  X
} from "lucide-react";
import { getMode, getProvider, normalizeEndpoint, setMode as writeMode } from "./data/provider";
import { controlPlaneApiUrl, controlPlaneProvider } from "./data/control-plane-provider";
import { queryKeys } from "./data/query-keys";
import type {
  Artifact,
  Dag,
  DagNode,
  DataMode,
  Instance,
  NodeDraft,
  NodeDraftInput,
  NodeDraftSchema,
  NodeDetail,
  GitHubRepoOption,
  NodeConfig,
  NodeEvent,
  MachineConfig,
  MachineList,
  NodeLog,
  NodeModule,
  NodeModuleDetail,
  NodeRegistryItem,
  NodeContract,
  NodeRunCreateInput,
  NodeRunEvent,
  NodeRunRelayMapping,
  NodeRunMode,
  NodeRunRelayMode,
  NodeRunResult,
  NodeTestStep,
  NodeTestPlan,
  NodeTestPlanInputState,
  NodeTestRunResult,
  Run,
  RunNodeState,
  RuntimeInheritanceItem,
  RuntimeInheritancePreview,
  Runtime,
  CapabilityConfigPreview,
  SopDataProvider,
  StageStatus,
  WorkflowDefinition
} from "./data/types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";
type AppView = "runtime" | "instance" | "workflows" | "workflow" | "nodes" | "machines" | "settings";
type AppRoute = { view: AppView; nodeId: string; pipelineId: string; artifactId: string; moduleId: string; nodeRunId?: string; nodeRunList?: boolean };
type StreamStatus = "live" | "reconnecting" | "polling fallback" | "closed";
type RunOverlay = Partial<Omit<Run, "pipelineId" | "nodes" | "nodeStates">> & {
  pipelineId: string;
  nodes?: Record<string, StageStatus>;
  nodeStates?: Record<string, RunNodeState>;
};
type NodeDefinitionEditInput = {
  nodeId: string;
  title: string;
  description: string;
  mode: string;
  needs: string;
  executor: string;
  skill: string;
  entry: string;
  agent: string;
  webhookRoute: string;
  inputs: string;
  optionalInputs: string;
  outputs: string;
  capabilities: string;
};
type RuntimeProbeStatus = "ok" | "failed" | "unknown";
type RuntimeProbeResult = {
  id: string;
  label: string;
  target: string;
  status: RuntimeProbeStatus;
  latencyMs?: number;
  summary: string;
  checkedAt: string;
};

interface StageNodeData extends Record<string, unknown> {
  stage: DagNode;
  status: StageStatus;
  selected: boolean;
  onSelect: (id: string) => void;
  onInfo: (id: string) => void;
}

interface NodeRunStepNodeData extends Record<string, unknown> {
  step: NodeTestStep;
  index: number;
  selected: boolean;
  active: boolean;
}

const statusOrder: StageStatus[] = ["running", "waiting", "failed", "skipped", "done"];
const DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND = "";
const DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID = "";
const GLOBAL_TUNNEL_API_URL = "https://tunnel-api.chxyka.ccwu.cc";
const GLOBAL_TUNNEL_ADMIN_URL = "https://tunnel-admin-9vt.pages.dev";
const RUNTIME_HOST_ARCHITECTURE_DOC_URL = "https://pub-6c235832628e401093619867c6100e22.r2.dev/sop-runtime-host-architecture.html";
const DEFAULT_HERMES_SMOKE_ROUTE = "sop-runtime-hermes-smoke";
const RUNTIME_MANAGEMENT_FORM_STORAGE_KEY = "sop-ui.runtime-management.form.v1";
type RuntimeManagementAction = "create-runtime" | "delete-runtime" | "create-instance" | "delete-instance";
type RuntimeManagementConfigPreview = RuntimeInheritancePreview & {
  backend?: string;
  d1?: {
    enabled?: boolean;
    account_id?: string;
    database_id?: string;
    database_name?: string;
  };
};

type RuntimeManagementFormDefaults = {
  createSshCommand: string;
  createPrivateKey: string;
  createEnvText: string;
  deleteTargetRuntimeId: string;
  deleteRuntimeId: string;
  deleteSshCommand: string;
  deletePrivateKey: string;
  deleteForce: boolean;
  instanceId: string;
  instanceRepo: string;
  deleteInstanceId: string;
  deleteInstanceRepo: string;
  deleteInstanceForce: boolean;
};

function stringFromStorage(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function machineRuntimeId(machine: MachineConfig | undefined) {
  if (!machine?.host) return "";
  return `runtime-${machine.host.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function slugifyInstanceSeed(value: string) {
  return (value || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "workspace";
}

function generateInstanceId(repo: string) {
  const seed = repo.split("/").pop() || "workspace";
  const suffix = Math.random().toString(36).slice(2, 7) || "new";
  return `instance-${slugifyInstanceSeed(seed)}-${suffix || "new"}`;
}

function workflowIdForInstance(instance: Instance | undefined) {
  return instance?.workflowBinding?.workflowId || instance?.sopType || "workflow";
}

function runtimeHost(runtime: Runtime | undefined) {
  return runtime?.clientIp || runtime?.machine || runtime?.metadata?.client_ip || "";
}

function runtimeChannelUrl(runtime: Runtime | undefined) {
  return runtime?.channelUrl || runtime?.endpoint || "";
}

function runtimeSpiBaseUrl(runtime: Runtime | undefined) {
  return runtime?.spiBaseUrl || (runtime?.endpoint ? `${runtime.endpoint}/api/sop` : "");
}

function isRuntimeDeleteCandidate(target: Runtime, executor: Runtime | undefined) {
  const metadataType = target.metadata?.type;
  if (target.manual) return false;
  if (metadataType && metadataType !== "sop-runtime") return false;
  if (target.status !== "active" || target.localStatus !== "ok") return false;
  if (!executor) return true;
  if (target.id === executor.id) return false;
  if (normalizeEndpoint(target.endpoint) && normalizeEndpoint(target.endpoint) === normalizeEndpoint(executor.endpoint)) return false;
  return true;
}

function machineMatchesRuntime(machine: MachineConfig, target: Runtime | undefined) {
  const host = runtimeHost(target);
  if (!host) return false;
  return machine.host === host || machineRuntimeId(machine) === target?.id;
}

function readRuntimeManagementFormDefaults(): RuntimeManagementFormDefaults {
  const defaults = {
    createSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
    createPrivateKey: "",
    createEnvText: "",
    deleteTargetRuntimeId: "",
    deleteRuntimeId: DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID,
    deleteSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
    deletePrivateKey: "",
    deleteForce: false,
    instanceId: "",
    instanceRepo: "",
    deleteInstanceId: "wiki-sop-new-instance",
    deleteInstanceRepo: "skkeoriw/wiki-sop-new-instance",
    deleteInstanceForce: false,
  };
  try {
    const raw = window.localStorage.getItem(RUNTIME_MANAGEMENT_FORM_STORAGE_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<RuntimeManagementFormDefaults>;
    return {
      createSshCommand: stringFromStorage(stored.createSshCommand, defaults.createSshCommand),
      createPrivateKey: stringFromStorage(stored.createPrivateKey, defaults.createPrivateKey),
      createEnvText: stringFromStorage(stored.createEnvText, defaults.createEnvText),
      deleteTargetRuntimeId: stringFromStorage(stored.deleteTargetRuntimeId, defaults.deleteTargetRuntimeId),
      deleteRuntimeId: stringFromStorage(stored.deleteRuntimeId, defaults.deleteRuntimeId),
      deleteSshCommand: stringFromStorage(stored.deleteSshCommand, defaults.deleteSshCommand),
      deletePrivateKey: stringFromStorage(stored.deletePrivateKey, defaults.deletePrivateKey),
      deleteForce: Boolean(stored.deleteForce),
      instanceId: stringFromStorage(stored.instanceId, defaults.instanceId),
      instanceRepo: stringFromStorage(stored.instanceRepo, defaults.instanceRepo),
      deleteInstanceId: stringFromStorage(stored.deleteInstanceId, defaults.deleteInstanceId),
      deleteInstanceRepo: stringFromStorage(stored.deleteInstanceRepo, defaults.deleteInstanceRepo),
      deleteInstanceForce: Boolean(stored.deleteInstanceForce),
    };
  } catch {
    return defaults;
  }
}

function writeRuntimeManagementFormDefaults(value: RuntimeManagementFormDefaults) {
  try {
    window.localStorage.setItem(RUNTIME_MANAGEMENT_FORM_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in locked-down browsers; the form still works.
  }
}

function executionSortPriority(run: Run, selectedRunId: string) {
  if (run.status === "running") return 0;
  if (selectedRunId && run.pipelineId === selectedRunId) return 1;
  if (run.status === "waiting") return 2;
  return 3;
}

function ensureSelectedRunVisible(runs: Run[], selectedRun: Run | undefined) {
  if (!selectedRun || runs.some((run) => run.pipelineId === selectedRun.pipelineId)) return runs;
  return [selectedRun, ...runs];
}

function runtimeEnvTemplateFromPreview(preview: RuntimeInheritancePreview | undefined) {
  if (!preview?.items?.length) return "";
  return preview.items
    .filter((item) => item.required || item.present || ["cloudflare", "notebooklm", "llm", "hermes", "github", "telegram"].includes(item.category))
    .map((item) => {
      if (item.secret) {
        return `${item.key}= # ${item.present ? `inherited from ${item.source}; leave blank to use inherited value` : "missing; paste value only if you want this request override"}`;
      }
      return `${item.key}=${item.present ? item.maskedValue : ""}${item.present ? ` # inherited from ${item.source}` : " # missing"}`;
    })
    .join("\n");
}

function runtimeConfigItem(preview: RuntimeInheritancePreview | undefined, key: string) {
  return preview?.items?.find((item) => item.key === key);
}

function runtimeConfigValue(preview: RuntimeInheritancePreview | undefined, key: string) {
  const item = runtimeConfigItem(preview, key);
  if (!item?.present || item.secret) return "";
  return item.maskedValue || "";
}

function readRoute(): AppRoute {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const empty = { nodeId: "", pipelineId: "", artifactId: "", moduleId: "" };
  if (parts[0] === "runtimes") {
    if (parts[2] === "workflows") return { view: "workflows", ...empty };
    if (parts[2] === "instances" && parts[4] === "workflows") {
      const executionIndex = parts.indexOf("executions");
      const runsIndex = parts.indexOf("runs");
      const nodeIndex = parts.indexOf("nodes");
      const isNodeRoute = nodeIndex >= 0;
      const isNodeRunsRoute = isNodeRoute && parts[nodeIndex + 2] === "runs";
      return {
        view: isNodeRoute ? "nodes" : "workflow",
        ...empty,
        pipelineId: isNodeRoute ? "" : executionIndex >= 0 ? decodeURIComponent(parts[executionIndex + 1] || "") : runsIndex >= 0 ? decodeURIComponent(parts[runsIndex + 1] || "") : "",
        nodeId: isNodeRoute ? decodeURIComponent(parts[nodeIndex + 1] || "") : executionIndex >= 0 ? decodeURIComponent(parts[executionIndex + 2] || "") : runsIndex >= 0 ? decodeURIComponent(parts[runsIndex + 2] || "") : "",
        moduleId: nodeIndex >= 0 && parts[nodeIndex + 2] === "modules" ? decodeURIComponent(parts[nodeIndex + 3] || "") : "",
        nodeRunId: isNodeRunsRoute ? decodeURIComponent(parts[nodeIndex + 3] || "") : "",
        nodeRunList: isNodeRunsRoute,
      };
    }
    if (parts[2] === "instances" && parts[4] === "workflow") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[6] || ""), nodeId: decodeURIComponent(parts[7] || "") };
    if (parts[2] === "instances" && parts[4] === "executions") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[5] || ""), nodeId: decodeURIComponent(parts[7] || "") };
    if (parts[2] === "instances" && parts[4] === "nodes") return { view: "nodes", ...empty, nodeId: decodeURIComponent(parts[5] || ""), moduleId: parts[6] === "modules" ? decodeURIComponent(parts[7] || "") : "" };
    if (parts[2] === "instances" && parts[3]) return { view: "instance", ...empty };
    if (parts[2] === "instances") return { view: "instance", ...empty };
    return { view: "runtime", ...empty };
  }
  if (parts[0] === "instances") return { view: parts[2] === "workflow" ? "workflow" : "instance", ...empty, pipelineId: decodeURIComponent(parts[4] || ""), nodeId: decodeURIComponent(parts[5] || "") };
  if (parts[0] === "runs") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[1] || ""), nodeId: decodeURIComponent(parts[2] || "") };
  if (parts[0] === "workflows") return { view: "workflows", ...empty };
  if (parts[0] === "workflow") {
    const offset = parts[1] === "runs" ? 2 : 1;
    return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[offset] || ""), nodeId: decodeURIComponent(parts[offset + 1] || "") };
  }
  if (parts[0] === "nodes") {
    return {
      view: "nodes",
      ...empty,
      nodeId: decodeURIComponent(parts[1] || ""),
      moduleId: parts[2] === "modules" ? decodeURIComponent(parts[3] || "") : "",
      nodeRunId: parts[2] === "runs" ? decodeURIComponent(parts[3] || "") : "",
      nodeRunList: parts[2] === "runs",
    };
  }
  if (parts[0] === "artifacts") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[1] || ""), artifactId: decodeURIComponent(parts[2] || "") };
  if (parts[0] === "machines") return { view: "machines", ...empty };
  if (parts[0] === "settings") return { view: "settings", ...empty };
  return { view: "workflow", ...empty };
}

function routePath(view: AppView, entityId = "", secondaryId = "") {
  if (view === "runtime") return "/runtimes";
  if (view === "instance") return "/instances";
  if (view === "workflows") return "/workflows";
  if (view === "nodes") return entityId ? `/nodes/${encodeURIComponent(entityId)}${secondaryId ? `/modules/${encodeURIComponent(secondaryId)}` : ""}` : "/nodes";
  if (view === "workflow") return entityId ? `/workflow/runs/${encodeURIComponent(entityId)}${secondaryId ? `/${encodeURIComponent(secondaryId)}` : ""}` : "/workflow";
  if (view === "machines") return "/machines";
  if (view === "settings") return "/settings";
  return "/workflows";
}

function routeRuntimeId(runtime: Runtime | undefined, runtimeId: string) {
  return runtime?.id || runtimeId || "runtime";
}

function routeInstanceId(instance: Instance | undefined, instanceId: string) {
  return instance?.instanceId || instanceId || "instance";
}

function readRouteContext() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "runtimes") {
    return {
      runtimeId: decodeURIComponent(parts[1] || ""),
      instanceId: parts[2] === "instances" ? decodeURIComponent(parts[3] || "") : "",
      workflowId: parts[2] === "instances" && parts[4] === "workflows" ? decodeURIComponent(parts[5] || "") : "",
    };
  }
  return { runtimeId: "", instanceId: "", workflowId: "" };
}

function inspectorTabLabel(tab: InspectorTab) {
  if (tab === "config") return "Definition";
  if (tab === "run") return "Node Run";
  if (tab === "artifacts") return "Artifacts";
  return "Logs";
}

function shortId(value: string) {
  if (value.length <= 28) return value;
  return `${value.slice(0, 14)}...${value.slice(-8)}`;
}

function statusLabel(status: StageStatus) {
  if (status === "done") return "Done";
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "cancelled") return "Cancelled";
  return "Waiting";
}

function runProgressFromNodes(run: Run | undefined, dag?: Dag | undefined) {
  if (!run) return { percent: 0, done: 0, failed: 0, running: 0, total: dag?.nodes.length || 0, source: "none" };
  const nodeIds = new Set<string>([
    ...Object.keys(run.nodes || {}),
    ...(dag?.nodes || []).map((node) => node.id),
  ]);
  const total = Number(run.nodeCount || nodeIds.size || dag?.nodes.length || 0);
  const states = [...nodeIds].map((id) => run.nodes?.[id] || run.nodeStates?.[id]?.status).filter(Boolean) as StageStatus[];
  const done = Number(run.doneCount || states.filter((state) => state === "done").length);
  const failed = Number(run.failedCount || states.filter((state) => state === "failed").length);
  const running = states.filter((state) => state === "running").length;
  if (!total) {
    const backend = Number(run.progress || 0);
    return { percent: Number.isFinite(backend) ? backend : 0, done, failed, running, total: 0, source: "backend" };
  }
  const terminal = states.filter((state) => state === "done" || state === "failed" || state === "skipped" || state === "cancelled").length;
  const percent = run.status === "done" ? 100 : Math.round((terminal / total) * 100);
  return { percent, done, failed, running, total, source: "nodes" };
}

async function fetchProbe(
  id: string,
  label: string,
  target: string,
  options: RequestInit = {},
  summarize?: (data: unknown, response: Response) => string
): Promise<RuntimeProbeResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(target, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get("content-type") || "";
    let data: unknown = null;
    if (options.method !== "OPTIONS" && contentType.includes("application/json")) {
      data = await response.json();
    } else if (options.method !== "OPTIONS") {
      data = await response.text();
    }
    if (!response.ok) {
      return {
        id,
        label,
        target,
        status: "failed",
        latencyMs,
        summary: `HTTP ${response.status} ${response.statusText}`.trim(),
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      id,
      label,
      target,
      status: "ok",
      latencyMs,
      summary: summarize ? summarize(data, response) : `HTTP ${response.status}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      id,
      label,
      target,
      status: "failed",
      latencyMs: Math.round(performance.now() - startedAt),
      summary: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function summarizeSopIndex(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const runtime = record.runtime as Record<string, unknown> | undefined;
  const runtimeId = String(runtime?.runtime_id || record.runtime_id || "runtime");
  const sops = Array.isArray(record.sops) ? record.sops.length : Array.isArray(record.instances) ? record.instances.length : 0;
  return `${runtimeId} · ${sops} instances`;
}

function summarizeInstances(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const instances = Array.isArray(record.instances) ? record.instances : Array.isArray(record.sops) ? record.sops : [];
  return `${instances.length} registered instances`;
}

function summarizeDag(data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const nodes = Array.isArray(record.nodes) ? record.nodes.length : 0;
  const edges = Array.isArray(record.edges) ? record.edges.length : 0;
  return `${nodes} nodes · ${edges} edges`;
}

async function runRuntimeProbeChecks(runtime: Runtime, managementInstance: Instance | undefined) {
  const endpoint = normalizeEndpoint(runtime.endpoint);
  const spiBase = runtime.spiBaseUrl || `${endpoint}/api/sop`;
  const checks = [
    fetchProbe("spi-index", "SPI Index", spiBase, {}, summarizeSopIndex),
    fetchProbe("instance-registry", "Instance Registry", `${endpoint}/api/sop/instances`, {}, summarizeInstances),
    fetchProbe("cors-options", "CORS OPTIONS", spiBase, { method: "OPTIONS" }, (_data, response) => `HTTP ${response.status}`),
  ];
  if (managementInstance) {
    checks.push(fetchProbe(
      "management-dag",
      "Management DAG",
      `${endpoint}/api/sop/${encodeURIComponent(managementInstance.instanceId)}/dag`,
      {},
      summarizeDag
    ));
  }
  const results = await Promise.all(checks);
  if (!managementInstance) {
    results.push({
      id: "management-dag",
      label: "Management DAG",
      target: `${endpoint}/api/sop/runtime-management/dag`,
      status: "unknown",
      summary: "runtime-management instance missing",
      checkedAt: new Date().toISOString(),
    });
  }
  return results;
}

function encodeSecretB64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
}

function parseRuntimeEnvOverrides(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  value.split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith("#")) return;
    const separator = text.indexOf("=");
    if (separator <= 0) return;
    const key = text.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return;
    env[key] = text.slice(separator + 1).trim();
  });
  return env;
}

function compactStringRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => String(value || "").trim()).map(([key, value]) => [key, String(value).trim()]));
}

const CREATE_RUNTIME_IDENTITY_KEYS = new Set([
  "runtime_id",
  "channel_name",
  "channel_url",
  "spi_base_url",
  "endpoint_url",
  "webhook_public_host",
  "hermes_public_host",
  "hermes_webhook_url",
  "RUNTIME_TARGET_RUNTIME_ID",
  "RUNTIME_TARGET_CHANNEL_URL",
  "HERMES_WEBHOOK_URL",
  "WEBHOOK_PUBLIC_HOST",
]);

function withoutCreateRuntimeIdentity(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !CREATE_RUNTIME_IDENTITY_KEYS.has(key)));
}

function statusIcon(status: StageStatus) {
  if (status === "done") return <CheckCircle2 size={15} />;
  if (status === "running") return <Loader2 size={15} className="spin" />;
  if (status === "failed") return <AlertTriangle size={15} />;
  return <Clock size={15} />;
}

function streamStatusHint(status: "live" | "reconnecting" | "polling fallback" | "closed") {
  if (status === "live") return "SSE 实时更新";
  if (status === "reconnecting") return "正在恢复 SSE";
  if (status === "polling fallback") return "15 秒轮询降级";
  return "当前没有运行中的 Run";
}

function fallbackNodeModules(node: NodeRegistryItem | undefined, runScoped: boolean): NodeModule[] {
  if (!node) return [];
  const rows: Array<[string, string, string, string]> = [
    ["basic", "Basic", "节点身份、分类和发布状态", node.title || node.nodeId],
    ["executor", "Executor", "执行器、Agent、Webhook 和操作入口", String(node.executor?.type || node.case || "node")],
    ["skill", "Skill", "节点背后的 Skill 安装、说明和来源", String(node.skill?.id || node.executor?.skill || "skill")],
    ["inputs", "Inputs", "节点定义声明的输入契约；运行态解析只在 Node Run Detail 展示", `${Object.keys(node.inputs || {}).length} inputs`],
    ["outputs", "Outputs", "节点定义声明的输出契约；实际产物只在 Node Run Detail 展示", `${Object.keys(node.outputs || {}).length} outputs`],
    ["artifacts", "Artifacts", "运行记录和候选产物入口；具体文件在 Node Run Detail 展示", "run-scoped artifacts"],
    ["capabilities", "Capabilities", "Git、TG、SSE 和日志附属能力", "git / telegram / sse"],
    ["runtime", "Runtime State", "节点运行状态、进度、耗时和错误", runScoped ? "current run" : "waiting for run"],
    ["actions", "Actions", "Inspect、Retry、Cancel、Validate 和 Publish", "inspect / retry / cancel"],
    ["logs", "Logs / Events", "节点日志、事件和错误线索", "node events"],
  ];
  return rows.map(([id, title, description, summary]) => ({
    id,
    title,
    description,
    summary,
    status: (node.missingFields || []).length && ["basic", "executor", "outputs"].includes(id) ? "warning" : "ready",
    runScoped,
  }));
}

function depClassLabel(dep?: string): string {
  if (dep === "independent") return "独立 action";
  if (dep === "state_dependent") return "依赖目标机状态";
  if (dep === "artifact_dependent") return "依赖上游产物";
  return dep || "";
}

function NodeDepBadges({ contract }: { contract?: NodeContract | null }) {
  if (!contract) return null;
  return (
    <div className="node-test-badges">
      {contract.depClass ? (
        <span className={`pill dep-${contract.depClass}`}>{depClassLabel(contract.depClass)}</span>
      ) : null}
      {contract.sideEffect ? (
        <span className={`pill side-${contract.sideEffect}`}>
          {contract.sideEffect === "mutating" ? "会改目标机" : "只读"}
        </span>
      ) : null}
      {contract.testableStandalone ? <span className="pill ok">可独立测试</span> : null}
    </div>
  );
}

/** Self-contained node validation surface. Runtime-management nodes may still
 * have engine contracts, but business nodes use the generic preflight plan. */
function isSecretField(name: string): boolean {
  return /key|token|secret|password|private/i.test(name);
}

function planFromResult(result: NodeTestRunResult | null): NodeTestPlan | null {
  if (!result?.detail) return null;
  const detail = result.detail as Record<string, unknown>;
  if (!detail.node_id && !detail.nodeId) return null;
  return {
    sopId: detail.sop_id ? String(detail.sop_id) : undefined,
    workflowId: detail.workflow_id ? String(detail.workflow_id) : undefined,
    instanceId: detail.instance_id ? String(detail.instance_id) : undefined,
    nodeId: String(detail.node_id || detail.nodeId || ""),
    nodeTitle: detail.node_title ? String(detail.node_title) : undefined,
    mode: detail.mode ? String(detail.mode) : undefined,
    inputSource: detail.input_source as NodeTestPlan["inputSource"],
    baseRunId: detail.base_run_id ? String(detail.base_run_id) : undefined,
    requiredInputs: (detail.required_inputs as NodeTestPlanInputState[]) || [],
    optionalInputs: (detail.optional_inputs as NodeTestPlanInputState[]) || [],
    resolvedInputs: (detail.resolved_inputs as NodeTestPlanInputState[]) || [],
    pendingMaterializationInputs: (detail.pending_materialization_inputs as NodeTestPlanInputState[]) || [],
    missingInputs: (detail.missing_inputs as NodeTestPlanInputState[]) || [],
    upstreamNodes: (detail.upstream_nodes as Array<Record<string, unknown>>) || [],
    availableExistingRuns: (detail.available_existing_runs as Array<Record<string, unknown>>) || [],
    sideEffects: (detail.side_effects as Record<string, unknown>) || {},
    status: detail.status ? String(detail.status) : result.status,
  };
}

function renderInputRows(items: NodeTestPlanInputState[] | undefined, empty: string) {
  if (!items?.length) return <div className="node-test-pre muted">{empty}</div>;
  return (
    <div className="node-test-detail">
      {items.map((item) => (
        <span key={`${item.name}-${item.source || item.sourceNodeRunId || ""}`} className={`kv ${item.resolved ? "good" : item.resolutionState === "pending_materialization" ? "warn" : "bad"}`}>
          {item.name}: {item.resolved
            ? String(item.value ?? "").slice(0, 80)
            : item.resolutionState === "pending_materialization"
              ? `等待接力物化校验${item.sourceNodeRunId ? ` · ${item.sourceNodeRunId}` : ""}${item.sourceOutput ? ` · ${item.sourceOutput}` : ""}`
              : item.reason || "missing"}
        </span>
      ))}
    </div>
  );
}

function isNodeTestInputSource(value: string): value is NonNullable<NodeTestPlan["inputSource"]> {
  return ["existing-run", "existing-node-run", "generated-fixture", "manual", "deepseek-mock"].includes(value);
}

function readNodeTestRouteDefaults(runId?: string): { inputSource: NonNullable<NodeTestPlan["inputSource"]>; runId: string } {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const source = params.get("test_source") || "";
  const routeRunId = params.get("test_run") || "";
  if (isNodeTestInputSource(source)) return { inputSource: source, runId: routeRunId || runId || "" };
  if (runId) return { inputSource: "existing-run", runId };
  return { inputSource: "generated-fixture", runId: "" };
}

function readSearchParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) || "";
}

function writeSearchParam(name: string, value: string, mode: "push" | "replace" = "push") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  const search = url.searchParams.toString();
  const nextUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === nextUrl) return;
  if (mode === "replace") window.history.replaceState(null, "", nextUrl);
  else window.history.pushState(null, "", nextUrl);
}

function removeSearchParams(names: string[], mode: "push" | "replace" = "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  names.forEach((name) => {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  });
  if (!changed) return;
  const search = url.searchParams.toString();
  const nextUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
  if (mode === "replace") window.history.replaceState(null, "", nextUrl);
  else window.history.pushState(null, "", nextUrl);
}

function searchForNodeRunsPage() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  params.delete("step");
  const search = params.toString();
  return search ? `?${search}` : "";
}

function searchForNodeRunDetailPage() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams();
  const mode = readSearchParam("mode");
  if (mode) params.set("mode", mode);
  const search = params.toString();
  return search ? `?${search}` : "";
}

function nodeTestTone(status?: string) {
  if (status === "done") return "ok";
  if (status === "needs_input" || status === "skipped" || status === "waiting") return "warn";
  if (status === "failed" || status === "error") return "err";
  return "";
}

function NodeTestExecution({ result }: { result: NodeTestRunResult | null }) {
  if (!result) return null;
  const steps = result.steps || [];
  const events = result.events || [];
  const artifacts = result.artifacts || [];
  return (
    <div className="node-test-execution">
      <div className={`node-test-result ${nodeTestTone(result.status)}`}>
        <div>
          Preflight <code>{result.testId || result.pipelineId}</code> · <strong>{result.status || "unknown"}</strong>
        </div>
        {result.reason ? <div className="node-test-reason">原因：{result.reason}</div> : null}
      </div>
      <div className="node-test-pre">Test Execution Steps</div>
      {steps.length ? (
        <ol className="node-test-steps">
          {steps.map((step, index) => (
            <li key={step.id || index} className={`node-test-step ${nodeTestTone(step.status)}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title || step.id}</strong>
                <small>{step.id} · {step.status}</small>
                {step.summary ? <p>{step.summary}</p> : null}
                {step.detail && Object.keys(step.detail).length ? <code>{formatValue(step.detail)}</code> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : <div className="node-test-pre muted">该测试记录没有 step 明细。</div>}
      {events.length ? (
        <>
          <div className="node-test-pre">Events</div>
          <div className="node-test-events">
            {events.slice(0, 8).map((event, index) => (
              <div key={`${event.event}-${event.stepId || index}`} className="node-test-event">
                <span>{event.sequence || index + 1}</span>
                <strong>{event.event}</strong>
                <small>{event.stepId || formatBeijingTime(event.ts, "")}</small>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {artifacts.length ? (
        <>
          <div className="node-test-pre">Artifacts</div>
          <div className="node-test-artifacts">
            {artifacts.map((artifact) => (
              <code key={artifact.id || artifact.path}>{artifact.path || artifact.title}</code>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NodeTestPanel({ provider, runtime, instanceId, mode, nodeId, runs, runId }: {
  provider: SopDataProvider;
  runtime?: Runtime;
  instanceId: string;
  mode: DataMode;
  nodeId: string;
  runs: Run[];
  runId?: string;
}) {
  const queryClient = useQueryClient();
  const initialDefaults = readNodeTestRouteDefaults(runId);
  const [inputSource, setInputSource] = useState<NodeTestPlan["inputSource"]>(initialDefaults.inputSource);
  const [seedRunId, setSeedRunId] = useState(initialDefaults.runId);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [preflight, setPreflight] = useState<NodeTestRunResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const defaults = readNodeTestRouteDefaults(runId);
    setInputSource(defaults.inputSource);
    setSeedRunId(defaults.runId);
    setPreflight(null);
    setError("");
  }, [runId, instanceId, nodeId]);

  const contractQuery = useQuery({
    queryKey: queryKeys.nodeContract(mode, runtime, instanceId, nodeId),
    queryFn: () => provider.getNodeContract(runtime!, instanceId, nodeId),
    enabled: Boolean(runtime && instanceId && nodeId),
  });
  const contract = contractQuery.data;

  const planQuery = useQuery({
    queryKey: queryKeys.nodeTestPlan(mode, runtime, instanceId, nodeId),
    queryFn: () => provider.getNodeTestPlan(runtime!, instanceId, nodeId),
    enabled: Boolean(runtime && instanceId && nodeId),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.nodeTests(mode, runtime, instanceId, nodeId),
    queryFn: () => provider.listNodeTests(runtime!, instanceId, nodeId),
    enabled: Boolean(runtime && instanceId && nodeId),
  });

  const historyDetailMutation = useMutation({
    mutationFn: (testId: string) => provider.getNodeTestResult(runtime!, instanceId, nodeId, testId),
    onSuccess: (result) => {
      setPreflight(result);
      setError("");
    },
    onError: (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); },
  });

  const preflightMutation = useMutation({
    mutationFn: () => provider.runNodePreflight(runtime!, instanceId, nodeId, {
      inputSource: inputSource || "generated-fixture",
      pipelineId: inputSource === "existing-run" ? seedRunId : undefined,
      manualInputs,
    }),
    onSuccess: (r) => {
      setPreflight(r);
      setError("");
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeTests(mode, runtime, instanceId, nodeId) });
    },
    onError: (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); },
  });

  if (contractQuery.isLoading || planQuery.isLoading) return <div className="node-test-panel muted">加载节点验证计划…</div>;

  const resultPlan = planFromResult(preflight);
  const plan = resultPlan || planQuery.data;
  if (!plan) return <div className="node-test-panel muted">该节点暂未暴露验证计划。</div>;
  const missingCount = plan.missingInputs?.length || 0;
  const resolvedCount = plan.resolvedInputs?.length || 0;
  const pendingCount = plan.pendingMaterializationInputs?.length || 0;
  const availableRuns = plan.availableExistingRuns || [];
  const sideEffects = plan.sideEffects || {};
  const requiredInputs = plan.requiredInputs || [];

  return (
    <div className="node-test-panel">
      <NodeDepBadges contract={contract} />
      <div className="node-test-badges">
        <span className={`pill ${missingCount ? "dep-artifact_dependent" : "ok"}`}>
          {missingCount ? `${missingCount} missing input` : "preflight ready"}
        </span>
        <span className="pill">resolved {resolvedCount}</span>
        {pendingCount ? <span className="pill dep-artifact_dependent">pending relay {pendingCount}</span> : null}
        {sideEffects.external_api ? <span className="pill side-mutating">external API</span> : null}
        {sideEffects.telegram ? <span className="pill side-mutating">TG possible</span> : null}
        {sideEffects.real_execution_enabled === false ? <span className="pill side-read_only">dry-run only</span> : null}
      </div>
      {plan.upstreamNodes && plan.upstreamNodes.length ? (
        <div className="node-test-pre">
          上游依赖：{plan.upstreamNodes.map((item) => `${String(item.node_id || item.nodeId || "")}.${String(item.output || "")}`).join("、")}
        </div>
      ) : null}
      <div className="node-test-form">
        <label>Input Source
          <select value={inputSource || "generated-fixture"} onChange={(e) => setInputSource(e.target.value as NodeTestPlan["inputSource"])}>
            <option value="generated-fixture">Generated fixture</option>
            <option value="existing-run">Existing run</option>
            <option value="manual">Manual input</option>
            <option value="deepseek-mock">DeepSeek mock</option>
          </select>
        </label>
        {inputSource === "existing-run" ? (
          <label>Existing Run
            <select value={seedRunId} onChange={(e) => setSeedRunId(e.target.value)}>
              <option value="">选择可复用的历史 Run</option>
              {[...runs.map((r) => ({ pipeline_id: r.pipelineId, status: r.status })), ...availableRuns]
                .filter((run, index, all) => all.findIndex((item) => String(item.pipeline_id) === String(run.pipeline_id)) === index)
                .map((r) => (
                <option key={String(r.pipeline_id)} value={String(r.pipeline_id)}>
                  {String(r.pipeline_id)}{r.status ? ` · ${String(r.status)}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {inputSource === "manual" ? (
          requiredInputs.map((field) => (
            <label key={field.name}>{field.name}
              <input
                type={isSecretField(field.name) ? "password" : "text"}
                value={manualInputs[field.name] || ""}
                onChange={(e) => setManualInputs((prev) => ({ ...prev, [field.name]: e.target.value }))}
                placeholder={field.source || "手工输入测试值"}
                autoComplete="off"
              />
            </label>
          ))
        ) : null}
      </div>
      <button
        className="btn primary"
        disabled={preflightMutation.isPending || (inputSource === "existing-run" && !seedRunId)}
        onClick={() => preflightMutation.mutate()}
      >
        <Play size={14} /> Run Preflight
      </button>
      {inputSource === "existing-run" && !seedRunId ? <span className="node-test-hint">选择历史 Run 后再验证上游输出。</span> : null}
      <div className="node-test-pre">Required Inputs</div>
      {renderInputRows(plan.requiredInputs, "该节点没有声明必需输入。")}
      {plan.pendingMaterializationInputs?.length ? (
        <>
          <div className="node-test-pre">Relay Candidates</div>
          {renderInputRows(plan.pendingMaterializationInputs, "没有等待物化的接力候选。")}
        </>
      ) : null}
      {plan.optionalInputs?.length ? (
        <>
          <div className="node-test-pre">Optional Inputs</div>
          {renderInputRows(plan.optionalInputs, "没有 optional input。")}
        </>
      ) : null}
      {preflight ? (
        <NodeTestExecution result={preflight} />
      ) : null}
      <div className="node-test-pre">Test History</div>
      <div className="node-test-history">
        {(historyQuery.data || []).map((item) => (
          <button
            key={item.testId || item.pipelineId}
            type="button"
            className={preflight?.testId === item.testId ? "active" : ""}
            disabled={historyDetailMutation.isPending}
            onClick={() => historyDetailMutation.mutate(item.testId || item.pipelineId || "")}
          >
            <span className={`status-pill ${nodeTestTone(item.status)}`}>{item.status || "unknown"}</span>
            <strong>{item.testId || item.pipelineId}</strong>
            <small>{formatBeijingTime(item.startedAt || item.finishedAt, "")}</small>
          </button>
        ))}
        {!historyQuery.isLoading && !(historyQuery.data || []).length ? <div className="node-test-pre muted">还没有测试记录。</div> : null}
        {historyQuery.isLoading ? <div className="node-test-pre muted">加载测试历史…</div> : null}
      </div>
      {error ? <div className="node-test-result err">{error}</div> : null}
    </div>
  );
}

function nodeRunTone(status?: string) {
  if (status === "done" || status === "ready") return "done";
  if (status === "running" || status === "pending") return "running";
  if (status === "waiting" || status === "warning" || status === "needs_input" || status === "skipped" || status === "blocked") return "waiting";
  if (status === "failed" || status === "error") return "failed";
  return "";
}

function nodeRunCardTone(status?: string) {
  if (status === "done" || status === "ready") return "ok";
  if (status === "running" || status === "pending") return "running";
  if (status === "failed" || status === "error") return "err";
  if (status === "warning" || status === "needs_input" || status === "skipped" || status === "blocked" || status === "waiting") return "warn";
  return "";
}

function issueTone(severity?: string) {
  if (severity === "error") return "failed";
  if (severity === "warning") return "warning";
  return severity || "warning";
}

function formatElapsed(ms?: number) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatBeijingTime(value?: string | number | Date, fallback = "-") {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const NODE_RUN_MODE_LABELS: Record<string, string> = {
  preflight: "节点检查",
  probe: "能力探测",
  "dry-run": "试运行计划",
  "real-node": "真实执行",
};

const DEFAULT_NODE_RUN_MODE: NodeRunMode = "real-node";
const DEFAULT_NODE_RUN_INPUT_SOURCE: NonNullable<NodeRunCreateInput["inputSource"]> = "generated-fixture";
const DEFAULT_NODE_RUN_SOURCE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const NODE_RUN_INPUT_SOURCE_LABELS: Record<string, string> = {
  "generated-fixture": "默认示例输入",
  "existing-run": "历史 Workflow Run",
  "existing-node-run": "上游 Node Run",
  manual: "手动输入",
  "deepseek-mock": "DeepSeek 模拟输入",
  artifact: "指定 Artifact",
};

const NODE_RUN_OUTER_STEP_COPY: Record<string, { title: string; summary?: string }> = {
  "create-run": { title: "创建 Node Run 工作区", summary: "为本次节点执行分配独立运行记录。" },
  "load-definition": { title: "加载节点定义", summary: "读取当前 Workflow 中的节点契约、执行器和声明输入输出。" },
  "resolve-context": { title: "解析执行环境", summary: "确认 Runtime、Instance、Workflow 和 Node 的执行上下文。" },
  "resolve-inputs": { title: "解析节点输入", summary: "从历史 Run、系统测试输入或手动输入中准备本次节点入参。" },
  "resolve-config": { title: "解析运行配置", summary: "加载 Runtime 与 Instance 配置，检查 GitHub、TG、Worker 等依赖。" },
  "generate-agent-request": { title: "生成 Agent Request", summary: "渲染本次交给 Hermes skill 的 request.md，并保存执行器元数据。" },
  "probe-capabilities": { title: "探测附属能力", summary: "检查节点可能用到的外部能力是否可用。" },
  "build-execution-plan": { title: "生成执行计划", summary: "根据模式和输入生成节点级执行计划。" },
  "execute-or-dry-run": { title: "执行节点逻辑", summary: "真实执行节点，或生成试运行计划。" },
  "validate-outputs": { title: "校验节点输出", summary: "检查声明输出和实际产物是否匹配。" },
};

const NODE_RUN_LIFECYCLE_STEP_COPY: Record<string, { title: string; summary?: string }> = {
  pre: { title: "执行前", summary: "解析上下文、输入和运行配置，并进入 stage_runner on_start。" },
  doing: { title: "执行中", summary: "执行节点 Skill / agent 业务逻辑。" },
  post: { title: "执行后", summary: "记录结果、校验输出，并按 capability 配置处理 GitHub / Telegram。" },
};

function nodeRunModeLabel(value?: string) {
  return value ? NODE_RUN_MODE_LABELS[value] || value : "-";
}

function nodeRunInputSourceLabel(value?: string) {
  return value ? NODE_RUN_INPUT_SOURCE_LABELS[value] || value : "-";
}

function nodeInputSourceExpression(spec: unknown) {
  if (spec && typeof spec === "object" && "from" in spec) return String((spec as Record<string, unknown>).from || "");
  return String(spec || "");
}

function nodeDefinitionOrder(node: NodeRegistryItem) {
  return typeof node.ui?.order === "number" ? node.ui.order : Number.MAX_SAFE_INTEGER;
}

function nodeInputReferencesNode(spec: unknown, nodeId: string) {
  const source = nodeInputSourceExpression(spec);
  if (!source || !nodeId) return false;
  return source === nodeId || source.startsWith(`${nodeId}.`) || source.includes(`${nodeId}.outputs.`);
}

type NodeRelayTarget = {
  node: NodeRegistryItem;
  recommended: boolean;
  reason: string;
};

type NodeRelayOptions = {
  relayMode?: NodeRunRelayMode | string;
  selectedOutputs?: string[];
  relayMappings?: NodeRunRelayMapping[];
};

function nodeRelayReason(node: NodeRegistryItem, currentNodeId: string) {
  if ((node.needs || []).includes(currentNodeId)) return "来自 workflow 依赖关系";
  const inputSpecs = [
    ...Object.values(node.inputs || {}),
    ...Object.values(node.optionalInputs || {}),
  ];
  if (inputSpecs.some((spec) => nodeInputReferencesNode(spec, currentNodeId))) return "输入引用了当前节点输出";
  return "";
}

function buildRelayTargetNodes(nodes: NodeRegistryItem[], currentNodeId: string): NodeRelayTarget[] {
  if (!currentNodeId) return [];
  return nodes
    .filter((item) => item.nodeId !== currentNodeId)
    .map((item) => {
      const reason = nodeRelayReason(item, currentNodeId);
      return { node: item, recommended: Boolean(reason), reason: reason || "手动选择接力目标" };
    })
    .sort((left, right) => {
      if (left.recommended !== right.recommended) return left.recommended ? -1 : 1;
      return nodeDefinitionOrder(left.node) - nodeDefinitionOrder(right.node);
    });
}

function generatedNodeRunFixtureValue(inputName: string, sourceExpression = "") {
  const name = inputName.toLowerCase();
  const source = sourceExpression.toLowerCase();
  if (name === "source_url" || name === "url" || source.endsWith(".source_url")) return DEFAULT_NODE_RUN_SOURCE_URL;
  if (name === "metadata_file" || source.endsWith(".metadata_file")) return "raw/youtube-metadata/node-test-fixture.json";
  if (name === "reports" || source.endsWith(".reports")) return "raw/notebooklm-analysis/node-test-fixture.md";
  if (name === "deep_research" || name === "analysis_file" || source.endsWith(".analysis_file")) return "raw/youtube-deep-research/node-test-fixture/analysis.md";
  if (name === "index" || source.endsWith(".index")) return "index.md";
  return "";
}

function nodeRunInputSourceHelp(inputSource?: string) {
  if (inputSource === "existing-run") return "从选中的历史 Workflow Run 读取 context 和上游节点 outputs。";
  if (inputSource === "existing-node-run") return "从上游 Node Run 的接力包中选择输出，并物化为本次输入目录。";
  if (inputSource === "manual") return "使用下方手动填写的字段，适合复现单个节点的问题。";
  if (inputSource === "deepseek-mock") return "请求运行时生成模拟输入；当前没有模型模拟时会回退到默认示例。";
  return "按节点输入契约生成固定示例值，适合快速真实执行单个节点。";
}

function nodeRunRelayModeLabel(mode?: string) {
  if (mode === "selected_outputs") return "手动选择输出";
  if (mode === "all_outputs") return "传递整个输出包";
  return "按目标输入自动匹配";
}

function nodeRunRelayModeHelp(mode?: string) {
  if (mode === "selected_outputs") return "只传递勾选的上游输出。适合下游只需要 source_url、analysis_file 等单个输出。";
  if (mode === "all_outputs") return "传递上游所有 relayable outputs。适合下游自己遍历整个输出包。";
  return "默认模式。根据目标节点 inputs 和当前 workflow 默认绑定自动选择匹配输出。";
}

function contractRecord(spec: unknown): Record<string, unknown> {
  return spec && typeof spec === "object" ? spec as Record<string, unknown> : {};
}

function nodeInputContractRows(node: NodeRegistryItem | undefined) {
  return [
    ...Object.entries(node?.inputs || {}).map(([name, spec]) => ({ name, spec, required: true })),
    ...Object.entries(node?.optionalInputs || {}).map(([name, spec]) => ({ name, spec, required: false })),
  ];
}

function contractResolvers(spec: unknown): Array<{ id: string; label: string }> {
  const record = contractRecord(spec);
  const raw = Array.isArray(record.resolvers) ? record.resolvers : record.resolvers && typeof record.resolvers === "object" ? [record.resolvers] : [];
  return raw.map((item) => {
    if (typeof item === "string") return { id: item, label: item };
    const row = contractRecord(item);
    const id = String(row.id || row.name || row.kind || row.type || "").trim();
    const label = String(row.label || row.title || row.path || row.pattern || id).trim();
    return id ? { id, label } : null;
  }).filter(Boolean) as Array<{ id: string; label: string }>;
}

function defaultTargetInputForOutput(targetNode: NodeRegistryItem | undefined, sourceOutput: string) {
  const rows = nodeInputContractRows(targetNode);
  if (!rows.length) return "";
  const exact = rows.find((row) => row.name === sourceOutput);
  if (exact) return exact.name;
  const required = rows.filter((row) => row.required);
  if (required.length === 1) return required[0].name;
  return rows[0].name;
}

function normalizeRelayMappingsForTarget(
  targetNode: NodeRegistryItem | undefined,
  sourceOutputs: string[],
  current: NodeRunRelayMapping[] = [],
) {
  const bySource = new Map(current.map((item) => [item.sourceOutput, item]));
  const targetInputs = new Set(nodeInputContractRows(targetNode).map((row) => row.name));
  return sourceOutputs.filter(Boolean).map((sourceOutput) => {
    const existing = bySource.get(sourceOutput);
    const targetInput = existing?.targetInput && targetInputs.has(existing.targetInput)
      ? existing.targetInput
      : defaultTargetInputForOutput(targetNode, sourceOutput);
    const targetSpec = nodeInputContractRows(targetNode).find((row) => row.name === targetInput)?.spec;
    const resolvers = contractResolvers(targetSpec);
    return {
      sourceOutput,
      targetInput,
      resolver: existing?.resolver || resolvers[0]?.id || "",
    };
  });
}

function encodeRelayMappings(mappings: NodeRunRelayMapping[] = []) {
  const rows = mappings
    .filter((item) => item.sourceOutput)
    .map((item) => ({
      sourceOutput: item.sourceOutput,
      targetInput: item.targetInput || "",
      resolver: item.resolver || "",
    }));
  return rows.length ? JSON.stringify(rows) : "";
}

function decodeRelayMappings(value: string | null): NodeRunRelayMapping[] {
  if (!value) return [];
  try {
    const rows = JSON.parse(value);
    if (!Array.isArray(rows)) return [];
    return rows.map((item) => ({
      sourceOutput: String(item.sourceOutput || item.source_output || "").trim(),
      targetInput: String(item.targetInput || item.target_input || "").trim(),
      resolver: String(item.resolver || "").trim(),
    })).filter((item) => item.sourceOutput);
  } catch {
    return [];
  }
}

function nodeOutputContractRows(node: NodeRegistryItem | undefined, fallback?: NodeRunResult) {
  const outputEntries = Object.entries(node?.outputs || {});
  if (outputEntries.length) {
    return outputEntries.map(([name, spec]) => ({
      name,
      spec,
      type: outputContractType(spec),
      path: outputContractPath(spec),
      relayable: true,
    }));
  }
  return (fallback?.relayPackage?.items || []).map((item) => ({
    name: item.output || item.relativePath || item.path,
    spec: item.valueType || "file",
    type: item.valueType || "file",
    path: item.relativePath || item.path,
    relayable: true,
  })).filter((item) => item.name);
}

function outputContractPath(spec: unknown) {
  if (typeof spec === "string") return spec;
  if (spec && typeof spec === "object") {
    const record = spec as Record<string, unknown>;
    return String(record.path || record.from || record.value || "");
  }
  return "";
}

function outputContractType(spec: unknown) {
  if (spec && typeof spec === "object") {
    const record = spec as Record<string, unknown>;
    if (record.kind) return String(record.kind);
    if (record.shape) return String(record.shape);
    if (record.type) return String(record.type);
  }
  const path = outputContractPath(spec);
  if (!path || path.startsWith("context.")) return "text";
  if (path.includes("*")) return "file_set";
  return "file";
}

function nodeRunInputPreviewRows(
  node: NodeRegistryItem | undefined,
  inputSource: NodeRunCreateInput["inputSource"] | undefined,
  seedRunId: string,
  sourceNodeRunId: string,
  manualInputs: Record<string, string>,
  relayMode: string = "auto_by_target_inputs",
  selectedOutputs: string[] = [],
  relayMappings: NodeRunRelayMapping[] = [],
) {
  const inputs = Object.entries(node?.inputs || {});
  if (!inputs.length) {
    return [{
      key: "no-inputs",
      name: "declared_inputs",
      value: "该节点没有声明必需输入",
      source: "-",
      logic: "运行时只解析 Runtime / Instance / Workflow 上下文。",
      missing: false,
    }];
  }
  return inputs.map(([name, spec]) => {
    const source = nodeInputSourceExpression(spec);
    if (inputSource === "existing-run") {
      return {
        key: name,
        name,
        value: seedRunId || "未选择 Workflow Run",
        source,
        logic: seedRunId ? `从 ${seedRunId} 的 ${source || "上下文"} 解析。` : "需要先选择一个历史 Workflow Run。",
        missing: !seedRunId,
      };
    }
    if (inputSource === "existing-node-run") {
      const mappingText = relayMappings.length
        ? relayMappings.map((item) => `${item.sourceOutput} -> ${item.targetInput || "?"}${item.resolver ? ` · ${item.resolver}` : ""}`).join("; ")
        : selectedOutputs.join(", ");
      return {
        key: name,
        name,
        value: sourceNodeRunId || "未指定上游 Node Run",
        source,
        logic: sourceNodeRunId
          ? `${nodeRunRelayModeLabel(relayMode)}${mappingText ? `：${mappingText}` : ""}`
          : "需要指定一个已完成的上游 Node Run。",
        missing: !sourceNodeRunId,
      };
    }
    if (inputSource === "manual") {
      const value = manualInputs[name] || "";
      return {
        key: name,
        name,
        value: value ? (isSecretField(name) ? "已填写，已隐藏" : value) : "未填写",
        source,
        logic: "使用本次页面手动输入值，不修改 Instance 或 Settings。",
        missing: !value,
      };
    }
    const fixture = generatedNodeRunFixtureValue(name, source);
    return {
      key: name,
      name,
      value: fixture || "运行时按契约生成",
      source,
      logic: inputSource === "deepseek-mock"
        ? "优先使用模拟输入；未启用模型生成时使用固定示例值。"
        : `匹配 ${name}${source ? ` / ${source}` : ""} 的固定示例规则。`,
      missing: false,
    };
  });
}

function nodeActionSteps(nodeId?: string, actions?: string[]) {
  const declared = (actions || []).filter(Boolean);
  void nodeId;
  return declared;
}

function localizedNodeRunStep(step: NodeTestStep, nodeId?: string): NodeTestStep {
  void nodeId;
  const copy = NODE_RUN_LIFECYCLE_STEP_COPY[step.id] || NODE_RUN_OUTER_STEP_COPY[step.id];
  if (!copy) return step;
  return {
    ...step,
    title: copy.title,
    summary: step.summary && step.summary !== step.title ? step.summary : copy.summary,
  };
}

function nodeRunTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function makeNodeRunId(nodeId: string) {
  const suffix = Math.random().toString(16).slice(2, 8);
  return `node-run-${nodeId}-${nodeRunTimestamp()}-${suffix}`;
}

function nodeRunStepTiming(step: { startedAt?: string; finishedAt?: string; elapsedMs?: number }) {
  const parts = [];
  if (step.startedAt) parts.push(`开始 ${formatBeijingTime(step.startedAt)}`);
  if (step.finishedAt) parts.push(`结束 ${formatBeijingTime(step.finishedAt)}`);
  if (typeof step.elapsedMs === "number") parts.push(formatElapsed(step.elapsedMs));
  return parts.join(" · ");
}

function currentNodeRunStep(result?: { steps?: NodeTestStep[] }) {
  const steps = result?.steps || [];
  return steps.find((step) => step.status === "running")
    || steps.find((step) => ["failed", "blocked", "needs_input"].includes(step.status))
    || steps.find((step) => step.status === "waiting")
    || steps[steps.length - 1];
}

function nodeRunIsLive(result?: NodeRunResult) {
  return Boolean(result?.pending || result?.status === "running" || (result?.steps || []).some((step) => step.status === "running"));
}

function makeOptimisticNodeRun(params: {
  runtimeId: string;
  instanceId: string;
  workflowId: string;
  nodeId: string;
  nodeTitle?: string;
  nodeRunId: string;
  mode: NodeRunMode;
  inputSource?: NodeRunCreateInput["inputSource"];
  retryOf?: string;
}): NodeRunResult {
  const startedAt = new Date().toISOString();
  return {
    nodeRunId: params.nodeRunId,
    pipelineId: params.nodeRunId,
    runtimeId: params.runtimeId,
    instanceId: params.instanceId,
    workflowId: params.workflowId,
    nodeId: params.nodeId,
    nodeTitle: params.nodeTitle,
    status: "running",
    mode: params.mode,
    inputSource: params.inputSource || "generated-fixture",
    pending: true,
    startedAt,
    retryOf: params.retryOf,
    steps: [
      { id: "create-run", title: NODE_RUN_OUTER_STEP_COPY["create-run"].title, status: "running", summary: NODE_RUN_OUTER_STEP_COPY["create-run"].summary, startedAt },
      { id: "load-definition", title: NODE_RUN_OUTER_STEP_COPY["load-definition"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["load-definition"].summary },
      { id: "resolve-context", title: NODE_RUN_OUTER_STEP_COPY["resolve-context"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["resolve-context"].summary },
      { id: "resolve-inputs", title: NODE_RUN_OUTER_STEP_COPY["resolve-inputs"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["resolve-inputs"].summary },
      { id: "resolve-config", title: NODE_RUN_OUTER_STEP_COPY["resolve-config"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["resolve-config"].summary },
      { id: "generate-agent-request", title: NODE_RUN_OUTER_STEP_COPY["generate-agent-request"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["generate-agent-request"].summary },
      { id: "probe-capabilities", title: NODE_RUN_OUTER_STEP_COPY["probe-capabilities"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["probe-capabilities"].summary },
      { id: "build-execution-plan", title: NODE_RUN_OUTER_STEP_COPY["build-execution-plan"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["build-execution-plan"].summary },
      { id: "execute-or-dry-run", title: NODE_RUN_OUTER_STEP_COPY["execute-or-dry-run"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["execute-or-dry-run"].summary },
      { id: "validate-outputs", title: NODE_RUN_OUTER_STEP_COPY["validate-outputs"].title, status: "waiting", summary: NODE_RUN_OUTER_STEP_COPY["validate-outputs"].summary },
    ],
    events: [{ sequence: 1, event: "node_run.step.running", nodeRunId: params.nodeRunId, nodeId: params.nodeId, stepId: "create-run", ts: startedAt, data: { summary: NODE_RUN_OUTER_STEP_COPY["create-run"].summary } }],
    artifacts: [],
    detail: {
      side_effects: { writes_workspace: true, git_write: true, telegram: true, external_api: true, llm: false, executed: false },
      fix_suggestions: [],
    },
  };
}

function detailList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function detailRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nodeRunBusinessArtifacts(result?: NodeRunResult): Artifact[] {
  const business = result?.businessArtifacts || [];
  if (business.length) return business;
  const coreArtifacts = (result?.coreOutputs || []).flatMap((output) => output.artifacts || []);
  if (coreArtifacts.length) return coreArtifacts;
  const actualPaths = new Set(nodeRunActualOutputPaths(result).filter((path) => !path.includes("://")));
  return (result?.artifacts || []).filter((artifact) => actualPaths.has(artifact.path));
}

function nodeRunDiagnosticArtifacts(result?: NodeRunResult): Artifact[] {
  const businessIds = new Set(nodeRunBusinessArtifacts(result).map((artifact) => artifact.id || artifact.path));
  const evidence = result?.executionEvidence?.artifacts || [];
  if (evidence.length) return evidence.filter((artifact) => !businessIds.has(artifact.id || artifact.path));
  return (result?.artifacts || []).filter((artifact) => !businessIds.has(artifact.id || artifact.path));
}

function nodeCapabilityRecord(node: NodeRegistryItem | undefined, capability: string): Record<string, unknown> {
  const caps = detailRecord(node?.capabilities);
  return detailRecord(caps[capability]);
}

function nodeCapabilityPaths(node: NodeRegistryItem | undefined): string[] {
  const git = nodeCapabilityRecord(node, "git");
  const raw = Array.isArray(git.paths) ? git.paths : Array.isArray(git.managed_paths) ? git.managed_paths : [];
  return raw.map(String).filter(Boolean);
}

function nodeRunCapabilityOverridePayload(params: {
  gitEnabled: boolean;
  gitPathsText: string;
  gitSaveScope: string;
  telegramEnabled: boolean;
  telegramSaveScope: string;
}) {
  return {
    git: {
      enabled: params.gitEnabled,
      save_scope: params.gitSaveScope,
      managed_by: "runtime-harness",
      paths: params.gitPathsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    },
    telegram: {
      enabled: params.telegramEnabled,
      save_scope: params.telegramSaveScope,
      managed_by: "runtime-harness",
    },
  };
}

const CONFIG_SOURCE_LABELS: Record<string, string> = {
  "node-run-overrides": "本次运行",
  "instance-settings": "Instance",
  "runtime-settings": "Runtime",
  "global-settings": "Settings",
  "runtime-env-file": "环境文件",
  "bridge-env": "进程环境",
  "definition-default": "定义默认值",
  missing: "未配置",
  instance: "Instance",
  runtime: "Runtime",
  global: "Settings",
  runtime_env_file: "环境文件",
  bridge_env: "进程环境",
};

function configSourceLabel(source: string) {
  return CONFIG_SOURCE_LABELS[source] || source.replace(/_/g, " ");
}

const SETTING_GROUP_WORKFLOW_TAGS: Record<string, string[]> = {
  cloudflare: ["runtime-management"],
  github: ["runtime-management", "youtube-research-wiki"],
  "hermes-auth": ["runtime-management", "node-run"],
  "telegram-defaults": ["youtube-research-wiki"],
  "runtime-defaults": ["runtime-management"],
  "instance-defaults": ["runtime-management", "youtube-research-wiki"],
  notebooklm: ["youtube-research-wiki"],
  "youtube-workers": ["youtube-research-wiki"],
  "llm-vertex": ["youtube-research-wiki"],
  "settings-backend": ["runtime-management"],
  "core-repos": ["runtime-management"],
  "infra-repos": ["runtime-management"],
  "machine-defaults": ["runtime-management"],
  other: ["runtime-management", "youtube-research-wiki"],
};

const SETTING_CONFIG_GROUPS = [
  {
    id: "cloudflare",
    title: "Cloudflare",
    subtitle: "全局 DNS / tunnel 路由认证",
    keys: [
      { key: "CLOUDFLARE_EMAIL", label: "Cloudflare Email", placeholder: "name@example.com" },
      { key: "CLOUDFLARE_API_KEY", label: "Global API Key", placeholder: "已保存时会显示 masked；填写则覆盖" },
      { key: "TUNNEL_API", label: "Tunnel API", placeholder: "" },
    ],
  },
  {
    id: "github",
    title: "GitHub",
    subtitle: "全局代码访问凭据和 owner 级 token",
    keys: [
      { key: "GITHUB_TOKEN", label: "Default GitHub Token", placeholder: "默认 GitHub token" },
      { key: "GITHUB_CHANGFENGHU_TOKEN", label: "ChangfengHU Token", placeholder: "用于 ChangfengHU 下的基础设施仓库" },
      { key: "GITHUB_SKKEORIW_TOKEN", label: "skkeoriw Token", placeholder: "用于 skkeoriw 下的 runtime brain 仓库" },
    ],
  },
  {
    id: "hermes-auth",
    title: "Hermes Auth",
    subtitle: "Hermes CLI / gateway 默认 OpenAI-compatible 模型配置",
    keys: [
      { key: "HERMES_MODEL_PROVIDER", label: "Provider", placeholder: "openai" },
      { key: "HERMES_MODEL", label: "Default Model", placeholder: "deepseek-v4-flash 或 deepseek-v4-pro" },
      { key: "HERMES_MODEL_BASE_URL", label: "Base URL", placeholder: "https://api-proxy.chxyka.ccwu.cc/v1" },
      { key: "HERMES_OPENAI_API_KEY", label: "OpenAI-compatible API Key", placeholder: "Bearer token，不要带 Bearer 前缀" },
    ],
  },
  {
    id: "telegram-defaults",
    title: "Telegram Defaults",
    subtitle: "作为 create-instance 的默认 TG 通知配置，可被 Instance 覆盖",
    keys: [
      { key: "YOUTUBE_WIKI_TG_TOKEN", label: "Default TG Bot Token", placeholder: "create-instance 默认 Telegram bot token" },
      { key: "YOUTUBE_WIKI_TG_CHAT_ID", label: "Default TG Chat ID", placeholder: "create-instance 默认 Telegram chat id" },
    ],
  },
  {
    id: "runtime-defaults",
    title: "Runtime Defaults",
    subtitle: "create-runtime / runtime-management 初始化默认值",
    keys: [
      { key: "BRIDGE_PORT", label: "Bridge Port", placeholder: "18121" },
      { key: "HERMES_WEBHOOK_PORT", label: "Hermes Webhook Port", placeholder: "8644" },
      { key: "WEBHOOK_PUBLIC_HOST", label: "Webhook Public Host", placeholder: "runtime 初始化后写入" },
    ],
  },
  {
    id: "instance-defaults",
    title: "Instance Defaults",
    subtitle: "create-instance 默认仓库、模型和业务配置",
    keys: [
      { key: "WIKI_GITHUB_REPO", label: "Default Wiki Repo", placeholder: "skkeoriw/runtime-management" },
    ],
  },
  {
    id: "notebooklm",
    title: "NotebookLM",
    subtitle: "NotebookLM Bridge 研究节点配置",
    keys: [
      { key: "NOTEBOOKLM_BRIDGE_URL", label: "Bridge URL", placeholder: "https://notebooklm-bridge..." },
      { key: "NOTEBOOKLM_BRIDGE_TOKEN", label: "Bridge Token", placeholder: "NotebookLM Bridge token" },
      { key: "NOTEBOOKLM_CLIENT_ID", label: "Client ID", placeholder: "NotebookLM client id" },
    ],
  },
  {
    id: "youtube-workers",
    title: "YouTube Workers",
    subtitle: "YouTube 内容解析与深度研究 Worker 配置",
    keys: [
      { key: "YOUTUBE_CONTENT_API_URL", label: "Content API URL", placeholder: "https://youtube-content-parse..." },
      { key: "YOUTUBE_CONTENT_API_TOKEN", label: "Content API Token", placeholder: "Content API token" },
      { key: "YOUTUBE_RESEARCH_WORKFLOW_URL", label: "Research Worker URL", placeholder: "https://youtube-research-workflow..." },
      { key: "YOUTUBE_RESEARCH_WORKFLOW_TOKEN", label: "Research Worker Token", placeholder: "Research Worker token" },
    ],
  },
  {
    id: "llm-vertex",
    title: "LLM / Vertex",
    subtitle: "Wiki 构建和模型调用相关配置",
    keys: [
      { key: "WIKI_LLM_PROVIDER", label: "Wiki LLM Provider", placeholder: "vertex" },
      { key: "GOOGLE_CLOUD_API_KEY", label: "Google Cloud API Key", placeholder: "Google/Gemini API key" },
      { key: "GEMINI_API_KEY", label: "Gemini API Key", placeholder: "Gemini API key" },
      { key: "WIKI_GEMINI_MODEL", label: "Gemini Model", placeholder: "gemini-..." },
      { key: "GOOGLE_PROJECT_ID", label: "Google Project ID", placeholder: "project id" },
      { key: "VERTEX_LOCATION", label: "Vertex Location", placeholder: "us-central1" },
      { key: "WIKI_VERTEX_MODEL", label: "Vertex Model", placeholder: "gemini-1.5-pro" },
    ],
  },
  {
    id: "settings-backend",
    title: "Settings Backend",
    subtitle: "Control Plane / D1 配置存储连接",
    keys: [
      { key: "RUNTIME_SETTINGS_BACKEND", label: "Backend", placeholder: "d1" },
      { key: "RUNTIME_SETTINGS_CLOUDFLARE_EMAIL", label: "Cloudflare Email", placeholder: "settings backend email" },
      { key: "RUNTIME_SETTINGS_CLOUDFLARE_API_KEY", label: "Cloudflare API Key", placeholder: "settings backend global key" },
      { key: "RUNTIME_SETTINGS_CLOUDFLARE_API_TOKEN", label: "Cloudflare API Token", placeholder: "settings backend token" },
      { key: "RUNTIME_SETTINGS_CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare Account ID", placeholder: "account id" },
      { key: "RUNTIME_SETTINGS_D1_DATABASE_ID", label: "D1 Database ID", placeholder: "database id" },
      { key: "RUNTIME_SETTINGS_D1_DATABASE_NAME", label: "D1 Database Name", placeholder: "runtime-settings-db" },
    ],
  },
  {
    id: "core-repos",
    title: "Core Repositories",
    subtitle: "创建 runtime 时需要继承的核心源码地址",
    keys: [
      { key: "AGENT_REPO", label: "Brain Repo", placeholder: "https://github.com/skkeoriw/agent-brain-plugins" },
      { key: "SKILL_REPO", label: "Runtime Skill Repo", placeholder: "https://github.com/skkeoriw/auto-youtube-wiki-skill" },
    ],
  },
  {
    id: "infra-repos",
    title: "Tunnel / Skill Infrastructure",
    subtitle: "非核心但必须可追踪的发布与隧道基础设施",
    keys: [
      { key: "AUTO_DOMAIN_REPO", label: "Auto Domain CLI", placeholder: "https://github.com/ChangfengHU/auto-domain-cli" },
      { key: "AUTO_DOMAIN_TUNNEL_REPO", label: "Auto Domain Tunnel", placeholder: "https://github.com/ChangfengHU/cloudflare-youtube-pipeline/tree/main/auto-domain-tunnel" },
      { key: "SKILL_PUBLISHER_REPO", label: "Skill Publisher", placeholder: "https://github.com/ChangfengHU/skill-publisher" },
    ],
  },
  {
    id: "machine-defaults",
    title: "Machine Defaults",
    subtitle: "SOP UI 和当前控制面状态",
    keys: [
      { key: "SOP_UI_URL", label: "SOP UI URL", placeholder: "" },
    ],
  },
];

function settingGroupIcon(id: string) {
  if (id === "cloudflare") return <Cloud size={18} />;
  if (id === "github") return <Github size={18} />;
  if (id === "hermes-auth") return <Bot size={18} />;
  if (id === "telegram-defaults") return <Send size={18} />;
  if (id === "runtime-defaults") return <Server size={18} />;
  if (id === "instance-defaults") return <LayoutDashboard size={18} />;
  if (id === "notebooklm") return <Network size={18} />;
  if (id === "youtube-workers") return <Workflow size={18} />;
  if (id === "llm-vertex") return <Bot size={18} />;
  if (id === "settings-backend") return <Settings size={18} />;
  if (id === "core-repos") return <GitBranch size={18} />;
  if (id === "infra-repos") return <PackageSearch size={18} />;
  if (id === "machine-defaults") return <ShieldCheck size={18} />;
  return <SlidersHorizontal size={18} />;
}

function settingWorkflowTags(id: string) {
  return SETTING_GROUP_WORKFLOW_TAGS[id] || [];
}

function capabilityConfigQueryKey(mode: DataMode, runtime: Runtime | undefined, instanceId: string, nodeId = "") {
  return ["capability-config", mode, runtime?.id || runtime?.endpoint || "", instanceId, nodeId];
}

const INSTANCE_OVERRIDE_CONFIG_KEYS = [
  { key: "GITHUB_TOKEN", label: "GitHub Token", group: "GitHub" },
  { key: "YOUTUBE_WIKI_TG_TOKEN", label: "Telegram Bot Token", group: "Telegram" },
  { key: "YOUTUBE_WIKI_TG_CHAT_ID", label: "Telegram Chat ID", group: "Telegram" },
];

function compactNonEmptyValues(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
}

function InheritedSettingsPanel({
  provider,
  runtime,
  instance,
  mode,
  nodeId,
  title = "Inherited Settings",
  description = "当前上下文只读取 Settings 默认值和下游覆盖结果；这里不修改 Settings。",
  compact = false,
  layered = false,
  allowInstanceOverrides = false,
  onOpenSettings,
  onOpenInstance,
}: {
  provider: SopDataProvider;
  runtime?: Runtime;
  instance?: Instance;
  mode: DataMode;
  nodeId?: string;
  title?: string;
  description?: string;
  compact?: boolean;
  layered?: boolean;
  allowInstanceOverrides?: boolean;
  onOpenSettings?: () => void;
  onOpenInstance?: () => void;
}) {
  const queryClient = useQueryClient();
  const [instanceOverrideEdits, setInstanceOverrideEdits] = useState<Record<string, string>>({});
  const instanceId = instance?.instanceId || "";
  const query = useQuery({
    queryKey: ["inherited-settings", ...capabilityConfigQueryKey(mode, runtime, instanceId, nodeId || "")],
    queryFn: () => provider.getCapabilityConfig(runtime!, instanceId, nodeId),
    enabled: Boolean(runtime && instanceId),
    retry: 1,
  });
  const settingsDefaultsQuery = useQuery({
    queryKey: ["inherited-settings-defaults", mode],
    queryFn: () => controlPlaneProvider.getSettings(),
    enabled: Boolean(runtime && instanceId),
    retry: 1,
  });
  const config = query.data;
  const saveInstanceOverridesMutation = useMutation({
    mutationFn: () => provider.saveCapabilityConfig(runtime!, instanceId, {
      scope: "instance",
      values: compactNonEmptyValues(instanceOverrideEdits),
    }),
    onSuccess: (saved) => {
      setInstanceOverrideEdits({});
      queryClient.setQueryData(capabilityConfigQueryKey(mode, runtime, instanceId, nodeId || ""), saved);
      queryClient.invalidateQueries({ queryKey: capabilityConfigQueryKey(mode, runtime, instanceId, nodeId || "") });
      queryClient.invalidateQueries({ queryKey: ["inherited-settings"] });
    },
  });
  const byKey = useMemo(() => {
    const items = new Map<string, CapabilityConfigPreview["items"][number]>();
    (config?.items || []).forEach((item) => {
      items.set(item.key, item);
      (item.aliases || []).forEach((alias) => items.set(alias, item));
    });
    return items;
  }, [config]);
  const settingsDefaultsByKey = useMemo(() => {
    const items = new Map<string, RuntimeInheritancePreview["items"][number]>();
    (settingsDefaultsQuery.data?.items || []).forEach((item) => {
      items.set(item.key, item);
      (item.aliases || []).forEach((alias) => items.set(alias, item));
    });
    return items;
  }, [settingsDefaultsQuery.data]);
  const displayItemForKey = (key: string) => {
    const resolved = byKey.get(key);
    const inherited = settingsDefaultsByKey.get(key);
    const present = Boolean(resolved?.present || inherited?.present);
    return {
      label: resolved?.label || key.replace(/_/g, " "),
      present,
      required: Boolean(resolved?.required || inherited?.required),
      maskedValue: resolved?.present ? resolved.maskedValue || "已配置" : inherited?.present ? inherited.maskedValue || "已配置" : "",
      sourceKind: resolved?.present ? resolved.sourceKind || "resolved" : inherited?.present ? "global-settings" : "missing",
    };
  };
  const knownKeys = new Set(SETTING_CONFIG_GROUPS.flatMap((group) => group.keys.map((field) => field.key)));
  const extraItems = (config?.items || []).filter((item) => item.key && !knownKeys.has(item.key));
  const groups = extraItems.length
    ? [...SETTING_CONFIG_GROUPS, { id: "other", title: "Other Settings", subtitle: "当前上下文解析到但未归入固定分组的配置", keys: extraItems.map((item) => ({ key: item.key, label: item.label || item.key, placeholder: "" })) }]
    : SETTING_CONFIG_GROUPS;
  const defaultItemForKey = (key: string) => {
    const item = settingsDefaultsByKey.get(key);
    return {
      label: item?.key?.replace(/_/g, " ") || key.replace(/_/g, " "),
      present: Boolean(item?.present),
      required: Boolean(item?.required),
      maskedValue: item?.maskedValue || "",
      sourceKind: item?.present ? "global-settings" : "missing",
    };
  };
  const effectiveItemForKey = (key: string) => {
    const item = byKey.get(key);
    return {
      label: item?.label || key.replace(/_/g, " "),
      present: Boolean(item?.present),
      required: Boolean(item?.required),
      maskedValue: item?.maskedValue || "",
      sourceKind: item?.sourceKind || "missing",
      source: item?.source || "",
    };
  };
  const overrideDetailsForKey = (key: string) => {
    const item = byKey.get(key);
    const values = item?.valuesByScope || {};
    return ["instance", "runtime", "runtime_env_file", "bridge_env"]
      .map((scope) => ({ scope, value: values[scope] }))
      .filter((entry) => entry.value?.present);
  };
  const renderLayerGroups = (layer: "defaults" | "overrides" | "effective") => {
    const rendered = groups.map((group) => {
      const rows = group.keys.flatMap((field) => {
        if (layer === "defaults") {
          const item = defaultItemForKey(field.key);
          return [{ key: field.key, label: field.label, value: item.maskedValue, present: item.present, required: item.required, sourceKind: item.sourceKind }];
        }
        if (layer === "effective") {
          if (!byKey.has(field.key)) return [];
          const item = effectiveItemForKey(field.key);
          return [{ key: field.key, label: field.label, value: item.maskedValue, present: item.present, required: item.required, sourceKind: item.sourceKind }];
        }
        const details = overrideDetailsForKey(field.key).filter((entry) => entry.scope !== "instance");
        if (!details.length) return [];
        return [{
          key: field.key,
          label: field.label,
          value: details.map((entry) => `${configSourceLabel(entry.scope)}: ${entry.value?.maskedValue || "已配置"}`).join(" · "),
          present: true,
          required: false,
          sourceKind: details.map((entry) => configSourceLabel(entry.scope)).join(" / "),
        }];
      });
      if (layer !== "defaults" && !rows.length) return null;
      const presentCount = rows.filter((row) => row.present).length;
      return (
        <article key={`${layer}-${group.id}`} className="inherited-settings-group">
          <div className="inherited-settings-group-head">
            <span>{settingGroupIcon(group.id)}</span>
            <div>
              <strong>{group.title}</strong>
              <small>{group.subtitle}</small>
            </div>
            <em>{presentCount}/{rows.length}</em>
          </div>
          <div className="settings-group-tags">
            {settingWorkflowTags(group.id).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <div className="inherited-settings-rows">
            {rows.map((row) => (
              <div key={row.key} className={`inherited-settings-row ${row.present ? "present" : "missing"}`}>
                <div>
                  <strong>{row.label}</strong>
                  <code>{row.key}</code>
                </div>
                <code title={row.value || ""}>{row.present ? row.value || "已配置" : "未配置"}</code>
                <span className={`status-pill ${row.present ? "done" : row.required ? "failed" : "waiting"}`}>{configSourceLabel(row.sourceKind)}</span>
              </div>
            ))}
          </div>
        </article>
      );
    }).filter(Boolean);
    return rendered.length ? rendered : <Empty text={layer === "overrides" ? "当前没有 Runtime / env 覆盖项" : "当前没有可展示配置"} />;
  };
  const instanceOverrideEditedCount = Object.keys(compactNonEmptyValues(instanceOverrideEdits)).length;
  const renderInstanceOverrideEditor = () => (
    <section className="instance-override-editor">
      <div className="inherited-settings-layer-head">
        <div>
          <strong>Instance Overrides: GitHub / Telegram</strong>
          <span>只保存当前 Instance 的 GitHub / Telegram 覆盖值，不修改 Settings 默认值，也不修改 Runtime/env。</span>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={!instanceOverrideEditedCount || saveInstanceOverridesMutation.isPending || !runtime || !instance}
          onClick={() => saveInstanceOverridesMutation.mutate()}
        >
          {saveInstanceOverridesMutation.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
          保存 Instance 覆盖{instanceOverrideEditedCount ? ` (${instanceOverrideEditedCount})` : ""}
        </button>
      </div>
      {saveInstanceOverridesMutation.error ? <div className="inline-error">{String(saveInstanceOverridesMutation.error instanceof Error ? saveInstanceOverridesMutation.error.message : saveInstanceOverridesMutation.error)}</div> : null}
      <div className="instance-override-grid">
        {INSTANCE_OVERRIDE_CONFIG_KEYS.map((field) => {
          const effective = effectiveItemForKey(field.key);
          const instanceScope = byKey.get(field.key)?.valuesByScope?.instance;
          const secret = /TOKEN|KEY|SECRET|PRIVATE/.test(field.key);
          return (
            <label key={field.key} className={`instance-override-field ${instanceScope?.present ? "present" : ""} ${instanceOverrideEdits[field.key]?.trim() ? "edited" : ""}`}>
              <span>
                <strong>{field.label}</strong>
                <code>{field.key}</code>
              </span>
              <small>{field.group} · 当前 Instance 覆盖：{instanceScope?.present ? instanceScope.maskedValue || "已配置" : "未配置"}</small>
              <small>最终生效：{effective.present ? `${effective.maskedValue || "已配置"} · ${configSourceLabel(effective.sourceKind)}` : "未配置"}</small>
              <input
                type={secret ? "password" : "text"}
                value={instanceOverrideEdits[field.key] || ""}
                onChange={(event) => setInstanceOverrideEdits((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={instanceScope?.present ? "填写新值覆盖当前 Instance；留空不变" : "填写当前 Instance 覆盖值"}
                autoComplete="off"
              />
            </label>
          );
        })}
      </div>
    </section>
  );
  return (
    <section className={`inherited-settings-panel ${compact ? "compact" : ""}`}>
      <div className="inherited-settings-head">
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <div className="inherited-settings-actions">
          {onOpenSettings ? <button type="button" className="btn" onClick={onOpenSettings}><Settings size={14} />Open Settings</button> : null}
          {onOpenInstance ? <button type="button" className="btn" onClick={onOpenInstance}><LayoutDashboard size={14} />Open Instance</button> : null}
        </div>
      </div>
      {query.isLoading || settingsDefaultsQuery.isLoading ? <Skeleton /> : null}
      {query.error ? <div className="inline-error">{String(query.error instanceof Error ? query.error.message : query.error)}</div> : null}
      {settingsDefaultsQuery.error ? <div className="inline-error">{String(settingsDefaultsQuery.error instanceof Error ? settingsDefaultsQuery.error.message : settingsDefaultsQuery.error)}</div> : null}
      {config || settingsDefaultsQuery.data ? (
        <>
          <div className="inherited-settings-meta">
            <span>{config?.workflowId || config?.registryFilters?.workflow_id || "workflow context"}</span>
            <span>{nodeId || "instance context"}</span>
            <span>{(config?.precedence || ["global-settings"]).map(configSourceLabel).join(" > ")}</span>
          </div>
          {layered ? (
            <div className="inherited-settings-layers">
              <section className="inherited-settings-layer">
                <div className="inherited-settings-layer-head">
                  <div><strong>Settings Defaults</strong><span>全局默认值，只读；来源是 Control Plane Settings。</span></div>
                </div>
                <div className="inherited-settings-groups">{renderLayerGroups("defaults")}</div>
              </section>
              <section className="inherited-settings-layer">
                <div className="inherited-settings-layer-head">
                  <div><strong>Runtime / Env Overrides</strong><span>Runtime、环境文件和进程环境覆盖项，只读展示。</span></div>
                </div>
                <div className="inherited-settings-groups">{renderLayerGroups("overrides")}</div>
              </section>
              {allowInstanceOverrides ? renderInstanceOverrideEditor() : null}
              <section className="inherited-settings-layer">
                <div className="inherited-settings-layer-head">
                  <div><strong>Effective Runtime Config</strong><span>当前 Instance / Workflow 最终会解析到的运行值。</span></div>
                </div>
                <div className="inherited-settings-groups">{renderLayerGroups("effective")}</div>
              </section>
            </div>
          ) : (
            <div className="inherited-settings-groups">
              {groups.map((group) => {
                const presentCount = group.keys.filter((field) => displayItemForKey(field.key).present).length;
                return (
                  <article key={group.id} className="inherited-settings-group">
                    <div className="inherited-settings-group-head">
                      <span>{settingGroupIcon(group.id)}</span>
                      <div>
                        <strong>{group.title}</strong>
                        <small>{group.subtitle}</small>
                      </div>
                      <em>{presentCount}/{group.keys.length}</em>
                    </div>
                    <div className="settings-group-tags">
                      {settingWorkflowTags(group.id).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <div className="inherited-settings-rows">
                      {group.keys.map((field) => {
                        const item = displayItemForKey(field.key);
                        return (
                          <div key={field.key} className={`inherited-settings-row ${item.present ? "present" : "missing"}`}>
                            <div>
                              <strong>{item.label || field.label}</strong>
                              <code>{field.key}</code>
                            </div>
                            <code title={item.maskedValue || ""}>{item.present ? item.maskedValue || "已配置" : "未配置"}</code>
                            <span className={`status-pill ${item.present ? "done" : item.required ? "failed" : "waiting"}`}>{configSourceLabel(item.sourceKind)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function nodeRunCapabilityRows(result?: NodeRunResult): Array<{ key: string; label: string; status: string; reason: string; action: string; detail: Record<string, unknown> }> {
  const issues = result?.issues || [];
  const caps = detailRecord(result?.capabilities);
  if (result?.capabilityResults?.length) {
    return result.capabilityResults.map((item) => {
      const issue = issues.find((candidate) => candidate.relatedCapability === item.key || candidate.relatedCapability === item.capability);
      const runtimeDetail = detailRecord(caps[item.key] || caps[item.capability || ""]);
      return {
        key: item.key,
        label: item.label || item.capability || item.key,
        status: item.status || "unknown",
        reason: item.reason || issue?.message || "",
        action: issue?.action || "",
        detail: { ...(item.detail || {}), ...runtimeDetail },
      };
    });
  }
  const rows: Array<{ key: string; label: string; status: string; reason: string; action: string; detail: Record<string, unknown> }> = [];
  Object.entries(caps).forEach(([key, value]) => {
    const item = detailRecord(value);
    rows.push({
      key,
      label: String(item.label || key),
      status: String(item.status || "unknown"),
      reason: String(item.error || item.reason || item.message || ""),
      action: "",
      detail: item,
    });
  });
  return rows;
}

function nodeRunActualOutputPaths(result?: NodeRunResult) {
  const paths: string[] = [];
  Object.values(result?.actualOutputs || {}).forEach((value) => {
    if (Array.isArray(value)) paths.push(...value.map(String).filter(Boolean));
    else if (value) paths.push(String(value));
  });
  return Array.from(new Set(paths));
}

function nodeRunOutputCategories(result?: NodeRunResult) {
  const detail = detailRecord(result?.detail);
  const rawCategories = detailRecord(
    result?.outputCategories && Object.keys(result.outputCategories).length
      ? result.outputCategories
      : detail.output_categories,
  );
  const fallbackCore = nodeRunActualOutputPaths(result);
  const order = [
    ["core_outputs", "核心输出", "节点声明 outputs 对应的业务结果。"],
    ["raw_files", "节点原始文件", "节点 Skill/Worker 产生的原始响应、字幕和中间文件。"],
    ["run_records", "运行记录", "Node Run 工作台、事件、状态和 capability 记录。"],
  ];
  return order.map(([key, fallbackTitle, fallbackDescription]) => {
    const record = detailRecord(rawCategories[key]);
    const files = nodeRunStringArray(record.files);
    return {
      key,
      title: String(record.title || fallbackTitle),
      description: String(record.description || fallbackDescription),
      files: key === "core_outputs" && !files.length ? fallbackCore : files,
    };
  });
}

function nodeRunOutputCategoryFiles(result: NodeRunResult | undefined, key: string) {
  return nodeRunOutputCategories(result).find((category) => category.key === key)?.files || [];
}

function nodeRunCapabilityRow(result: NodeRunResult | undefined, aliases: string[]) {
  const normalized = new Set(aliases.map((item) => item.toLowerCase()));
  return nodeRunCapabilityRows(result).find((row) => normalized.has(String(row.key || "").toLowerCase()) || normalized.has(String(row.label || "").toLowerCase()));
}

function nodeRunUniqueFiles(files: string[]) {
  return Array.from(new Set(files.map(String).filter(Boolean)));
}

function nodeRunGitFileGroups(detail: Record<string, unknown>, result?: NodeRunResult) {
  const visible = (path: string) => path && path !== "raw/pipeline-context.json";
  const changedFiles = nodeRunStringArray(detail.changed_files).filter(visible);
  const eventFiles = nodeRunStringArray(detail.event_changed_files).filter(visible);
  const managedPaths = nodeRunStringArray(detail.managed_paths).filter(visible);
  const allGitFiles = nodeRunUniqueFiles([...changedFiles, ...eventFiles]);
  const allGitSet = new Set([...allGitFiles, ...managedPaths]);
  const categorySet = (key: string) => new Set(nodeRunOutputCategoryFiles(result, key).filter((path) => allGitSet.has(path)));
  const declaredOutputSet = categorySet("core_outputs");
  const rawWorkerSet = categorySet("raw_files");
  if (!rawWorkerSet.size) {
    allGitFiles.filter((path) => /\/raw\//.test(path) && path.includes("raw/youtube-deep-research/")).forEach((path) => rawWorkerSet.add(path));
  }
  const runRecordSet = categorySet("run_records");
  allGitFiles
    .filter((path) => path.includes("raw/pipeline-runs/") || path.includes("raw/node-runs/") || path.includes("logs/stage-events/"))
    .forEach((path) => runRecordSet.add(path));
  const grouped = new Set([
    ...declaredOutputSet,
    ...rawWorkerSet,
    ...runRecordSet,
  ]);
  const other = allGitFiles.filter((path) => !grouped.has(path));
  return {
    declaredOutputs: Array.from(declaredOutputSet),
    rawWorkerFiles: Array.from(rawWorkerSet),
    runRecords: Array.from(runRecordSet),
    other,
    managedPaths,
    changedFiles,
  };
}

function CapabilityFileList({ title, files, max = 7 }: { title: string; files: string[]; max?: number }) {
  const visible = files.slice(0, max);
  const hidden = files.slice(max);
  return (
    <div className="capability-file-list">
      <div><strong>{title}</strong><span>{files.length} files</span></div>
      {visible.length ? (
        <ul>
          {visible.map((file) => <li key={file}><code>{file}</code></li>)}
        </ul>
      ) : <small>没有记录文件。</small>}
      {hidden.length ? (
        <details>
          <summary><span>查看剩余 {hidden.length} 个文件</span><ChevronDown size={13} /></summary>
          <ul>{hidden.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function GitCapabilitySummary({ detail, result }: { detail: Record<string, unknown>; result?: NodeRunResult }) {
  const groups = nodeRunGitFileGroups(detail, result);
  const repo = String(detail.repository || "");
  const commit = String(detail.commit || "");
  const eventCommit = String(detail.event_commit || "");
  return (
    <div className="capability-detail-panel">
      <div className="capability-panel-title">
        <Github size={15} />
        <div>
          <strong>GitHub 同步</strong>
          <small>只展示本阶段推送摘要；产物定义以“校验节点输出”为准。</small>
        </div>
      </div>
      <div className="capability-metric-grid">
        <span><b>仓库</b>{repo || "-"}</span>
        <span><b>主提交</b>{commit ? `${commit}${detail.pushed ? " · pushed" : ""}` : "-"}</span>
        <span><b>同步文件</b>{groups.changedFiles.length}</span>
        <span><b>事件提交</b>{eventCommit ? `${eventCommit}${detail.event_pushed ? " · pushed" : ""}` : "-"}</span>
      </div>
      {groups.declaredOutputs.length ? <CapabilityFileList title="核心输出" files={groups.declaredOutputs} max={5} /> : null}
      {groups.rawWorkerFiles.length ? <CapabilityFileList title="节点原始文件" files={groups.rawWorkerFiles} max={5} /> : null}
      {groups.runRecords.length ? <CapabilityFileList title="运行记录" files={groups.runRecords} max={5} /> : null}
      {groups.other.length ? <CapabilityFileList title="其他同步文件" files={groups.other} max={5} /> : null}
      {groups.managedPaths.length ? (
        <details className="capability-managed-scope">
          <summary><span>管理范围 {groups.managedPaths.length} 项</span><ChevronDown size={13} /></summary>
          <CapabilityFileList title="Git 管理范围" files={groups.managedPaths} max={10} />
        </details>
      ) : null}
    </div>
  );
}

function TelegramCapabilitySummary({ detail }: { detail: Record<string, unknown> }) {
  const history = detailList(detail.history);
  const rows = history.length ? history : [{
    trigger: detail.trigger,
    status: detail.status,
    sent_at: detail.sent_at,
    api_ok: detail.api_ok,
    message_preview: detail.message_preview,
    error: detail.error,
  }];
  return (
    <div className="capability-detail-panel">
      <div className="capability-panel-title">
        <Send size={15} />
        <div>
          <strong>Telegram notification</strong>
          <small>按触发点展示实际发送记录，不在主页面展开完整 payload。</small>
        </div>
      </div>
      <div className="capability-metric-grid">
        <span><b>发送记录</b>{rows.length}</span>
        <span><b>触发器</b>{nodeRunStringArray(detail.triggers).join(", ") || "-"}</span>
      </div>
      <div className="telegram-send-list">
        {rows.map((row, index) => {
          const status = String(row.status || (row.api_ok ? "done" : "failed"));
          return (
            <article key={`${String(row.trigger || "notify")}-${String(row.sent_at || index)}`} className={nodeRunCardTone(status)}>
              <div>
                <strong>{String(row.trigger || "notify")}</strong>
                <span className={`status-pill ${nodeRunTone(status)}`}>{status}</span>
              </div>
              <small>{formatBeijingTime(String(row.sent_at || row.recorded_at || ""), "")}</small>
              {row.message_preview ? <p>{String(row.message_preview)}</p> : null}
              {row.error ? <small>{String(row.error)}</small> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function nodeRunStepScalarRows(detail: Record<string, unknown>) {
  const blocked = new Set(["stdout_tail", "stderr_tail", "context", "node_state", "actual_outputs", "validation", "command", "capabilities"]);
  return Object.entries(detail)
    .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
    .filter(([key]) => !blocked.has(key))
    .slice(0, 8);
}

const NodeRunStepFlowNode = memo(({ data }: NodeProps<Node<NodeRunStepNodeData>>) => {
  const { step, index, selected, active } = data;
  const tone = nodeRunTone(step.status);
  return (
    <div className={`node-run-flow-node ${tone} ${selected ? "selected" : ""} ${active ? "active" : ""}`} aria-label={`Inspect step ${step.id}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-run-flow-node-top">
        <span>{index + 1}</span>
        <span className={`status-pill ${tone}`}>{step.status || "waiting"}</span>
      </div>
      <strong>{step.title || step.id}</strong>
      <small>{step.id}</small>
      {step.summary ? <p>{step.summary}</p> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeRunNodeTypes = { nodeRunStep: NodeRunStepFlowNode };

function nodeRunOutputValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.map((item) => String(item)).join("\n") : "未生成";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.path) return String(record.path);
    if (record.from) return String(record.from);
    return formatValue(record);
  }
  return value === undefined || value === null || value === "" ? "未生成" : String(value);
}

function nodeRunStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function nodeRunCoreOutputRows(result?: NodeRunResult) {
  if (result?.coreOutputs?.length) return result.coreOutputs;
  return Object.entries(result?.actualOutputs || {}).map(([name, value]) => ({
    name,
    kind: Array.isArray(value) ? "files" : "scalar",
    value,
    files: Array.isArray(value) ? value.map(String).filter(Boolean) : [],
    artifacts: [],
    declared: {},
  }));
}

function NodeRunCoreOutputsSummary({ result }: { result: NodeRunResult | undefined }) {
  const outputs = nodeRunCoreOutputRows(result);
  if (!outputs.length) return <Empty text="没有核心输出记录" />;
  return (
    <div className="node-run-core-output-list">
      {outputs.map((output) => {
        const files = output.files || [];
        const artifacts = output.artifacts || [];
        const isScalar = !files.length;
        return (
          <article key={output.name} className="node-run-core-output-card">
            <div>
              <strong>{output.name}</strong>
              <span className="status-pill done">{output.kind || (isScalar ? "scalar" : "file")}</span>
            </div>
            {isScalar ? (
              <code>{nodeRunOutputValue(output.value)}</code>
            ) : (
              <div className="node-run-core-output-files">
                {files.map((file) => <code key={file}>{file}</code>)}
              </div>
            )}
            {artifacts.length ? <ArtifactList artifacts={artifacts} /> : null}
          </article>
        );
      })}
    </div>
  );
}

function NodeRunRelayPackageSummary({ result }: { result: NodeRunResult | undefined }) {
  const relay = result?.relayPackage;
  const items = relay?.items || [];
  if (!relay?.manifestPath && !items.length) return <Empty text="没有接力包记录" />;
  return (
    <div className="node-run-relay-package">
      <div className="node-run-step-meta-grid">
        <span><b>输出目录</b>{relay?.outputDirectory || "-"}</span>
        <span><b>Manifest</b>{relay?.manifestPath || "-"}</span>
        <span><b>可接力输出</b>{items.length}</span>
      </div>
      <div className="node-run-relay-item-list">
        {items.map((item) => (
          <article key={`${item.output}-${item.path}`} className="node-run-relay-item">
            <div>
              <strong>{item.output || pathBasename(item.path)}</strong>
              <span className="status-pill waiting">{item.valueType || "file"}</span>
            </div>
            <code>{item.path}</code>
            {item.sourcePath ? <small>来源：{item.sourcePath}</small> : null}
            {item.artifact?.preview ? (
              <details className="node-run-input-preview">
                <summary><span>查看内容</span><ChevronDown size={14} /></summary>
                <pre>{item.artifact.preview}</pre>
              </details>
            ) : null}
          </article>
        ))}
      </div>
      {!items.length ? <div className="node-run-empty">Manifest 中没有可接力 item。</div> : null}
    </div>
  );
}

function NodeRunExecutionEvidenceSummary({ result }: { result: NodeRunResult | undefined }) {
  const artifacts = nodeRunDiagnosticArtifacts(result);
  if (!artifacts.length) return <Empty text="没有执行证据文件" />;
  return <ArtifactList artifacts={artifacts} />;
}

function NodeRunOutputValidationSummary({
  result,
  step,
}: {
  result: NodeRunResult | undefined;
  step: NodeTestStep | undefined;
}) {
  const detail = detailRecord(result?.detail);
  const realExecution = detailRecord(detail.real_execution);
  const realDetail = detailRecord(realExecution.detail);
  const nodeState = detailRecord(realDetail.node_state);
  const stepDetail = detailRecord(step?.detail);
  const stepDeclaredOutputs = detailRecord(stepDetail.declared_outputs);
  const stateDeclaredOutputs = detailRecord(nodeState.declared_outputs);
  const declaredOutputs = Object.keys(stepDeclaredOutputs).length ? stepDeclaredOutputs : stateDeclaredOutputs;
  const actualOutputs = result?.actualOutputs && Object.keys(result.actualOutputs).length
    ? result.actualOutputs
    : Object.keys(detailRecord(realExecution.actual_outputs)).length
      ? detailRecord(realExecution.actual_outputs)
      : detailRecord(stepDetail.actual_outputs);
  const stepValidation = detailRecord(stepDetail.validation);
  const validation = result?.validation && Object.keys(result.validation).length
    ? result.validation
    : Object.keys(stepValidation).length ? stepValidation : stepDetail;
  const missing = nodeRunStringArray(validation.missing_outputs);
  const unexpected = nodeRunStringArray(validation.unexpected_outputs);
  const declaredEntries = Object.entries(declaredOutputs);
  const actualEntries = Object.entries(actualOutputs || {});
  return (
    <div className="node-run-validation-summary">
      <div className="section-title"><span>输出校验摘要</span><span>{String(validation.status || step?.status || "unknown")}</span></div>
      <div className="node-run-validation-stats">
        <span><b>声明输出</b>{declaredEntries.length}</span>
        <span><b>实际输出</b>{actualEntries.length}</span>
        <span><b>缺失</b>{missing.length}</span>
        <span><b>多余</b>{unexpected.length}</span>
      </div>
      <NodeRunCoreOutputsSummary result={result} />
      <details className="node-run-step-raw">
        <summary><span>接力包</span><ChevronDown size={14} /></summary>
        <NodeRunRelayPackageSummary result={result} />
      </details>
      <div className="node-run-output-grid">
        {declaredEntries.map(([name, spec]) => {
          const isMissing = missing.includes(name);
          return (
            <article key={name} className={isMissing ? "err" : "done"}>
              <div><strong>{name}</strong><span className={`status-pill ${isMissing ? "failed" : "done"}`}>{isMissing ? "missing" : "declared"}</span></div>
              <code>{nodeRunOutputValue(spec)}</code>
              {actualOutputs && Object.prototype.hasOwnProperty.call(actualOutputs, name) ? (
                <small>实际：{nodeRunOutputValue((actualOutputs as Record<string, unknown>)[name])}</small>
              ) : null}
            </article>
          );
        })}
        {!declaredEntries.length && actualEntries.map(([name, value]) => (
          <article key={name} className="done">
            <div><strong>{name}</strong><span className="status-pill done">actual</span></div>
            <code>{nodeRunOutputValue(value)}</code>
          </article>
        ))}
        {!declaredEntries.length && !actualEntries.length ? <div className="node-run-empty">当前结果没有声明输出或实际输出记录。</div> : null}
      </div>
    </div>
  );
}

function pathBasename(value: unknown) {
  const text = String(value || "").trim();
  return text.split("/").filter(Boolean).pop() || text;
}

function artifactFromRecord(record: Record<string, unknown>): Artifact {
  return {
    id: String(record.id || record.path || ""),
    producer: String(record.producer || ""),
    output: String(record.output || ""),
    type: String(record.type || "file"),
    format: String(record.format || "text"),
    path: String(record.path || ""),
    title: String(record.title || pathBasename(record.path)),
    size: Number(record.size || 0),
    mimeType: String(record.mimeType || record.mime_type || "text/plain"),
    tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
    resolution: String(record.resolution || "node-run-input-manifest"),
    metadata: detailRecord(record.metadata),
    preview: record.preview ? String(record.preview) : undefined,
    previewTruncated: Boolean(record.previewTruncated || record.preview_truncated),
  };
}

function nodeRunInputArtifacts(result: NodeRunResult | undefined, step: NodeTestStep | undefined) {
  if (result?.inputArtifacts?.length) return result.inputArtifacts;
  const stepDetail = detailRecord(step?.detail);
  return detailList(stepDetail.materialized_inputs).map(artifactFromRecord);
}

function NodeRunInputArtifactsSummary({
  result,
  step,
}: {
  result: NodeRunResult | undefined;
  step: NodeTestStep | undefined;
}) {
  const artifacts = nodeRunInputArtifacts(result, step);
  const stepDetail = detailRecord(step?.detail);
  const inputResolution = detailRecord(stepDetail.input_resolution || result?.inputResolution);
  const manifestItems = detailList(inputResolution.items);
  const inputManifest = String(stepDetail.input_manifest || result?.detail?.input_manifest || "");
  const inputDirectory = String(stepDetail.input_directory || result?.detail?.input_directory || "");
  const resolvedInputs = detailList(stepDetail.resolved_inputs).length
    ? detailList(stepDetail.resolved_inputs)
    : detailList(detailRecord(result?.detail).resolved_inputs);
  const pendingInputs = detailList(stepDetail.pending_materialization_inputs).length
    ? detailList(stepDetail.pending_materialization_inputs)
    : detailList(detailRecord(result?.detail).pending_materialization_inputs);
  const missingInputs = detailList(stepDetail.missing_inputs).length
    ? detailList(stepDetail.missing_inputs)
    : detailList(detailRecord(result?.detail).missing_inputs);
  return (
    <div className="node-run-input-artifacts">
      {Object.keys(inputResolution).length ? (
        <div className="node-run-input-resolution">
          <div className="section-title"><span>接力解析</span><span>{nodeRunRelayModeLabel(String(inputResolution.relay_mode || result?.relayMode || "auto_by_target_inputs"))}</span></div>
          <div className="node-run-step-meta-grid">
            <span><b>来源 Node Run</b>{String(inputResolution.source_node_run_id || result?.sourceNodeRunId || "-")}</span>
            <span><b>Relay Mode</b>{nodeRunRelayModeLabel(String(inputResolution.relay_mode || result?.relayMode || "auto_by_target_inputs"))}</span>
            <span><b>Selected</b>{nodeRunStringArray(inputResolution.selected_outputs).join(", ") || "-"}</span>
            <span><b>Matched</b>{nodeRunStringArray(inputResolution.matched_outputs).join(", ") || "-"}</span>
          </div>
          {manifestItems.length ? (
            <div className="node-run-relay-resolution-list">
              {manifestItems.map((item, index) => {
                const materializedPath = String(item.materialized_path || item.path || "");
                const sourcePath = String(item.source_path || "");
                return (
                  <article key={`${materializedPath || String(item.path || index)}-${String(item.source_output || "")}`}>
                    <strong>{String(item.source_output || item.output || "output")} → {String(item.target_input || item.input_name || "input")}</strong>
                    <code>{materializedPath}</code>
                    {sourcePath ? <small>来源文件：{sourcePath}</small> : null}
                    {item.value_preview ? <pre>{String(item.value_preview)}</pre> : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {pendingInputs.length ? (
        <div className="node-run-input-resolved-list">
          <div className="section-title"><span>接力候选</span><span>{pendingInputs.length} pending materialization</span></div>
          {pendingInputs.map((item) => (
            <article key={`${String(item.name)}-${String(item.source_node_run_id || item.provenance || "")}`} className="node-run-input-resolved-card">
              <div>
                <strong>{String(item.name || item.target_input || "input")}</strong>
                <span className="status-pill waiting">pending</span>
              </div>
              <code>{String(item.value || item.provenance || "-")}</code>
              {item.source ? <small>定义来源：{String(item.source)}</small> : null}
              {item.source_node_run_id ? <small>上游 Node Run：{String(item.source_node_run_id)}</small> : null}
              {item.reason ? <small>{String(item.reason)}</small> : null}
            </article>
          ))}
        </div>
      ) : null}
      {resolvedInputs.length || missingInputs.length ? (
        <div className="node-run-input-resolved-list">
          <div className="section-title"><span>解析结果</span><span>{resolvedInputs.length} resolved · {missingInputs.length} missing</span></div>
          {resolvedInputs.map((item) => (
            <article key={`${String(item.name)}-${String(item.provenance || "")}`} className="node-run-input-resolved-card">
              <div>
                <strong>{String(item.name || "input")}</strong>
                <span className="status-pill done">{String(item.provenance || "resolved")}</span>
              </div>
              <code>{nodeRunOutputValue(item.value)}</code>
              {item.source ? <small>定义来源：{String(item.source)}</small> : null}
              {item.source_node_run_id ? <small>上游 Node Run：{String(item.source_node_run_id)}</small> : null}
            </article>
          ))}
          {missingInputs.map((item) => (
            <article key={`${String(item.name)}-missing`} className="node-run-input-resolved-card err">
              <div>
                <strong>{String(item.name || "input")}</strong>
                <span className="status-pill failed">missing</span>
              </div>
              <small>{String(item.reason || "没有解析到输入")}</small>
            </article>
          ))}
        </div>
      ) : null}
      <div className="section-title"><span>实际输入产物</span><span>{artifacts.length}</span></div>
      {inputDirectory || inputManifest ? (
        <div className="node-run-input-artifact-context">
          {inputDirectory ? <span><b>输入目录</b>{inputDirectory}</span> : null}
          {inputManifest ? <span><b>索引文件</b>{inputManifest}</span> : null}
        </div>
      ) : null}
      <div className="node-run-input-artifact-list">
        {artifacts.map((artifact) => {
          const metadata = artifact.metadata || {};
          const sourcePath = String(metadata.source_path || "");
          const sourceNode = String(metadata.source_node || "");
          const sourceRun = String(metadata.source_run_id || "");
          const sourceOutput = String(metadata.source_output || artifact.output || "");
          return (
            <article key={artifact.id || artifact.path} className="node-run-input-artifact-card">
              <div>
                <strong>{artifact.title || pathBasename(sourcePath || artifact.path)}</strong>
                <span className="status-pill done">{sourceOutput || "input"}</span>
              </div>
              <code>{artifact.path}</code>
              {sourcePath ? <small>来自：{sourcePath}</small> : null}
              {sourceNode || sourceRun ? <small>{[sourceNode, sourceRun].filter(Boolean).join(" · ")}</small> : null}
              <details className="node-run-input-preview">
                <summary><span>查看内容</span><ChevronDown size={14} /></summary>
                <pre>{artifact.preview || "当前输入文件没有文本预览。"}</pre>
              </details>
            </article>
          );
        })}
      </div>
      {!artifacts.length ? <div className="node-run-empty">还没有物化后的输入文件。真实执行开始后会显示下游节点实际读取的文件。</div> : null}
    </div>
  );
}

function NodeRunAgentRequestSummary({
  result,
  step,
}: {
  result: NodeRunResult | undefined;
  step: NodeTestStep | undefined;
}) {
  const stepDetail = detailRecord(step?.detail);
  const agent = { ...detailRecord(result?.agentRequest), ...stepDetail };
  const rendered = String(agent.rendered_request || "");
  const receipt = detailRecord(agent.receipt);
  const command = Array.isArray(agent.command) ? agent.command.map(String).join(" ") : String(agent.stage_command_preview || "");
  return (
    <div className="node-run-agent-request">
      <div className="section-title"><span>Agent Request</span><span>{String(agent.template_version || "hermes-agent-executor.v1")}</span></div>
      <div className="node-run-step-meta-grid">
        <span><b>Executor</b>{String(agent.executor || "hermes")}</span>
        <span><b>Skill</b>{String(agent.requested_skill || agent.skill || "-")}</span>
        <span><b>Request</b>{String(agent.request_path || "-")}</span>
        <span><b>Receipt</b>{String(agent.receipt_path || "-")}</span>
      </div>
      {command ? (
        <details className="node-run-step-raw" open>
          <summary><span>执行命令</span><ChevronDown size={14} /></summary>
          <code>{command}</code>
        </details>
      ) : null}
      {rendered ? (
        <details className="node-run-step-raw" open>
          <summary><span>request.md</span><ChevronDown size={14} /></summary>
          <pre className="artifact-preview">{rendered}</pre>
        </details>
      ) : <div className="node-run-empty">Agent Request 尚未生成。</div>}
      {Object.keys(receipt).length ? (
        <details className="node-run-step-raw">
          <summary><span>receipt.json</span><ChevronDown size={14} /></summary>
          <code>{formatValue(receipt)}</code>
        </details>
      ) : null}
    </div>
  );
}

function NodeRunStepDetailPanel({
  step,
  result,
  events,
}: {
  step: NodeTestStep | undefined;
  result: NodeRunResult | undefined;
  events?: NodeRunEvent[];
}) {
  const detail = detailRecord(result?.detail);
  const stepDetail = detailRecord(step?.detail);
  const suggestions = detailList(detail.fix_suggestions);
  const stepEvents = (events?.length ? events : result?.events || []).filter((event) => event.stepId === step?.id);
  const scalarRows = nodeRunStepScalarRows(stepDetail);
  const innerFlowIsRelevant = step?.id === "execute-or-dry-run";
  const gitCapability = step?.id === "persist-to-github" ? nodeRunCapabilityRow(result, ["git", "github"]) : undefined;
  const telegramCapability = step?.id === "send-telegram-notification" ? nodeRunCapabilityRow(result, ["telegram", "tg"]) : undefined;
  if (!step) return <aside id="node-run-step-detail" className="node-run-step-detail-panel"><Empty text="选择一个阶段查看详情" /></aside>;
  const showFixes = ["failed", "blocked", "needs_input"].includes(step.status);
  return (
    <aside id="node-run-step-detail" className={`node-run-step-detail-panel ${nodeRunCardTone(step.status)}`}>
      <div className="node-run-step-detail-head">
        <div>
          <span className={`status-pill ${nodeRunTone(step.status)}`}>{step.status || "waiting"}</span>
          <span className="status-pill subtle">{stepEvents.length} events</span>
        </div>
        <strong>{step.title || step.id}</strong>
        <small>{step.id}</small>
      </div>
      {step.summary ? <p>{step.summary}</p> : null}
      <div className="node-run-step-meta-grid">
        <span><b>状态</b>{step.status || "waiting"}</span>
        <span><b>耗时</b>{typeof step.elapsedMs === "number" ? formatElapsed(step.elapsedMs) : "-"}</span>
        <span><b>开始时间</b>{formatBeijingTime(step.startedAt)}</span>
        <span><b>结束时间</b>{formatBeijingTime(step.finishedAt)}</span>
      </div>
      {scalarRows.length ? (
        <div className="node-run-step-kv-grid">
          {scalarRows.map(([key, value]) => (
            <span key={key}><b>{key.replace(/_/g, " ")}</b>{String(value ?? "-")}</span>
          ))}
        </div>
      ) : null}
      {showFixes && suggestions.length ? (
        <div className="node-run-step-fixes">
          <div className="section-title"><span>修复建议</span><span>{suggestions.length}</span></div>
          {suggestions.slice(0, 3).map((item, index) => (
            <article key={`${String(item.target || "fix")}-${index}`}>
              <span className="status-pill waiting">{String(item.target || "fix")}</span>
              <strong>{String(item.title || "Suggested fix")}</strong>
              <small>{String(item.reason || "")}</small>
              {item.action ? <small>{String(item.action)}</small> : null}
            </article>
          ))}
        </div>
      ) : null}
      {stepEvents.length ? (
        <div className="node-run-step-events">
          <div className="section-title"><span>事件</span><span>{stepEvents.length}</span></div>
          {stepEvents.slice(-6).map((event, index) => (
            <article key={`${event.event}-${event.ts || index}`}>
              <span>{event.sequence || index + 1}</span>
              <div>
                <strong>{event.event}</strong>
                <small>{formatBeijingTime(event.ts, "")}</small>
                {event.data?.summary ? <small>{String(event.data.summary)}</small> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {innerFlowIsRelevant && (result?.innerSteps || []).length ? (
        <div className="node-run-step-inner-flow">
          <div className="section-title"><span>执行节点逻辑</span><span>{result?.innerSteps?.length || 0}</span></div>
          <NodeRunInnerFlow result={result} />
        </div>
      ) : null}
      {step.id === "generate-agent-request" ? <NodeRunAgentRequestSummary result={result} step={step} /> : null}
      {step.id === "resolve-inputs" ? <NodeRunInputArtifactsSummary result={result} step={step} /> : null}
      {gitCapability ? <GitCapabilitySummary detail={gitCapability.detail} result={result} /> : null}
      {telegramCapability ? <TelegramCapabilitySummary detail={telegramCapability.detail} /> : null}
      {step.id === "validate-outputs" ? <NodeRunOutputValidationSummary result={result} step={step} /> : null}
      {step.detail && Object.keys(step.detail).length ? (
        <details className="node-run-step-raw">
          <summary><span>阶段原始详情</span><ChevronDown size={14} /></summary>
          <code>{formatValue(step.detail)}</code>
        </details>
      ) : null}
    </aside>
  );
}

function NodeRunFlow({
  result,
  events,
  selectedStepId,
  onSelectStep,
}: {
  result: NodeRunResult | undefined;
  events?: NodeRunEvent[];
  selectedStepId?: string;
  onSelectStep?: (stepId: string) => void;
}) {
  const steps = (result?.steps || []).map((step) => localizedNodeRunStep(step, result?.nodeId));
  const current = currentNodeRunStep({ ...result, steps });
  const resolvedSelectedStepId = selectedStepId || current?.id || steps[0]?.id || "";
  const selectedStep = steps.find((step) => step.id === resolvedSelectedStepId) || current || steps[0];
  const compactFlow = typeof window !== "undefined" && window.innerWidth < 700;
  const columns = compactFlow ? 2 : 4;
  const xSpacing = compactFlow ? 230 : 245;
  const ySpacing = compactFlow ? 158 : 172;
  const flowNodes = useMemo<Node<NodeRunStepNodeData>[]>(() => steps.map((step, index) => ({
    id: step.id || `step-${index}`,
    type: "nodeRunStep",
    position: {
      x: (index % columns) * xSpacing,
      y: Math.floor(index / columns) * ySpacing,
    },
    data: {
      step,
      index,
      selected: (step.id || `step-${index}`) === resolvedSelectedStepId,
      active: step.status === "running" || Boolean(current?.id && step.id === current.id),
    },
  })), [steps, resolvedSelectedStepId, current?.id, columns, xSpacing, ySpacing]);
  const flowEdges = useMemo<Edge[]>(() => steps.slice(0, -1).map((step, index) => {
    const next = steps[index + 1];
    const status = next.status || step.status || "waiting";
    return {
      id: `node-run-edge-${step.id || index}-${next.id || index + 1}`,
      source: step.id || `step-${index}`,
      target: next.id || `step-${index + 1}`,
      type: "smoothstep",
      animated: status === "running",
      className: `node-run-edge ${nodeRunTone(status)}`,
    };
  }), [steps]);
  if (!steps.length) return <div className="node-run-empty">创建一次 Node Run 后展示节点级执行流程。</div>;
  return (
    <div className="node-run-dag-layout" aria-label="Node run execution flow">
      <div className="node-run-dag-canvas">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeRunNodeTypes}
          fitView
          fitViewOptions={{ padding: .18 }}
          minZoom={.35}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => onSelectStep?.(node.id)}
          defaultEdgeOptions={{ className: "node-run-edge" }}
        >
          <Background color="#dfe4ec" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <NodeRunStepDetailPanel step={selectedStep} result={result} events={events} />
    </div>
  );
}

function NodeRunInnerFlow({ result }: { result: NodeRunResult | undefined }) {
  const detail = detailRecord(result?.detail);
  const innerSteps = (result?.innerSteps?.length
    ? result.innerSteps
    : detailList(detail.inner_steps).map((item) => ({
      id: String(item.id || item.step_id || ""),
      title: String(item.title || item.id || "Inner step"),
      status: String(item.status || "waiting"),
      summary: item.summary ? String(item.summary) : undefined,
      startedAt: item.started_at ? String(item.started_at) : undefined,
      finishedAt: item.finished_at ? String(item.finished_at) : undefined,
      elapsedMs: typeof item.elapsed_ms === "number" ? item.elapsed_ms : undefined,
      detail: detailRecord(item.detail),
    }))).map((step) => localizedNodeRunStep(step, result?.nodeId));
  if (!innerSteps.length) {
    return <div className="node-run-empty">该 Node Run 暂未提供执行生命周期。</div>;
  }
  return (
    <div className="node-run-inner-flow" aria-label="Node inner flow">
      {innerSteps.map((step, index) => (
        <div key={step.id || index} className={`node-run-inner-step ${nodeRunCardTone(step.status)} ${step.status === "running" ? "active" : ""}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.title || step.id}</strong>
            <small>{step.id} · {step.status}{step.elapsedMs ? ` · ${formatElapsed(step.elapsedMs)}` : ""}</small>
            {step.summary ? <p>{step.summary}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function NodeRunConfigPanel({ result }: { result: NodeRunResult | undefined }) {
  const detail = detailRecord(result?.detail);
  const configs = detailRecord(detail.resolved_config);
  const sideEffects = detailRecord(detail.side_effects);
  const runtimeContext = result?.runtimeContext && Object.keys(result.runtimeContext).length ? result.runtimeContext : detailRecord(detail.runtime_context);
  const instanceContext = result?.instanceContext && Object.keys(result.instanceContext).length ? result.instanceContext : detailRecord(detail.instance_context);
  const capabilityOverrides = result?.capabilityOverrides && Object.keys(result.capabilityOverrides).length ? result.capabilityOverrides : detailRecord(detail.capability_overrides);
  const definitionReports = result?.definitionScopeReports && Object.keys(result.definitionScopeReports).length ? result.definitionScopeReports : detailRecord(detail.definition_scope_reports);
  const current = currentNodeRunStep(result);
  const environment = result?.environmentSnapshot || [];
  const legacySuggestions = detailList(detail.fix_suggestions).map((item, index) => ({
    id: `${String(item.target || "fix")}-${index}`,
    target: String(item.target || "fix"),
    severity: "warning",
    title: String(item.title || "Suggested fix"),
    message: String(item.reason || ""),
    action: String(item.action || ""),
    source: "legacy-detail",
    relatedConfigKeys: [] as string[],
  }));
  const issues = result?.issues?.length ? result.issues : legacySuggestions;
  return (
    <div className="node-run-diagnosis">
      <div className="node-run-live-inspector">
        <div className="section-title"><span>Live Inspector</span><span>{result?.status || "idle"}</span></div>
        <div className="node-run-inspector-card">
          <span className={`status-pill ${nodeRunTone(current?.status)}`}>{current?.status || "idle"}</span>
          <strong>{current?.title || "No active step"}</strong>
          <small>{current?.id || ""}</small>
          {current?.summary ? <p>{current.summary}</p> : null}
        </div>
        <div className="node-run-side-effect-grid">
          {Object.entries(sideEffects).filter(([, value]) => typeof value === "boolean").map(([key, value]) => (
            <div key={key} className="node-run-side-effect">
              <span>{key.replace(/_/g, " ")}</span>
              <strong>{value ? "enabled" : "off"}</strong>
            </div>
          ))}
          {!Object.keys(sideEffects).length ? <div className="node-run-empty">还没有 side-effect 快照。</div> : null}
        </div>
      </div>
      <div className="section-title"><span>运行上下文</span><span>Runtime / Instance</span></div>
      <div className="node-run-context-grid compact">
        <article>
          <strong>Runtime</strong>
          <KeyValues data={runtimeContext} />
        </article>
        <article>
          <strong>Instance</strong>
          <KeyValues data={instanceContext} />
        </article>
      </div>
      <div className="section-title"><span>本次能力挂载</span><span>{Object.keys(capabilityOverrides).length}</span></div>
      {Object.keys(capabilityOverrides).length ? (
        <div className="node-run-raw-config always-open">
          <code>{formatValue(capabilityOverrides)}</code>
        </div>
      ) : <div className="node-run-empty">本次运行没有显式 capability override。</div>}
      {Object.keys(definitionReports).length ? (
        <>
          <div className="section-title"><span>定义保存结果</span><span>scope</span></div>
          <div className="node-run-raw-config always-open">
            <code>{formatValue(definitionReports)}</code>
          </div>
        </>
      ) : null}
      <div className="section-title"><span>需要处理</span><span>{issues.length}</span></div>
      {issues.map((item, index) => (
        <article key={item.id || `${item.target || "issue"}-${index}`} className={`node-run-fix-card ${nodeRunCardTone(issueTone(item.severity))}`}>
          <div className="node-run-fix-head">
            <span className={`status-pill ${nodeRunTone(issueTone(item.severity))}`}>{item.severity || "warning"}</span>
            <small>{item.target || "configuration"}</small>
          </div>
          <strong>{item.title || "Suggested fix"}</strong>
          {item.message ? <p>{item.message}</p> : null}
          {item.action ? <small>{item.action}</small> : null}
          {item.relatedConfigKeys?.length ? <code>{item.relatedConfigKeys.join(", ")}</code> : null}
        </article>
      ))}
      {!issues.length ? <div className="node-run-empty">当前诊断没有给出必须修复项。</div> : null}
      <details className="node-run-config-details">
        <summary><span>本次加载的运行配置</span><em>{environment.length}</em><ChevronDown size={14} /></summary>
        {environment.map((item) => (
          <article key={item.id || `${item.capability || "config"}-${item.key}-${item.source || ""}`} className={`node-run-config-card ${item.present === false ? "err" : nodeRunCardTone(item.status || "")}`}>
            <div>
              <strong>{item.label || item.key}</strong>
              <span className={`status-pill ${nodeRunTone(item.present === false ? "failed" : item.status || "done")}`}>{item.present === false ? "missing" : item.sourceKind || "loaded"}</span>
            </div>
            <div className="node-run-env-meta">
              <span>{item.capability || "runtime"}</span>
              <span>{item.source || "-"}</span>
              {item.required ? <span>required</span> : null}
            </div>
            <code>{item.value || (item.present === false ? "missing" : "-")}</code>
          </article>
        ))}
        {!environment.length ? (
          Object.keys(configs).length ? (
            <details className="node-run-raw-config">
              <summary><span>查看原始配置解析</span><ChevronDown size={14} /></summary>
              <code>{formatValue(configs)}</code>
            </details>
          ) : <Empty text="还没有配置解析结果" />
        ) : (
          <details className="node-run-raw-config">
            <summary><span>原始配置解析</span><ChevronDown size={14} /></summary>
            <code>{formatValue(configs)}</code>
          </details>
        )}
      </details>
    </div>
  );
}

function NodeRunDetail({
  result,
  events,
  onRetry,
  showBanner = true,
  showFlow = true,
}: {
  result: NodeRunResult | undefined;
  events: NodeRunEvent[];
  onRetry: (retryOf: string) => void;
  showBanner?: boolean;
  showFlow?: boolean;
}) {
  if (!result) return <div className="node-run-empty">选择或创建一个 Node Run 查看详情。</div>;
  const detail = detailRecord(result.detail);
  const resolvedInputs = detailList(detail.resolved_inputs);
  const missingInputs = detailList(detail.missing_inputs);
  const live = nodeRunIsLive(result);
  return (
    <div className="node-run-detail">
      {showBanner ? <div className={`node-run-result-banner ${nodeRunTone(result.status)}`}>
        <div>
          <strong>{result.nodeRunId}</strong>
          <span>{nodeRunModeLabel(result.mode || "preflight")} · {nodeRunInputSourceLabel(result.inputSource || "generated-fixture")} · {result.status || "unknown"}</span>
        </div>
        <div className="node-run-banner-actions">
          {live ? <span className="status-pill running"><Loader2 size={12} className="spin" />live</span> : null}
          <span>{formatBeijingTime(result.startedAt, "未开始")}{result.finishedAt ? ` -> ${formatBeijingTime(result.finishedAt)}` : ""}</span>
          {typeof result.elapsedMs === "number" ? <span>{formatElapsed(result.elapsedMs)}</span> : null}
          {result.retryOf ? <span>retry of {shortId(result.retryOf)}</span> : null}
          <button type="button" className="btn subtle node-run-retry-btn" onClick={() => onRetry(result.nodeRunId)}><RefreshCw size={13} />重试 Node Run</button>
        </div>
        {result.reason ? <p>{result.reason}</p> : null}
      </div> : null}
      {showFlow ? <NodeRunFlow result={result} /> : null}
      {showFlow ? <DetailBlock title="执行节点逻辑">
        <NodeRunInnerFlow result={result} />
      </DetailBlock> : null}
      <div className="node-run-detail-grid">
        <DetailBlock title="已解析输入">
          {resolvedInputs.length ? (
            <div className="node-test-detail">
              {resolvedInputs.map((item) => (
                <span key={String(item.name)} className="kv good">{String(item.name)}: {String(item.value ?? "").slice(0, 90)}</span>
              ))}
            </div>
          ) : <Empty text="没有已解析输入" />}
          {missingInputs.length ? (
            <div className="node-test-detail">
              {missingInputs.map((item) => (
                <span key={String(item.name)} className="kv bad">{String(item.name)}: {String(item.reason || "missing")}</span>
              ))}
            </div>
          ) : null}
        </DetailBlock>
        <DetailBlock title="事件">
          <div className="node-run-events">
            {(events.length ? events : result.events || []).slice(-18).map((event, index) => (
              <div key={`${event.event}-${event.stepId || index}`} className="node-test-event">
                <span>{event.sequence || index + 1}</span>
                <strong>{event.event}</strong>
                <small>{event.stepId || ""}{event.ts ? ` · ${formatBeijingTime(event.ts)}` : ""}</small>
                {event.data?.summary ? <small>{String(event.data.summary)}</small> : null}
              </div>
            ))}
            {!(events.length || result.events?.length) ? <Empty text="没有事件记录" /> : null}
          </div>
        </DetailBlock>
        <DetailBlock title="产物">
          <div className="node-test-artifacts">
            {(result.artifacts || []).map((artifact) => <code key={artifact.id || artifact.path}>{artifact.path || artifact.title}</code>)}
            {!result.artifacts?.length ? <Empty text="没有产物记录" /> : null}
          </div>
        </DetailBlock>
      </div>
    </div>
  );
}

function useNodeRunController({
  provider,
  runtime,
  instance,
  workflowId,
  node,
  runs,
  mode,
  selectedNodeRunId,
  onOpenNodeRun,
}: {
  provider: SopDataProvider;
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  workflowId: string;
  node: NodeRegistryItem | undefined;
  runs: Run[];
  mode: DataMode;
  selectedNodeRunId: string;
  onOpenNodeRun: (nodeId: string, nodeRunId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [runMode, setRunMode] = useState<NodeRunMode>(DEFAULT_NODE_RUN_MODE);
  const [inputSource, setInputSource] = useState<NodeRunCreateInput["inputSource"]>(DEFAULT_NODE_RUN_INPUT_SOURCE);
  const [seedRunId, setSeedRunId] = useState("");
  const [sourceNodeRunId, setSourceNodeRunId] = useState("");
  const [relayMode, setRelayMode] = useState<NodeRunRelayMode>("auto_by_target_inputs");
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([]);
  const [relayMappings, setRelayMappings] = useState<NodeRunRelayMapping[]>([]);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [runtimeOverrides, setRuntimeOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const nodeId = node?.nodeId || "";
  const instanceId = instance?.instanceId || "";
  const gitDefault = nodeCapabilityRecord(node, "git");
  const telegramDefault = nodeCapabilityRecord(node, "telegram");
  const [gitEnabled, setGitEnabled] = useState(Boolean(gitDefault.enabled ?? true));
  const [gitPathsText, setGitPathsText] = useState(nodeCapabilityPaths(node).join("\n"));
  const [gitSaveScope, setGitSaveScope] = useState("run");
  const [telegramEnabled, setTelegramEnabled] = useState(Boolean(telegramDefault.enabled ?? true));
  const [telegramSaveScope, setTelegramSaveScope] = useState("run");

  useEffect(() => {
    setGitEnabled(Boolean(nodeCapabilityRecord(node, "git").enabled ?? true));
    setGitPathsText(nodeCapabilityPaths(node).join("\n"));
    setGitSaveScope("run");
    setTelegramEnabled(Boolean(nodeCapabilityRecord(node, "telegram").enabled ?? true));
    setTelegramSaveScope("run");
    setRuntimeOverrides({});
  }, [nodeId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("test_source") === "existing-run" && params.get("test_run")) {
      setInputSource("existing-run");
      setSeedRunId(params.get("test_run") || "");
    }
    if (params.get("test_source") === "existing-node-run" && params.get("test_run")) {
      setInputSource("existing-node-run");
      setSourceNodeRunId(params.get("test_run") || "");
      const nextRelayMode = (params.get("relay_mode") || "auto_by_target_inputs") as NodeRunRelayMode;
      setRelayMode(["selected_outputs", "all_outputs", "auto_by_target_inputs"].includes(nextRelayMode) ? nextRelayMode : "auto_by_target_inputs");
      const decodedMappings = decodeRelayMappings(params.get("relay_map"));
      const outputs = (params.get("relay_outputs") || "").split(",").map((item) => item.trim()).filter(Boolean);
      setSelectedOutputs(outputs.length ? outputs : decodedMappings.map((item) => item.sourceOutput).filter(Boolean));
      setRelayMappings(decodedMappings);
    }
  }, [nodeId]);

  const historyQuery = useQuery({
    queryKey: queryKeys.nodeRuns(mode, runtime, instanceId, workflowId, nodeId),
    queryFn: () => provider.listNodeRuns(runtime!, instanceId, workflowId, nodeId),
    enabled: Boolean(runtime && instanceId && workflowId && nodeId),
  });
  const activeNodeRunId = selectedNodeRunId || historyQuery.data?.[0]?.nodeRunId || "";
  const detailQuery = useQuery({
    queryKey: queryKeys.nodeRun(mode, runtime, instanceId, workflowId, nodeId, activeNodeRunId),
    queryFn: () => provider.getNodeRun(runtime!, instanceId, workflowId, nodeId, activeNodeRunId),
    enabled: Boolean(runtime && instanceId && workflowId && nodeId && activeNodeRunId),
    refetchInterval: (query) => nodeRunIsLive(query.state.data) ? 1000 : false,
  });
  const eventsQuery = useQuery({
    queryKey: queryKeys.nodeRunEvents(mode, runtime, instanceId, workflowId, nodeId, activeNodeRunId),
    queryFn: () => provider.getNodeRunEvents(runtime!, instanceId, workflowId, nodeId, activeNodeRunId),
    enabled: Boolean(runtime && instanceId && workflowId && nodeId && activeNodeRunId),
    refetchInterval: () => nodeRunIsLive(detailQuery.data) ? 1000 : false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: NodeRunCreateInput) => provider.createNodeRun(runtime!, instanceId, workflowId, nodeId, payload),
    onSuccess: (result) => {
      setError("");
      queryClient.invalidateQueries({ queryKey: queryKeys.nodeRuns(mode, runtime, instanceId, workflowId, nodeId) });
      queryClient.setQueryData(queryKeys.nodeRun(mode, runtime, instanceId, workflowId, nodeId, result.nodeRunId), result);
      onOpenNodeRun(nodeId, result.nodeRunId);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  function startNodeRun(retryOf = "") {
    if (!runtime || !instance || !nodeId) return;
    const nodeRunId = makeNodeRunId(nodeId);
    const effectiveRelayMappings = inputSource === "existing-node-run" && relayMode === "selected_outputs"
      ? normalizeRelayMappingsForTarget(node, selectedOutputs, relayMappings)
      : relayMappings;
    const payload: NodeRunCreateInput = {
      nodeRunId,
      mode: runMode,
      inputSource,
      pipelineId: inputSource === "existing-run" ? seedRunId : undefined,
      sourceNodeRunId: inputSource === "existing-node-run" ? sourceNodeRunId : undefined,
      relayMode: inputSource === "existing-node-run" ? relayMode : undefined,
      selectedOutputs: inputSource === "existing-node-run" ? selectedOutputs : undefined,
      relayMappings: inputSource === "existing-node-run" ? effectiveRelayMappings : undefined,
      manualInputs,
      overrides: runtimeOverrides,
      capabilityOverrides: nodeRunCapabilityOverridePayload({
        gitEnabled,
        gitPathsText,
        gitSaveScope,
        telegramEnabled,
        telegramSaveScope,
      }),
      retryOf,
    };
    const optimistic = makeOptimisticNodeRun({
      runtimeId: runtime.id,
      instanceId,
      workflowId,
      nodeId,
      nodeTitle: node?.title,
      nodeRunId,
      mode: runMode,
      inputSource,
      retryOf,
    });
    queryClient.setQueryData(queryKeys.nodeRun(mode, runtime, instanceId, workflowId, nodeId, nodeRunId), optimistic);
    queryClient.setQueryData(queryKeys.nodeRunEvents(mode, runtime, instanceId, workflowId, nodeId, nodeRunId), optimistic.events || []);
    onOpenNodeRun(nodeId, nodeRunId);
    createMutation.mutate(payload);
  }

  const inputFields = Object.entries(node?.inputs || {});
  return {
    provider,
    runtime,
    instance,
    workflowId,
    node,
    runs,
    mode,
    nodeId,
    instanceId,
    runMode,
    setRunMode,
    inputSource,
    setInputSource,
    seedRunId,
    setSeedRunId,
    sourceNodeRunId,
    setSourceNodeRunId,
    relayMode,
    setRelayMode,
    selectedOutputs,
    setSelectedOutputs,
    relayMappings,
    setRelayMappings,
    manualInputs,
    setManualInputs,
    runtimeOverrides,
    setRuntimeOverrides,
    gitEnabled,
    setGitEnabled,
    gitPathsText,
    setGitPathsText,
    gitSaveScope,
    setGitSaveScope,
    telegramEnabled,
    setTelegramEnabled,
    telegramSaveScope,
    setTelegramSaveScope,
    error,
    historyQuery,
    activeNodeRunId,
    detailQuery,
    eventsQuery,
    createMutation,
    startNodeRun,
    inputFields,
    current: detailQuery.data,
    events: eventsQuery.data || [],
  };
}

function NodeRunInputPreview({ controller }: { controller: ReturnType<typeof useNodeRunController> }) {
  const rows = nodeRunInputPreviewRows(
    controller.node,
    controller.inputSource,
    controller.seedRunId,
    controller.sourceNodeRunId,
    controller.manualInputs,
    controller.relayMode,
    controller.selectedOutputs,
    controller.relayMappings,
  );
  return (
    <section className="node-run-input-preview">
      <div>
        <span className="status-pill waiting"><Info size={12} />输入预览</span>
        <strong>{nodeRunInputSourceLabel(controller.inputSource || DEFAULT_NODE_RUN_INPUT_SOURCE)}</strong>
        <small>{nodeRunInputSourceHelp(controller.inputSource)}</small>
      </div>
      <div className="node-run-input-preview-rows">
        {rows.map((row) => (
          <article key={row.key} className={row.missing ? "missing" : "ready"}>
            <div>
              <strong>{row.name}</strong>
              <code>{row.source || "-"}</code>
            </div>
            <code title={row.value}>{row.value}</code>
            <small>{row.logic}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function NodeRunStartPanel({
  controller,
  compact = false,
  title = "运行节点",
}: {
  controller: ReturnType<typeof useNodeRunController>;
  compact?: boolean;
  title?: string;
}) {
  const {
    runtime,
    instance,
    node,
    runs,
    runMode,
    setRunMode,
    inputSource,
    setInputSource,
    seedRunId,
    setSeedRunId,
    sourceNodeRunId,
    setSourceNodeRunId,
    relayMode,
    setRelayMode,
    selectedOutputs,
    setSelectedOutputs,
    relayMappings,
    setRelayMappings,
    manualInputs,
    setManualInputs,
    gitEnabled,
    setGitEnabled,
    gitPathsText,
    setGitPathsText,
    gitSaveScope,
    setGitSaveScope,
    telegramEnabled,
    setTelegramEnabled,
    telegramSaveScope,
    setTelegramSaveScope,
    createMutation,
    startNodeRun,
    inputFields,
    error,
  } = controller;
  const [showInheritedConfig, setShowInheritedConfig] = useState(false);
  if (!node || !instance || !runtime) return <div className="node-run-empty">选择 Runtime、Instance 和 Node 后才能创建 Node Run。</div>;
  return (
    <section className={`node-run-start-panel ${compact ? "compact" : ""}`}>
      <div className="node-run-start-head">
        <div>
          <strong>{title}</strong>
          <span>{runtime.id} · {instance.instanceId} · {node.nodeId}</span>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={createMutation.isPending || (inputSource === "existing-run" && !seedRunId) || (inputSource === "existing-node-run" && !sourceNodeRunId)}
          onClick={() => startNodeRun()}
        >
          {createMutation.isPending ? <Loader2 size={14} className="spin" /> : <Play size={14} />} 运行节点
        </button>
      </div>
      <div className="node-run-context-grid">
        <article>
          <strong>Runtime Context</strong>
          <KeyValues data={{
            runtime_id: runtime.id,
            endpoint: runtime.endpoint || runtime.channelUrl || "-",
            spi_base_url: runtime.spiBaseUrl || "-",
            local_status: runtime.localStatus || runtime.status || "-",
          }} />
        </article>
        <article>
          <strong>Instance Context</strong>
          <KeyValues data={{
            instance_id: instance.instanceId,
            repo: instance.repo || "-",
            repo_branch: instance.repoBranch || "-",
            wiki_local_path: instance.wikiLocalPath || "-",
            workspace_status: instance.workspaceStatus || "-",
            run_index_status: instance.runIndexStatus || "-",
          }} />
        </article>
      </div>
      <div className="node-run-health-strip">
        <div>
          <strong>Instance Health</strong>
          <span>运行前先确认 GitHub 与 TG 可用；这些测试复用 Instance 页面现有能力。</span>
        </div>
        <div className="instance-health-actions compact">
          <InstanceHealthTestButton provider={controller.provider} runtime={runtime} instance={instance} mode={controller.mode} kind="github" />
          <InstanceHealthTestButton provider={controller.provider} runtime={runtime} instance={instance} mode={controller.mode} kind="telegram" />
        </div>
      </div>
      <div className="node-run-controls">
        <label>模式
          <select value={runMode} onChange={(event) => setRunMode(event.target.value as NodeRunMode)}>
            <option value="real-node">真实执行</option>
            <option value="preflight">节点检查</option>
            <option value="probe">能力探测</option>
            <option value="dry-run">试运行计划</option>
          </select>
        </label>
        <label>输入来源
          <select value={inputSource || "generated-fixture"} onChange={(event) => setInputSource(event.target.value as NodeRunCreateInput["inputSource"])}>
            <option value="generated-fixture">默认示例输入</option>
            <option value="existing-run">历史 Workflow Run</option>
            <option value="existing-node-run">上游 Node Run</option>
            <option value="manual">手动输入</option>
            <option value="deepseek-mock">DeepSeek 模拟输入</option>
          </select>
        </label>
        {inputSource === "existing-run" ? (
          <label>Workflow Run
            <select value={seedRunId} onChange={(event) => setSeedRunId(event.target.value)}>
              <option value="">选择历史 Workflow Run</option>
              {runs.map((run) => <option key={run.pipelineId} value={run.pipelineId}>{run.pipelineId} · {run.status}</option>)}
            </select>
          </label>
        ) : null}
        {inputSource === "existing-node-run" ? (
          <>
            <label>Source Node Run
              <input
                value={sourceNodeRunId}
                onChange={(event) => setSourceNodeRunId(event.target.value)}
                placeholder="node-run-youtube-deep-research-..."
                autoComplete="off"
              />
            </label>
            <label>接力模式
              <select value={relayMode} onChange={(event) => setRelayMode(event.target.value as NodeRunRelayMode)}>
                <option value="auto_by_target_inputs">按目标输入自动匹配</option>
                <option value="selected_outputs">手动选择输出</option>
                <option value="all_outputs">传递整个输出包</option>
              </select>
            </label>
            {relayMode === "selected_outputs" ? (
              <>
                <label>选择输出
                  <input
                    value={selectedOutputs.join(",")}
                    onChange={(event) => {
                      const outputs = event.target.value.split(",").map((item) => item.trim()).filter(Boolean);
                      setSelectedOutputs(outputs);
                      setRelayMappings(normalizeRelayMappingsForTarget(node, outputs, relayMappings));
                    }}
                    placeholder="source_url, analysis_file"
                    autoComplete="off"
                  />
                </label>
                {selectedOutputs.length ? (
                  <div className="node-relay-inline-mapping">
                    {normalizeRelayMappingsForTarget(node, selectedOutputs, relayMappings).map((mapping) => {
                      const targetRows = nodeInputContractRows(node);
                      const targetSpec = targetRows.find((row) => row.name === mapping.targetInput)?.spec;
                      const resolvers = contractResolvers(targetSpec);
                      return (
                        <article key={mapping.sourceOutput}>
                          <code>{mapping.sourceOutput}</code>
                          <span>{"->"}</span>
                          <select
                            value={mapping.targetInput || ""}
                            onChange={(event) => setRelayMappings((current) => normalizeRelayMappingsForTarget(node, selectedOutputs, current).map((item) => (
                              item.sourceOutput === mapping.sourceOutput ? { ...item, targetInput: event.target.value, resolver: "" } : item
                            )))}
                          >
                            {targetRows.map((row) => <option key={row.name} value={row.name}>{row.name}{row.required ? " · 必填" : " · 可选"}</option>)}
                          </select>
                          <select
                            value={mapping.resolver || ""}
                            onChange={(event) => setRelayMappings((current) => normalizeRelayMappingsForTarget(node, selectedOutputs, current).map((item) => (
                              item.sourceOutput === mapping.sourceOutput ? { ...item, resolver: event.target.value } : item
                            )))}
                          >
                            <option value="">自动 resolver</option>
                            {resolvers.map((resolver) => <option key={resolver.id} value={resolver.id}>{resolver.label}</option>)}
                          </select>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {inputSource === "manual" ? inputFields.map(([name, spec]) => (
          <label key={name}>{name}
            <input
              type={isSecretField(name) ? "password" : "text"}
              value={manualInputs[name] || ""}
              onChange={(event) => setManualInputs((prev) => ({ ...prev, [name]: event.target.value }))}
              placeholder={String((spec as Record<string, unknown>)?.from || spec || "manual value")}
              autoComplete="off"
            />
          </label>
        )) : null}
      </div>
      <NodeRunInputPreview controller={controller} />
      <div className="node-run-config-disclosure">
        <button type="button" className="btn" onClick={() => setShowInheritedConfig((value) => !value)}>
          <Settings size={14} />{showInheritedConfig ? "隐藏运行配置" : "查看运行配置"}
        </button>
        <span>默认继承当前 Instance 的 GitHub / Telegram / Worker 等配置。</span>
      </div>
      {showInheritedConfig ? (
        <InheritedSettingsPanel
          provider={controller.provider}
          runtime={runtime}
          instance={instance}
          mode={controller.mode}
          nodeId={node.nodeId}
          title="运行配置继承"
          description="Node Run 只读取当前 Runtime、Instance 和 Settings 的解析结果；需要改默认值请回到 Settings，需要改工作区身份请回到 Instance。"
          compact
        />
      ) : null}
      <section className="node-run-capability-editor">
        <div className="section-title"><span>挂载能力</span><span>Runtime Harness</span></div>
        <article className={`node-run-capability-edit-card ${gitEnabled ? "enabled" : ""}`}>
          <label className="inline-check">
            <input type="checkbox" checked={gitEnabled} onChange={(event) => setGitEnabled(event.target.checked)} />
            <span>GitHub 持久化</span>
          </label>
          <small>把该节点产物保存到当前 Instance repo。路径来自 Node Definition，可按本次运行或当前 Instance 覆盖。</small>
          <label>
            <span>GitHub 保存路径</span>
            <textarea value={gitPathsText} onChange={(event) => setGitPathsText(event.target.value)} rows={4} disabled={!gitEnabled} />
          </label>
          <label>
            <span>保存范围</span>
            <select value={gitSaveScope} onChange={(event) => setGitSaveScope(event.target.value)} disabled={!gitEnabled}>
              <option value="run">仅本次运行</option>
              <option value="instance">保存到当前 Instance sop.yaml</option>
              <option value="project">生成项目默认变更请求</option>
            </select>
          </label>
        </article>
        <article className={`node-run-capability-edit-card ${telegramEnabled ? "enabled" : ""}`}>
          <label className="inline-check">
            <input type="checkbox" checked={telegramEnabled} onChange={(event) => setTelegramEnabled(event.target.checked)} />
            <span>Telegram 通知</span>
          </label>
          <small>使用当前 Instance 解析出的 TG token/chat_id 发送节点进度通知。</small>
          <label>
            <span>保存范围</span>
            <select value={telegramSaveScope} onChange={(event) => setTelegramSaveScope(event.target.value)} disabled={!telegramEnabled}>
              <option value="run">仅本次运行</option>
              <option value="instance">保存到当前 Instance sop.yaml</option>
              <option value="project">生成项目默认变更请求</option>
            </select>
          </label>
        </article>
      </section>
      {runMode === "real-node" ? <div className="node-run-warning"><AlertTriangle size={14} />真实执行会调用节点实际逻辑，并可能写入 Git、调用外部 API 或发送 TG 通知。</div> : null}
      {error ? <div className="node-test-result err">{error}</div> : null}
    </section>
  );
}

function NodeRunHistoryRows({
  controller,
  onOpenNodeRun,
  limit,
}: {
  controller: ReturnType<typeof useNodeRunController>;
  onOpenNodeRun: (nodeId: string, nodeRunId: string) => void;
  limit?: number;
}) {
  const items = controller.historyQuery.data || [];
  const visible = typeof limit === "number" ? items.slice(0, limit) : items;
  return (
    <div className="node-run-history-list">
      {visible.map((item) => (
        <button key={item.nodeRunId} type="button" className={controller.activeNodeRunId === item.nodeRunId ? "active" : ""} onClick={() => onOpenNodeRun(controller.nodeId, item.nodeRunId)}>
          <span className={`status-pill ${nodeRunTone(item.status)}`}>{item.status || "unknown"}</span>
          <strong>{shortId(item.nodeRunId)}</strong>
          <small>{nodeRunModeLabel(item.mode || "preflight")} · {nodeRunInputSourceLabel(item.inputSource || "generated-fixture")}</small>
          <small>{formatBeijingTime(item.startedAt || item.finishedAt, "")}</small>
        </button>
      ))}
      {controller.historyQuery.isLoading ? <div className="node-run-empty">加载 Node Run 历史...</div> : null}
      {!controller.historyQuery.isLoading && !visible.length ? <div className="node-run-empty">还没有 Node Run。</div> : null}
    </div>
  );
}

function NodeRunContextPanel({ controller, showRaw = false }: { controller: ReturnType<typeof useNodeRunController>; showRaw?: boolean }) {
  const result = controller.current;
  const detail = detailRecord(result?.detail);
  return (
    <div className="node-run-context-panel">
      <DetailBlock title="Run Context">
        <KeyValues data={{
          runtime: controller.runtime?.id || "-",
          instance: controller.instance?.instanceId || "-",
          workflow: controller.workflowId || "-",
          node: controller.node?.nodeId || "-",
          mode: result?.mode || controller.runMode,
          input_source: result?.inputSource || controller.inputSource || "-",
          relay_mode: result?.relayMode || controller.relayMode || "-",
          source_node_run: result?.sourceNodeRunId || controller.sourceNodeRunId || "-",
          selected_outputs: (result?.selectedOutputs?.length ? result.selectedOutputs : controller.selectedOutputs).join(", ") || "-",
          seed_workflow_run: result?.createdFrom || controller.seedRunId || "-",
          dry_run: result?.mode === "dry-run" ? "yes" : "-",
        }} />
      </DetailBlock>
      <DetailBlock title="Node Contract">
        <KeyValues data={{
          title: controller.node?.title || "-",
          inputs: Object.keys(controller.node?.inputs || {}).length,
          outputs: Object.keys(controller.node?.outputs || {}).length,
          executor: String(controller.node?.executor?.type || controller.node?.case || "node"),
          status: result?.status || "no run selected",
        }} />
      </DetailBlock>
      {showRaw ? <DetailBlock title="Raw Detail">
        <code className="node-run-raw-detail">{formatValue(detail)}</code>
      </DetailBlock> : null}
    </div>
  );
}

function NodeRunResultTabs({ result, events }: { result: NodeRunResult | undefined; events: NodeRunEvent[] }) {
  const [tab, setTab] = useState<"events" | "inputs" | "agent" | "artifacts" | "raw">("events");
  if (!result) return <div className="node-run-empty">选择一次 Node Run 后展示事件、输入和产物。</div>;
  const detail = detailRecord(result.detail);
  const resolvedInputs = detailList(detail.resolved_inputs);
  const missingInputs = detailList(detail.missing_inputs);
  const visibleEvents = events.length ? events : result.events || [];
  const coreOutputs = nodeRunCoreOutputRows(result);
  const diagnosticArtifacts = nodeRunDiagnosticArtifacts(result);
  const actualOutputs = detailRecord(result.actualOutputs);
  const validation = detailRecord(result.validation);
  return (
    <section className="node-run-results-panel">
      <div className="node-run-results-tabs" role="tablist" aria-label="Node run result sections">
        <button type="button" className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}>事件</button>
        <button type="button" className={tab === "inputs" ? "active" : ""} onClick={() => setTab("inputs")}>输入</button>
        <button type="button" className={tab === "agent" ? "active" : ""} onClick={() => setTab("agent")}>Agent Request</button>
        <button type="button" className={tab === "artifacts" ? "active" : ""} onClick={() => setTab("artifacts")}>产物</button>
        <button type="button" className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>原始数据</button>
      </div>
      {tab === "events" ? (
        <div className="node-run-events node-run-results-body">
          {visibleEvents.slice(-20).map((event, index) => (
            <div key={`${event.event}-${event.stepId || index}`} className="node-test-event">
              <span>{event.sequence || index + 1}</span>
              <strong>{event.event}</strong>
              <small>{event.stepId || ""}{event.ts ? ` · ${formatBeijingTime(event.ts)}` : ""}</small>
              {event.data?.summary ? <small>{String(event.data.summary)}</small> : null}
            </div>
          ))}
          {!visibleEvents.length ? <Empty text="没有事件记录" /> : null}
        </div>
      ) : null}
      {tab === "inputs" ? (
        <div className="node-run-results-body">
          <NodeRunInputArtifactsSummary result={result} step={(result.steps || []).find((item) => item.id === "resolve-inputs")} />
          <div className="node-test-detail">
            {resolvedInputs.map((item) => (
              <span key={String(item.name)} className="kv good">{String(item.name)}: {String(item.value ?? "").slice(0, 120)}</span>
            ))}
            {missingInputs.map((item) => (
              <span key={String(item.name)} className="kv bad">{String(item.name)}: {String(item.reason || "missing")}</span>
            ))}
          </div>
          {!(resolvedInputs.length || missingInputs.length) ? <Empty text="没有已解析输入" /> : null}
        </div>
      ) : null}
      {tab === "agent" ? (
        <div className="node-run-results-body">
          <NodeRunAgentRequestSummary result={result} step={(result.steps || []).find((item) => item.id === "generate-agent-request")} />
        </div>
      ) : null}
      {tab === "artifacts" ? (
        <div className="node-run-results-body">
          <div className="node-run-artifact-summary">
            <div>
              <span className={`status-pill ${nodeRunTone(String(validation.status || result.status || ""))}`}>{String(validation.status || result.status || "unknown")}</span>
              <strong>{coreOutputs.length} 个核心输出</strong>
              <small>{coreOutputs.length ? coreOutputs.map((item) => item.name).join(", ") : "暂无声明输出记录"}</small>
            </div>
          </div>
          {Object.keys(actualOutputs).length ? (
            <div className="node-run-output-map">
              {Object.entries(actualOutputs).map(([key, value]) => (
                <span key={key}><b>{key}</b>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</span>
              ))}
            </div>
          ) : null}
          <DetailBlock title={`核心输出 · ${coreOutputs.length}`}>
            <NodeRunCoreOutputsSummary result={result} />
          </DetailBlock>
          <DetailBlock title={`接力包 · ${result.relayPackage?.items?.length || 0}`}>
            <NodeRunRelayPackageSummary result={result} />
          </DetailBlock>
          {diagnosticArtifacts.length ? (
            <DetailBlock title={`执行证据 · ${diagnosticArtifacts.length}`}>
              <NodeRunExecutionEvidenceSummary result={result} />
            </DetailBlock>
          ) : null}
          {!coreOutputs.length && !diagnosticArtifacts.length ? <Empty text="没有产物记录" /> : null}
        </div>
      ) : null}
      {tab === "raw" ? (
        <div className="node-run-results-body">
          <code className="node-run-raw-detail">{formatValue(detail)}</code>
        </div>
      ) : null}
    </section>
  );
}

function NodeRunActiveStepCard({ result }: { result: NodeRunResult | undefined }) {
  const steps = (result?.steps || []).map((step) => localizedNodeRunStep(step, result?.nodeId));
  const current = currentNodeRunStep({ ...result, steps });
  const done = steps.filter((step) => ["done", "ok"].includes(step.status)).length;
  const failed = steps.filter((step) => ["failed", "blocked", "needs_input"].includes(step.status)).length;
  const progress = steps.length ? Math.round(((done + failed) / steps.length) * 100) : 0;
  return (
    <section className={`node-run-current-step ${nodeRunCardTone(current?.status || result?.status || "")}`}>
      <div>
        <span className={`status-pill ${nodeRunTone(result?.status)}`}>{result?.status || "loading"}</span>
        <strong>{current?.title || "等待 Node Run"}</strong>
        <p>{current?.summary || result?.reason || "Node Run 工作台正在加载。"}</p>
      </div>
      <div className="node-run-progress-meter" aria-label="Node run progress">
        <span><b style={{ width: `${Math.max(4, progress)}%` }} /></span>
        <small>{done}/{steps.length || 0} 完成{failed ? ` · ${failed} 失败` : ""}</small>
      </div>
      {current ? <code>{current.id} · {current.status}{nodeRunStepTiming(current) ? ` · ${nodeRunStepTiming(current)}` : ""}</code> : null}
    </section>
  );
}

function NodeRunCapabilitySummary({ result }: { result: NodeRunResult | undefined }) {
  const rows = nodeRunCapabilityRows(result);
  const validation = detailRecord(result?.validation);
  const artifacts = nodeRunBusinessArtifacts(result);
  return (
    <section className="node-run-capability-summary">
      <div className="section-title"><span>执行结果</span><span>{rows.length} 个能力</span></div>
      <div className="node-run-result-mini-grid">
        <div>
          <span>输出产物</span>
          <strong>{artifacts.length}</strong>
          <small>{String(validation.status || result?.status || "unknown")}</small>
        </div>
        <div>
          <span>业务节点</span>
          <strong>{result?.status || "-"}</strong>
          <small>{result?.elapsedMs ? formatElapsed(result.elapsedMs) : "-"}</small>
        </div>
      </div>
      <div className="node-run-capability-list">
        {rows.map((row) => (
          <article key={row.key} className={`node-run-capability-card ${nodeRunCardTone(row.status)}`}>
            <div>
              <span className={`status-pill ${nodeRunTone(row.status)}`}>{row.status}</span>
              <strong>{row.label}</strong>
            </div>
            {row.key === "git" || row.key === "github" ? (
              <div className="node-run-capability-facts">
                <span>{nodeRunGitFileGroups(row.detail, result).changedFiles.length} files</span>
                <span>{String(row.detail.commit || "-")}</span>
                <span>{row.detail.pushed ? "pushed" : "not pushed"}</span>
              </div>
            ) : null}
            {row.key === "telegram" || row.key === "tg" ? (
              <div className="node-run-capability-facts">
                <span>{detailList(row.detail.history).length || 1} sends</span>
                <span>{nodeRunStringArray(row.detail.triggers).join(", ") || String(row.detail.trigger || "-")}</span>
              </div>
            ) : null}
            {row.reason ? <p>{row.reason}</p> : <p>No issue reported.</p>}
            {row.action ? <small>{row.action}</small> : null}
            {(row.key === "git" || row.key === "github") ? <small>点击执行流程里的 Persist to GitHub 查看推送文件和 commit。</small> : null}
            {(row.key === "telegram" || row.key === "tg") ? <small>点击执行流程里的 Send Telegram notification 查看发送记录。</small> : null}
          </article>
        ))}
        {!rows.length ? <Empty text="本次 Node Run 没有记录 capability 结果" /> : null}
      </div>
    </section>
  );
}

function NodeDetailOverviewPanel({
  node,
  modules,
  selectedModuleId,
  loading,
  onSelectModule,
}: {
  node: NodeRegistryItem | undefined;
  modules: NodeModule[];
  selectedModuleId?: string;
  loading: boolean;
  onSelectModule: (moduleId: string) => void;
}) {
  if (loading) return <Skeleton />;
  if (!node) return <Empty text="没有选中的 Node" />;
  const inputs = Object.keys(node.inputs || {});
  const outputs = Object.keys(node.outputs || {});
  return (
    <section className="node-detail-overview-panel">
      <div className="node-detail-overview-hero">
        <div>
          <span className="status-pill done">{String(node.executor?.type || node.case || "node")}</span>
          <h2>{node.title || node.nodeId}</h2>
          <p>{node.description || contractSummary(node)}</p>
        </div>
        <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>{(node.missingFields || []).length ? "review" : "ready"}</span>
      </div>
      <div className="node-detail-overview-grid">
        <article>
          <strong>Contract</strong>
          <span>{inputs.length} inputs · {outputs.length} outputs</span>
          <code>{contractSummary(node)}</code>
        </article>
        <article>
          <strong>Execution</strong>
          <span>{String(node.executor?.type || node.case || "node")}</span>
          <code>{String(node.executor?.skill || node.skill?.id || node.nodeId)}</code>
        </article>
        <article>
          <strong>Capabilities</strong>
          <span>Git · TG · SSE</span>
          <code>{node.infra?.tgNotify === false ? "telegram optional/off" : "telegram enabled"}</code>
        </article>
      </div>
      <div className="node-detail-module-strip">
        <span>节点详情</span>
        {modules.map((module) => (
          <button key={module.id} type="button" className={`btn ${selectedModuleId === module.id ? "active" : ""}`} onClick={() => onSelectModule(module.id)}>{module.title || module.id}</button>
        ))}
        {!modules.length ? <small>no modules</small> : null}
      </div>
    </section>
  );
}

function NodeInputContractPanel({ node, payload }: { node: NodeRegistryItem; payload: Record<string, unknown> }) {
  const rows = nodeInputContractRows(node);
  const bindings = rows
    .map((row) => ({ ...row, source: nodeInputSourceExpression(row.spec) }))
    .filter((row) => row.source.includes(".outputs."));
  const rawDefinition = {
    declared_inputs: node.inputs || {},
    optional_inputs: node.optionalInputs || {},
    schema: payload.schema || payload.declared_inputs || undefined,
  };
  return (
    <div className="node-contract-definition-view">
      <DetailBlock title={`输入契约 · ${rows.length}`}>
        <div className="node-contract-cards">
          {rows.map((row) => {
            const source = nodeInputSourceExpression(row.spec);
            const spec = contractRecord(row.spec);
            const accepts = Array.isArray(spec.accepts) ? spec.accepts.map(String).join(", ") : "-";
            const resolvers = contractResolvers(row.spec);
            return (
              <article key={row.name} className="node-contract-card">
                <div>
                  <span className={`status-pill ${row.required ? "running" : "waiting"}`}>{row.required ? "必填" : "可选"}</span>
                  <strong>{row.name}</strong>
                </div>
                <div className="node-run-step-meta-grid">
                  <span><b>kind</b>{String(spec.kind || spec.type || "auto")}</span>
                  <span><b>value_type</b>{String(spec.value_type || spec.format || spec.type || "-")}</span>
                  <span><b>accepts</b>{accepts}</span>
                  <span><b>source hint</b>{source || "-"}</span>
                  <span><b>resolvers</b>{resolvers.length ? resolvers.map((item) => item.id).join(", ") : "-"}</span>
                </div>
              </article>
            );
          })}
          {!rows.length ? <Empty text="该节点没有声明输入契约" /> : null}
        </div>
      </DetailBlock>
      <DetailBlock title={`Workflow 默认绑定 · ${bindings.length}`}>
        <div className="node-binding-list">
          {bindings.map((binding) => {
            const [fromNode, rest] = binding.source.split(".outputs.");
            return (
              <article key={`${binding.name}-${binding.source}`}>
                <span className="status-pill subtle">workflow binding</span>
                <strong>{fromNode || "-"} → {node.nodeId}</strong>
                <small>{binding.source} → {binding.name}</small>
                <small>这是当前 workflow 的默认连线，不是 Node Definition 的硬依赖。</small>
                {rest ? <code>{rest}</code> : null}
              </article>
            );
          })}
          {!bindings.length ? <Empty text="当前 workflow 没有为该节点返回默认绑定" /> : null}
        </div>
      </DetailBlock>
      <details className="node-run-step-raw">
        <summary><span>Raw Definition</span><ChevronDown size={14} /></summary>
        <code>{formatValue(rawDefinition)}</code>
      </details>
    </div>
  );
}

function NodeOutputContractPanel({ node, payload }: { node: NodeRegistryItem; payload: Record<string, unknown> }) {
  const outputs = nodeOutputContractRows(node);
  const rawDefinition = {
    declared_outputs: node.outputs || {},
    schema: payload.schema || payload.declared_outputs || undefined,
  };
  return (
    <div className="node-contract-definition-view">
      <DetailBlock title={`输出契约 · ${outputs.length}`}>
        <div className="node-contract-cards">
          {outputs.map((output) => (
            <article key={output.name} className="node-contract-card">
              <div>
                <span className="status-pill done">relayable</span>
                <strong>{output.name}</strong>
              </div>
              <div className="node-run-step-meta-grid">
                <span><b>kind</b>{String(contractRecord(output.spec).kind || output.type)}</span>
                <span><b>value_type</b>{String(contractRecord(output.spec).value_type || contractRecord(output.spec).format || output.type || "-")}</span>
                <span><b>default path</b>{output.path || "runtime value"}</span>
                <span><b>role</b>{String(contractRecord(output.spec).role || "relay-output")}</span>
              </div>
            </article>
          ))}
          {!outputs.length ? <Empty text="该节点没有声明输出契约" /> : null}
        </div>
      </DetailBlock>
      <DetailBlock title="接力规则">
        <div className="node-relay-rules">
          <article><strong>自动匹配</strong><span>根据目标节点输入契约和 workflow 默认绑定选择 source output。</span></article>
          <article><strong>手动选择</strong><span>用户在接力弹窗中选择一个或多个 output，例如 source_url、analysis_file。</span></article>
          <article><strong>整包传递</strong><span>显式把所有 relayable outputs 物化为下游输入；manifest 只作为索引。</span></article>
        </div>
      </DetailBlock>
      <details className="node-run-step-raw">
        <summary><span>Raw Definition</span><ChevronDown size={14} /></summary>
        <code>{formatValue(rawDefinition)}</code>
      </details>
    </div>
  );
}

function NodeModuleInlinePanel({
  node,
  module,
  detail,
  loading,
}: {
  node: NodeRegistryItem | undefined;
  module: NodeModule | undefined;
  detail: NodeModuleDetail | undefined;
  loading: boolean;
}) {
  if (loading) return <section className="module-detail-panel inline-module-detail"><Skeleton /></section>;
  if (!node || !module) return <section className="module-detail-panel inline-module-detail"><Empty text="选择模块查看详情" /></section>;
  const payload = detail?.detail || {};
  if (module.id === "inputs") {
    return (
      <section className="module-detail-panel inline-module-detail">
        <div className="panel-head compact">
          <div><strong>输入契约</strong><span>Node Definition 只声明需要什么；实际 resolved inputs 只在 Node Run Detail 展示。</span></div>
          <span className="status-pill done">Definition</span>
        </div>
        <NodeInputContractPanel node={node} payload={payload} />
      </section>
    );
  }
  if (module.id === "outputs") {
    return (
      <section className="module-detail-panel inline-module-detail">
        <div className="panel-head compact">
          <div><strong>输出契约</strong><span>这些 outputs 是接力选择的规范，不是某次运行产物列表。</span></div>
          <span className="status-pill done">Definition</span>
        </div>
        <NodeOutputContractPanel node={node} payload={payload} />
      </section>
    );
  }
  return (
    <section className="module-detail-panel inline-module-detail">
      <div className="panel-head compact">
        <div><strong>{module.title || module.id}</strong><span>{module.description || "节点模块详情"}</span></div>
        <span className={`status-pill ${module.status}`}>{module.status}</span>
      </div>
      <div className="module-detail-body">
        {(module.lane || module.contractVersion || module.schema?.length || module.metrics) && (
          <div className="module-contract-strip">
            {module.lane && <span>{module.lane}</span>}
            {module.contractVersion && <span>{module.contractVersion}</span>}
            {module.schema?.slice(0, 6).map((item) => <code key={item}>{item}</code>)}
            {module.metrics && Object.entries(module.metrics).slice(0, 4).map(([key, value]) => (
              <span key={key}>{key}: {String(value)}</span>
            ))}
          </div>
        )}
        <DetailBlock title="模块详情">
          <KeyValues data={payload} />
        </DetailBlock>
        {module.id === "skill" && <DetailBlock title="Skill README"><pre className="log-box compact-log">{String((payload.skill_readme as string) || node.skillReadme || "No README")}</pre></DetailBlock>}
        {module.id === "artifacts" && <DetailBlock title="产物"><ArtifactList artifacts={((payload.artifacts as Artifact[]) || [])} /></DetailBlock>}
        {module.id === "actions" && <DetailBlock title="CLI"><KeyValues data={(payload.cli as Record<string, unknown>) || node.cli || {}} /></DetailBlock>}
      </div>
    </section>
  );
}

function NodeRunsIndexPage({
  provider,
  runtime,
  instance,
  workflowId,
  node,
  runs,
  mode,
  onOpenNode,
  onOpenNodeRun,
}: {
  provider: SopDataProvider;
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  workflowId: string;
  node: NodeRegistryItem | undefined;
  runs: Run[];
  mode: DataMode;
  onOpenNode: (nodeId: string) => void;
  onOpenNodeRun: (nodeId: string, nodeRunId: string) => void;
}) {
  const controller = useNodeRunController({ provider, runtime, instance, workflowId, node, runs, mode, selectedNodeRunId: "", onOpenNodeRun });
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const items = (controller.historyQuery.data || []).filter((item) => {
    const matchesStatus = statusFilter === "all" || String(item.status || "") === statusFilter;
    const haystack = `${item.nodeRunId} ${item.mode || ""} ${item.inputSource || ""}`.toLowerCase();
    return matchesStatus && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  });
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [statusFilter, search, node?.nodeId]);
  return (
    <section className="node-runs-page">
      <div className="node-page-header">
        <div>
          <span className="status-pill running"><Activity size={13} />节点运行</span>
          <h1>{node?.title || node?.nodeId || "节点运行"}</h1>
          <p>{runtime?.id || "Runtime"} · {instance?.instanceId || "Instance"} · {workflowId}</p>
        </div>
        <div className="node-page-actions">
          <button type="button" className="btn" disabled={!node} onClick={() => node && onOpenNode(node.nodeId)}>返回节点</button>
        </div>
      </div>
      <div className="node-runs-index-grid">
        <aside className="node-runs-side-panel">
          <NodeRunStartPanel controller={controller} title="启动节点运行" />
          <div className="node-run-start-note">运行节点会立即打开独立工作台，执行流程、事件和产物都在 Node Run Detail 页面展示。</div>
        </aside>
        <section className="node-runs-table-panel">
          <div className="panel-head compact">
            <div><strong>运行历史</strong><span>{items.length}/{controller.historyQuery.data?.length || 0} 条记录 · 第 {currentPage}/{pageCount} 页</span></div>
            <span className="status-pill done">{mode}</span>
          </div>
          <div className="node-runs-tools">
            <label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Node Run" /></label>
            <label className="filter-box"><SlidersHorizontal size={14} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="done">完成</option><option value="running">运行中</option><option value="failed">失败</option><option value="waiting">等待</option></select></label>
          </div>
          <div className="node-runs-table">
            {pagedItems.map((item) => (
              <article key={item.nodeRunId} className={`node-run-table-row ${nodeRunCardTone(item.status)}`}>
                <div>
                  <span className={`status-pill ${nodeRunTone(item.status)}`}>{item.status || "unknown"}</span>
                  <strong>{item.nodeRunId}</strong>
                  <small>{nodeRunModeLabel(item.mode || "preflight")} · {nodeRunInputSourceLabel(item.inputSource || "generated-fixture")}</small>
                </div>
                <div>
                  <span>{formatBeijingTime(item.startedAt, "未开始")}</span>
                  <span>{typeof item.elapsedMs === "number" ? formatElapsed(item.elapsedMs) : formatBeijingTime(item.finishedAt)}</span>
                </div>
                <button type="button" className="btn primary" onClick={() => onOpenNodeRun(controller.nodeId, item.nodeRunId)}>打开运行</button>
              </article>
            ))}
            {controller.historyQuery.isLoading ? <Skeleton /> : null}
            {!controller.historyQuery.isLoading && !items.length ? <Empty text="没有匹配的 Node Run" /> : null}
          </div>
          {items.length > pageSize ? (
            <div className="node-runs-pagination">
              <button type="button" className="btn" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
              <span>{(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, items.length)} / {items.length}</span>
              <button type="button" className="btn" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</button>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function NodeRunDetailPage({
  provider,
  runtime,
  instance,
  workflowId,
  node,
  runs,
  mode,
  selectedNodeRunId,
  onOpenNode,
  onOpenNodeRuns,
  onOpenNodeRun,
  relayTargets,
  onRelayNodeRun,
  onOpenSettings,
}: {
  provider: SopDataProvider;
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  workflowId: string;
  node: NodeRegistryItem | undefined;
  runs: Run[];
  mode: DataMode;
  selectedNodeRunId: string;
  onOpenNode: (nodeId: string) => void;
  onOpenNodeRuns: (nodeId: string) => void;
  onOpenNodeRun: (nodeId: string, nodeRunId: string) => void;
  relayTargets: NodeRelayTarget[];
  onRelayNodeRun: (nodeId: string, sourceNodeRunId: string, options?: NodeRelayOptions) => void;
  onOpenSettings: () => void;
}) {
  const controller = useNodeRunController({ provider, runtime, instance, workflowId, node, runs, mode, selectedNodeRunId, onOpenNodeRun });
  const result = controller.current;
  const live = nodeRunIsLive(result);
  const localizedSteps = (result?.steps || []).map((step) => localizedNodeRunStep(step, result?.nodeId));
  const current = currentNodeRunStep({ ...result, steps: localizedSteps });
  const [selectedStepId, setSelectedStepId] = useState(() => readSearchParam("step"));
  const [relayOpen, setRelayOpen] = useState(false);
  const [relaySearch, setRelaySearch] = useState("");
  const [relayMode, setRelayMode] = useState<NodeRunRelayMode>("auto_by_target_inputs");
  const [selectedRelayOutputs, setSelectedRelayOutputs] = useState<string[]>([]);
  const [selectedRelayTargetId, setSelectedRelayTargetId] = useState("");
  const [relayMappings, setRelayMappings] = useState<NodeRunRelayMapping[]>([]);
  const stepKey = (result?.steps || []).map((step) => step.id).join("|");
  const sourceOutputRows = useMemo(() => nodeOutputContractRows(node, result), [node?.nodeId, result?.nodeRunId, result?.relayPackage?.items?.length]);
  const sourceOutputNames = sourceOutputRows.map((item) => item.name).filter(Boolean);
  const filteredRelayTargets = useMemo(() => {
    const needle = relaySearch.trim().toLowerCase();
    if (!needle) return relayTargets;
    return relayTargets.filter((item) => {
      const haystack = [
        item.node.nodeId,
        item.node.title,
        item.node.description,
        item.reason,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [relaySearch, relayTargets]);
  const recommendedRelayCount = relayTargets.filter((item) => item.recommended).length;
  const selectedRelayTarget = relayTargets.find((item) => item.node.nodeId === selectedRelayTargetId) || relayTargets[0];
  const relayMappingRows = relayMode === "selected_outputs"
    ? normalizeRelayMappingsForTarget(selectedRelayTarget?.node, selectedRelayOutputs, relayMappings)
    : [];
  const relayReady = Boolean(selectedRelayTarget) && (relayMode !== "selected_outputs" || selectedRelayOutputs.length > 0);
  function toggleRelayOutput(name: string) {
    if (!name) return;
    setSelectedRelayOutputs((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  }
  useEffect(() => {
    removeSearchParams(["test_source", "test_run"], "replace");
  }, [selectedNodeRunId]);
  useEffect(() => {
    if (!relayOpen || selectedRelayTargetId || !relayTargets.length) return;
    setSelectedRelayTargetId((relayTargets.find((item) => item.recommended) || relayTargets[0]).node.nodeId);
  }, [relayOpen, selectedRelayTargetId, relayTargets]);
  useEffect(() => {
    const onPopState = () => setSelectedStepId(readSearchParam("step"));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const steps = result?.steps || [];
    if (!steps.length) return;
    const routeStepId = readSearchParam("step");
    const fallback = current?.id || steps[0]?.id || "";
    const routeStepExists = Boolean(routeStepId && steps.some((step) => step.id === routeStepId));
    const previousExists = Boolean(selectedStepId && steps.some((step) => step.id === selectedStepId));
    const nextStepId = routeStepExists ? routeStepId : previousExists ? selectedStepId : fallback;
    if (nextStepId && selectedStepId !== nextStepId) setSelectedStepId(nextStepId);
    if (nextStepId && routeStepId !== nextStepId) writeSearchParam("step", nextStepId, "replace");
  }, [result?.nodeRunId, stepKey, current?.id, selectedStepId]);
  function selectNodeRunStep(stepId: string) {
    if (!stepId) return;
    setSelectedStepId(stepId);
    writeSearchParam("step", stepId, "push");
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      window.prompt("Copy Node Run URL", window.location.href);
    }
  }
  return (
    <section className="node-run-detail-page">
      <div className="node-run-detail-header">
        <div>
          <div className="node-run-breadcrumb">
            <span>{runtime?.id || "Runtime"}</span>
            <span>{instance?.instanceId || "Instance"}</span>
            <span>{workflowId}</span>
            <span>{node?.nodeId || "Node"}</span>
          </div>
          <h1>{node?.title || node?.nodeId || "Node Run"}</h1>
          <p>{selectedNodeRunId || "Select a node run"}</p>
        </div>
        <div className="node-run-detail-actions">
          {live ? <span className="status-pill running"><Loader2 size={12} className="spin" />live</span> : null}
          <span className={`status-pill ${nodeRunTone(result?.status)}`}>{result?.status || "loading"}</span>
          <button type="button" className="btn" disabled={!node} onClick={() => node && onOpenNode(node.nodeId)}>返回节点</button>
          <button type="button" className="btn" disabled={!node} onClick={() => node && onOpenNodeRuns(node.nodeId)}>运行列表</button>
          <button type="button" className="btn" onClick={copyLink}><Copy size={13} />复制链接</button>
          {result?.status === "done" && relayTargets.length ? (
            <button type="button" className="btn primary" onClick={() => setRelayOpen(true)}>
              <Play size={13} />接力到节点
            </button>
          ) : null}
          {result ? <button type="button" className="btn" onClick={() => controller.startNodeRun(result.nodeRunId)}><RefreshCw size={13} />重试</button> : null}
        </div>
      </div>
      {!selectedNodeRunId ? (
        <div className="node-run-empty">没有指定 Node Run。请返回 Node Runs 选择一次执行。</div>
      ) : (
        <>
          <div className="node-run-workspace-hero">
            <NodeRunActiveStepCard result={result} />
            <section className="node-run-workspace-summary">
              <strong>{live ? "Node Run 运行中" : "Node Run 快照"}</strong>
              <span>{current?.id || "no active step"}</span>
              <p>{result?.reason || current?.summary || "通过执行流程、事件和产物检查这次节点运行。"}</p>
            </section>
          </div>
          {relayOpen && result ? (
            <div className="modal-backdrop" role="presentation" onClick={() => setRelayOpen(false)}>
              <section className="trigger-modal node-relay-modal" role="dialog" aria-modal="true" aria-label="Relay node run" onClick={(event) => event.stopPropagation()}>
                <div className="modal-head">
                  <div>
                    <h2>接力到节点</h2>
                    <span>{result.nodeRunId} 的输出契约会按接力模式物化为目标节点输入</span>
                  </div>
                  <button type="button" className="ghost-btn" onClick={() => setRelayOpen(false)}><X size={16} />关闭</button>
                </div>
                <div className="node-relay-mode-panel">
                  <div>
                    <strong>传递什么</strong>
                    <span>{nodeRunRelayModeHelp(relayMode)}</span>
                  </div>
                  <div className="segmented compact">
                    <button type="button" className={relayMode === "auto_by_target_inputs" ? "active" : ""} onClick={() => setRelayMode("auto_by_target_inputs")}>自动匹配</button>
                    <button type="button" className={relayMode === "selected_outputs" ? "active" : ""} onClick={() => setRelayMode("selected_outputs")}>手动选择</button>
                    <button type="button" className={relayMode === "all_outputs" ? "active" : ""} onClick={() => setRelayMode("all_outputs")}>整包</button>
                  </div>
                </div>
                <div className="node-relay-outputs-panel">
                  <div className="section-title"><span>上游输出规范</span><span>{sourceOutputRows.length}</span></div>
                  <div className="node-relay-output-list">
                    {sourceOutputRows.map((output) => (
                      <label key={output.name} className={`node-relay-output-row ${relayMode === "selected_outputs" && selectedRelayOutputs.includes(output.name) ? "active" : ""}`}>
                        {relayMode === "selected_outputs" ? (
                          <input type="checkbox" checked={selectedRelayOutputs.includes(output.name)} onChange={() => toggleRelayOutput(output.name)} />
                        ) : <span className="dot done" />}
                        <span>
                          <strong>{output.name}</strong>
                          <small>{output.type} · {output.path || "runtime value"}</small>
                        </span>
                      </label>
                    ))}
                    {!sourceOutputRows.length ? <Empty text="当前节点没有声明输出契约；只能使用整包或运行结果中的 relay package。" /> : null}
                  </div>
                  {relayMode === "selected_outputs" && !selectedRelayOutputs.length ? <small className="field-hint bad">请选择至少一个输出。</small> : null}
                  {relayMode !== "selected_outputs" && sourceOutputNames.length ? <small className="field-hint">{nodeRunRelayModeLabel(relayMode)}会在后端解析，不会把 manifest.json 当成业务输入。</small> : null}
                </div>
                <label className="node-relay-search">
                  <span>选择目标 Node</span>
                  <input value={relaySearch} onChange={(event) => setRelaySearch(event.target.value)} placeholder="搜索节点名称、ID 或说明" />
                </label>
                <div className="node-relay-summary">
                  <span>{recommendedRelayCount} 个推荐节点</span>
                  <span>{relayTargets.length} 个可选节点</span>
                </div>
                <div className="node-relay-list">
                  {filteredRelayTargets.map((item) => (
                    <button
                      key={item.node.nodeId}
                      type="button"
                      className={`node-relay-row ${item.recommended ? "recommended" : ""} ${selectedRelayTarget?.node.nodeId === item.node.nodeId ? "active" : ""}`}
                      onClick={() => setSelectedRelayTargetId(item.node.nodeId)}
                    >
                      <span className="stage-letter">{item.node.ui?.stageLetter || item.node.nodeId.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{item.node.title || item.node.nodeId}</strong>
                        <small>{item.node.nodeId}</small>
                        <small>{item.node.description || contractSummary(item.node)}</small>
                      </span>
                      <span>
                        <em>{item.reason}</em>
                        <b className={`status-pill ${item.recommended ? "done" : "waiting"}`}>{item.recommended ? "推荐" : "可选"}</b>
                      </span>
                    </button>
                  ))}
                  {!filteredRelayTargets.length ? <Empty text="没有匹配的节点" /> : null}
                </div>
                {selectedRelayTarget ? (
                  <div className="node-relay-mapping-panel">
                    <div className="section-title"><span>目标输入契约</span><span>{nodeInputContractRows(selectedRelayTarget.node).length}</span></div>
                    <div className="node-run-input-preview-rows">
                      {nodeInputContractRows(selectedRelayTarget.node).map((row) => {
                        const spec = contractRecord(row.spec);
                        return (
                          <article key={row.name}>
                            <div>
                              <strong>{row.name}</strong>
                              <code>{String(spec.type || spec.kind || "auto")}{row.required ? " · required" : " · optional"}</code>
                            </div>
                            <small>{String(spec.from || "没有默认 workflow binding")}</small>
                            {contractResolvers(row.spec).length ? <small>resolvers: {contractResolvers(row.spec).map((resolver) => resolver.label).join(", ")}</small> : <small>resolvers: auto/direct</small>}
                          </article>
                        );
                      })}
                      {!nodeInputContractRows(selectedRelayTarget.node).length ? <Empty text="目标节点没有声明输入契约，建议先编辑节点定义。" /> : null}
                    </div>
                  </div>
                ) : null}
                {selectedRelayTarget && relayMode === "selected_outputs" ? (
                  <div className="node-relay-mapping-panel">
                    <div className="section-title"><span>输出到目标输入映射</span><span>{relayMappingRows.length}</span></div>
                    {relayMappingRows.map((mapping) => {
                      const targetRows = nodeInputContractRows(selectedRelayTarget.node);
                      const targetSpec = targetRows.find((row) => row.name === mapping.targetInput)?.spec;
                      const resolvers = contractResolvers(targetSpec);
                      return (
                        <article key={mapping.sourceOutput} className="node-relay-mapping-row">
                          <code>{mapping.sourceOutput}</code>
                          <span>{"->"}</span>
                          <select
                            value={mapping.targetInput || ""}
                            onChange={(event) => setRelayMappings((current) => normalizeRelayMappingsForTarget(selectedRelayTarget.node, selectedRelayOutputs, current).map((item) => (
                              item.sourceOutput === mapping.sourceOutput ? { ...item, targetInput: event.target.value, resolver: "" } : item
                            )))}
                          >
                            {targetRows.map((row) => <option key={row.name} value={row.name}>{row.name}{row.required ? " · 必填" : " · 可选"}</option>)}
                          </select>
                          <select
                            value={mapping.resolver || ""}
                            onChange={(event) => setRelayMappings((current) => normalizeRelayMappingsForTarget(selectedRelayTarget.node, selectedRelayOutputs, current).map((item) => (
                              item.sourceOutput === mapping.sourceOutput ? { ...item, resolver: event.target.value } : item
                            )))}
                          >
                            <option value="">自动 resolver</option>
                            {resolvers.map((resolver) => <option key={resolver.id} value={resolver.id}>{resolver.label}</option>)}
                          </select>
                        </article>
                      );
                    })}
                    {!relayMappingRows.length ? <Empty text="先选择至少一个上游输出，再配置它映射到目标节点的哪个输入。" /> : null}
                  </div>
                ) : null}
                <div className="node-relay-footer">
                  <div>
                    <strong>{selectedRelayTarget?.node.title || selectedRelayTarget?.node.nodeId || "未选择目标节点"}</strong>
                    <span>{relayMode === "selected_outputs" ? "手动映射会在运行前按目标输入契约校验。" : "运行时会按目标节点输入契约解析接力包。"}</span>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!relayReady}
                    onClick={() => {
                      if (!selectedRelayTarget) return;
                      onRelayNodeRun(selectedRelayTarget.node.nodeId, result.nodeRunId, {
                        relayMode,
                        selectedOutputs: relayMode === "selected_outputs" ? selectedRelayOutputs : [],
                        relayMappings: relayMode === "selected_outputs" ? relayMappingRows : [],
                      });
                      setRelayOpen(false);
                    }}
                  >
                    打开目标运行工作台
                  </button>
                </div>
              </section>
            </div>
          ) : null}
          <div className="node-run-detail-grid-page">
            <section className="node-run-workspace-main">
              <section className="node-run-flow-panel">
                <div className="panel-head compact"><div><strong>执行流程</strong><span>{result?.status || "loading"}</span></div></div>
                {controller.detailQuery.isLoading && !result ? <Skeleton /> : (
                  <NodeRunFlow
                    result={result}
                    events={controller.events}
                    selectedStepId={selectedStepId}
                    onSelectStep={selectNodeRunStep}
                  />
                )}
              </section>
              <details className="node-run-inner-details">
                <summary><span>执行节点逻辑</span><ChevronDown size={15} /></summary>
                <NodeRunInnerFlow result={result} />
              </details>
              <NodeRunResultTabs result={result} events={controller.events} />
            </section>
            <aside className="node-run-debug-panel">
              <NodeRunCapabilitySummary result={result} />
              <NodeRunConfigPanel result={result} />
              <details className="node-run-context-details">
                <summary><span>运行配置继承</span><ChevronDown size={15} /></summary>
                <InheritedSettingsPanel
                  provider={provider}
                  runtime={runtime}
                  instance={instance}
                  mode={mode}
                  nodeId={node?.nodeId}
                  title="配置来源"
                  description="这里展示本次 Node Run 解析到的 Settings/Runtime/Instance 配置。当前页面不保存上游配置；默认值请去 Settings，工作区身份请去 Instance。"
                  compact
                  onOpenSettings={onOpenSettings}
                />
              </details>
              <div className="node-run-repair-actions">
                <InstanceHealthTestButton provider={provider} runtime={runtime} instance={instance} mode={mode} kind="github" />
                <InstanceHealthTestButton provider={provider} runtime={runtime} instance={instance} mode={mode} kind="telegram" />
              </div>
              <details className="node-run-context-details">
                <summary><span>运行上下文</span><ChevronDown size={15} /></summary>
                <NodeRunContextPanel controller={controller} showRaw />
              </details>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

const EVENT_META: Record<string, { icon: string; label: string }> = {
  stage_start:        { icon: "RUN", label: "开始执行" },
  stage_done:         { icon: "OK", label: "执行完成" },
  stage_failed:       { icon: "ERR", label: "执行失败" },
  stage_skipped:      { icon: "SKIP", label: "已跳过" },
  tg_notify_sent:     { icon: "TG", label: "TG 通知" },
  tg_notify_failed:   { icon: "TG", label: "TG 通知失败" },
  pipeline_cancelled: { icon: "STOP", label: "Pipeline 已取消" },
  node_retry:         { icon: "RETRY", label: "节点重试" },
  node_cancelled:     { icon: "STOP", label: "节点已取消" },
};

function EventRow({ event }: { event: NodeEvent }) {
  const meta = EVENT_META[event.event] || { icon: "•", label: event.event };
  const time = formatBeijingTime(event.ts, "");
  const isTg = event.event.startsWith("tg_notify");
  const ok = event.ok !== false;
  let detail = "";
  if (event.duration_s) detail = `${event.duration_s}s`;
  else if (event.trigger) detail = `(${event.trigger})`;
  else if (event.error) detail = event.error.slice(0, 60);
  return (
    <div className={`event-row ${isTg && !ok ? "event-error" : ""}`}>
      <span className="event-icon">{meta.icon}</span>
      <span className="event-time">{time}</span>
      <span className="event-label">{meta.label}</span>
      {detail && <span className="event-detail">{detail}</span>}
      {isTg && <span className={`status-pill ${ok ? "done" : "failed"}`}>{ok ? "sent" : "failed"}</span>}
    </div>
  );
}

function CapabilityRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="capability-row">
      <span>{label}</span>
      <span className={`status-pill ${enabled ? "done" : "waiting"}`}>{enabled ? "enabled" : "disabled"}</span>
    </div>
  );
}

const StageNode = memo(({ data }: NodeProps<Node<StageNodeData>>) => {
  const { stage, status, selected, onSelect, onInfo } = data;
  return (
    <div className={`flow-node-wrap ${selected ? "selected" : ""}`}>
      <button type="button" className={`flow-node ${status}`} onClick={() => onSelect(stage.id)}>
        <Handle type="target" position={Position.Left} />
        <div className="node-top">
          <span className={`status-pill ${status}`}>{statusIcon(status)}{statusLabel(status)}</span>
          <span className="node-mode">{stage.branch || stage.mode}</span>
        </div>
        <div className="flow-node-title"><span className="stage-letter">{stage.ui?.stageLetter || stage.id.slice(0, 1).toUpperCase()}</span><strong>{stage.title}</strong></div>
        <span>{String(stage.executor?.type || stage.mode)} · {stage.id}</span>
        {stage.purpose && <span className="node-purpose">{stage.purpose}</span>}
        <div className="flow-capabilities" aria-label="Node capabilities">
          <span className={capabilityEnabled(stage.capabilities?.git) ? "on" : ""}>Git</span>
          <span className={capabilityEnabled(stage.capabilities?.telegram) ? "on" : ""}>TG</span>
          <span className={capabilityEnabled(stage.capabilities?.sse) ? "on" : ""}>SSE</span>
        </div>
        <div className="node-progress">
          <i style={{ width: status === "done" ? "100%" : status === "running" ? "62%" : status === "failed" ? "100%" : "0%" }} />
        </div>
        <Handle type="source" position={Position.Right} />
      </button>
      <button
        type="button"
        className="node-info-btn"
        title="查看节点配置"
        onClick={(e) => { e.stopPropagation(); onInfo(stage.id); }}
      >
        <Info size={13} />
      </button>
    </div>
  );
});

const nodeTypes = { stage: StageNode };

export default function App() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<DataMode>(getMode);
  const provider = useMemo(() => getProvider(mode), [mode]);
  const [route, setRoute] = useState<AppRoute>(readRoute);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const viewMode = route.view;
  const routeContext = useMemo(readRouteContext, [route]);
  const hasRuntimeRouteId = Boolean(routeContext.runtimeId);
  const initialEndpoint = useMemo(() => normalizeEndpoint(new URL(window.location.href).searchParams.get("endpoint") || ""), []);
  const initialManualRuntime = useMemo<Runtime | undefined>(() => initialEndpoint ? ({
    id: `manual:${initialEndpoint}`, name: initialEndpoint.replace(/^https?:\/\//, ""), endpoint: initialEndpoint,
    status: "manual", localStatus: "unknown", manual: true
  }) : undefined, [initialEndpoint]);
  const [manualRuntime, setManualRuntime] = useState<Runtime | undefined>(initialManualRuntime);
  const [manualEndpoint, setManualEndpoint] = useState(initialEndpoint);
  const [runtimeId, setRuntimeId] = useState(initialManualRuntime?.id || "");
  const [runtimeSwitcherOpen, setRuntimeSwitcherOpen] = useState(false);
  const [runtimeSwitchSearch, setRuntimeSwitchSearch] = useState("");
  const [instanceSwitcherOpen, setInstanceSwitcherOpen] = useState(false);
  const [instanceSwitchSearch, setInstanceSwitchSearch] = useState("");
  const [runtimeDirectorySearch, setRuntimeDirectorySearch] = useState("");
  const [runtimeDirectoryStatus, setRuntimeDirectoryStatus] = useState("active");
  const [runtimeDirectoryPage, setRuntimeDirectoryPage] = useState(1);
  const [instanceId, setInstanceId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("config");
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [runtimeManagementOpen, setRuntimeManagementOpen] = useState(false);
  const [triggerUrl, setTriggerUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const runtimeManagementDefaults = useMemo(readRuntimeManagementFormDefaults, []);
  const [runtimeManagementAction, setRuntimeManagementAction] = useState<RuntimeManagementAction>("create-runtime");
  const [runtimeCreateSshCommand, setRuntimeCreateSshCommand] = useState(runtimeManagementDefaults.createSshCommand);
  const [runtimeCreatePrivateKey, setRuntimeCreatePrivateKey] = useState(runtimeManagementDefaults.createPrivateKey);
  const [runtimeCreateEnvText, setRuntimeCreateEnvText] = useState(runtimeManagementDefaults.createEnvText);
  const [runtimeCreateConfigOverrides, setRuntimeCreateConfigOverrides] = useState<Record<string, string>>({});
  const [runtimeCreateMachineId, setRuntimeCreateMachineId] = useState("");
  const [runtimeDeleteTargetRuntimeId, setRuntimeDeleteTargetRuntimeId] = useState(runtimeManagementDefaults.deleteTargetRuntimeId);
  const [runtimeDeleteId, setRuntimeDeleteId] = useState(runtimeManagementDefaults.deleteRuntimeId);
  const [runtimeDeleteSshCommand, setRuntimeDeleteSshCommand] = useState(runtimeManagementDefaults.deleteSshCommand);
  const [runtimeDeletePrivateKey, setRuntimeDeletePrivateKey] = useState(runtimeManagementDefaults.deletePrivateKey);
  const [runtimeDeleteMachineId, setRuntimeDeleteMachineId] = useState("");
  const [runtimeDeleteForce, setRuntimeDeleteForce] = useState(runtimeManagementDefaults.deleteForce);
  const [runtimeDeleteConfirmed, setRuntimeDeleteConfirmed] = useState(false);
  const [instanceCreateId, setInstanceCreateId] = useState(runtimeManagementDefaults.instanceId);
  const [instanceCreateRepo, setInstanceCreateRepo] = useState(runtimeManagementDefaults.instanceRepo);
  const suggestedInstanceCreateId = useMemo(() => generateInstanceId(instanceCreateRepo), [instanceCreateRepo]);
  const [instanceTelegramTokenMode, setInstanceTelegramTokenMode] = useState<"global" | "override">("global");
  const [instanceTelegramToken, setInstanceTelegramToken] = useState("");
  const [instanceTelegramChatId, setInstanceTelegramChatId] = useState("");
  const [instanceDeleteId, setInstanceDeleteId] = useState(runtimeManagementDefaults.deleteInstanceId);
  const [instanceDeleteRepo, setInstanceDeleteRepo] = useState(runtimeManagementDefaults.deleteInstanceRepo);
  const [instanceDeleteForce, setInstanceDeleteForce] = useState(runtimeManagementDefaults.deleteInstanceForce);
  const [managementConfigValues, setManagementConfigValues] = useState<Record<string, string>>({});
  const [machineName, setMachineName] = useState("");
  const [machineSshCommand, setMachineSshCommand] = useState("");
  const [machineAuthType, setMachineAuthType] = useState<"private_key" | "password">("private_key");
  const [machinePrivateKey, setMachinePrivateKey] = useState("");
  const [machinePassword, setMachinePassword] = useState("");
  const [machineRole, setMachineRole] = useState("target");
  const [machineStatus, setMachineStatus] = useState("active");
  const [machineDuplicateReuseSecret, setMachineDuplicateReuseSecret] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [machineTestResult, setMachineTestResult] = useState<Record<string, unknown> | null>(null);
  const [machineSearch, setMachineSearch] = useState("");
  const [machineStatusFilter, setMachineStatusFilter] = useState("active");
  const [machineRoleFilter, setMachineRoleFilter] = useState("all");
  const [machineAuthFilter, setMachineAuthFilter] = useState("all");
  const [machinePage, setMachinePage] = useState(1);
  const [toast, setToast] = useState("");
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [nodeConfigId, setNodeConfigId] = useState("");
  const [rawLogOpen, setRawLogOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("closed");
  const [optimisticRuns, setOptimisticRuns] = useState<Run[]>([]);
  const [runOverlays, setRunOverlays] = useState<Record<string, RunOverlay>>({});
  const [executionSearch, setExecutionSearch] = useState("");
  const [executionFilter, setExecutionFilter] = useState<"all" | StageStatus>("all");
  const [executionPage, setExecutionPage] = useState(1);
  const [nodeSearch, setNodeSearch] = useState("");
  const [nodeFilter, setNodeFilter] = useState("all");
  const [selectedManagedNodeId, setSelectedManagedNodeId] = useState("");
  const [selectedNodeModuleId, setSelectedNodeModuleId] = useState("basic");
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftLocalError, setDraftLocalError] = useState("");
  const [confirmRealDraft, setConfirmRealDraft] = useState(false);
  const [draftInput, setDraftInput] = useState<NodeDraftInput>({
    skill_install_command: "bash <(curl -fsSL https://skill.vyibc.com/install-vyibc-face-consistent-album.sh)",
    skill_id: "vyibc-face-consistent-album",
    node_id: "youtube-cover-image",
    title: "YouTube Cover Image",
    description: "基于上游研究结果生成 YouTube 封面图候选。",
    upstream: "youtube-deep-research",
    upstream_output: "analysis_file",
    input_name: "research_report",
    output_name: "cover_images",
    output_path: "raw/generated-images/{pipeline_id}/cover-images.json"
  });
  const isRuntimeDirectory = viewMode === "runtime" && !hasRuntimeRouteId;
  const isInstanceDirectory = viewMode === "instance" && !routeContext.instanceId;
  const runtimeDirectoryPageSize = 25;
  const runtimeQueryOptions = isRuntimeDirectory
    ? {
      page: runtimeDirectoryPage,
      pageSize: runtimeDirectoryPageSize,
      q: runtimeDirectorySearch.trim(),
      status: runtimeDirectoryStatus === "all" ? undefined : runtimeDirectoryStatus,
      sort: "updated_at",
      order: "desc" as const,
    }
    : {
      page: 1,
      pageSize: 200,
      q: "",
      status: "active",
      sort: "updated_at",
      order: "desc" as const,
    };
  const runtimesQuery = useQuery({
    queryKey: [
      ...queryKeys.runtimes(mode),
      runtimeQueryOptions.page,
      runtimeQueryOptions.pageSize,
      runtimeQueryOptions.q || "",
      runtimeQueryOptions.status || "all",
    ],
    queryFn: async () => {
      if (provider.listRuntimeHosts) return provider.listRuntimeHosts(runtimeQueryOptions);
      const runtimes = await provider.listRuntimes(runtimeQueryOptions);
      return {
        runtimes,
        total: runtimes.length,
        page: runtimeQueryOptions.page,
        pageSize: runtimeQueryOptions.pageSize,
        hasMore: runtimes.length >= runtimeQueryOptions.pageSize,
        source: "legacy-provider",
      };
    },
    retry: 1,
  });
  const runtimes = useMemo(() => {
    const items = runtimesQuery.data?.runtimes || [];
    return manualRuntime && !items.some((item) => item.endpoint === manualRuntime.endpoint) ? [manualRuntime, ...items] : items;
  }, [manualRuntime, runtimesQuery.data]);
  const runtimeTotal = Math.max(runtimesQuery.data?.total ?? runtimes.length, runtimes.length);
  const runtimeHasMore = Boolean(runtimesQuery.data?.hasMore);
  const runtime = runtimes.find((item) => item.id === runtimeId) || runtimes[0];
  const switcherRuntimes = useMemo(() => {
    const query = runtimeSwitchSearch.trim().toLowerCase();
    if (!query) return runtimes;
    return runtimes.filter((item) => {
      const searchable = [
        item.id,
        item.name,
        item.displayName,
        item.endpoint,
        item.clientIp,
        item.localStatus,
        item.metadata?.hermes_webhook_url,
        item.metadata?.webhook_public_host,
      ].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [runtimeSwitchSearch, runtimes]);
  const routeRuntimePending = Boolean(routeContext.runtimeId && runtime && runtime.id !== routeContext.runtimeId);
  const shouldLoadRuntimeScopedData =
    (viewMode === "runtime" && hasRuntimeRouteId) ||
    viewMode === "workflows" ||
    viewMode === "instance" ||
    viewMode === "workflow" ||
    viewMode === "nodes" ||
    viewMode === "settings" ||
    triggerOpen ||
    runtimeManagementOpen;
  const shouldLoadInstances = Boolean(runtime && !routeRuntimePending && shouldLoadRuntimeScopedData);

  const instancesQuery = useQuery({
    queryKey: queryKeys.instances(mode, runtime),
    queryFn: async () => {
      const options = { page: 1, pageSize: 100, sort: "updated_at", order: "desc" as const };
      if (provider.listRuntimeInstances) return provider.listRuntimeInstances(runtime, options);
      const instances = await provider.listInstances(runtime, options);
      return {
        instances,
        total: instances.length,
        page: 1,
        pageSize: 100,
        hasMore: false,
        source: "legacy-provider",
      };
    },
    enabled: shouldLoadInstances,
  });
  const instances = instancesQuery.data?.instances || [];
  const instanceTotal = Math.max(instancesQuery.data?.total ?? instances.length, instances.length);
  const instanceSource = instancesQuery.data?.source || "";
  const instanceHasMore = Boolean(instancesQuery.data?.hasMore);
  const instance = instances.find((item) => item.instanceId === instanceId) || instances[0];
  const switcherInstances = useMemo(() => {
    const query = instanceSwitchSearch.trim().toLowerCase();
    if (!query) return instances;
    return instances.filter((item) => {
      const searchable = [
        item.instanceId,
        item.title,
        item.repo,
        item.sopType,
        item.workflowBinding?.workflowName,
        item.status,
        item.wikiLocalPath,
      ].filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [instanceSwitchSearch, instances]);
  const managementInstance = instances.find((item) => item.instanceId === "runtime-management" || item.sopType === "runtime-management");
  const isRuntimeManagementInstance = Boolean(instance && (instance.instanceId === "runtime-management" || instance.sopType === "runtime-management"));
  const workflowsQuery = useQuery({
    queryKey: ["workflow-definitions", mode, runtime?.id || ""],
    queryFn: async () => provider.listWorkflowDefinitions ? provider.listWorkflowDefinitions(runtime) : [],
    enabled: viewMode === "workflows" || runtimeManagementOpen,
  });
  const workflowDefinitions = workflowsQuery.data || [];
  const currentRuntimeManagementDefaults = (): RuntimeManagementFormDefaults => ({
    createSshCommand: runtimeCreateSshCommand,
    createPrivateKey: runtimeCreatePrivateKey,
    createEnvText: runtimeCreateEnvText,
    deleteTargetRuntimeId: runtimeDeleteTargetRuntimeId,
    deleteRuntimeId: runtimeDeleteId,
    deleteSshCommand: runtimeDeleteSshCommand,
    deletePrivateKey: runtimeDeletePrivateKey,
    deleteForce: runtimeDeleteForce,
    instanceId: instanceCreateId,
    instanceRepo: instanceCreateRepo,
    deleteInstanceId: instanceDeleteId,
    deleteInstanceRepo: instanceDeleteRepo,
    deleteInstanceForce: instanceDeleteForce,
  });

  const saveRuntimeManagementDefaults = () => {
    writeRuntimeManagementFormDefaults(currentRuntimeManagementDefaults());
    setToast("Runtime 管理默认参数已保存到当前浏览器");
  };

  const resetRuntimeManagementDefaults = () => {
    const cleanDefaults: RuntimeManagementFormDefaults = {
      createSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
      createPrivateKey: "",
      createEnvText: "",
      deleteTargetRuntimeId: "",
      deleteRuntimeId: DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID,
      deleteSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
      deletePrivateKey: "",
      deleteForce: false,
      instanceId: "",
      instanceRepo: "",
      deleteInstanceId: "",
      deleteInstanceRepo: "",
      deleteInstanceForce: false,
    };
    window.localStorage.removeItem(RUNTIME_MANAGEMENT_FORM_STORAGE_KEY);
    setRuntimeCreateSshCommand(cleanDefaults.createSshCommand);
    setRuntimeCreatePrivateKey(cleanDefaults.createPrivateKey);
    setRuntimeCreateEnvText(cleanDefaults.createEnvText);
    setRuntimeDeleteTargetRuntimeId(cleanDefaults.deleteTargetRuntimeId);
    setRuntimeDeleteId(cleanDefaults.deleteRuntimeId);
    setRuntimeDeleteSshCommand(cleanDefaults.deleteSshCommand);
    setRuntimeDeletePrivateKey(cleanDefaults.deletePrivateKey);
    setRuntimeDeleteForce(cleanDefaults.deleteForce);
    setRuntimeDeleteConfirmed(false);
    setInstanceCreateId(cleanDefaults.instanceId);
    setInstanceCreateRepo(cleanDefaults.instanceRepo);
    setInstanceDeleteId(cleanDefaults.deleteInstanceId);
    setInstanceDeleteRepo(cleanDefaults.deleteInstanceRepo);
    setInstanceDeleteForce(cleanDefaults.deleteInstanceForce);
    setToast("Runtime 管理默认参数已重置");
  };

  useEffect(() => {
    writeRuntimeManagementFormDefaults({
      createSshCommand: runtimeCreateSshCommand,
      createPrivateKey: runtimeCreatePrivateKey,
      createEnvText: runtimeCreateEnvText,
      deleteTargetRuntimeId: runtimeDeleteTargetRuntimeId,
      deleteRuntimeId: runtimeDeleteId,
      deleteSshCommand: runtimeDeleteSshCommand,
      deletePrivateKey: runtimeDeletePrivateKey,
      deleteForce: runtimeDeleteForce,
      instanceId: instanceCreateId,
      instanceRepo: instanceCreateRepo,
      deleteInstanceId: instanceDeleteId,
      deleteInstanceRepo: instanceDeleteRepo,
      deleteInstanceForce: instanceDeleteForce,
    });
  }, [
    runtimeCreateSshCommand,
    runtimeCreatePrivateKey,
    runtimeCreateEnvText,
    runtimeDeleteTargetRuntimeId,
    runtimeDeleteId,
    runtimeDeleteSshCommand,
    runtimeDeletePrivateKey,
    runtimeDeleteForce,
    instanceCreateId,
    instanceCreateRepo,
    instanceDeleteId,
    instanceDeleteRepo,
    instanceDeleteForce,
  ]);

  const shouldLoadWorkflowShape = viewMode === "instance" || viewMode === "workflow";
  const shouldLoadRuns = viewMode === "instance" || viewMode === "workflow";
  const shouldLoadRunDetail = viewMode === "workflow" && Boolean(route.pipelineId);
  const executionPageSize = viewMode === "instance" ? 8 : 20;
  const dagQuery = useQuery({
    queryKey: queryKeys.dag(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.getDag(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance && shouldLoadWorkflowShape),
  });
  const runtimeInheritanceQuery = useQuery({
    queryKey: ["runtime-inheritance", mode, runtime?.id || "", managementInstance?.instanceId || ""],
    queryFn: () => provider.getRuntimeInheritance(runtime!, managementInstance!.instanceId),
    enabled: Boolean(runtime && managementInstance && runtimeManagementOpen),
    retry: 1,
  });
  const runtimeManagementConfigQuery = useQuery({
    queryKey: ["control-plane-settings", mode],
    queryFn: () => controlPlaneProvider.getSettings(),
    enabled: viewMode === "settings" || runtimeManagementOpen,
    retry: 1,
  });
  const settingsRegistryQuery = useQuery({
    queryKey: ["settings-registry", mode, runtime?.id || ""],
    queryFn: () => provider.getSettingRegistry ? provider.getSettingRegistry(runtime) : Promise.resolve({ items: [] }),
    enabled: Boolean(runtime && viewMode === "settings"),
    retry: 1,
  });
  const machineQueryOptions = viewMode === "machines"
    ? {
      page: machinePage,
      pageSize: 25,
      q: machineSearch.trim(),
      status: machineStatusFilter,
      role: machineRoleFilter === "all" ? "" : machineRoleFilter,
      authType: machineAuthFilter === "all" ? "" : machineAuthFilter,
      sort: "updated_at",
      order: "desc" as const,
    }
    : {
      page: 1,
      pageSize: 100,
      q: "",
      status: "active",
      sort: "updated_at",
      order: "desc" as const,
    };
  const machinesQuery = useQuery({
    queryKey: ["control-plane-machines", mode, machineQueryOptions.page, machineQueryOptions.pageSize, machineQueryOptions.q, machineQueryOptions.status, machineQueryOptions.role, machineQueryOptions.authType],
    queryFn: () => controlPlaneProvider.listMachines(machineQueryOptions),
    enabled: viewMode === "settings" || viewMode === "machines" || runtimeManagementOpen,
    retry: 1,
  });
  const githubReposQuery = useQuery({
    queryKey: ["control-plane-github-repos", mode],
    queryFn: () => controlPlaneProvider.listGithubRepos(),
    enabled: mode === "real" && runtimeManagementOpen && runtimeManagementAction === "create-instance",
    retry: 1,
  });
  const inheritedTelegramToken = runtimeConfigItem(runtimeManagementConfigQuery.data, "YOUTUBE_WIKI_TG_TOKEN");
  const inheritedTelegramChatId = runtimeConfigValue(runtimeManagementConfigQuery.data, "YOUTUBE_WIKI_TG_CHAT_ID");
  useEffect(() => {
    if (!instanceTelegramChatId && inheritedTelegramChatId) {
      setInstanceTelegramChatId(inheritedTelegramChatId);
    }
  }, [inheritedTelegramChatId, instanceTelegramChatId]);
  const runtimeDeleteCandidates = useMemo(() => {
    return runtimes.filter((item) => isRuntimeDeleteCandidate(item, runtime));
  }, [runtime, runtimes]);
  const selectedDeleteRuntime = useMemo(() => {
    return runtimeDeleteCandidates.find((item) => item.id === runtimeDeleteTargetRuntimeId);
  }, [runtimeDeleteCandidates, runtimeDeleteTargetRuntimeId]);
  const selectedDeleteRuntimeMachine = useMemo(() => {
    if (!selectedDeleteRuntime) return undefined;
    return (machinesQuery.data?.machines || []).find((machine) => machineMatchesRuntime(machine, selectedDeleteRuntime));
  }, [machinesQuery.data, selectedDeleteRuntime]);

  useEffect(() => {
    if (!runtimeDeleteTargetRuntimeId) return;
    if (!runtimeDeleteCandidates.some((item) => item.id === runtimeDeleteTargetRuntimeId)) {
      setRuntimeDeleteTargetRuntimeId("");
      setRuntimeDeleteId("");
      setRuntimeDeleteMachineId("");
      setRuntimeDeleteConfirmed(false);
    }
  }, [runtimeDeleteCandidates, runtimeDeleteTargetRuntimeId]);

  useEffect(() => {
    if (!selectedDeleteRuntime) return;
    setRuntimeDeleteId(selectedDeleteRuntime.id);
    if (selectedDeleteRuntimeMachine) {
      setRuntimeDeleteMachineId(selectedDeleteRuntimeMachine.id);
      if (selectedDeleteRuntimeMachine.sshCommand) setRuntimeDeleteSshCommand(selectedDeleteRuntimeMachine.sshCommand);
    } else {
      setRuntimeDeleteMachineId("");
    }
  }, [selectedDeleteRuntime, selectedDeleteRuntimeMachine]);
  const runsQuery = useQuery({
    queryKey: [...queryKeys.runs(mode, runtime, instance?.instanceId || ""), executionSearch.trim(), executionFilter, executionPage, executionPageSize],
    queryFn: async () => {
      const options = {
        page: executionPage,
        pageSize: executionPageSize,
        q: executionSearch.trim(),
        status: executionFilter === "all" ? undefined : executionFilter,
        sort: "updated_at",
        order: "desc" as const,
      };
      if (provider.listWorkflowRuns) return provider.listWorkflowRuns(runtime, instance.instanceId, options);
      const runs = await provider.listRuns(runtime, instance.instanceId, options);
      return {
        runs,
        total: runs.length,
        page: executionPage,
        pageSize: executionPageSize,
        hasMore: runs.length >= executionPageSize,
        source: "legacy-provider",
      };
    },
    enabled: Boolean(runtime && instance && shouldLoadRuns),
    refetchInterval: (query) => (query.state.data?.runs.some((run) => run.status === "running") && streamStatus !== "live" ? 15000 : false)
  });
  const serverRuns = runsQuery.data?.runs || [];
  const runTotal = Math.max(runsQuery.data?.total ?? serverRuns.length, serverRuns.length);
  const runHasMore = Boolean(runsQuery.data?.hasMore);
  const runListSource = runsQuery.data?.source || "";
  const runs = useMemo(() => mergeRuns(serverRuns, optimisticRuns, runOverlays), [serverRuns, optimisticRuns, runOverlays]);
  const routeRunMissing = Boolean(selectedRunId && runs.length && !runs.some((run) => run.pipelineId === selectedRunId));
  const selectedRunSummary = selectedRunId ? runs.find((run) => run.pipelineId === selectedRunId) : runs[0];

  const runQuery = useQuery({
    queryKey: queryKeys.run(mode, runtime, instance?.instanceId || "", selectedRunSummary?.pipelineId || ""),
    queryFn: () => provider.getRun(runtime!, instance!.instanceId, selectedRunSummary!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRunSummary && shouldLoadRunDetail),
    refetchInterval: (query) => (query.state.data?.status === "running" && streamStatus !== "live" ? 15000 : false)
  });
  const selectedRun = runQuery.data || selectedRunSummary;
  const runDagQuery = useQuery({
    queryKey: queryKeys.runDag(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunDag(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun && shouldLoadRunDetail),
    retry: false,
  });
  const runEventsQuery = useQuery({
    queryKey: queryKeys.runEvents(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunEvents(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun && shouldLoadRunDetail),
    refetchInterval: selectedRun?.status === "running" && streamStatus !== "live" ? 15000 : false,
  });
  const runArtifactsQuery = useQuery({
    queryKey: queryKeys.runArtifacts(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunArtifacts(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun && shouldLoadRunDetail),
  });
  const runArtifactCandidatesQuery = useQuery({
    queryKey: queryKeys.runArtifactCandidates(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunArtifactCandidates(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: false,
  });
  const dag = runDagQuery.data || dagQuery.data;
  const selectedStage = dag?.nodes.find((stage) => stage.id === selectedStageId) || dag?.nodes[0];
  const selectedStageKey = selectedStage?.id || "";
  const selectedStatus = selectedStage ? selectedRun?.nodes[selectedStage.id] || "waiting" : "waiting";

  const nodeQuery = useQuery({
    queryKey: queryKeys.node(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || "", selectedStageKey),
    queryFn: () => provider.getNode(runtime!, instance!.instanceId, selectedRun!.pipelineId, selectedStageKey),
    enabled: Boolean(runtime && instance && selectedRun && selectedStage && shouldLoadRunDetail)
  });
  const logQuery = useQuery({
    queryKey: queryKeys.log(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || "", selectedStageKey),
    queryFn: () => provider.getNodeLog(runtime!, instance!.instanceId, selectedRun!.pipelineId, selectedStageKey),
    enabled: Boolean(runtime && instance && selectedRun && selectedStage && shouldLoadRunDetail)
  });
  const nodeConfigQuery = useQuery({
    queryKey: queryKeys.nodeConfig(mode, runtime, instance?.instanceId || "", nodeConfigId),
    queryFn: () => provider.getNodeConfig(runtime!, instance!.instanceId, nodeConfigId),
    enabled: Boolean(runtime && instance && showNodeConfig && nodeConfigId)
  });
  const nodesQuery = useQuery({
    queryKey: queryKeys.nodes(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listNodes(runtime!, instance!.instanceId),
    enabled: Boolean(runtime && instance && (viewMode === "instance" || viewMode === "nodes"))
  });
  const nodeDraftsQuery = useQuery({
    queryKey: queryKeys.nodeDrafts(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listNodeDrafts(runtime!, instance!.instanceId),
    enabled: Boolean(runtime && instance && (viewMode === "nodes" || viewMode === "settings"))
  });
  const nodeDraftSchemaQuery = useQuery({
    queryKey: queryKeys.nodeDraftSchema(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.getNodeDraftSchema(runtime!, instance!.instanceId),
    enabled: Boolean(runtime && instance && (viewMode === "nodes" || viewMode === "settings" || draftOpen))
  });
  const managedNodes = nodesQuery.data || [];
  const selectedManagedNode = managedNodes.find((node) => node.nodeId === selectedManagedNodeId) || managedNodes[0];
  const nodeModulesQuery = useQuery({
    queryKey: queryKeys.nodeModules(mode, runtime, instance?.instanceId || "", selectedManagedNode?.nodeId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.listNodeModules(runtime!, instance!.instanceId, selectedManagedNode!.nodeId, selectedRun?.pipelineId),
    enabled: Boolean(runtime && instance && selectedManagedNode && viewMode === "nodes"),
  });
  const selectedNodeModules = (nodeModulesQuery.data && nodeModulesQuery.data.length)
    ? nodeModulesQuery.data
    : selectedManagedNode?.modules?.length
      ? selectedManagedNode.modules
      : fallbackNodeModules(selectedManagedNode, Boolean(selectedRun));
  const selectedNodeModule = selectedNodeModules.find((module) => module.id === selectedNodeModuleId) || selectedNodeModules.find((module) => module.id === "basic") || selectedNodeModules[0];
  const nodeModuleQuery = useQuery({
    queryKey: queryKeys.nodeModule(mode, runtime, instance?.instanceId || "", selectedManagedNode?.nodeId || "", selectedNodeModule?.id || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getNodeModule(runtime!, instance!.instanceId, selectedManagedNode!.nodeId, selectedNodeModule!.id, selectedRun?.pipelineId),
    enabled: Boolean(runtime && instance && selectedManagedNode && selectedNodeModule && viewMode === "nodes" && !route.nodeRunList && !route.nodeRunId),
  });
  const nodeFilters = useMemo(() => {
    const managementGroups = ["create-runtime", "delete-runtime", "create-instance"].filter((group) => managedNodes.some((node) => matchesNodeGroup(node, group)));
    const groups = ["all", ...managementGroups];
    if (managedNodes.some((node) => matchesNodeGroup(node, "failed"))) groups.push("failed");
    return groups;
  }, [managedNodes]);
  const visibleManagedNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    return managedNodes.filter((node) => {
      const searchable = [node.nodeId, node.title, node.description, node.ui?.category, node.case, node.executor?.type, node.branch].filter(Boolean).join(" ").toLowerCase();
      return matchesNodeGroup(node, nodeFilter) && (!query || searchable.includes(query));
    });
  }, [managedNodes, nodeFilter, nodeSearch]);

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const [result] = await Promise.all([
        provider.triggerRun(runtime, instance.instanceId, { repo: instance.repo, url: triggerUrl }),
        minimumDelay(450),
      ]);
      return result;
    },
    onMutate: async () => {
      const tempId = `starting-${Date.now()}`;
      const run = createOptimisticRun(tempId, triggerUrl, instance?.repo || "", dag);
      setOptimisticRuns((items) => [run, ...items]);
      setSelectedRunId(tempId);
      navigateTo("workflow", tempId, dag?.nodes[0]?.id || "");
      setToast("Workflow Run starting...");
      return { tempId };
    },
    onSuccess: async (result, _variables, context) => {
      const realId = result.pipelineId;
      if (realId) {
        setOptimisticRuns((items) => items.map((run) => run.pipelineId === context?.tempId
          ? { ...run, pipelineId: realId, status: "running", updatedAt: new Date().toISOString() }
          : run
        ));
        setRunOverlays((items) => ({ ...items, [realId]: { pipelineId: realId, status: "running", updatedAt: new Date().toISOString() } }));
        setSelectedRunId(realId);
        navigateTo("workflow", realId, dag?.nodes[0]?.id || "");
      }
      setTriggerOpen(false);
      setToast(realId ? `Workflow Run started: ${shortId(realId)}` : "Workflow Run started");
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, instance.instanceId) });
      if (realId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, realId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.runDag(mode, runtime, instance.instanceId, realId) });
      }
    },
    onError: (error, _variables, context) => {
      setOptimisticRuns((items) => items.map((run) => run.pipelineId === context?.tempId
        ? { ...run, status: "failed", updatedAt: new Date().toISOString() }
        : run
      ));
      setToast(`Workflow Run failed: ${String((error as Error).message || error)}`);
    }
  });

  const resolveMachineSshPayload = async (machineId: string, sshCommand: string, privateKey: string) => {
    if (!machineId) {
      return {
        ssh_command: sshCommand,
        private_key_b64: encodeSecretB64(privateKey),
      };
    }
    const machine = await controlPlaneProvider.getMachineSecret(machineId);
    const resolvedPrivateKey = privateKey.trim() || machine.privateKey || "";
    return {
      machine_id: machine.id || machineId,
      ssh_command: sshCommand.trim() || machine.sshCommand,
      private_key_b64: encodeSecretB64(resolvedPrivateKey),
      ssh_password: machine.authType === "password" ? machine.password : "",
    };
  };

  const resolveGlobalWorkflowPayload = async () => {
    const resolved = await controlPlaneProvider.resolveSettingsForWorkflow();
    if (!resolved.ok) throw new Error("Control Plane 全局配置加载失败");
    return compactStringRecord(resolved.payload || {});
  };

  const createRuntimeMutation = useMutation({
    mutationFn: async () => {
      if (!managementInstance) throw new Error("当前 Runtime 没有 runtime-management instance");
      const sshPayload = await resolveMachineSshPayload(runtimeCreateMachineId, runtimeCreateSshCommand, runtimeCreatePrivateKey);
      const globalPayload = withoutCreateRuntimeIdentity(await resolveGlobalWorkflowPayload());
      const runtimeOverrides = withoutCreateRuntimeIdentity({
        ...compactStringRecord(parseRuntimeEnvOverrides(runtimeCreateEnvText)),
        ...compactStringRecord(runtimeCreateConfigOverrides),
      });
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "create-runtime",
          ...globalPayload,
          ...sshPayload,
          ...runtimeOverrides,
        }),
        minimumDelay(450),
      ]);
      return result;
    },
    onSuccess: async (result) => {
      if (managementInstance) setInstanceId(managementInstance.instanceId);
      const pipelineId = result.pipelineId || "";
      if (pipelineId) {
        setSelectedRunId(pipelineId);
        const baseRuntime = runtime?.id || runtimeId || "runtime";
        const nextUrl = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(managementInstance!.instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}${window.location.search}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
        setRoute({ view: "workflow", nodeId: "", pipelineId, artifactId: "", moduleId: "" });
      }
      setToast(pipelineId ? `Runtime 创建任务已启动：${shortId(pipelineId)}` : "Runtime 创建任务已启动");
      setRuntimeManagementOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instances(mode, runtime) });
      if (managementInstance) await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, managementInstance.instanceId) });
    },
    onError: (error) => {
      setToast(`Runtime 创建失败：${String((error as Error).message || error)}`);
    },
  });

  const deleteRuntimeMutation = useMutation({
    mutationFn: async () => {
      if (!managementInstance) throw new Error("当前 Runtime 没有 runtime-management instance");
      if (!runtimeDeleteConfirmed) throw new Error("请先确认要删除的目标 Runtime");
      const selectedMachine = (machinesQuery.data?.machines || []).find((machine) => machine.id === runtimeDeleteMachineId) || selectedDeleteRuntimeMachine;
      const resolvedRuntimeId = runtimeDeleteId.trim() || selectedDeleteRuntime?.id || machineRuntimeId(selectedMachine);
      const targetHost = runtimeHost(selectedDeleteRuntime) || selectedMachine?.host || "";
      const channelUrl = runtimeChannelUrl(selectedDeleteRuntime);
      const spiBaseUrl = runtimeSpiBaseUrl(selectedDeleteRuntime);
      if (!resolvedRuntimeId) throw new Error("请选择要删除的 Runtime");
      if (resolvedRuntimeId === runtime?.id) throw new Error("不能从当前执行 Runtime 删除自身");
      if (!targetHost) throw new Error("目标 Runtime 缺少 target_host，无法生成 delete-runtime 入参");
      if (!runtimeDeleteMachineId && !runtimeDeleteSshCommand.trim()) {
        throw new Error("缺少该目标 Runtime 的 SSH 凭据：请先在 Machines 中保存该机器，或在高级 SSH 覆盖里填写 ssh_command");
      }
      const sshPayload = await resolveMachineSshPayload(runtimeDeleteMachineId || selectedMachine?.id || "", runtimeDeleteSshCommand, runtimeDeletePrivateKey);
      const globalPayload = await resolveGlobalWorkflowPayload();
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "delete-runtime",
          ...globalPayload,
          runtime_id: resolvedRuntimeId,
          target_host: targetHost,
          channel_name: selectedDeleteRuntime?.channelName || resolvedRuntimeId,
          channel_url: channelUrl,
          spi_base_url: spiBaseUrl,
          ...sshPayload,
          force: runtimeDeleteForce,
        }),
        minimumDelay(450),
      ]);
      return result;
    },
    onSuccess: async (result) => {
      if (managementInstance) setInstanceId(managementInstance.instanceId);
      const pipelineId = result.pipelineId || "";
      if (pipelineId) {
        setSelectedRunId(pipelineId);
        const baseRuntime = runtime?.id || runtimeId || "runtime";
        const nextUrl = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(managementInstance!.instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}${window.location.search}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
        setRoute({ view: "workflow", nodeId: "", pipelineId, artifactId: "", moduleId: "" });
      }
      setToast(pipelineId ? `Runtime 删除任务已启动：${shortId(pipelineId)}` : "Runtime 删除任务已启动");
      setRuntimeManagementOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instances(mode, runtime) });
      if (managementInstance) await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, managementInstance.instanceId) });
    },
    onError: (error) => {
      setToast(`Runtime 删除失败：${String((error as Error).message || error)}`);
    },
  });

  const createInstanceMutation = useMutation({
    mutationFn: async () => {
      if (!managementInstance) throw new Error("当前 Runtime 没有 runtime-management instance");
      const repo = instanceCreateRepo.trim();
      const resolvedInstanceId = instanceCreateId.trim() || suggestedInstanceCreateId;
      const instancePayload = {
        instance_id: resolvedInstanceId,
        repo,
        workspace_kind: "execution-workspace",
        telegram: {
          chat_id: instanceTelegramChatId.trim(),
          token: instanceTelegramTokenMode === "override" ? instanceTelegramToken.trim() : "",
        },
        enabled: true,
      };
      if (!instancePayload.instance_id) throw new Error("请填写 Instance ID");
      if (!instancePayload.repo) throw new Error("请填写 Instance Repo");
      const globalPayload = await resolveGlobalWorkflowPayload();
      const runtimeOverrides = {
        ...compactStringRecord(parseRuntimeEnvOverrides(runtimeCreateEnvText)),
        ...compactStringRecord(runtimeCreateConfigOverrides),
      };
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "create-instance",
          ...globalPayload,
          runtime_id: runtime?.id || runtimeId,
          channel_url: runtime?.channelUrl || runtime?.endpoint,
          instance_id: instancePayload.instance_id,
          repo: instancePayload.repo,
          instance_repo: instancePayload.repo,
          instance_telegram_chat_id: instanceTelegramChatId.trim(),
          instance_telegram_token: instanceTelegramTokenMode === "override" ? instanceTelegramToken.trim() : "",
          instances: [instancePayload],
          ...runtimeOverrides,
        }),
        minimumDelay(450),
      ]);
      return result;
    },
    onSuccess: async (result) => {
      if (managementInstance) setInstanceId(managementInstance.instanceId);
      const pipelineId = result.pipelineId || "";
      if (pipelineId) {
        setSelectedRunId(pipelineId);
        const baseRuntime = runtime?.id || runtimeId || "runtime";
        const nextUrl = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(managementInstance!.instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}${window.location.search}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
        setRoute({ view: "workflow", nodeId: "", pipelineId, artifactId: "", moduleId: "" });
      }
      setToast(pipelineId ? `Instance 创建任务已启动：${shortId(pipelineId)}` : "Instance 创建任务已启动");
      setRuntimeManagementOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instances(mode, runtime) });
      if (managementInstance) await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, managementInstance.instanceId) });
    },
    onError: (error) => {
      setToast(`Instance 创建失败：${String((error as Error).message || error)}`);
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: async () => {
      if (!managementInstance) throw new Error("当前 Runtime 没有 runtime-management instance");
      const targetId = instanceDeleteId.trim();
      if (!targetId) throw new Error("请填写 Instance ID");
      if (targetId === "runtime-management") throw new Error("runtime-management 是受保护的默认管理 Instance，不能通过 delete-instance 删除");
      const targetInstance = instances.find((item) => item.instanceId === targetId);
      const targetRepo = instanceDeleteRepo.trim() || targetInstance?.repo || `skkeoriw/${targetId}`;
      const targetPayload = {
        instance_id: targetId,
        repo: targetRepo,
        wiki_local_path: targetInstance?.wikiLocalPath || "",
        workspace_status: targetInstance?.workspaceStatus || "",
        enabled: targetInstance?.enabled !== false,
      };
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "delete-instance",
          runtime_id: runtime?.id || runtimeId,
          channel_url: runtime?.channelUrl || runtime?.endpoint,
          instance_id: targetId,
          repo: targetRepo,
          instance_repo: targetRepo,
          wiki_local_path: targetInstance?.wikiLocalPath || "",
          instances: [targetPayload],
          force: instanceDeleteForce,
        }),
        minimumDelay(450),
      ]);
      return result;
    },
    onSuccess: async (result) => {
      if (managementInstance) setInstanceId(managementInstance.instanceId);
      const pipelineId = result.pipelineId || "";
      if (pipelineId) {
        setSelectedRunId(pipelineId);
        const baseRuntime = runtime?.id || runtimeId || "runtime";
        const nextUrl = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(managementInstance!.instanceId)}/workflow/runs/${encodeURIComponent(pipelineId)}${window.location.search}`;
        if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
        setRoute({ view: "workflow", nodeId: "", pipelineId, artifactId: "", moduleId: "" });
      }
      setToast(pipelineId ? `Instance 删除任务已启动：${shortId(pipelineId)}` : "Instance 删除任务已启动");
      setRuntimeManagementOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instances(mode, runtime) });
      if (managementInstance) await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, managementInstance.instanceId) });
    },
    onError: (error) => {
      setToast(`Instance 删除失败：${String((error as Error).message || error)}`);
    },
  });

  const saveManagementConfigMutation = useMutation({
    mutationFn: async () => {
      const values = Object.fromEntries(Object.entries(managementConfigValues).filter(([, value]) => value.trim()));
      if (!Object.keys(values).length) throw new Error("请至少填写一个要保存的配置值");
      const [result] = await Promise.all([
        controlPlaneProvider.saveSettings({
          values,
        }),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: async () => {
      setManagementConfigValues({});
      setToast("全局配置已保存到 Control Plane D1");
      initializeManagementConfigMutation.reset();
      await runtimeManagementConfigQuery.refetch();
    },
    onError: (error) => {
      setToast(`全局配置保存失败：${String((error as Error).message || error)}`);
    },
  });

  const initializeManagementConfigMutation = useMutation({
    mutationFn: async () => {
      throw new Error("全局 Settings 已迁移到 Control Plane，不再从某台 Runtime 初始化");
    },
    onSuccess: async () => {
      saveManagementConfigMutation.reset();
      setManagementConfigValues({});
      setToast("全局 Settings 已由 Control Plane 管理");
      await runtimeManagementConfigQuery.refetch();
    },
    onError: (error) => {
      setToast(`初始化管理配置失败：${String((error as Error).message || error)}`);
    },
  });

  const saveMachineMutation = useMutation({
    mutationFn: async () => {
      if (!machineSshCommand.trim()) throw new Error("请填写 SSH Command");
      const [result] = await Promise.all([
        controlPlaneProvider.saveMachine({
          id: selectedMachineId || undefined,
          name: machineName.trim() || machineSshCommand.trim(),
          sshCommand: machineSshCommand.trim(),
          authType: machineAuthType,
          privateKey: machineAuthType === "private_key" && machinePrivateKey.trim() ? machinePrivateKey : undefined,
          password: machineAuthType === "password" && machinePassword.trim() ? machinePassword : undefined,
          role: machineRole || "target",
          status: machineStatus || "active",
        }),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: async () => {
      setToast("机器节点已保存到 Control Plane D1");
      setMachinePrivateKey("");
      setMachinePassword("");
      await machinesQuery.refetch();
    },
    onError: (error) => {
      setToast(`机器节点保存失败：${String((error as Error).message || error)}`);
    },
  });
  const deleteMachineMutation = useMutation({
    mutationFn: async (machineId: string) => {
      const [result] = await Promise.all([
        controlPlaneProvider.deleteMachine(machineId),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: async (_result, machineId) => {
      if (selectedMachineId === machineId) {
        setSelectedMachineId("");
        setMachineName("");
        setMachineSshCommand("");
        setMachinePrivateKey("");
        setMachinePassword("");
        setMachineRole("target");
        setMachineStatus("active");
      }
      setToast("机器节点已删除（soft delete）");
      await machinesQuery.refetch();
    },
    onError: (error) => {
      setToast(`机器节点删除失败：${String((error as Error).message || error)}`);
    },
  });
  const duplicateMachineMutation = useMutation({
    mutationFn: async ({ id, reuseSecret }: { id: string; reuseSecret: boolean }) => {
      const [result] = await Promise.all([
        controlPlaneProvider.duplicateMachine(id, { reuseSecret }),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: async (machine) => {
      setSelectedMachineId(machine.id);
      setMachineName(machine.name);
      setMachineSshCommand(machine.sshCommand);
      setMachineAuthType(machine.authType === "password" ? "password" : "private_key");
      setMachineRole(machine.role || "target");
      setMachineStatus(machine.status || "active");
      setMachinePrivateKey("");
      setMachinePassword("");
      setToast("机器节点已复制，secret 仍由后端保存且不回显");
      await machinesQuery.refetch();
    },
    onError: (error) => {
      setToast(`机器节点复制失败：${String((error as Error).message || error)}`);
    },
  });
  const testMachineMutation = useMutation({
    mutationFn: async (machineId: string) => {
      const [result] = await Promise.all([
        controlPlaneProvider.testMachine(machineId),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: (result) => {
      setMachineTestResult(result);
      setToast("机器测试请求已提交");
    },
    onError: (error) => {
      setToast(`机器测试失败：${String((error as Error).message || error)}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => provider.retryNode(runtime, instance.instanceId, selectedRun!.pipelineId, selectedStageKey),
    onSuccess: async () => {
      setToast(`${selectedStage?.title || selectedStageKey} 重试中`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, selectedRun!.pipelineId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.node(mode, runtime, instance.instanceId, selectedRun!.pipelineId, selectedStageKey) });
    }
  });

  const cancelRunMutation = useMutation({
    mutationFn: () => provider.cancelRun(runtime, instance.instanceId, selectedRun!.pipelineId),
    onSuccess: async () => {
      setToast("Run 已取消");
      await queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, selectedRun!.pipelineId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, instance.instanceId) });
    }
  });

  const cancelNodeMutation = useMutation({
    mutationFn: () => provider.cancelNode(runtime, instance.instanceId, selectedRun!.pipelineId, selectedStageKey),
    onSuccess: async () => {
      setToast(`节点 ${selectedStageKey} 已取消`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, selectedRun!.pipelineId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.node(mode, runtime, instance.instanceId, selectedRun!.pipelineId, selectedStageKey) });
    }
  });
  const createDraftMutation = useMutation({
    mutationFn: () => provider.createNodeDraft(runtime, instance.instanceId, draftInput),
    onSuccess: async (draft) => {
      setDraftOpen(false);
      setDraftLocalError("");
      setConfirmRealDraft(false);
      setToast(`节点草稿已创建：${draft.draftId}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.nodeDrafts(mode, runtime, instance.instanceId) });
    }
  });
  useEffect(() => {
    const routePrefixes = ["/runtimes", "/instances", "/overview", "/runs", "/workflow", "/workflows", "/nodes", "/artifacts", "/machines", "/settings"];
    if (window.location.pathname === "/" || !routePrefixes.some((prefix) => window.location.pathname === prefix || window.location.pathname.startsWith(`${prefix}/`))) {
      window.history.replaceState(null, "", `/runtimes${window.location.search}`);
      setRoute(readRoute());
    }
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => { if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id); }, [runtimeId, runtimes]);
  useEffect(() => { if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId); }, [instanceId, instances]);
  useEffect(() => {
    if (routeContext.runtimeId && runtimes.some((item) => item.id === routeContext.runtimeId) && runtimeId !== routeContext.runtimeId) {
      setRuntimeId(routeContext.runtimeId);
    }
  }, [routeContext.runtimeId, runtimeId, runtimes]);
  useEffect(() => {
    if (routeContext.instanceId && instances.some((item) => item.instanceId === routeContext.instanceId) && instanceId !== routeContext.instanceId) {
      setInstanceId(routeContext.instanceId);
    }
  }, [routeContext.instanceId, instanceId, instances]);
  useEffect(() => { if (runs.length && !selectedRunId) setSelectedRunId(runs[0].pipelineId); }, [runs, selectedRunId]);
  useEffect(() => {
    if (route.pipelineId && runs.some((run) => run.pipelineId === route.pipelineId) && selectedRunId !== route.pipelineId) {
      setSelectedRunId(route.pipelineId);
    }
  }, [route.pipelineId, runs, selectedRunId]);
  useEffect(() => { if (dag?.nodes.length && !dag.nodes.some((stage) => stage.id === selectedStageId)) setSelectedStageId(dag.nodes[0].id); }, [dag, selectedStageId]);
  useEffect(() => {
    if (viewMode === "workflow" && selectedRun?.runningNode && !route.nodeId) {
      setSelectedStageId(selectedRun.runningNode);
    }
  }, [route.nodeId, selectedRun?.pipelineId, selectedRun?.runningNode, viewMode]);
  useEffect(() => {
    if (route.nodeId && dag?.nodes.some((stage) => stage.id === route.nodeId) && selectedStageId !== route.nodeId) {
      setSelectedStageId(route.nodeId);
    }
  }, [dag, route.nodeId, selectedStageId]);
  useEffect(() => { setInstanceId(""); setSelectedRunId(""); setSelectedStageId(""); }, [runtimeId]);
  useEffect(() => { setSelectedRunId(""); setSelectedStageId(""); setExecutionPage(1); }, [instanceId]);
  useEffect(() => { setExecutionPage(1); }, [runtimeId]);
  useEffect(() => {
    if (!serverRuns.length) return;
    const serverIds = new Set(serverRuns.map((run) => run.pipelineId));
    setOptimisticRuns((items) => items.filter((run) => run.pipelineId.startsWith("starting-") || !serverIds.has(run.pipelineId)));
  }, [serverRuns]);
  useEffect(() => { setSelectedManagedNodeId(""); }, [runtimeId, instanceId]);
  useEffect(() => {
    if (!managedNodes.length) return;
    if (route.view === "nodes" && route.nodeId && managedNodes.some((node) => node.nodeId === route.nodeId)) {
      setSelectedManagedNodeId(route.nodeId);
      return;
    }
    if (!managedNodes.some((node) => node.nodeId === selectedManagedNodeId)) setSelectedManagedNodeId(managedNodes[0].nodeId);
  }, [managedNodes, route.nodeId, route.view, selectedManagedNodeId]);
  useEffect(() => {
    if (route.view === "nodes" && route.moduleId) {
      setSelectedNodeModuleId(route.moduleId);
      return;
    }
    if (selectedNodeModules.length && !selectedNodeModules.some((module) => module.id === selectedNodeModuleId)) {
      setSelectedNodeModuleId(selectedNodeModules[0].id);
    }
  }, [route.moduleId, route.view, selectedNodeModuleId, selectedNodeModules]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { setInspectorTab("config"); setShowNodeConfig(false); }, [selectedStageId]);
  useEffect(() => {
    if (mode !== "real" || !runtime || !instance || !selectedRun || selectedRun.status !== "running") {
      setStreamStatus("closed");
      return;
    }
    const url = `${runtime.endpoint}/api/sop/${encodeURIComponent(instance.instanceId)}/runs/${encodeURIComponent(selectedRun.pipelineId)}/events/stream`;
    const stream = new EventSource(url);
    let fallbackTimer = 0;
    let inFallback = false;
    const refreshFromEvent = (event: MessageEvent) => {
      setStreamStatus("live");
      setRunOverlays((items) => applyStreamEvent(items, selectedRun.pipelineId, event.type, event.data, dag));
      queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, selectedRun.pipelineId) });
    };
    const eventTypes = [
      "node.started", "node.progress", "artifact.created",
      "git.committed", "git.failed", "telegram.sent", "telegram.failed",
      "node.completed", "node.failed", "node.skipped", "node.cancelled",
      "run.completed", "run.failed", "run.cancelled"
    ];
    eventTypes.forEach((eventType) => stream.addEventListener(eventType, refreshFromEvent));
    stream.onopen = () => {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
      inFallback = false;
      setStreamStatus("live");
    };
    stream.onerror = () => {
      if (!inFallback) setStreamStatus("reconnecting");
      if (!fallbackTimer) fallbackTimer = window.setTimeout(() => {
        inFallback = true;
        setStreamStatus("polling fallback");
      }, 5000);
    };
    return () => {
      window.clearTimeout(fallbackTimer);
      eventTypes.forEach((eventType) => stream.removeEventListener(eventType, refreshFromEvent));
      stream.close();
      setStreamStatus("closed");
    };
  }, [mode, runtime?.id, instance?.instanceId, selectedRun?.pipelineId, selectedRun?.status, dag, queryClient]);
  useEffect(() => {
    if (!initialEndpoint || !runtimes.length) return;
    const matched = runtimes.find((item) => normalizeEndpoint(item.endpoint) === initialEndpoint);
    if (matched && runtimeId !== matched.id) setRuntimeId(matched.id);
  }, [initialEndpoint, runtimes, runtimeId]);

  const flowNodes = useMemo(() => buildFlowNodes(
    dag,
    selectedRun,
    selectedStageId,
    (nodeId) => {
      setSelectedStageId(nodeId);
      navigateTo("workflow", selectedRun?.pipelineId || "", nodeId);
    },
    openNodeConfig
  ), [dag, selectedRun, selectedStageId]);
  const flowEdges = useMemo(() => buildFlowEdges(dag, selectedRun), [dag, selectedRun]);
  const sortedRuns = [...runs].sort((a, b) => {
    const delta = executionSortPriority(a, selectedRunId) - executionSortPriority(b, selectedRunId);
    return delta || b.updatedAt.localeCompare(a.updatedAt);
  });
  const visibleExecutions = sortedRuns.filter((run) => {
    const query = executionSearch.trim().toLowerCase();
    const matchedStatus = executionFilter === "all" || run.status === executionFilter;
    const searchable = [run.pipelineId, run.sourceUrl, run.repo, run.status].filter(Boolean).join(" ").toLowerCase();
    return matchedStatus && (!query || searchable.includes(query));
  });
  const workflowExecutions = ensureSelectedRunVisible(visibleExecutions, selectedRun);
  const queryError = [runtimesQuery.error, instancesQuery.error, dagQuery.error, runsQuery.error, runQuery.error, nodeQuery.error, nodesQuery.error, nodeDraftsQuery.error, nodeModulesQuery.error, nodeModuleQuery.error, runEventsQuery.error, runArtifactsQuery.error].find(Boolean);
  const completedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "done").length : 0;
  const failedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "failed").length : 0;
  const artifactCount = (nodeQuery.data?.artifacts || []).length;
  const nodesReadyCount = managedNodes.filter((node) => (node.missingFields || []).length === 0).length;

  function changeMode(nextMode: DataMode) {
    writeMode(nextMode);
    setMode(nextMode);
    setManualRuntime(undefined);
    setRuntimeId(""); setInstanceId(""); setSelectedRunId(""); setSelectedStageId("");
  }

  function navigateTo(view: AppView, entityId = "", secondaryId = "") {
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    const baseInstance = routeInstanceId(instance, instanceId);
    const baseWorkflow = workflowIdForInstance(instance);
    let nextPath = routePath(view, entityId, secondaryId);
    if (view === "runtime") nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}`;
    if (view === "instance") nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances`;
    if (view === "workflows") nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/workflows`;
    if (view === "workflow") {
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}`;
      if (entityId) nextPath += `/executions/${encodeURIComponent(entityId)}`;
      if (secondaryId) nextPath += `/${encodeURIComponent(secondaryId)}`;
    }
    if (view === "nodes") {
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}/nodes`;
      if (entityId) nextPath += `/${encodeURIComponent(entityId)}`;
      if (secondaryId) nextPath += `/modules/${encodeURIComponent(secondaryId)}`;
    }
    const nextUrl = `${nextPath}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({
      view,
      nodeId: view === "nodes" ? entityId : view === "workflow" ? secondaryId : "",
      pipelineId: view === "workflow" ? entityId : "",
      artifactId: "",
      moduleId: view === "nodes" ? secondaryId : "",
    });
  }

  function selectRuntime(nextRuntimeId: string) {
    setRuntimeId(nextRuntimeId);
    setRuntimeSwitcherOpen(false);
    setRuntimeSwitchSearch("");
    setInstanceSwitcherOpen(false);
    setInstanceSwitchSearch("");
    const nextUrl = `/runtimes/${encodeURIComponent(nextRuntimeId)}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "runtime", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" });
  }

  function switchActiveInstance(nextInstanceId: string) {
    if (!nextInstanceId) return;
    setInstanceId(nextInstanceId);
    setSelectedRunId("");
    setSelectedStageId("");
    setInstanceSwitcherOpen(false);
    setInstanceSwitchSearch("");
    const baseRuntime = runtime?.id || runtimeId || "runtime";
    let nextPath = window.location.pathname;
    let nextRoute: AppRoute | undefined;
    if (viewMode === "workflow") {
      const workflowId = routeContext.workflowId || workflowIdForInstance(instance) || "workflow";
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(nextInstanceId)}/workflows/${encodeURIComponent(workflowId)}`;
      nextRoute = { view: "workflow", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" };
    } else if (viewMode === "nodes") {
      const workflowId = routeContext.workflowId || workflowIdForInstance(instance) || "workflow";
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(nextInstanceId)}/workflows/${encodeURIComponent(workflowId)}/nodes`;
      if (route.nodeId) nextPath += `/${encodeURIComponent(route.nodeId)}`;
      if (route.nodeRunId) nextPath += `/runs/${encodeURIComponent(route.nodeRunId)}`;
      else if (route.nodeRunList) nextPath += `/runs`;
      else if (route.moduleId) nextPath += `/modules/${encodeURIComponent(route.moduleId)}`;
      nextRoute = { view: "nodes", nodeId: route.nodeId, pipelineId: "", artifactId: "", moduleId: route.moduleId, nodeRunId: route.nodeRunId, nodeRunList: route.nodeRunList };
    } else if (viewMode === "instance" && routeContext.instanceId) {
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(nextInstanceId)}`;
      nextRoute = { view: "instance", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" };
    }
    const nextUrl = `${nextPath}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    if (nextRoute) setRoute(nextRoute);
  }

  function openWorkflowDefinitionForInstance(workflowId: string, targetInstanceId = instance?.instanceId || instanceId, pipelineId = "", nodeId = "") {
    if (!targetInstanceId || !workflowId) return;
    setInstanceId(targetInstanceId);
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    let nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(targetInstanceId)}/workflows/${encodeURIComponent(workflowId)}`;
    if (pipelineId) nextPath += `/executions/${encodeURIComponent(pipelineId)}`;
    if (nodeId) nextPath += `/${encodeURIComponent(nodeId)}`;
    const nextUrl = `${nextPath}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "workflow", nodeId, pipelineId, artifactId: "", moduleId: "" });
    if (pipelineId) setSelectedRunId(pipelineId);
    else setSelectedRunId("");
    if (nodeId) setSelectedStageId(nodeId);
    else setSelectedStageId("");
  }

  function selectInstance(nextInstanceId: string, open = false) {
    setInstanceId(nextInstanceId);
    const baseRuntime = runtime?.id || runtimeId || "runtime";
    const nextPath = open
      ? `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(nextInstanceId)}`
      : `/runtimes/${encodeURIComponent(baseRuntime)}/instances`;
    const nextUrl = `${nextPath}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "instance", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" });
  }

  function openWorkflowForInstance(targetInstanceId = instance?.instanceId || instanceId, pipelineId = "", nodeId = "") {
    if (!targetInstanceId) return;
    const targetInstance = instances.find((item) => item.instanceId === targetInstanceId)
      || (instance?.instanceId === targetInstanceId ? instance : undefined);
    const workflowId = workflowIdForInstance(targetInstance);
    openWorkflowDefinitionForInstance(workflowId, targetInstanceId, pipelineId, nodeId);
  }

  function openRuntimeManagement(action: RuntimeManagementAction, targetInstanceId = "") {
    setRuntimeManagementAction(action);
    if (action === "delete-instance") {
      const target = instances.find((item) => item.instanceId === targetInstanceId)
        || (targetInstanceId && instance?.instanceId === targetInstanceId ? instance : undefined)
        || (instance?.instanceId ? instance : undefined)
        || instances.find((item) => item.instanceId !== "runtime-management")
        || instances[0];
      if (target) {
        setInstanceDeleteId(target.instanceId);
        setInstanceDeleteRepo(target.repo || "");
      }
    }
    setRuntimeManagementOpen(true);
  }

  function selectManagedNode(nodeId: string, moduleId = "") {
    setSelectedManagedNodeId(nodeId);
    if (moduleId) setSelectedNodeModuleId(moduleId);
    navigateTo("nodes", nodeId, moduleId);
  }

  function openNodeRuns(nodeId: string) {
    if (!nodeId) return;
    setSelectedManagedNodeId(nodeId);
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    const baseInstance = routeInstanceId(instance, instanceId);
    const baseWorkflow = routeContext.workflowId || workflowIdForInstance(instance);
    const nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}/nodes/${encodeURIComponent(nodeId)}/runs`;
    const nextUrl = `${nextPath}${searchForNodeRunsPage()}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "nodes", nodeId, pipelineId: "", artifactId: "", moduleId: "", nodeRunId: "", nodeRunList: true });
  }

  function openNodeRun(nodeId: string, nodeRunId: string) {
    if (!nodeId || !nodeRunId) return;
    setSelectedManagedNodeId(nodeId);
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    const baseInstance = routeInstanceId(instance, instanceId);
    const baseWorkflow = routeContext.workflowId || workflowIdForInstance(instance);
    const nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}/nodes/${encodeURIComponent(nodeId)}/runs/${encodeURIComponent(nodeRunId)}`;
    const nextUrl = `${nextPath}${searchForNodeRunDetailPage()}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "nodes", nodeId, pipelineId: "", artifactId: "", moduleId: "", nodeRunId, nodeRunList: true });
  }

  function addManualEndpoint(event: FormEvent) {
    event.preventDefault();
    const endpoint = normalizeEndpoint(manualEndpoint);
    if (!endpoint) return;
    const item: Runtime = { id: `manual:${endpoint}`, name: endpoint.replace(/^https?:\/\//, ""), endpoint, status: "manual", localStatus: "unknown", manual: true };
    setManualRuntime(item);
    setRuntimeId(item.id);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["sop", mode] });
    setToast("数据已刷新");
  }

  function openNodeConfig(nodeId: string) {
    setNodeConfigId(nodeId);
    setShowNodeConfig(true);
  }

  function openNodeValidationFromRun(nodeId: string, pipelineId: string) {
    if (!nodeId || !pipelineId) return;
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    const baseInstance = routeInstanceId(instance, instanceId);
    const baseWorkflow = routeContext.workflowId || workflowIdForInstance(instance);
    const params = new URLSearchParams(window.location.search);
    params.set("test_source", "existing-run");
    params.set("test_run", pipelineId);
    const nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}/nodes/${encodeURIComponent(nodeId)}/runs`;
    const nextUrl = `${nextPath}?${params.toString()}`;
    setSelectedManagedNodeId(nodeId);
    setSelectedNodeModuleId("basic");
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "nodes", nodeId, pipelineId: "", artifactId: "", moduleId: "", nodeRunList: true });
  }

  function openNodeRelayFromNodeRun(nodeId: string, sourceNodeRunId: string, options?: NodeRelayOptions) {
    if (!nodeId || !sourceNodeRunId) return;
    const baseRuntime = routeRuntimeId(runtime, runtimeId);
    const baseInstance = routeInstanceId(instance, instanceId);
    const baseWorkflow = routeContext.workflowId || workflowIdForInstance(instance);
    const params = new URLSearchParams(window.location.search);
    params.delete("step");
    params.set("test_source", "existing-node-run");
    params.set("test_run", sourceNodeRunId);
    params.set("relay_mode", String(options?.relayMode || "auto_by_target_inputs"));
    if (options?.selectedOutputs?.length) params.set("relay_outputs", options.selectedOutputs.join(","));
    else params.delete("relay_outputs");
    const relayMap = encodeRelayMappings(options?.relayMappings || []);
    if (relayMap) params.set("relay_map", relayMap);
    else params.delete("relay_map");
    const nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflows/${encodeURIComponent(baseWorkflow)}/nodes/${encodeURIComponent(nodeId)}/runs`;
    const query = params.toString();
    const nextUrl = `${nextPath}${query ? `?${query}` : ""}`;
    setSelectedManagedNodeId(nodeId);
    setSelectedNodeModuleId("basic");
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "nodes", nodeId, pipelineId: "", artifactId: "", moduleId: "", nodeRunList: true });
  }

  function handleCancelRun() {
    if (!window.confirm(`确认取消 Run: ${selectedRun?.pipelineId}？\n当前阶段完成后不会触发下一阶段。`)) return;
    cancelRunMutation.mutate();
  }

  function handleCancelNode() {
    if (!window.confirm(`确认取消节点: ${selectedStageKey}？`)) return;
    cancelNodeMutation.mutate();
  }

  function handleRetry() {
    if (mode === "real" && !window.confirm(`确认重试节点: ${selectedStageKey}？`)) return;
    retryMutation.mutate();
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    const schema = nodeDraftSchemaQuery.data;
    const missingFields = (schema?.fields || [])
      .filter((field) => field.required && !String(draftInput[field.name as keyof NodeDraftInput] || "").trim())
      .map((field) => field.label || field.name);
    if (missingFields.length) {
      setDraftLocalError(`请先填写必填字段: ${missingFields.join(", ")}`);
      return;
    }
    const nodeId = draftInput.node_id.trim();
    if (nodeId && managedNodes.some((node) => node.nodeId === nodeId)) {
      setDraftLocalError(`节点 ID 已存在于生产 DAG: ${nodeId}`);
      return;
    }
    setDraftLocalError("");
    createDraftMutation.mutate();
  }

  return (
    <div className={`app-shell single-shell ${railCollapsed ? "rail-collapsed" : ""}`}>
      <aside className="control-rail">
        <div className="rail-brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SOP Control</strong>
            <span>Runtime orchestration</span>
          </div>
          <button type="button" className="rail-collapse-btn" title={railCollapsed ? "展开菜单" : "折叠菜单"} onClick={() => setRailCollapsed((value) => !value)}>
            {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav className="rail-nav" aria-label="Primary">
          <button type="button" className={`rail-nav-item ${viewMode === "runtime" ? "active" : ""}`} onClick={() => navigateTo("runtime")}>
            <Server size={17} /><span>Runtime</span><small>{runtime?.localStatus || runtime?.status || "detail"}</small>
          </button>
          <button type="button" className={`rail-nav-item ${viewMode === "instance" ? "active" : ""}`} onClick={() => navigateTo("instance")}>
            <LayoutDashboard size={17} /><span>Instance</span><small>{instanceTotal || instances.length || "-"} registry</small>
          </button>
          <button type="button" className={`rail-nav-item ${viewMode === "workflows" || viewMode === "workflow" ? "active" : ""}`} onClick={() => navigateTo("workflows")}>
            <Workflow size={17} /><span>Workflow</span><small>{workflowDefinitions.length || "-"} definitions</small>
          </button>
          <button type="button" className={`rail-nav-item ${viewMode === "nodes" ? "active" : ""}`} onClick={() => navigateTo("nodes")}>
            <Boxes size={17} /><span>Node</span><small>{managedNodes.length || "-"} definitions</small>
          </button>
          <button type="button" className={`rail-nav-item ${viewMode === "machines" ? "active" : ""}`} onClick={() => navigateTo("machines")}>
            <Server size={17} /><span>Machines</span><small>{machinesQuery.data?.total ?? "-"}</small>
          </button>
          <button type="button" className={`rail-nav-item ${viewMode === "settings" ? "active" : ""}`} onClick={() => navigateTo("settings")}>
            <Settings size={17} /><span>Settings</span><small>{mode}</small>
          </button>
        </nav>
      </aside>
      <header className="topbar">
        <div className="active-context">
          <RuntimeSwitcher
            runtime={runtime}
            runtimes={switcherRuntimes}
            total={runtimes.length}
            loading={runtimesQuery.isLoading}
            open={runtimeSwitcherOpen}
            search={runtimeSwitchSearch}
            onOpenChange={setRuntimeSwitcherOpen}
            onSearchChange={setRuntimeSwitchSearch}
            onSelect={selectRuntime}
          />
          <InstanceSwitcher
            instance={instance}
            instances={switcherInstances}
            total={instances.length}
            loading={instancesQuery.isLoading}
            open={instanceSwitcherOpen}
            search={instanceSwitchSearch}
            disabled={!runtime}
            onOpenChange={setInstanceSwitcherOpen}
            onSearchChange={setInstanceSwitchSearch}
            onSelect={switchActiveInstance}
          />
          <div className="context-crumbs">
            <span>Context</span>
            <strong>{instance?.title || "Workspace"}{selectedRun?.pipelineId ? ` / ${shortId(selectedRun.pipelineId)}` : ""}</strong>
          </div>
          <code>{runtime?.endpoint || "No endpoint"}</code>
          <span className={`status-pill ${instance?.status === "failed" ? "failed" : runtime?.localStatus === "ok" ? "done" : "waiting"}`}>{instance?.status || runtime?.localStatus || "unknown"}</span>
        </div>
        <div className="top-actions">
          <div className="mode-switch" aria-label="数据模式">
            <button type="button" className={mode === "real" ? "active" : ""} onClick={() => changeMode("real")}>Real</button>
            <button type="button" className={mode === "mock" ? "active" : ""} onClick={() => changeMode("mock")}>Mock</button>
          </div>
          <button type="button" onClick={refresh}><RefreshCw size={16} />Refresh</button>
          <button type="button" onClick={() => window.open(RUNTIME_HOST_ARCHITECTURE_DOC_URL, "_blank", "noopener,noreferrer")}>
            <Info size={16} />Architecture
          </button>
          <button type="button" className="primary" disabled={!runtime || !instance} onClick={() => {
            if (viewMode === "runtime" || isRuntimeManagementInstance) openRuntimeManagement(runtimeManagementAction);
            else setTriggerOpen(true);
          }}>
            <Play size={16} />{viewMode === "runtime" || isRuntimeManagementInstance ? "Host Operations" : "New Workflow Run"}
          </button>
        </div>
      </header>

      {queryError && <div className="error-banner">数据请求失败：{String((queryError as Error).message || queryError)}</div>}

      {false && viewMode === "workflow" && <aside className="sidebar">
        <section>
          <div className="section-title"><span>Runtime</span><span>{mode}</span></div>
          {runtime ? (
            <div className="runtime-card">
              <div className="row"><strong>{runtime.name}</strong><span className={`status-pill ${runtime.localStatus === "ok" ? "done" : "waiting"}`}>{runtime.localStatus}</span></div>
              <code>{runtime.endpoint}</code>
              <span>{runtime.manual ? "手动 endpoint" : `${runtime.machine || "remote"} service machine`}</span>
            </div>
          ) : <LoadingOrEmpty loading={runtimesQuery.isLoading} text="没有发现 active SOP Runtime" />}
          {mode === "real" && (
            <form className="manual-endpoint" onSubmit={addManualEndpoint}>
              <label htmlFor="manual-endpoint">手动 Endpoint</label>
              <div><input id="manual-endpoint" value={manualEndpoint} onChange={(event) => setManualEndpoint(event.target.value)} placeholder="https://..." /><button>Apply</button></div>
            </form>
          )}
        </section>
        <section>
          <div className="section-title"><span>Workspaces</span><span>{instances.length}/{instanceTotal}</span></div>
          {instances.map((item) => (
            <button key={item.instanceId} type="button" className={`list-card ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => setInstanceId(item.instanceId)}>
              <strong>{item.title}</strong><span>{item.instanceId}</span><span>{item.repo}</span>
            </button>
          ))}
          {!instances.length && <LoadingOrEmpty loading={instancesQuery.isLoading} text="当前 Runtime 没有 enabled workspace" />}
        </section>
        <section className="runs-section">
          <div className="section-title"><span>Workflow Runs</span><span>{visibleExecutions.length}/{runTotal}</span></div>
          <div className="execution-tools">
            <label className="search-box">
              <Search size={14} />
              <input value={executionSearch} onChange={(event) => setExecutionSearch(event.target.value)} placeholder="Search workflow run" />
            </label>
            <label className="filter-box">
              <SlidersHorizontal size={14} />
              <select value={executionFilter} onChange={(event) => setExecutionFilter(event.target.value as "all" | StageStatus)}>
                <option value="all">All status</option>
                {statusOrder.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </label>
          </div>
          {visibleExecutions.map((run) => (
            <button key={run.pipelineId} type="button" className={`run-card ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`} onClick={() => { setSelectedRunId(run.pipelineId); navigateTo("workflow", run.pipelineId, selectedStage?.id || ""); }}>
              <div className="row"><strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong><span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span></div>
              <span>{formatBeijingTime(run.updatedAt || run.startedAt)}</span><span>{run.sourceUrl || run.repo}</span>
            </button>
          ))}
          {!visibleExecutions.length && <LoadingOrEmpty loading={runsQuery.isLoading} text={runs.length ? "没有匹配的 Workflow Run" : "当前 Workspace 还没有 Workflow Run"} />}
        </section>
      </aside>}

      <main className={`main ${viewMode === "nodes" ? "nodes-main" : ""}`}>
        {viewMode === "workflows" ? (
          <WorkflowCatalog
            workflows={workflowDefinitions}
            runtimes={runtimes}
            runtime={runtime}
            selectedInstance={instance}
            instances={instances}
            loading={workflowsQuery.isLoading}
            onOpenRuntime={(id) => selectRuntime(id)}
            onSelectInstance={switchActiveInstance}
            onOpenExecutions={(workflowId) => openWorkflowDefinitionForInstance(workflowId, instance?.instanceId || instanceId)}
            onOpenManagement={openRuntimeManagement}
          />
        ) : viewMode === "runtime" && isRuntimeDirectory ? (
          <RuntimeDirectory
            runtimes={runtimes}
            total={runtimeTotal}
            hasMore={runtimeHasMore}
            source={runtimesQuery.data?.source || ""}
            loading={runtimesQuery.isLoading}
            error={runtimesQuery.error ? String(runtimesQuery.error.message) : ""}
            page={runtimeDirectoryPage}
            pageSize={runtimeDirectoryPageSize}
            search={runtimeDirectorySearch}
            statusFilter={runtimeDirectoryStatus}
            onSearch={setRuntimeDirectorySearch}
            onStatusFilter={setRuntimeDirectoryStatus}
            onPage={setRuntimeDirectoryPage}
            onOpenRuntime={selectRuntime}
          />
        ) : viewMode === "runtime" ? (
          <RuntimeOverview
            runtime={runtime}
            runtimes={runtimes}
            selectedInstance={instance}
            instances={instances}
            instanceTotal={instanceTotal}
            instanceSource={instanceSource}
            instanceHasMore={instanceHasMore}
            runs={workflowExecutions}
            dag={dag}
            selectedRun={selectedRun}
            loading={runtimesQuery.isLoading || instancesQuery.isLoading}
            mode={mode}
            onSelectRelationshipInstance={(id) => setInstanceId(id)}
            onOpenInstance={(id) => selectInstance(id, true)}
            managementInstance={managementInstance}
            onOpenWorkflow={openWorkflowForInstance}
            onOpenManagement={openRuntimeManagement}
          />
        ) : viewMode === "instance" ? (
          <InstanceOverview
            runtime={runtime}
            instance={instance}
            provider={provider}
            mode={mode}
            instances={instances}
            directoryMode={isInstanceDirectory}
            instanceTotal={instanceTotal}
            instanceSource={instanceSource}
            runs={runs}
            dag={dag}
            managedNodes={managedNodes}
            runArtifacts={runArtifactsQuery.data || []}
            onSelectInstance={(id) => selectInstance(id, false)}
            onOpenInstance={(id) => selectInstance(id, true)}
            onOpenWorkflow={(targetInstanceId) => {
              if (targetInstanceId) {
                openWorkflowForInstance(targetInstanceId);
                return;
              }
              openWorkflowForInstance(instance?.instanceId || instanceId, selectedRun?.pipelineId || runs[0]?.pipelineId || "", selectedStage?.id || dag?.nodes[0]?.id || "");
            }}
            onOpenExecutions={() => openWorkflowForInstance(instance?.instanceId || instanceId, selectedRun?.pipelineId || runs[0]?.pipelineId || "")}
            onOpenNodes={() => navigateTo("nodes")}
            onOpenSettings={() => navigateTo("settings")}
            onOpenManagement={openRuntimeManagement}
          />
        ) : viewMode === "workflow" ? (
          <WorkflowWorkspace
            runtime={runtime}
            instance={instance}
            instances={instances}
            provider={provider}
            mode={mode}
            runs={workflowExecutions}
            executionSearch={executionSearch}
            executionFilter={executionFilter}
            executionPage={executionPage}
            executionHasNext={runHasMore}
            executionTotal={runTotal}
            executionSource={runListSource}
            onExecutionSearch={setExecutionSearch}
            onExecutionFilter={setExecutionFilter}
            onExecutionPage={setExecutionPage}
            selectedRun={selectedRun}
            selectedRunMissing={routeRunMissing}
            selectedStage={selectedStage}
            selectedStatus={selectedStatus}
            dag={dag}
            dagLoading={dagQuery.isLoading}
            flowNodes={flowNodes}
            flowEdges={flowEdges}
            nodeDetail={nodeQuery.data}
            nodeLog={logQuery.data}
            runEvents={runEventsQuery.data || []}
            runArtifacts={runArtifactsQuery.data || []}
            streamStatus={streamStatus}
            inspectorTab={inspectorTab}
            setInspectorTab={setInspectorTab}
            rawLogOpen={rawLogOpen}
            setRawLogOpen={setRawLogOpen}
            openNodeConfig={openNodeConfig}
            onValidateNodeWithRun={openNodeValidationFromRun}
            onSwitchInstance={switchActiveInstance}
            onSelectRun={(pipelineId) => { setSelectedRunId(pipelineId); navigateTo("workflow", pipelineId, selectedStage?.id || ""); }}
            onSelectNode={(nodeId) => { setSelectedStageId(nodeId); navigateTo("workflow", selectedRun?.pipelineId || "", nodeId); }}
            onCancelRun={handleCancelRun}
            onRetryNode={handleRetry}
            onCancelNode={handleCancelNode}
            cancelRunPending={cancelRunMutation.isPending}
            retryPending={retryMutation.isPending}
            cancelNodePending={cancelNodeMutation.isPending}
          />
        ) : viewMode === "nodes" ? (
          <NodesWorkspace
            instance={instance}
            runtime={runtime}
            provider={provider}
            mode={mode}
            runs={runs}
            nodes={managedNodes}
            drafts={nodeDraftsQuery.data || []}
            loading={nodesQuery.isLoading}
            routeNodeId={route.nodeId || ""}
            routeModuleId={route.moduleId || ""}
            nodeRunList={Boolean(route.nodeRunList)}
            selectedNodeId={selectedManagedNode?.nodeId || ""}
            selectedNodeRunId={route.nodeRunId || ""}
            selectedNode={selectedManagedNode}
            modules={selectedNodeModules}
            selectedModule={selectedNodeModule}
            moduleDetail={nodeModuleQuery.data}
            moduleLoading={nodeModulesQuery.isLoading || nodeModuleQuery.isLoading}
            visibleNodes={visibleManagedNodes}
            nodeSearch={nodeSearch}
            nodeFilter={nodeFilter}
            nodeFilters={nodeFilters}
            onNodeSearch={setNodeSearch}
            onNodeFilter={setNodeFilter}
            onSelectNode={selectManagedNode}
            onOpenNodeRuns={openNodeRuns}
            onOpenNodeRun={openNodeRun}
            onRelayNodeRun={openNodeRelayFromNodeRun}
            onOpenSettings={() => navigateTo("settings")}
            onSelectModule={(moduleId) => {
              setSelectedNodeModuleId(moduleId);
              if (selectedManagedNode) navigateTo("nodes", selectedManagedNode.nodeId, moduleId);
            }}
            onOpenDraft={() => setDraftOpen(true)}
          />
        ) : viewMode === "machines" ? (
          <MachinesPage
            machines={machinesQuery.data?.machines || []}
            machineList={machinesQuery.data}
            loading={machinesQuery.isLoading}
            error={machinesQuery.error ? String(machinesQuery.error.message) : ""}
            machineSearch={machineSearch}
            setMachineSearch={setMachineSearch}
            machineStatusFilter={machineStatusFilter}
            setMachineStatusFilter={setMachineStatusFilter}
            machineRoleFilter={machineRoleFilter}
            setMachineRoleFilter={setMachineRoleFilter}
            machineAuthFilter={machineAuthFilter}
            setMachineAuthFilter={setMachineAuthFilter}
            machinePage={machinePage}
            setMachinePage={setMachinePage}
            selectedMachineId={selectedMachineId}
            setSelectedMachineId={setSelectedMachineId}
            machineName={machineName}
            setMachineName={setMachineName}
            machineSshCommand={machineSshCommand}
            setMachineSshCommand={setMachineSshCommand}
            machineAuthType={machineAuthType}
            setMachineAuthType={setMachineAuthType}
            machinePrivateKey={machinePrivateKey}
            setMachinePrivateKey={setMachinePrivateKey}
            machinePassword={machinePassword}
            setMachinePassword={setMachinePassword}
            machineRole={machineRole}
            setMachineRole={setMachineRole}
            machineStatus={machineStatus}
            setMachineStatus={setMachineStatus}
            duplicateReuseSecret={machineDuplicateReuseSecret}
            setDuplicateReuseSecret={setMachineDuplicateReuseSecret}
            saveMachinePending={saveMachineMutation.isPending}
            saveMachineError={saveMachineMutation.error ? String(saveMachineMutation.error.message) : ""}
            onSaveMachine={(event) => { event.preventDefault(); saveMachineMutation.mutate(); }}
            testPending={testMachineMutation.isPending}
            testResult={machineTestResult}
            testError={testMachineMutation.error ? String(testMachineMutation.error.message) : ""}
            onTestMachine={(id) => testMachineMutation.mutate(id)}
            deletePending={deleteMachineMutation.isPending}
            onDeleteMachine={(id) => {
              if (!window.confirm(`确认删除机器节点 ${id}？\n这会在 Control Plane 中执行 soft delete，不会登录目标机器。`)) return;
              deleteMachineMutation.mutate(id);
            }}
            duplicatePending={duplicateMachineMutation.isPending}
            onDuplicateMachine={(id, reuseSecret) => duplicateMachineMutation.mutate({ id, reuseSecret })}
            onToast={setToast}
          />
        ) : (
          <SettingsPage
            mode={mode}
            managementConfig={runtimeManagementConfigQuery.data}
            managementConfigLoading={runtimeManagementConfigQuery.isLoading}
            managementConfigError={runtimeManagementConfigQuery.error ? String(runtimeManagementConfigQuery.error.message) : ""}
            settingRegistry={settingsRegistryQuery.data}
            settingRegistryLoading={settingsRegistryQuery.isLoading}
            settingRegistryError={settingsRegistryQuery.error ? String(settingsRegistryQuery.error.message) : ""}
            machines={machinesQuery.data?.machines || []}
            machinesError={machinesQuery.error ? String(machinesQuery.error.message) : ""}
            onOpenMachines={() => navigateTo("machines")}
            managementConfigValues={managementConfigValues}
            setManagementConfigValues={setManagementConfigValues}
            saveManagementConfigPending={saveManagementConfigMutation.isPending}
            saveManagementConfigError={saveManagementConfigMutation.error ? String(saveManagementConfigMutation.error.message) : ""}
            onRefreshManagementConfig={() => runtimeManagementConfigQuery.refetch()}
            onSaveManagementConfig={(event) => { event.preventDefault(); initializeManagementConfigMutation.reset(); saveManagementConfigMutation.mutate(); }}
            globalTunnelApiUrl={GLOBAL_TUNNEL_API_URL}
            globalTunnelAdminUrl={GLOBAL_TUNNEL_ADMIN_URL}
          />
        )}
      </main>

      {runtimeManagementOpen && runtime && managementInstance && (
        <RuntimeManagementStartDrawer
          mode={mode}
          runtime={runtime}
          instance={managementInstance}
          instances={instances}
          action={runtimeManagementAction}
          setAction={setRuntimeManagementAction}
          createSshCommand={runtimeCreateSshCommand}
          setCreateSshCommand={setRuntimeCreateSshCommand}
          createPrivateKey={runtimeCreatePrivateKey}
          setCreatePrivateKey={setRuntimeCreatePrivateKey}
          createEnvText={runtimeCreateEnvText}
          setCreateEnvText={setRuntimeCreateEnvText}
          createConfigOverrides={runtimeCreateConfigOverrides}
          setCreateConfigOverrides={setRuntimeCreateConfigOverrides}
          createMachineId={runtimeCreateMachineId}
          setCreateMachineId={setRuntimeCreateMachineId}
          deleteRuntimeId={runtimeDeleteId}
          deleteTargetRuntimeId={runtimeDeleteTargetRuntimeId}
          setDeleteTargetRuntimeId={setRuntimeDeleteTargetRuntimeId}
          setDeleteRuntimeId={setRuntimeDeleteId}
          deleteSshCommand={runtimeDeleteSshCommand}
          setDeleteSshCommand={setRuntimeDeleteSshCommand}
          deletePrivateKey={runtimeDeletePrivateKey}
          setDeletePrivateKey={setRuntimeDeletePrivateKey}
          deleteMachineId={runtimeDeleteMachineId}
          setDeleteMachineId={setRuntimeDeleteMachineId}
          deleteForce={runtimeDeleteForce}
          setDeleteForce={setRuntimeDeleteForce}
          deleteConfirmed={runtimeDeleteConfirmed}
          setDeleteConfirmed={setRuntimeDeleteConfirmed}
          deleteCandidates={runtimeDeleteCandidates}
          deleteCandidatesLoading={runtimesQuery.isLoading}
          machines={machinesQuery.data?.machines || []}
          machinesLoading={machinesQuery.isLoading}
          githubRepos={githubReposQuery.data || []}
          githubReposLoading={githubReposQuery.isLoading}
          githubReposError={githubReposQuery.error ? String(githubReposQuery.error.message) : ""}
          instanceCreateId={instanceCreateId}
          setInstanceCreateId={setInstanceCreateId}
          instanceCreateRepo={instanceCreateRepo}
          setInstanceCreateRepo={setInstanceCreateRepo}
          suggestedInstanceCreateId={suggestedInstanceCreateId}
          instanceTelegramTokenMode={instanceTelegramTokenMode}
          setInstanceTelegramTokenMode={setInstanceTelegramTokenMode}
          instanceTelegramToken={instanceTelegramToken}
          setInstanceTelegramToken={setInstanceTelegramToken}
          instanceTelegramChatId={instanceTelegramChatId}
          setInstanceTelegramChatId={setInstanceTelegramChatId}
          inheritedTelegramToken={inheritedTelegramToken}
          inheritedTelegramChatId={inheritedTelegramChatId}
          instanceDeleteId={instanceDeleteId}
          setInstanceDeleteId={setInstanceDeleteId}
          instanceDeleteRepo={instanceDeleteRepo}
          setInstanceDeleteRepo={setInstanceDeleteRepo}
          instanceDeleteForce={instanceDeleteForce}
          setInstanceDeleteForce={setInstanceDeleteForce}
          inheritance={runtimeManagementConfigQuery.data}
          inheritanceLoading={runtimeManagementConfigQuery.isLoading}
          inheritanceError={runtimeManagementConfigQuery.error ? String(runtimeManagementConfigQuery.error.message) : ""}
          onRefreshInheritance={() => runtimeManagementConfigQuery.refetch()}
          onSaveDefaults={saveRuntimeManagementDefaults}
          onResetDefaults={resetRuntimeManagementDefaults}
          onLoadInheritanceToEnv={() => {
            setRuntimeCreateEnvText(runtimeEnvTemplateFromPreview(runtimeManagementConfigQuery.data));
            setToast("已把继承配置模板加载到 Runtime Env Overrides");
          }}
          createPending={createRuntimeMutation.isPending || createInstanceMutation.isPending}
          deletePending={deleteRuntimeMutation.isPending || deleteInstanceMutation.isPending}
          error={
            createRuntimeMutation.error ? String(createRuntimeMutation.error.message)
            : deleteRuntimeMutation.error ? String(deleteRuntimeMutation.error.message)
            : createInstanceMutation.error ? String(createInstanceMutation.error.message)
            : deleteInstanceMutation.error ? String(deleteInstanceMutation.error.message)
            : ""
          }
          onClose={() => setRuntimeManagementOpen(false)}
          onCreate={(event) => {
            event.preventDefault();
            if (runtimeManagementAction === "create-instance") createInstanceMutation.mutate();
            else createRuntimeMutation.mutate();
          }}
          onDelete={(event) => {
            event.preventDefault();
            if (runtimeManagementAction === "delete-instance") deleteInstanceMutation.mutate();
            else deleteRuntimeMutation.mutate();
          }}
        />
      )}
      {triggerOpen && runtime && instance && !isRuntimeManagementInstance && (
        <ExecutionStartDrawer
          mode={mode}
          runtime={runtime}
          instance={instance}
          triggerUrl={triggerUrl}
          setTriggerUrl={setTriggerUrl}
          pending={triggerMutation.isPending}
          error={triggerMutation.error ? String(triggerMutation.error.message) : ""}
          onClose={() => setTriggerOpen(false)}
          onStart={(event) => { event.preventDefault(); triggerMutation.mutate(); }}
        />
      )}
      {draftOpen && runtime && instance && (
        <NodeDraftDrawer
          mode={mode}
          runtime={runtime}
          instance={instance}
          schema={nodeDraftSchemaQuery.data}
          draftInput={draftInput}
          setDraftInput={(input) => { setDraftLocalError(""); setDraftInput(input); }}
          confirmRealDraft={confirmRealDraft}
          setConfirmRealDraft={setConfirmRealDraft}
          creatingDraft={createDraftMutation.isPending}
          createError={draftLocalError || (createDraftMutation.error ? String(createDraftMutation.error.message) : "")}
          onClose={() => setDraftOpen(false)}
          onCreateDraft={submitDraft}
        />
      )}
      {showNodeConfig && (
        <NodeConfigDrawer
          nodeId={nodeConfigId}
          node={nodeConfigQuery.data}
          loading={nodeConfigQuery.isLoading}
          error={nodeConfigQuery.error ? String((nodeConfigQuery.error as Error).message || nodeConfigQuery.error) : ""}
          onClose={() => setShowNodeConfig(false)}
        />
      )}
      {toast && <div className="toast"><CircleDot size={15} />{toast}</div>}
    </div>
  );
}

function buildRuntimeMetadataRows(runtime: Runtime | undefined) {
  const metadata = runtime?.metadata || {};
  const rows: Record<string, string> = {};
  const keyOrder = [
    "runtime_id",
    "display_name",
    "channel_name",
    "channel_url",
    "public",
    "spi_base_url",
    "ui_url",
    "runtime_target_host",
    "hermes",
    "webhook_public_host",
    "hermes_webhook_url",
    "hermes_webhook_port",
    "hermes_smoke_route",
    "wiki_repo",
    "title",
    "type",
    "auto_domain_source",
  ];
  const seen = new Set<string>();
  keyOrder.forEach((key) => {
    const value = metadata[key];
    if (value === undefined || value === "") return;
    rows[key] = value;
    seen.add(key);
  });
  Object.entries(metadata)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (!seen.has(key)) rows[key] = value;
  });
  return rows;
}

function shellQuoteSingle(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatHermesResponseBody(body: string) {
  const text = body.trim();
  if (!text) return "(empty response)";
  try {
    return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  } catch {
    return body;
  }
}

function buildHermesWebhookUrl(runtime: Runtime | undefined) {
  const route = runtime?.metadata?.hermes_smoke_route || DEFAULT_HERMES_SMOKE_ROUTE;
  const explicitUrl = runtime?.metadata?.hermes_webhook_url || runtime?.metadata?.webhook_public_host || runtime?.metadata?.hermes_public_host;
  if (explicitUrl) {
    const trimmed = explicitUrl.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed.includes("/webhooks/") ? trimmed : `${trimmed}/webhooks/${route}`;
    }
    const host = trimmed.replace(/^\/+/, "");
    return host.includes("/webhooks/") ? `https://${host}` : `https://${host}/webhooks/${route}`;
  }
  return "";
}

function buildHermesCurlCommand(url: string, message: string) {
  if (!url.trim()) return "Hermes webhook endpoint is missing in runtime metadata.";
  const body = JSON.stringify({
    message,
    text: message,
    prompt: message,
    source: "sop-ui",
    mode: "connectivity-check",
  });
  return [
    `body=${shellQuoteSingle(body)}`,
    `sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$HERMES_WEBHOOK_TOKEN" -hex | sed 's/^.* //')`,
    `curl -sS -X POST ${shellQuoteSingle(url)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'User-Agent: Mozilla/5.0 SOP-Runtime-Hermes-Smoke/1.0' \\`,
    `  -H "X-Hub-Signature-256: sha256=$sig" \\`,
    `  --data-binary "$body"`,
  ].join("\n");
}

function buildRuntimeHermesSmokeProxyUrl(runtime: Runtime | undefined) {
  const base = normalizeEndpoint(runtime?.spiBaseUrl || (runtime?.endpoint ? `${runtime.endpoint}/api/sop` : ""));
  return base ? `${base}/runtime/hermes-smoke` : "";
}

function buildRuntimeHermesAgentProxyUrl(runtime: Runtime | undefined) {
  const base = normalizeEndpoint(runtime?.spiBaseUrl || (runtime?.endpoint ? `${runtime.endpoint}/api/sop` : ""));
  return base ? `${base}/runtime/hermes-agent-check` : "";
}

function buildHermesAgentCurlCommand(url: string, message: string) {
  if (!url.trim()) return "Runtime SPI endpoint is missing.";
  const body = JSON.stringify({
    message,
    text: message,
    prompt: message,
    source: "sop-ui",
    mode: "agent-chat-check",
  });
  return [
    `curl -sS -X POST ${shellQuoteSingle(url)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  --data-binary ${shellQuoteSingle(body)}`,
  ].join("\n");
}

async function runHermesConnectivityCheck(runtime: Runtime | undefined, message: string) {
  const proxyUrl = buildRuntimeHermesSmokeProxyUrl(runtime);
  if (!proxyUrl) throw new Error("Runtime SPI endpoint is missing");
  const startedAt = performance.now();
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      message,
      text: message,
      prompt: message,
      source: "sop-ui",
      mode: "connectivity-check",
    }),
  });
  const body = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(body) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  const responseBody = typeof payload.response === "string" ? payload.response : body;
  const targetUrl = typeof payload.target_url === "string" ? payload.target_url : "";
  const curl = typeof payload.curl === "string" ? payload.curl : "";
  return {
    ok: Boolean(payload.ok ?? response.ok),
    httpStatus: Number(payload.http_status || response.status || 0),
    latencyMs: Number(payload.latency_ms || Math.round(performance.now() - startedAt)),
    responseBody: formatHermesResponseBody(responseBody),
    contentType: String(payload.content_type || response.headers.get("content-type") || ""),
    targetUrl,
    curl,
    proxyUrl,
    error: typeof payload.error === "string" ? payload.error : typeof payload.reason === "string" ? payload.reason : "",
  };
}

async function runHermesAgentChatCheck(runtime: Runtime | undefined, message: string) {
  const proxyUrl = buildRuntimeHermesAgentProxyUrl(runtime);
  if (!proxyUrl) throw new Error("Runtime SPI endpoint is missing");
  const startedAt = performance.now();
  const response = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      message,
      text: message,
      prompt: message,
      source: "sop-ui",
      mode: "agent-chat-check",
    }),
  });
  const body = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = body ? JSON.parse(body) as Record<string, unknown> : {};
  } catch {
    payload = {};
  }
  const responseBody = typeof payload.response === "string" ? payload.response : body;
  return {
    ok: Boolean(payload.ok ?? response.ok),
    httpStatus: response.status || 0,
    latencyMs: Number(payload.latency_ms || Math.round(performance.now() - startedAt)),
    responseBody: formatHermesResponseBody(responseBody),
    contentType: response.headers.get("content-type") || "application/json",
    targetUrl: proxyUrl,
    curl: buildHermesAgentCurlCommand(proxyUrl, message),
    exitCode: payload.exit_code === null || payload.exit_code === undefined ? "-" : String(payload.exit_code),
    mode: String(payload.mode || "hermes-agent-chat-check"),
    error: typeof payload.reason === "string" ? payload.reason : typeof payload.error === "string" ? payload.error : "",
  };
}

function RuntimeSwitcher({
  runtime,
  runtimes,
  total,
  loading,
  open,
  search,
  onOpenChange,
  onSearchChange,
  onSelect,
}: {
  runtime: Runtime | undefined;
  runtimes: Runtime[];
  total: number;
  loading: boolean;
  open: boolean;
  search: string;
  onOpenChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelect: (runtimeId: string) => void;
}) {
  return (
    <div className="runtime-switcher">
      <button type="button" className="runtime-switcher-button" onClick={() => onOpenChange(!open)} aria-expanded={open}>
        <Server size={16} />
        <span>
          <small>Runtime Host</small>
          <strong>{runtime?.displayName || runtime?.name || "Select host"}</strong>
        </span>
        <em className={runtime?.localStatus === "ok" ? "ok" : "warn"}>{runtime?.localStatus || runtime?.status || "unknown"}</em>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="runtime-switcher-menu">
          <label className="runtime-switcher-search">
            <Search size={14} />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={`Search ${total} runtimes`} autoFocus />
          </label>
          <div className="runtime-switcher-list">
            {runtimes.map((item) => (
              <button key={item.id} type="button" className={`runtime-switcher-item ${runtime?.id === item.id ? "active" : ""}`} onClick={() => onSelect(item.id)}>
                <span className={`runtime-dot ${item.localStatus === "ok" ? "ok" : "warn"}`} />
                <span>
                  <strong>{item.displayName || item.name}</strong>
                  <small>{item.clientIp || item.machine || "no client ip"} · {item.localStatus || item.status || "unknown"}</small>
                  <code>{item.spiBaseUrl || item.endpoint}</code>
                </span>
              </button>
            ))}
            {!runtimes.length && <div className="runtime-switcher-empty">{loading ? "Loading runtimes..." : "No runtime matched"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function InstanceSwitcher({
  instance,
  instances,
  total,
  loading,
  open,
  search,
  disabled,
  onOpenChange,
  onSearchChange,
  onSelect,
}: {
  instance: Instance | undefined;
  instances: Instance[];
  total: number;
  loading: boolean;
  open: boolean;
  search: string;
  disabled: boolean;
  onOpenChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelect: (instanceId: string) => void;
}) {
  return (
    <div className="runtime-switcher instance-switcher">
      <button type="button" className="runtime-switcher-button" onClick={() => onOpenChange(!open)} aria-expanded={open} disabled={disabled}>
        <LayoutDashboard size={16} />
        <span>
          <small>Instance Workspace</small>
          <strong>{instance?.title || instance?.instanceId || "Select instance"}</strong>
        </span>
        <em className={instance?.status === "failed" ? "warn" : "ok"}>{instance?.status || "ready"}</em>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="runtime-switcher-menu instance-switcher-menu">
          <label className="runtime-switcher-search">
            <Search size={14} />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={`Search ${total} instances`} autoFocus />
          </label>
          <div className="runtime-switcher-list">
            {instances.map((item) => (
              <button key={item.instanceId} type="button" className={`runtime-switcher-item ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => onSelect(item.instanceId)}>
                <span className={`runtime-dot ${item.status === "failed" ? "" : "ok"}`} />
                <span>
                  <strong>{item.title || item.instanceId}</strong>
                  <small>{item.instanceId} · {item.status || "ready"}</small>
                  <code>{item.repo || item.wikiLocalPath || "workspace pending"}</code>
                </span>
              </button>
            ))}
            {!instances.length && <div className="runtime-switcher-empty">{loading ? "Loading instances..." : "No instance matched"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function RuntimeOverview({
  runtime,
  runtimes,
  selectedInstance,
  instances,
  instanceTotal,
  instanceSource,
  instanceHasMore,
  runs,
  dag,
  selectedRun,
  loading,
  mode,
  onSelectRelationshipInstance,
  onOpenInstance,
  onOpenWorkflow,
  managementInstance,
  onOpenManagement,
}: {
  runtime: Runtime | undefined;
  runtimes: Runtime[];
  selectedInstance: Instance | undefined;
  instances: Instance[];
  instanceTotal: number;
  instanceSource: string;
  instanceHasMore: boolean;
  runs: Run[];
  dag: Dag | undefined;
  selectedRun: Run | undefined;
  loading: boolean;
  mode: DataMode;
  onSelectRelationshipInstance: (instanceId: string) => void;
  onOpenInstance: (instanceId: string) => void;
  onOpenWorkflow: (instanceId: string, pipelineId?: string, nodeId?: string) => void;
  managementInstance: Instance | undefined;
  onOpenManagement: (action: RuntimeManagementAction, targetInstanceId?: string) => void;
}) {
  type HermesUiResult = {
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    responseBody: string;
    contentType: string;
    error?: string;
    checkedAt: string;
    target: string;
    curl: string;
    exitCode?: string;
    mode?: string;
  };
  const runtimeMetadataRows = buildRuntimeMetadataRows(runtime);
  const readyCount = instances.filter((item) => item.status === "ready" || item.status === "running").length;
  const runningCount = instances.filter((item) => item.latestExecution?.status === "running").length;
  const failedCount = instances.filter((item) => item.status === "failed").length;
  const runtimeStatus = runtime?.localStatus === "ok" ? "done" : runtime?.status === "active" ? "running" : "waiting";
  const supportedTypes = runtime?.supportedSopTypes?.length ? runtime.supportedSopTypes.join(", ") : "-";
  const [probeResults, setProbeResults] = useState<RuntimeProbeResult[]>([]);
  const [probeRunning, setProbeRunning] = useState(false);
  const [hermesMessage, setHermesMessage] = useState("你好 你是谁");
  const [hermesUrl, setHermesUrl] = useState(buildHermesWebhookUrl(runtime));
  const [hermesDeliveryRunning, setHermesDeliveryRunning] = useState(false);
  const [hermesAgentRunning, setHermesAgentRunning] = useState(false);
  const [instanceSearch, setInstanceSearch] = useState("");
  const [instanceStatusFilter, setInstanceStatusFilter] = useState("all");
  const [runtimeTab, setRuntimeTab] = useState<"overview" | "config" | "events">("overview");
  const [relationshipInstanceId, setRelationshipInstanceId] = useState("");
  const [relationshipRunId, setRelationshipRunId] = useState("");
  const [relationshipNodeId, setRelationshipNodeId] = useState("");
  const [hermesDeliveryResult, setHermesDeliveryResult] = useState<HermesUiResult | null>(null);
  const [hermesAgentResult, setHermesAgentResult] = useState<HermesUiResult | null>(null);

  useEffect(() => {
    setProbeResults([]);
    setProbeRunning(false);
  }, [runtime?.id]);

  useEffect(() => {
    setHermesUrl(buildHermesWebhookUrl(runtime));
    setHermesDeliveryResult(null);
    setHermesAgentResult(null);
    setHermesDeliveryRunning(false);
    setHermesAgentRunning(false);
  }, [runtime?.id]);

  useEffect(() => {
    if (selectedInstance?.instanceId) setRelationshipInstanceId(selectedInstance.instanceId);
  }, [selectedInstance?.instanceId]);

  useEffect(() => {
    if (runs.length && (!relationshipRunId || !runs.some((run) => run.pipelineId === relationshipRunId))) {
      setRelationshipRunId((selectedRun && runs.some((run) => run.pipelineId === selectedRun.pipelineId) ? selectedRun.pipelineId : runs[0].pipelineId));
      return;
    }
    if (!runs.length && relationshipRunId) setRelationshipRunId("");
  }, [relationshipRunId, runs, selectedRun]);

  useEffect(() => {
    if (dag?.nodes.length && (!relationshipNodeId || !dag.nodes.some((node) => node.id === relationshipNodeId))) {
      setRelationshipNodeId(dag.nodes[0].id);
      return;
    }
    if (!dag?.nodes.length && relationshipNodeId) setRelationshipNodeId("");
  }, [dag, relationshipNodeId]);

  const visibleInstances = useMemo(() => {
    const query = instanceSearch.trim().toLowerCase();
    return instances.filter((item) => {
      const matchedStatus = instanceStatusFilter === "all" || item.status === instanceStatusFilter;
      const searchable = [item.instanceId, item.title, item.repo, item.sopType, item.status].filter(Boolean).join(" ").toLowerCase();
      return matchedStatus && (!query || searchable.includes(query));
    });
  }, [instances, instanceSearch, instanceStatusFilter]);

  const relationshipInstance = instances.find((item) => item.instanceId === relationshipInstanceId)
    || selectedInstance
    || instances[0];
  const relationshipWorkflow = relationshipInstance?.workflowBinding;
  const relationshipRun = relationshipInstance?.latestExecution
    || runs.find((run) => run.pipelineId === relationshipRunId)
    || selectedRun
    || runs[0];
  const workflowDefinitionCount = instances.filter((item) => item.workflowBinding).length;
  const latestExecutionCount = instances.filter((item) => item.latestExecution).length;
  const relationshipNodes: DagNode[] = [];
  const relationshipNode = relationshipNodes.find((node) => node.id === relationshipNodeId) || relationshipNodes[0];
  const relationshipProgress = runProgressFromNodes(relationshipRun, dag);
  const relationshipNodeStatus = relationshipNode ? relationshipRun?.nodes?.[relationshipNode.id] || "waiting" : "waiting";
  const runtimeChannelUrl = runtime?.channelUrl || runtime?.endpoint || "";
  const runtimeSpiUrl = runtime?.spiBaseUrl || (runtimeChannelUrl ? `${runtimeChannelUrl.replace(/\/+$/, "")}/api/sop` : "");
  const relationshipPath = [
    runtime?.displayName || runtime?.name || runtime?.id,
    relationshipInstance?.instanceId,
    relationshipWorkflow?.workflowName,
    relationshipRun?.pipelineId ? shortId(relationshipRun.pipelineId) : "",
  ].filter(Boolean).join(" / ");

  const handleRunProbe = async () => {
    if (!runtime) return;
    setProbeRunning(true);
    try {
      setProbeResults(await runRuntimeProbeChecks(runtime, managementInstance));
    } finally {
      setProbeRunning(false);
    }
  };

  const hermesPrompt = hermesMessage.trim() || "你好 你是谁";

  const handleRunHermesDeliveryCheck = async () => {
    if (!runtime) return;
    const target = hermesUrl.trim();
    if (!target) {
      setHermesDeliveryResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        responseBody: "",
        contentType: "",
        error: "Webhook URL is empty",
        checkedAt: new Date().toISOString(),
        target,
        curl: "",
      });
      return;
    }
    setHermesDeliveryRunning(true);
    try {
      const result = await runHermesConnectivityCheck(runtime, hermesPrompt);
      setHermesDeliveryResult({
        ok: result.ok,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        responseBody: result.responseBody,
        contentType: result.contentType,
        error: result.ok ? undefined : result.error || `HTTP ${result.httpStatus}`,
        checkedAt: new Date().toISOString(),
        target: result.targetUrl || target,
        curl: result.curl || buildHermesCurlCommand(target, hermesPrompt),
        mode: "webhook-delivery-check",
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setHermesDeliveryResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        responseBody: "",
        contentType: "",
        error: errorText,
        checkedAt: new Date().toISOString(),
        target,
        curl: buildHermesCurlCommand(target, hermesPrompt),
        mode: "webhook-delivery-check",
      });
    } finally {
      setHermesDeliveryRunning(false);
    }
  };

  const handleRunHermesAgentCheck = async () => {
    if (!runtime) return;
    const target = buildRuntimeHermesAgentProxyUrl(runtime);
    setHermesAgentRunning(true);
    try {
      const result = await runHermesAgentChatCheck(runtime, hermesPrompt);
      setHermesAgentResult({
        ok: result.ok,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        responseBody: result.responseBody,
        contentType: result.contentType,
        error: result.ok ? undefined : result.error || `HTTP ${result.httpStatus}`,
        checkedAt: new Date().toISOString(),
        target: result.targetUrl || target,
        curl: result.curl || buildHermesAgentCurlCommand(target, hermesPrompt),
        exitCode: result.exitCode,
        mode: result.mode,
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setHermesAgentResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        responseBody: "",
        contentType: "",
        error: errorText,
        checkedAt: new Date().toISOString(),
        target,
        curl: buildHermesAgentCurlCommand(target, hermesPrompt),
        mode: "hermes-agent-chat-check",
      });
    } finally {
      setHermesAgentRunning(false);
    }
  };

  const handleRunHermesChecks = async () => {
    await Promise.all([
      handleRunHermesDeliveryCheck(),
      handleRunHermesAgentCheck(),
    ]);
  };

  const renderHermesResult = (result: HermesUiResult | null, emptyText: string) => (
    result ? (
      <div className={`runtime-hermes-result ${result.ok ? "ok" : "failed"}`}>
        <div className="runtime-hermes-summary">
          <strong>{result.ok ? "Passed" : "Failed"}</strong>
          <span>{result.error || `HTTP ${result.httpStatus}`}</span>
          <small>{result.latencyMs}ms · {result.checkedAt}</small>
        </div>
        <KeyValues data={{
          target_url: result.target,
          http_status: result.httpStatus || "-",
          content_type: result.contentType || "-",
          latency_ms: `${result.latencyMs}ms`,
          mode: result.mode || "-",
          exit_code: result.exitCode || "-",
        }} />
        <div className="runtime-hermes-response">
          <div className="section-title"><span>Response</span><span>{result.responseBody === "(empty response)" ? "empty" : "body"}</span></div>
          <pre>{result.responseBody}</pre>
        </div>
      </div>
    ) : (
      <Empty text={emptyText} />
    )
  );

  return (
    <section className="runtime-overview">
      <section className="runtime-compact-header">
        <div className="runtime-compact-title">
          <span className="status-pill running"><Server size={14} />Runtime Host</span>
          <div>
            <h1>{runtime?.displayName || runtime?.name || runtime?.id || "No runtime selected"}</h1>
            <code>{runtimeChannelUrl || "No endpoint"}</code>
          </div>
        </div>
        <div className="runtime-compact-meta">
          <span className={`status-pill ${runtimeStatus}`}>{runtime?.localStatus || runtime?.status || "unknown"}</span>
          <span className="runtime-meta-chip">{mode}</span>
          <span className="runtime-meta-chip">SPI {runtimeSpiUrl ? "configured" : "missing"}</span>
          <button type="button" className="ghost-btn compact" onClick={handleRunProbe} disabled={!runtime || probeRunning}>
            {probeRunning ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}Run Checks
          </button>
        </div>
      </section>

      <section className="runtime-status-strip" aria-label="Runtime status summary">
        <RuntimeStatusItem label="Runtimes" value={runtimes.length} detail="discovered" />
        <RuntimeStatusItem label="Instances" value={instanceTotal} detail={`${instances.length} loaded · ${readyCount} ready`} />
        <RuntimeStatusItem label="Running" value={runningCount} detail={`${failedCount} failed`} tone={failedCount ? "warn" : "default"} />
        <RuntimeStatusItem label="SPI" value={runtime?.localStatus || runtime?.status || "-"} detail={runtimeSpiUrl || "-"} tone={runtime?.localStatus === "ok" ? "ok" : "default"} />
      </section>

      <div className="runtime-tabs segmented">
        <button type="button" className={runtimeTab === "overview" ? "active" : ""} onClick={() => setRuntimeTab("overview")}>Overview</button>
        <button type="button" className={runtimeTab === "config" ? "active" : ""} onClick={() => setRuntimeTab("config")}>Config</button>
        <button type="button" className={runtimeTab === "events" ? "active" : ""} onClick={() => setRuntimeTab("events")}>Events</button>
      </div>

      {runtimeTab === "overview" && (
        <>
      <section className="flow-panel runtime-relationship-panel">
        <div className="panel-head runtime-relationship-head">
          <div>
            <strong>Runtime Host Relationship</strong>
            <span>{relationshipPath || "选择 Runtime 后查看 Host / Instance / Workflow Definition / Latest Workflow Run 摘要"}</span>
          </div>
          <div className="runtime-relationship-actions">
            <span>{instances.length}/{instanceTotal} instances · {workflowDefinitionCount} workflows · {latestExecutionCount} latest runs · {instanceSource || "runtime-spi"}</span>
          </div>
        </div>
        <div className="relationship-columns compact">
          <div className="relationship-column">
            <div className="relationship-column-head">
              <strong>Instances</strong>
              <span>{instances.length}/{instanceTotal}</span>
            </div>
            <div className="relationship-list">
              {instances.map((item) => (
                <button
                  key={item.instanceId}
                  type="button"
                  className={`relationship-item ${relationshipInstance?.instanceId === item.instanceId ? "active" : ""}`}
                  onClick={() => {
                    setRelationshipInstanceId(item.instanceId);
                    setRelationshipRunId(item.latestExecution?.pipelineId || "");
                    setRelationshipNodeId("");
                    onSelectRelationshipInstance(item.instanceId);
                  }}
                >
                  <span>
                    <strong>{item.title || item.instanceId}</strong>
                    <small>{item.instanceId}</small>
                  </span>
                  <span className={`status-pill ${item.status === "failed" ? "failed" : item.status === "running" ? "running" : "done"}`}>{item.status || "ready"}</span>
                </button>
              ))}
              {!instances.length && <LoadingOrEmpty loading={loading} text="当前 Runtime 没有 Instance" />}
            </div>
          </div>

          <div className="relationship-column">
            <div className="relationship-column-head">
              <strong>Workflow Definition</strong>
              <span>{relationshipWorkflow ? 1 : 0}</span>
            </div>
            <div className="relationship-list">
              {relationshipWorkflow ? (
                <button
                  type="button"
                  className="relationship-item workflow active"
                  onClick={() => relationshipInstance && onOpenWorkflow(relationshipInstance.instanceId)}
                >
                  <span>
                    <strong>{relationshipWorkflow.workflowName || relationshipInstance?.sopType || "workflow"}</strong>
                    <small>{relationshipWorkflow.definitionPath || relationshipWorkflow.definitionSource || "agent-brains SOP definition"}</small>
                  </span>
                  <span className={`status-pill ${relationshipWorkflow.bindingStatus === "failed" ? "failed" : "done"}`}>
                    {relationshipWorkflow.workflowVersion || relationshipWorkflow.bindingStatus || "bound"}
                  </span>
                </button>
              ) : (
                <Empty text={relationshipInstance ? "当前 Instance 没有 Workflow Definition 绑定" : "先选择一个 Instance"} />
              )}
            </div>
          </div>

          <div className="relationship-column">
            <div className="relationship-column-head">
              <strong>Latest Workflow Run</strong>
              <span>{relationshipRun ? 1 : 0}</span>
            </div>
            <div className="relationship-list">
              {relationshipRun ? (
                <button
                  type="button"
                  className={`relationship-item node active ${relationshipRun.status}`}
                  onClick={() => relationshipInstance && onOpenWorkflow(relationshipInstance.instanceId, relationshipRun.pipelineId)}
                >
                  <span>
                    <strong>{shortId(relationshipRun.pipelineId)}</strong>
                    <small>{formatBeijingTime(relationshipRun.updatedAt || relationshipRun.startedAt, "无时间")} · {runProgressFromNodes(relationshipRun).percent}%</small>
                  </span>
                  <span className={`status-pill ${relationshipRun.status}`}>{statusLabel(relationshipRun.status)}</span>
                </button>
              ) : (
                <Empty text={relationshipInstance ? "当前 Instance 没有 Workflow Run 记录" : "先选择一个 Instance"} />
              )}
            </div>
          </div>

          <aside className="relationship-detail">
            <div className="relationship-column-head">
              <strong>Boundary Detail</strong>
              <span className={`status-pill ${relationshipRun?.status || relationshipInstance?.status || "waiting"}`}>
                {relationshipRun ? statusLabel(relationshipRun.status) : relationshipInstance?.status || "waiting"}
              </span>
            </div>
            {relationshipInstance ? (
              <>
                <div className="relationship-detail-title">
                  <strong>{relationshipInstance.title || relationshipInstance.instanceId}</strong>
                  <code>{relationshipInstance.instanceId}</code>
                </div>
                <div className="relationship-inspector-summary">
                  <div><span>Workflow</span><strong>{relationshipWorkflow?.workflowName || relationshipInstance.sopType || "-"}</strong></div>
                  <div><span>Run</span><strong>{relationshipRun?.pipelineId ? shortId(relationshipRun.pipelineId) : "No run"}</strong></div>
                  <div><span>Repo</span><strong>{relationshipInstance.repo || "-"}</strong></div>
                  <div><span>Artifacts</span><strong>{relationshipInstance.artifactCount ?? 0}</strong></div>
                </div>
                <div className="relationship-detail-actions">
                  <button type="button" onClick={() => relationshipInstance && onOpenInstance(relationshipInstance.instanceId)}>Open Instance</button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!relationshipInstance}
                    onClick={() => relationshipInstance && onOpenWorkflow(relationshipInstance.instanceId, relationshipRun?.pipelineId || "")}
                  >
                    {relationshipRun ? "Open Run" : "Open Workflow"}
                  </button>
                </div>
                <div className="relationship-progress">
                  <span>Latest execution progress</span>
                  <div className="dag-progress"><span style={{ width: `${relationshipProgress.percent}%` }} /></div>
                  <small>{relationshipProgress.done}/{relationshipProgress.total} nodes · {relationshipProgress.percent}%</small>
                </div>
                <details className="relationship-detail-more">
                  <summary>More context</summary>
                  <KeyValues data={{
                    runtime: runtime?.id || "-",
                    instance: relationshipInstance?.instanceId || "-",
                    workflow_definition: relationshipWorkflow?.workflowName || "-",
                    definition_path: relationshipWorkflow?.definitionPath || "-",
                    run: relationshipRun?.pipelineId || "-",
                    run_status: relationshipRun ? statusLabel(relationshipRun.status) : "-",
                    progress: relationshipRun ? `${runProgressFromNodes(relationshipRun).percent}%` : "-",
                    repo: relationshipInstance.repo || "-",
                    artifacts: relationshipInstance.artifactCount ?? "-",
                  }} />
                </details>
              </>
            ) : (
              <Empty text="选择一个 Instance 查看边界摘要" />
            )}
          </aside>
        </div>
      </section>

      <section className="runtime-detail-grid">
        <div className="flow-panel runtime-identity-panel">
          <div className="panel-head">
            <div><strong>Host Detail</strong><span>机器、通道和 SPI 的当前状态</span></div>
            <span className={`status-pill ${runtimeStatus}`}>{runtime?.localStatus || runtime?.status || "unknown"}</span>
          </div>
          <RuntimeHostDetailGroups runtime={runtime} metadataRows={runtimeMetadataRows} supportedTypes={supportedTypes} />
        </div>

        <div className="flow-panel runtime-health-panel">
          <div className="panel-head">
            <div><strong>Host Health</strong><span>面向控制台的可用性摘要</span></div>
            <button type="button" className="ghost-btn compact" onClick={handleRunProbe} disabled={!runtime || probeRunning}>
              {probeRunning ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}Run Checks
            </button>
          </div>
          <div className="runtime-health-grid">
            <RuntimeHealthItem label="Tunnel" value={runtime?.status || "unknown"} ok={runtime?.status === "active"} />
            <RuntimeHealthItem label="Local" value={runtime?.localStatus || "unknown"} ok={runtime?.localStatus === "ok"} />
            <RuntimeHealthItem label="SPI" value={runtime?.spiBaseUrl ? "configured" : "missing"} ok={Boolean(runtime?.spiBaseUrl || runtime?.endpoint)} />
            <RuntimeHealthItem label="Management" value={managementInstance ? "ready" : "missing"} ok={Boolean(managementInstance)} />
          </div>
          <RuntimeProbeList results={probeResults} running={probeRunning} />
        </div>
      </section>

      <section className="flow-panel runtime-hermes-panel">
        <div className="panel-head">
          <div>
            <strong>Hermes Checks</strong>
            <span>分开验证 webhook 投递链路和 Hermes Agent 真实对话能力</span>
          </div>
          <button type="button" className="ghost-btn compact" onClick={handleRunHermesChecks} disabled={!runtime || hermesDeliveryRunning || hermesAgentRunning}>
            {hermesDeliveryRunning || hermesAgentRunning ? <Loader2 size={14} className="spin" /> : <Play size={14} />}Run both
          </button>
        </div>
        <div className="runtime-hermes-grid">
          <div className="runtime-hermes-form">
            <label>
              <span>Test Message</span>
              <textarea value={hermesMessage} onChange={(event) => setHermesMessage(event.target.value)} rows={4} placeholder="请输入要发送给 Hermes 的文本" />
              <span className="field-hint">Delivery Check 会投递到 Hermes webhook；Agent Chat Check 会让 Runtime 本机 Hermes CLI 返回真实回答。</span>
            </label>
            <label>
              <span>Hermes Webhook URL</span>
              <input value={hermesUrl} onChange={(event) => setHermesUrl(event.target.value)} placeholder="Missing in runtime metadata" />
              <span className="field-hint">权威来源是 Runtime metadata 的 hermes_webhook_url / webhook_public_host；缺失时需要 create-runtime 初始化补齐。</span>
            </label>
            <div className={`runtime-hermes-endpoint-state ${hermesUrl.trim() ? "ok" : "missing"}`}>
              <strong>{hermesUrl.trim() ? "Hermes endpoint configured" : "Hermes endpoint missing"}</strong>
              <span>{hermesUrl.trim() ? "Delivery Check 可以验证 public webhook accepted；Agent Chat Check 仍然走 Runtime SPI 本机执行。" : "Runtime metadata 没有 Hermes 公网入口，不能用 SPI 域名代替 webhook。"}</span>
            </div>
            <div className="runtime-hermes-actions">
              <button type="button" className="primary" onClick={handleRunHermesDeliveryCheck} disabled={!runtime || hermesDeliveryRunning || !hermesUrl.trim()}>
                {hermesDeliveryRunning ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                {hermesDeliveryRunning ? "Checking..." : "Run delivery"}
              </button>
              <button type="button" onClick={handleRunHermesAgentCheck} disabled={!runtime || hermesAgentRunning}>
                {hermesAgentRunning ? <Loader2 size={16} className="spin" /> : <Bot size={16} />}
                {hermesAgentRunning ? "Checking..." : "Run agent chat"}
              </button>
              <div className="runtime-hermes-meta">
                <span>SPI: {runtime?.channelUrl || runtime?.endpoint || "-"}</span>
                <span>Delivery proxy: {buildRuntimeHermesSmokeProxyUrl(runtime) || "-"}</span>
                <span>Agent proxy: {buildRuntimeHermesAgentProxyUrl(runtime) || "-"}</span>
                <span>Hermes: {runtime?.metadata?.hermes_webhook_url || runtime?.metadata?.webhook_public_host || "missing"}</span>
              </div>
            </div>
          </div>
          <div className="runtime-hermes-output">
            <div className="runtime-hermes-check-card">
              <div className="runtime-hermes-check-head">
                <div>
                  <strong>Webhook Delivery Check</strong>
                  <span>验证公网域名、HMAC 签名、Hermes gateway、smoke skill 投递 accepted。</span>
                </div>
                <span className={`status-pill ${hermesDeliveryResult?.ok ? "done" : hermesDeliveryResult ? "failed" : "waiting"}`}>
                  {hermesDeliveryResult?.ok ? "passed" : hermesDeliveryResult ? "failed" : "waiting"}
                </span>
              </div>
              <div className="runtime-hermes-command">
                <div className="section-title"><span>curl</span><span>webhook delivery</span></div>
                <pre>{buildHermesCurlCommand(hermesUrl.trim() || buildHermesWebhookUrl(runtime), hermesPrompt)}</pre>
              </div>
              {renderHermesResult(hermesDeliveryResult, "点击 Run delivery。accepted 只代表任务投递成功，不代表 Agent 已返回最终回答。")}
            </div>
            <div className="runtime-hermes-check-card">
              <div className="runtime-hermes-check-head">
                <div>
                  <strong>Agent Chat Check</strong>
                  <span>验证 Runtime 本机 Hermes CLI 能用当前模型配置返回自然语言回答。</span>
                </div>
                <span className={`status-pill ${hermesAgentResult?.ok ? "done" : hermesAgentResult ? "failed" : "waiting"}`}>
                  {hermesAgentResult?.ok ? "passed" : hermesAgentResult ? "failed" : "waiting"}
                </span>
              </div>
              <div className="runtime-hermes-command">
                <div className="section-title"><span>curl</span><span>runtime agent proxy</span></div>
                <pre>{buildHermesAgentCurlCommand(buildRuntimeHermesAgentProxyUrl(runtime), hermesPrompt)}</pre>
              </div>
              {renderHermesResult(hermesAgentResult, "点击 Run agent chat，确认 Hermes CLI 可以真实回答测试消息。")}
            </div>
          </div>
        </div>
      </section>

      <section className="runtime-main-grid runtime-main-grid-single">
        <div className="flow-panel instance-list-panel">
          <div className="panel-head">
            <div><strong>Instance Registry</strong><span>{instanceSource || "runtime-spi"} · 当前 Runtime 下的业务隔离单元</span></div>
            <div className="instance-registry-actions">
              <span>{visibleInstances.length}/{instanceTotal}{instanceHasMore ? " · more" : ""}</span>
              <button type="button" className="primary compact" disabled={!managementInstance} onClick={() => onOpenManagement("create-instance")}>
                <Plus size={14} />Create Instance
              </button>
              <button type="button" className="ghost-btn compact" disabled={!managementInstance || !relationshipInstance} onClick={() => relationshipInstance && onOpenManagement("delete-instance", relationshipInstance.instanceId)}>
                <Trash2 size={14} />Delete Instance
              </button>
            </div>
          </div>
          <div className="execution-tools instance-tools">
            <label className="search-box">
              <Search size={14} />
              <input value={instanceSearch} onChange={(event) => setInstanceSearch(event.target.value)} placeholder="Search instance" />
            </label>
            <label className="filter-box">
              <SlidersHorizontal size={14} />
              <select value={instanceStatusFilter} onChange={(event) => setInstanceStatusFilter(event.target.value)}>
                <option value="all">All status</option>
                <option value="ready">Ready</option>
                <option value="running">Running</option>
                <option value="failed">Failed</option>
                <option value="disabled">Disabled</option>
                <option value="initializing">Initializing</option>
              </select>
            </label>
          </div>
          <div className="instance-table">
            {visibleInstances.map((item) => (
              <InstanceRow
                key={item.instanceId}
                instance={item}
                selected={relationshipInstance?.instanceId === item.instanceId}
                onSelect={() => {
                  setRelationshipInstanceId(item.instanceId);
                  setRelationshipRunId(item.latestExecution?.pipelineId || "");
                  setRelationshipNodeId("");
                  onSelectRelationshipInstance(item.instanceId);
                }}
                onOpen={() => onOpenInstance(item.instanceId)}
                onWorkflow={() => onOpenWorkflow(item.instanceId)}
                onDelete={() => onOpenManagement("delete-instance", item.instanceId)}
              />
            ))}
            {!visibleInstances.length && <LoadingOrEmpty loading={loading} text={instances.length ? "没有匹配的 Instance" : "当前 Runtime 没有 enabled Instance"} />}
          </div>
        </div>
      </section>

      <section className="flow-panel runtime-management-panel">
        <div className="panel-head">
          <div>
            <strong>Host Operations</strong>
            <span>机器级动作通过 runtime-management workflow 执行和记录</span>
          </div>
          <span className={`status-pill ${managementInstance ? "done" : "waiting"}`}>
            {managementInstance ? "runtime-management ready" : "missing"}
          </span>
        </div>
        <div className="runtime-management-actions">
          <ManagementActionCard
            title="Create Runtime"
            description="用管理 Runtime 的默认配置初始化一台新机器。"
            icon={<Server size={16} />}
            disabled={!managementInstance}
            onClick={() => onOpenManagement("create-runtime")}
          />
          <ManagementActionCard
            title="Delete Runtime"
            description="下线目标机器并清理服务、通道和残留。"
            icon={<AlertTriangle size={16} />}
            danger
            disabled={!managementInstance}
            onClick={() => onOpenManagement("delete-runtime")}
          />
        </div>
      </section>
        </>
      )}

      {runtimeTab === "config" && (
        <section className="runtime-detail-grid">
          <div className="flow-panel runtime-identity-panel">
            <div className="panel-head">
              <div><strong>Runtime Config</strong><span>来自 tunnel metadata 和 runtime SPI 的专属配置</span></div>
              <span className={`status-pill ${runtimeStatus}`}>{runtime?.localStatus || runtime?.status || "unknown"}</span>
            </div>
            <div className="runtime-detail-body">
              <KeyValues data={{
                runtime_id: runtime?.id || "-",
                display_name: runtime?.displayName || runtime?.name || "-",
                channel_name: runtime?.channelName || "-",
                channel_url: runtime?.channelUrl || runtime?.endpoint || "-",
                spi_base_url: runtime?.spiBaseUrl || "-",
                hermes_webhook_url: runtime?.metadata?.hermes_webhook_url || "-",
                webhook_public_host: runtime?.metadata?.webhook_public_host || "-",
                hermes_webhook_port: runtime?.metadata?.hermes_webhook_port || "-",
                client_ip: runtime?.clientIp || runtime?.machine || "-",
                local_port: runtime?.localPort || "-",
                supported_sop_types: supportedTypes,
              }} />
            </div>
          </div>
          <div className="flow-panel">
            <div className="panel-head"><div><strong>Metadata</strong><span>完整 metadata 摘要</span></div></div>
            <div className="runtime-detail-body">
              <KeyValues data={runtime?.metadata || {}} />
            </div>
          </div>
        </section>
      )}

      {runtimeTab === "events" && (
        <section className="flow-panel">
          <div className="panel-head"><div><strong>Runtime Events</strong><span>来自 instance latest workflow run 和最近探针</span></div></div>
          <div className="runtime-events-list">
            {instances.map((item) => (
              <div key={item.instanceId} className="runtime-event-row">
                <span className={`status-pill ${item.latestExecution?.status || item.status || "waiting"}`}>{item.latestExecution ? statusLabel(item.latestExecution.status) : item.status || "ready"}</span>
                <div>
                  <strong>{item.instanceId}</strong>
                  <span>{item.latestExecution?.pipelineId || item.workflowBinding?.workflowName || item.sopType || "no latest run"}</span>
                </div>
                <small>{formatBeijingTime(item.latestExecution?.updatedAt || item.updatedAt)}</small>
              </div>
            ))}
            {probeResults.map((item) => (
              <div key={item.id} className="runtime-event-row">
                <span className={`status-pill ${item.status === "ok" ? "done" : item.status === "failed" ? "failed" : "waiting"}`}>{item.status}</span>
                <div><strong>{item.label}</strong><span>{item.summary}</span></div>
                <small>{item.checkedAt}</small>
              </div>
            ))}
            {!instances.length && !probeResults.length && <Empty text="还没有 runtime event；可以先运行 health check。" />}
          </div>
        </section>
      )}
    </section>
  );
}

function RuntimeProbeList({ results, running }: { results: RuntimeProbeResult[]; running: boolean }) {
  if (!results.length && !running) {
    return (
      <div className="runtime-probe-empty">
        <Info size={14} />
        <span>点击 Run Checks 验证 SPI、Instance Registry、CORS 和 runtime-management DAG。</span>
      </div>
    );
  }
  return (
    <div className="runtime-probe-list" aria-live="polite">
      {running && !results.length && <Skeleton />}
      {results.map((item) => (
        <div key={item.id} className={`runtime-probe-row ${item.status}`}>
          <div>
            <strong>{item.label}</strong>
            <span title={item.target}>{item.target}</span>
          </div>
          <div>
            <span className={`status-pill ${item.status === "ok" ? "done" : item.status === "failed" ? "failed" : "waiting"}`}>{item.status}</span>
            <small>{item.latencyMs === undefined ? "-" : `${item.latencyMs}ms`}</small>
            <p>{item.summary}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RuntimeStatusItem({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "default" | "ok" | "warn";
}) {
  return (
    <div className={`runtime-status-item ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function RuntimeHostDetailGroups({
  runtime,
  metadataRows,
  supportedTypes,
}: {
  runtime: Runtime | undefined;
  metadataRows: Record<string, string>;
  supportedTypes: string;
}) {
  const channelUrl = runtime?.channelUrl || runtime?.endpoint || "";
  const spiUrl = runtime?.spiBaseUrl || (channelUrl ? `${channelUrl.replace(/\/+$/, "")}/api/sop` : "");
  const identity = {
    runtime_id: runtime?.id || "-",
    display_name: runtime?.displayName || runtime?.name || "-",
    status: runtime?.localStatus || runtime?.status || "unknown",
    supported_sop_types: supportedTypes,
    updated_at: formatBeijingTime(runtime?.updatedAt),
  };
  const network = {
    client_ip: runtime?.clientIp || runtime?.machine || "-",
    local_port: runtime?.localPort || "-",
    channel_name: runtime?.channelName || metadataRows.channel_name || "-",
    channel_url: channelUrl || "-",
    public_endpoint: metadataRows.public || "-",
  };
  const spi = {
    spi_base_url: spiUrl || "-",
    endpoint_url: metadataRows.endpoint_url || "-",
    ui_url: metadataRows.ui_url || "-",
    wiki_repo: metadataRows.wiki_repo || "-",
  };
  const hermes = {
    hermes_webhook_url: runtime?.metadata?.hermes_webhook_url || "-",
    webhook_public_host: runtime?.metadata?.webhook_public_host || "-",
    hermes_webhook_port: runtime?.metadata?.hermes_webhook_port || "-",
    hermes_smoke_route: runtime?.metadata?.hermes_smoke_route || "-",
  };
  const commandRows = Object.fromEntries(
    Object.entries(metadataRows).filter(([key]) => key.endsWith("_command") || key.includes("install_command"))
  );
  const knownKeys = new Set([
    ...Object.keys(identity),
    ...Object.keys(network),
    ...Object.keys(spi),
    ...Object.keys(hermes),
    ...Object.keys(commandRows),
    "runtime_id",
    "display_name",
    "title",
    "type",
  ]);
  const extraRows = Object.fromEntries(Object.entries(metadataRows).filter(([key]) => !knownKeys.has(key)));
  return (
    <div className="runtime-detail-groups">
      <RuntimeDetailGroup title="Identity" summary={runtime?.id || "runtime"} defaultOpen data={identity} />
      <RuntimeDetailGroup title="Network / Channel" summary={channelUrl || "missing channel"} data={network} />
      <RuntimeDetailGroup title="SOP SPI" summary={spiUrl || "missing spi"} data={spi} />
      <RuntimeDetailGroup title="Hermes" summary={hermes.hermes_webhook_url !== "-" ? "webhook configured" : "webhook metadata"} data={hermes} />
      <RuntimeDetailGroup title="Commands" summary={`${Object.keys(commandRows).length} command fields`} data={commandRows} />
      <RuntimeDetailGroup title="Raw Metadata" summary={`${Object.keys(extraRows).length} extra fields`} data={extraRows} />
    </div>
  );
}

function RuntimeDetailGroup({
  title,
  summary,
  data,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  data: Record<string, unknown>;
  defaultOpen?: boolean;
}) {
  return (
    <details className="runtime-detail-group" open={defaultOpen}>
      <summary>
        <strong>{title}</strong>
        <span>{summary}</span>
      </summary>
      <div className="runtime-detail-group-body">
        <KeyValues data={data} />
      </div>
    </details>
  );
}

function RuntimeDirectory({
  runtimes,
  total,
  hasMore,
  source,
  loading,
  error,
  page,
  pageSize,
  search,
  statusFilter,
  onSearch,
  onStatusFilter,
  onPage,
  onOpenRuntime,
}: {
  runtimes: Runtime[];
  total: number;
  hasMore: boolean;
  source: string;
  loading: boolean;
  error: string;
  page: number;
  pageSize: number;
  search: string;
  statusFilter: string;
  onSearch: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onPage: (value: number) => void;
  onOpenRuntime: (runtimeId: string) => void;
}) {
  const localOkCount = runtimes.filter((runtime) => runtime.localStatus === "ok").length;
  const hermesConfiguredCount = runtimes.filter((runtime) => runtime.metadata?.hermes_webhook_url || runtime.metadata?.webhook_public_host).length;
  return (
    <section className="runtime-directory">
      <div className="concept-hero runtime-hero">
        <div>
          <span className="status-pill running"><Server size={14} />Runtime Host Directory</span>
          <h1>选择一台 Runtime Host 后再进入实例和工作流。</h1>
          <p>机器、通道、SPI 与 Hermes 公网入口的基础状态，打开 Host 后查看实例、流程定义和执行记录。</p>
        </div>
        <div className="context-card">
          <strong>{total} hosts</strong>
          <span>Page {page}</span>
          <code>{source || (statusFilter === "all" ? "all status" : statusFilter)}</code>
        </div>
      </div>

      <section className="console-metrics">
        <Metric label="Page Hosts" value={runtimes.length} subtext={`page ${page}`} />
        <Metric label="Total" value={total} subtext={statusFilter === "all" ? "all runtime hosts" : `${statusFilter} runtime hosts`} />
        <Metric label="Local OK" value={localOkCount} subtext="runtime local status" />
        <Metric label="Hermes" value={hermesConfiguredCount} subtext="public webhook metadata" />
      </section>

      <section className="flow-panel runtime-directory-panel">
        <div className="panel-head runtime-directory-head">
          <div><strong>Host Directory</strong><span>机器、通道、SPI 和 Hermes 摘要</span></div>
          <div className="list-pagination compact">
            <button type="button" className="ghost-btn compact" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>
              Previous
            </button>
            <span>Page {page}</span>
            <button type="button" className="ghost-btn compact" disabled={!hasMore || loading} onClick={() => onPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
        <div className="execution-tools runtime-directory-tools">
          <label className="search-box">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => {
                onPage(1);
                onSearch(event.target.value);
              }}
              placeholder="Search runtime host"
            />
          </label>
          <label className="filter-box">
            <SlidersHorizontal size={14} />
            <select
              value={statusFilter}
              onChange={(event) => {
                onPage(1);
                onStatusFilter(event.target.value);
              }}
            >
              <option value="active">Active</option>
              <option value="all">All status</option>
              <option value="inactive">Inactive</option>
              <option value="error">Error</option>
            </select>
          </label>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="runtime-directory-list">
          {runtimes.map((runtime) => (
            <button key={runtime.id} type="button" className="runtime-directory-row" onClick={() => onOpenRuntime(runtime.id)}>
              <div className="runtime-directory-main">
                <strong>{runtime.displayName || runtime.name || runtime.id}</strong>
                <span>{runtime.id}</span>
                <code>{runtime.channelUrl || runtime.endpoint || "-"}</code>
              </div>
              <div className="runtime-directory-meta">
                <span className={`status-pill ${runtime.status === "active" ? "done" : runtime.status === "error" ? "failed" : "waiting"}`}>{runtime.status || "unknown"}</span>
                <span className={`status-pill ${runtime.localStatus === "ok" ? "done" : "waiting"}`}>local {runtime.localStatus || "unknown"}</span>
                <small>{runtime.clientIp || runtime.machine || "-"}</small>
                <small>{runtime.metadata?.hermes_webhook_url || runtime.metadata?.webhook_public_host ? "Hermes configured" : "Hermes missing"}</small>
              </div>
            </button>
          ))}
          {!runtimes.length && <LoadingOrEmpty loading={loading} text="没有匹配的 Runtime Host" />}
        </div>
      </section>
    </section>
  );
}

function WorkflowCatalog({
  workflows,
  runtimes,
  runtime,
  selectedInstance,
  instances,
  loading,
  onOpenRuntime,
  onSelectInstance,
  onOpenExecutions,
  onOpenManagement,
}: {
  workflows: WorkflowDefinition[];
  runtimes: Runtime[];
  runtime: Runtime | undefined;
  selectedInstance: Instance | undefined;
  instances: Instance[];
  loading: boolean;
  onOpenRuntime: (runtimeId: string) => void;
  onSelectInstance: (instanceId: string) => void;
  onOpenExecutions: (workflowId: string) => void;
  onOpenManagement: (action: RuntimeManagementAction) => void;
}) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [workflowTypeFilter, setWorkflowTypeFilter] = useState("all");
  const filteredWorkflows = useMemo(() => {
    const query = workflowSearch.trim().toLowerCase();
    return workflows.filter((item) => {
      const matchedType = workflowTypeFilter === "all" || item.interpreter === workflowTypeFilter || item.workflowType === workflowTypeFilter;
      const searchable = [item.workflowId, item.name, item.title, item.description, item.interpreter, item.workflowType, item.definitionPath].filter(Boolean).join(" ").toLowerCase();
      return matchedType && (!query || searchable.includes(query));
    });
  }, [workflowSearch, workflowTypeFilter, workflows]);
  const workflowTypes = useMemo(() => Array.from(new Set(workflows.flatMap((item) => [item.interpreter, item.workflowType]).filter(Boolean))).sort(), [workflows]);
  const selectedWorkflow = workflows.find((item) => item.workflowId === selectedWorkflowId) || workflows[0];
  const managementWorkflow = selectedWorkflow?.workflowId === "runtime-management";
  const defaultInstance = selectedInstance || instances.find((item) => item.instanceId !== "runtime-management") || instances[0];
  useEffect(() => {
    if (!selectedWorkflowId && workflows[0]) setSelectedWorkflowId(workflows[0].workflowId);
  }, [selectedWorkflowId, workflows]);
  return (
    <section className="workflow-catalog-page">
      <section className="ops-page-header">
        <div className="ops-page-title">
          <span className="status-pill running"><Workflow size={14} />Workflow Catalog</span>
          <div>
            <h1>Workflow Definitions</h1>
            <p>agent-brains SOP catalog · {runtime?.displayName || runtime?.id || "No runtime selected"}</p>
          </div>
        </div>
        <div className="ops-header-chips">
          <span>{workflows.length || 0} definitions</span>
          <span>{selectedWorkflow?.interpreter || "interpreter pending"}</span>
          <span>{instances.length} instances</span>
          <span>{runtime?.id || "no runtime"}</span>
        </div>
      </section>

      <section className="ops-toolbar">
        <label className="search-box">
          <Search size={14} />
          <input value={workflowSearch} onChange={(event) => setWorkflowSearch(event.target.value)} placeholder="Search workflow definition" />
        </label>
        <label className="filter-box">
          <SlidersHorizontal size={14} />
          <select value={workflowTypeFilter} onChange={(event) => setWorkflowTypeFilter(event.target.value)}>
            <option value="all">All interpreters</option>
            {workflowTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <span className="ops-toolbar-count">{filteredWorkflows.length}/{workflows.length} definitions</span>
      </section>

      <section className="workflow-catalog-grid">
        <div className="flow-panel workflow-catalog-list-panel">
          <div className="panel-head">
            <div><strong>Definition List</strong><span>无状态 SOP 定义，不属于某个 Instance</span></div>
            <span>{loading ? "loading" : `${filteredWorkflows.length} shown`}</span>
          </div>
          <div className="workflow-definition-list">
            {filteredWorkflows.map((item) => (
              <button
                key={item.workflowId}
                type="button"
                className={`workflow-definition-row ${selectedWorkflow?.workflowId === item.workflowId ? "active" : ""}`}
                onClick={() => setSelectedWorkflowId(item.workflowId)}
              >
                <div>
                  <strong>{item.title || item.name}</strong>
                  <span>{item.workflowId}</span>
                </div>
                <span className={`status-pill ${item.interpreter === "runtime-management" ? "running" : "done"}`}>
                  {item.interpreter}
                </span>
              </button>
            ))}
            {!filteredWorkflows.length && <LoadingOrEmpty loading={loading} text={workflows.length ? "没有匹配的 Workflow Definition" : "没有加载到 Workflow Definition"} />}
          </div>
        </div>

        <div className="flow-panel workflow-catalog-detail-panel">
          <div className="panel-head">
            <div><strong>{selectedWorkflow?.title || "Workflow Detail"}</strong><span>{selectedWorkflow?.definitionPath || "agent-brains SOP definition"}</span></div>
            <span className={`status-pill ${managementWorkflow ? "running" : "done"}`}>{selectedWorkflow?.workflowType || "workflow"}</span>
          </div>
          {selectedWorkflow ? (
            <div className="workflow-catalog-detail">
              <p>{selectedWorkflow.description || "该 Workflow Definition 来自 agent-brain-plugins；执行时选择 Runtime 和 Instance。"}</p>
              <KeyValues data={{
                workflow_id: selectedWorkflow.workflowId,
                interpreter: selectedWorkflow.interpreter,
                workflow_type: selectedWorkflow.workflowType,
                source: selectedWorkflow.definitionSource,
                definition_path: selectedWorkflow.definitionPath,
                nodes: selectedWorkflow.nodeCount || "-",
              }} />
              {managementWorkflow ? (
                <div className="workflow-action-grid">
                  {(selectedWorkflow.actions || []).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`management-action-card compact-action ${action.id.includes("delete") ? "danger" : ""}`}
                      onClick={() => onOpenManagement(action.id as RuntimeManagementAction)}
                    >
                      <span>{action.scope === "runtime" ? <Server size={16} /> : <LayoutDashboard size={16} />}</span>
                      <strong>{action.title || action.id}</strong>
                      <small>{action.description || action.id}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="workflow-run-context">
                  <div className="section-title"><span>Run Context</span><span>execution binding</span></div>
                  <div className="workflow-run-context-grid">
                    <button type="button" onClick={() => runtime && onOpenRuntime(runtime.id)}>
                      <strong>{runtime?.displayName || runtime?.id || "Select Runtime"}</strong>
                      <span>{runtime?.channelUrl || runtime?.endpoint || "No runtime selected"}</span>
                    </button>
                    <label className="workflow-run-context-select">
                      <strong>Instance Workspace</strong>
                      <select value={defaultInstance?.instanceId || ""} onChange={(event) => onSelectInstance(event.target.value)} disabled={!instances.length}>
                        {!instances.length && <option value="">No instance selected</option>}
                        {instances.map((item) => (
                          <option key={item.instanceId} value={item.instanceId}>{item.instanceId} · {item.repo || item.status || "workspace"}</option>
                        ))}
                      </select>
                      <span>{defaultInstance?.repo || "No instance selected"}</span>
                    </label>
                    <button type="button" className="primary" disabled={!runtime || !defaultInstance} onClick={() => selectedWorkflow && onOpenExecutions(selectedWorkflow.workflowId)}>
                      <Play size={16} />
                      Open Executions
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : <Empty text="选择一个 Workflow Definition" />}
        </div>
      </section>
    </section>
  );
}

function RuntimeHealthItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className={`runtime-health-item ${ok ? "ok" : "warn"}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function ManagementActionCard({
  title,
  description,
  icon,
  danger,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`management-action-card ${danger ? "danger" : ""}`} disabled={disabled} onClick={onClick}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <small>{description}</small>
    </button>
  );
}

function InstanceHealthTestButton({
  provider,
  runtime,
  instance,
  mode,
  kind,
}: {
  provider: SopDataProvider;
  runtime?: Runtime;
  instance?: Instance;
  mode: DataMode;
  kind: "github" | "telegram";
}) {
  const nodeId = kind === "github" ? "test-instance-github" : "test-instance-telegram";
  const [pipelineId, setPipelineId] = useState("");
  const [error, setError] = useState("");
  const label = kind === "github" ? "Test GitHub" : "Test Telegram";
  const mutation = useMutation({
    mutationFn: () => provider.triggerNodeTest(runtime!, "runtime-management", nodeId, {
      confirmMutating: true,
      requestOverrides: {
        action: "create-instance",
        management_action: "create-instance",
        runtime_id: runtime?.id || runtime?.name || "",
        channel_url: runtime?.endpoint || "",
        instances: [{
          instance_id: instance?.instanceId || "",
          repo: instance?.repo || "",
          workspace_kind: "execution-workspace",
        }],
      },
    }),
    onSuccess: (result) => {
      setError("");
      setPipelineId(result.pipelineId || "");
      if (result.status !== "triggered") setError(result.reason || result.status);
    },
    onError: (err: unknown) => {
      setPipelineId("");
      setError(err instanceof Error ? err.message : String(err));
    },
  });
  const resultQuery = useQuery({
    queryKey: queryKeys.nodeTestResult(mode, runtime, "runtime-management", nodeId, pipelineId),
    queryFn: () => provider.getNodeTestResult(runtime!, "runtime-management", nodeId, pipelineId),
    enabled: Boolean(runtime && pipelineId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return !status || status === "running" ? 1500 : false;
    },
  });
  const result = resultQuery.data;
  const instanceReport = Array.isArray(result?.detail?.instances) ? result.detail.instances[0] as Record<string, unknown> : undefined;
  const ok = result?.status === "done" || instanceReport?.ok === true || instanceReport?.sent === true;
  const terminal = result?.status && result.status !== "running";
  const disabled = !runtime || !instance || !instance.repo || mutation.isPending || result?.status === "running";
  const reason = String(instanceReport?.reason || result?.reason || error || "");
  const httpStatus = instanceReport?.http_status ? `HTTP ${instanceReport.http_status}` : "";

  return (
    <div className={`instance-health-test ${terminal ? (ok ? "ok" : "failed") : ""}`}>
      <button type="button" className={kind === "github" ? "primary" : ""} disabled={disabled} onClick={() => mutation.mutate()}>
        {mutation.isPending || result?.status === "running" ? <Loader2 size={14} className="spin" /> : kind === "github" ? <Github size={14} /> : <Send size={14} />}
        {label}
      </button>
      <div>
        <strong>{terminal ? (ok ? "passed" : "failed") : pipelineId ? "running" : "not tested"}</strong>
        <span>{pipelineId ? shortId(pipelineId) : kind === "github" ? "repo read/write probe" : "sendMessage probe"}</span>
        {(httpStatus || reason) && <small className={ok ? "" : "error-text"}>{[httpStatus, reason].filter(Boolean).join(" · ")}</small>}
      </div>
    </div>
  );
}

function WorkspaceIdentityPanel({
  instance,
  latestFailure,
}: {
  instance?: Instance;
  latestFailure?: Run;
}) {
  return (
    <div className="workspace-identity-body">
      {instance ? (
        <div className="kv-stack">
          <KeyValues data={{
            instance_id: instance.instanceId,
            status: instance.status || "unknown",
            repo: instance.repo || "-",
            repo_branch: instance.repoBranch || "-",
            wiki_local_path: instance.wikiLocalPath || "-",
            workspace_status: instance.workspaceStatus || "-",
            run_index_status: instance.runIndexStatus || "-",
            latest_failure: latestFailure?.pipelineId || "-",
          }} />
        </div>
      ) : <Empty text="请选择一个 Instance" />}
    </div>
  );
}

function InstanceConfigEditor({
  provider,
  runtime,
  instance,
  mode,
  onOpenSettings,
}: {
  provider: SopDataProvider;
  runtime?: Runtime;
  instance?: Instance;
  mode: DataMode;
  onOpenSettings?: () => void;
}) {
  const queryClient = useQueryClient();
  const instanceId = instance?.instanceId || "";
  const configQueryKey = ["workspace-identity-config", ...capabilityConfigQueryKey(mode, runtime, instanceId, "")];
  const [edits, setEdits] = useState<Record<string, string>>({});
  const configQuery = useQuery({
    queryKey: configQueryKey,
    queryFn: () => provider.getCapabilityConfig(runtime!, instanceId),
    enabled: Boolean(runtime && instanceId),
    retry: 1,
  });
  const byKey = useMemo(() => {
    const items = new Map<string, CapabilityConfigPreview["items"][number]>();
    (configQuery.data?.items || []).forEach((item) => {
      items.set(item.key, item);
      (item.aliases || []).forEach((alias) => items.set(alias, item));
    });
    return items;
  }, [configQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => provider.saveCapabilityConfig(runtime!, instanceId, {
      scope: "instance",
      values: compactNonEmptyValues(edits),
    }),
    onSuccess: (saved) => {
      setEdits({});
      queryClient.setQueryData(configQueryKey, saved);
      queryClient.invalidateQueries({ queryKey: configQueryKey });
      queryClient.invalidateQueries({ queryKey: capabilityConfigQueryKey(mode, runtime, instanceId, "") });
      queryClient.invalidateQueries({ queryKey: ["inherited-settings"] });
    },
  });
  const editedCount = Object.keys(compactNonEmptyValues(edits)).length;

  return (
    <section className="workspace-config-editor">
      {instance ? (
        <>
          <div className="workspace-config-head">
            <div>
              <strong>GitHub / Telegram Overrides</strong>
              <span>默认继承 Settings；如果 Test GitHub 或 Test Telegram 失败，只在这里覆盖当前 Instance。</span>
            </div>
            {onOpenSettings ? <button type="button" className="btn" onClick={onOpenSettings}><Settings size={14} />Settings</button> : null}
          </div>
          {configQuery.isLoading ? <Skeleton /> : null}
          {configQuery.error ? <div className="inline-error">{String(configQuery.error instanceof Error ? configQuery.error.message : configQuery.error)}</div> : null}
          {saveMutation.error ? <div className="inline-error">{String(saveMutation.error instanceof Error ? saveMutation.error.message : saveMutation.error)}</div> : null}
          <div className="workspace-config-grid">
            {INSTANCE_OVERRIDE_CONFIG_KEYS.map((field) => {
              const item = byKey.get(field.key);
              const instanceScope = item?.valuesByScope?.instance;
              const source = item?.sourceKind || (item?.present ? "resolved" : "missing");
              const secret = /TOKEN|KEY|SECRET|PRIVATE/.test(field.key);
              return (
                <label key={field.key} className={`workspace-config-field ${item?.present ? "present" : ""} ${edits[field.key]?.trim() ? "edited" : ""}`}>
                  <span>
                    <strong>{field.label}</strong>
                    <code>{field.key}</code>
                  </span>
                  <small>Instance 覆盖：{instanceScope?.present ? instanceScope.maskedValue || "已配置" : "未配置"}</small>
                  <small>最终生效：{item?.present ? `${item.maskedValue || "已配置"} · ${configSourceLabel(source)}` : "未配置"}</small>
                  <input
                    type={secret ? "password" : "text"}
                    value={edits[field.key] || ""}
                    onChange={(event) => setEdits((current) => ({ ...current, [field.key]: event.target.value }))}
                    placeholder={instanceScope?.present ? "填写新值覆盖当前 Instance；留空不变" : "填写当前 Instance 覆盖值"}
                    autoComplete="off"
                  />
                </label>
              );
            })}
          </div>
          <div className="workspace-config-actions">
            <span>留空会继续继承 Settings / Runtime / env。保存后再运行 Instance Health 测试。</span>
            <button
              type="button"
              className="btn primary"
              disabled={!editedCount || saveMutation.isPending || !runtime || !instance}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              保存覆盖{editedCount ? ` (${editedCount})` : ""}
            </button>
          </div>
        </>
      ) : <Empty text="请选择一个 Instance" />}
    </section>
  );
}

function InstanceOverview({
  runtime,
  instance,
  provider,
  mode,
  instances,
  directoryMode,
  instanceTotal,
  instanceSource,
  runs,
  dag,
  managedNodes,
  runArtifacts,
  onSelectInstance,
  onOpenInstance,
  onOpenWorkflow,
  onOpenExecutions,
  onOpenNodes,
  onOpenSettings,
  onOpenManagement,
}: {
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  provider: SopDataProvider;
  mode: DataMode;
  instances: Instance[];
  directoryMode: boolean;
  instanceTotal: number;
  instanceSource: string;
  runs: Run[];
  dag: Dag | undefined;
  managedNodes: NodeRegistryItem[];
  runArtifacts: Artifact[];
  onSelectInstance: (instanceId: string) => void;
  onOpenInstance: (instanceId: string) => void;
  onOpenWorkflow: (instanceId?: string) => void;
  onOpenExecutions: () => void;
  onOpenNodes: () => void;
  onOpenSettings: () => void;
  onOpenManagement: (action: RuntimeManagementAction, targetInstanceId?: string) => void;
}) {
  const binding = instance?.workflowBinding;
  const latest = instance?.latestExecution || runs[0];
  const latestFailure = runs.find((run) => run.status === "failed") || (latest?.status === "failed" ? latest : undefined);
  const capabilityStatus = (key: string) => readableCapabilityStatus((instance?.capabilities || {})[key]);
  const workflowBindingStatus = binding?.bindingStatus || "unbound";
  const [runSearch, setRunSearch] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState<"all" | StageStatus>("all");
  const [instanceSearch, setInstanceSearch] = useState("");
  const [instanceStatusFilter, setInstanceStatusFilter] = useState("all");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const visibleInstanceRuns = useMemo(() => {
    const query = runSearch.trim().toLowerCase();
    return runs.filter((run) => {
      const matchedStatus = runStatusFilter === "all" || run.status === runStatusFilter;
      const searchable = [run.pipelineId, run.status, run.repo, run.sourceUrl, run.updatedAt].filter(Boolean).join(" ").toLowerCase();
      return matchedStatus && (!query || searchable.includes(query));
    });
  }, [runSearch, runStatusFilter, runs]);
  const visibleInstances = useMemo(() => {
    const query = instanceSearch.trim().toLowerCase();
    return instances.filter((item) => {
      const matchedStatus = instanceStatusFilter === "all" || item.status === instanceStatusFilter;
      const searchable = [item.instanceId, item.title, item.repo, item.sopType, item.workflowBinding?.workflowName, item.status].filter(Boolean).join(" ").toLowerCase();
      return matchedStatus && (!query || searchable.includes(query));
    });
  }, [instanceSearch, instanceStatusFilter, instances]);

  if (directoryMode) {
    const readyCount = instances.filter((item) => item.status === "ready" || item.status === "running").length;
    const failedCount = instances.filter((item) => item.status === "failed").length;
    const workflowCount = instances.filter((item) => item.workflowBinding).length;
    return (
      <section className="instance-overview instance-directory-page">
        <section className="ops-page-header">
          <div className="ops-page-title">
            <span className="status-pill done"><LayoutDashboard size={14} />Instance Registry</span>
            <div>
              <h1>Instance Registry</h1>
              <p>{runtime?.displayName || runtime?.name || runtime?.id || "Runtime"} · {runtime?.endpoint || "No endpoint"} · {instanceSource || "runtime-spi"}</p>
            </div>
          </div>
          <div className="ops-header-chips">
            <span>{instanceTotal} instances</span>
            <span>{readyCount} ready</span>
            <span>{failedCount} failed</span>
            <span>{workflowCount} workflow bindings</span>
          </div>
        </section>

        <section className="ops-toolbar">
          <label className="search-box">
            <Search size={14} />
            <input value={instanceSearch} onChange={(event) => setInstanceSearch(event.target.value)} placeholder="Search instance" />
          </label>
          <label className="filter-box">
            <SlidersHorizontal size={14} />
            <select value={instanceStatusFilter} onChange={(event) => setInstanceStatusFilter(event.target.value)}>
              <option value="all">All status</option>
              <option value="ready">Ready</option>
              <option value="running">Running</option>
              <option value="failed">Failed</option>
              <option value="disabled">Disabled</option>
              <option value="initializing">Initializing</option>
            </select>
          </label>
          <span className="ops-toolbar-count">{visibleInstances.length}/{instanceTotal} instances</span>
          <div className="ops-toolbar-actions">
            <button type="button" className="primary compact" onClick={() => onOpenManagement("create-instance")}>
              <Plus size={14} />Create Instance
            </button>
            <button type="button" className="ghost-btn compact" disabled={!instance} onClick={() => instance && onOpenManagement("delete-instance", instance.instanceId)}>
              <Trash2 size={14} />Delete Instance
            </button>
          </div>
        </section>

        <section className="instance-directory-grid">
          <div className="flow-panel instance-registry-panel">
            <div className="panel-head">
              <div><strong>Instance List</strong><span>点击行只切换当前选择；详情、Workflow 和删除使用右侧显式按钮。</span></div>
              <span>{visibleInstances.length} shown</span>
            </div>
            <div className="instance-table">
              {visibleInstances.map((item) => (
                <InstanceRow
                  key={item.instanceId}
                  instance={item}
                  selected={instance?.instanceId === item.instanceId}
                  onSelect={() => onSelectInstance(item.instanceId)}
                  onOpen={() => onOpenInstance(item.instanceId)}
                  onWorkflow={() => onOpenWorkflow(item.instanceId)}
                  onDelete={() => onOpenManagement("delete-instance", item.instanceId)}
                />
              ))}
              {!visibleInstances.length && <LoadingOrEmpty loading={false} text={instances.length ? "没有匹配的 Instance" : "当前 Runtime 没有 Instance"} />}
            </div>
          </div>

          <aside className="flow-panel instance-directory-inspector">
            <div className="panel-head">
              <div><strong>{instance?.title || "Instance Detail"}</strong><span>{instance?.instanceId || "No instance selected"}</span></div>
              <span className={`status-pill ${instance?.status === "failed" ? "failed" : instance?.status === "running" ? "running" : "done"}`}>{instance?.status || "ready"}</span>
            </div>
            {instance ? (
              <div className="instance-inspector-body">
                <KeyValues data={{
                  instance_id: instance.instanceId,
                  repo: instance.repo || "-",
                  workflow: instance.workflowBinding?.workflowName || instance.sopType || "-",
                  latest_run: instance.latestExecution?.pipelineId || "-",
                  runs: instance.executionCount ?? "-",
                  artifacts: instance.artifactCount ?? 0,
                }} />
                <div className="relationship-detail-actions">
                  <button type="button" onClick={() => onOpenInstance(instance.instanceId)}>Open Instance</button>
                  <button type="button" className="primary" onClick={() => onOpenWorkflow(instance.instanceId)}>Open Workflow</button>
                  <button type="button" className="ghost-btn" onClick={() => onOpenManagement("delete-instance", instance.instanceId)}>Delete</button>
                </div>
              </div>
            ) : <Empty text="选择一个 Instance 查看详情" />}
          </aside>
        </section>
      </section>
    );
  }

  return (
    <section className="instance-overview">
      <div className="workflow-command-bar instance-command">
        <div className="workflow-title">
          <span className={`status-pill ${instance?.status === "failed" ? "failed" : instance?.status === "running" ? "running" : "done"}`}><LayoutDashboard size={14} />Instance Workspace</span>
          <div className="context-path">
            <span>Runtime Host</span>
            <strong>{runtime?.displayName || runtime?.name || runtime?.id || "host"}</strong>
            <span>/ Instance</span>
            <strong>{instance?.instanceId || "instance"}</strong>
          </div>
          <div>
            <h1>{instance?.title || "选择 Instance"}</h1>
            <p>{runtime?.name || "Runtime Host"} · {instance?.repo || "repo pending"} · {instance?.instanceId || "-"}</p>
          </div>
        </div>
        <div className="workflow-metrics">
          <Metric label="Workspace" value={instance?.workspaceStatus || "unknown"} subtext={instance?.wikiLocalPath || "local path pending"} />
          <Metric label="GitHub" value={capabilityStatus("git")} subtext={instance?.repo || "repo pending"} />
          <Metric label="Telegram" value={capabilityStatus("telegram")} subtext="instance notification" />
          <Metric label="Run Index" value={instance?.runIndexStatus || "unknown"} subtext={latest ? `${shortId(latest.pipelineId)} · ${statusLabel(latest.status)}` : "no execution"} />
        </div>
      </div>

      <section className="instance-grid">
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Workspace Identity</strong><span>Instance 是 Runtime/Hermes 上的执行工作区，不是 Workflow</span></div></div>
          <WorkspaceIdentityPanel
            instance={instance}
            latestFailure={latestFailure}
          />
        </div>

        <div className="flow-panel">
          <div className="panel-head">
            <div><strong>Instance Health</strong><span>创建 Instance 后应优先确认 GitHub 与 TG 可用</span></div>
            <button type="button" className="btn" disabled={!instance} onClick={() => setConfigDialogOpen(true)}><Settings size={14} />修改配置</button>
          </div>
          <KeyValues data={{
            workspace: instance?.workspaceStatus || "-",
            registry: instance?.enabled === false ? "disabled" : "enabled",
            github: capabilityStatus("git"),
            telegram: capabilityStatus("telegram"),
            run_index: instance?.runIndexStatus || "-",
          }} />
          <div className="instance-health-actions">
            <InstanceHealthTestButton provider={provider} runtime={runtime} instance={instance} mode={mode} kind="github" />
            <InstanceHealthTestButton provider={provider} runtime={runtime} instance={instance} mode={mode} kind="telegram" />
          </div>
        </div>

        {configDialogOpen ? (
          <div className="modal-backdrop" role="presentation" onClick={() => setConfigDialogOpen(false)}>
            <section className="trigger-modal instance-config-modal" role="dialog" aria-modal="true" aria-label="Instance configuration" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h2>Instance 配置</h2>
                  <span>{runtime?.id || runtime?.name || "-"} · {instance?.instanceId || "-"}</span>
                </div>
                <button type="button" className="ghost-btn" onClick={() => setConfigDialogOpen(false)}><X size={16} />关闭</button>
              </div>
              <InstanceConfigEditor
                provider={provider}
                runtime={runtime}
                instance={instance}
                mode={mode}
                onOpenSettings={onOpenSettings}
              />
            </section>
          </div>
        ) : null}

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Available Workflow Context</strong><span>Workflow 执行时选择；从当前 Instance 进入时会默认选中它</span></div><button type="button" onClick={() => onOpenWorkflow()}>Open Workflow</button></div>
          <KeyValues data={{
            binding_status: workflowBindingStatus,
            compatibility_workflow: binding?.workflowId || "-",
            definition_source: binding?.definitionSource || "stateless catalog",
            definition_path: binding?.definitionPath || "-",
          }} />
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Capabilities</strong><span>工作区级依赖能力</span></div></div>
          <CapabilityGrid capabilities={instance?.capabilities || {}} />
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Execution Summary</strong><span>Run 属于当前 Instance；Workflow Definition 执行时再选择</span></div></div>
          <div className="workflow-metrics compact-metrics">
            <Metric label="Workflow Runs" value={instance?.executionCount ?? runs.length} subtext={latest ? `${shortId(latest.pipelineId)} · ${statusLabel(latest.status)}` : "no run"} />
            <Metric label="Artifacts" value={instance?.artifactCount ?? runArtifacts.length} subtext={`${instance?.pageCount ?? latest?.pageCount ?? 0} pages`} />
            <Metric label="Catalog Nodes" value={`${binding?.enabledNodeCount ?? managedNodes.length}/${binding?.nodeCount ?? dag?.nodes.length ?? 0}`} subtext="selected workflow context" />
          </div>
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Recent Workflow Runs</strong><span>执行历史属于当前 Instance，不是 Workflow Definition</span></div><button type="button" onClick={onOpenExecutions}>Open Runs</button></div>
          <div className="execution-tools instance-run-tools">
            <label className="search-box">
              <Search size={14} />
              <input value={runSearch} onChange={(event) => setRunSearch(event.target.value)} placeholder="Search execution" />
            </label>
            <label className="filter-box">
              <SlidersHorizontal size={14} />
              <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value as "all" | StageStatus)}>
                <option value="all">All status</option>
                {statusOrder.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
            </label>
          </div>
          <RunTable runs={visibleInstanceRuns.slice(0, 8)} selectedRunId={latest?.pipelineId || ""} onSelect={() => onOpenExecutions()} />
        </div>

        <div className="flow-panel wide-panel">
          <div className="panel-head"><div><strong>Node Definition Catalog</strong><span>当前 Workflow Definition 中的节点定义</span></div><button type="button" onClick={onOpenNodes}>Open Nodes</button></div>
          <div className="stage-map compact">
            {(dag?.nodes || []).map((node) => (
              <button key={node.id} type="button" className="stage-map-node waiting" onClick={onOpenNodes}>
                <span className="dot waiting" />
                <strong>{node.title}</strong>
                <small>{node.id}</small>
              </button>
            ))}
            {!dag?.nodes.length && <Empty text="还没有加载 Workflow Definition DAG" />}
          </div>
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Other Instances</strong><span>{instances.length}/{instanceTotal} loaded · {instanceSource || "runtime-spi"}</span></div></div>
          <div className="runtime-list compact">
            {instances.map((item) => (
              <button key={item.instanceId} type="button" className={`runtime-select-card ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => onOpenInstance(item.instanceId)}>
                <div><strong>{item.title}</strong><span>{item.workflowBinding?.workflowName || item.sopType}</span></div>
                <span className={`status-pill ${item.status === "failed" ? "failed" : item.status === "running" ? "running" : "done"}`}>{item.status || "ready"}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

function InstanceRow({
  instance,
  selected = false,
  onSelect,
  onOpen,
  onWorkflow,
  onDelete,
}: {
  instance: Instance;
  selected?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onWorkflow: () => void;
  onDelete?: () => void;
}) {
  const latest = instance.latestExecution;
  const protectedInstance = instance.instanceId === "runtime-management";
  return (
    <div className={`instance-row ${selected ? "selected" : ""}`}>
      <button type="button" className="instance-main" onClick={onSelect}>
        <div>
          <strong>{instance.title}</strong>
          <span>{instance.instanceId}</span>
        </div>
        <span className={`status-pill ${instance.status === "failed" ? "failed" : instance.status === "running" ? "running" : "done"}`}>{instance.status || "ready"}</span>
      </button>
      <div className="instance-meta">
        <span>{instance.workflowBinding?.workflowName || instance.sopType || "Workflow"}</span>
        <span>{instance.repo || "-"}</span>
        <span>{latest ? `${shortId(latest.pipelineId)} · ${statusLabel(latest.status)} · ${runProgressFromNodes(latest).percent}%` : "No execution"}</span>
        <span>{instance.artifactCount || 0} artifacts · {instance.pageCount || 0} pages</span>
      </div>
      <div className="instance-actions">
        <button type="button" onClick={onOpen}>Open</button>
        <button type="button" onClick={onWorkflow}>Workflow</button>
        {onDelete && (
          <button type="button" className="danger-light" onClick={onDelete} disabled={protectedInstance} title={protectedInstance ? "runtime-management 是受保护的默认管理 Instance" : "Delete Instance"}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function CapabilityGrid({ capabilities }: { capabilities: Record<string, unknown> }) {
  const entries = Object.entries(capabilities);
  if (!entries.length) return <Empty text="暂无 capability 状态" />;
  return (
    <div className="capability-grid">
      {entries.map(([key, value]) => {
        const text = readableCapabilityStatus(value);
        const ok = ["ok", "ready", "configured"].includes(text);
        return <span key={key} className={`capability-chip ${ok ? "ok" : ""}`}><strong>{key}</strong>{text}</span>;
      })}
    </div>
  );
}

function readableCapabilityStatus(value: unknown) {
  if (typeof value === "string") return value || "unknown";
  if (typeof value === "boolean") return value ? "configured" : "missing";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const explicit = record.status || record.state || record.result;
    if (typeof explicit === "string" && explicit) return explicit;
    if (record.enabled === false) return "disabled";
    if (record.present === false) return "missing";
    if (record.configured === false) return "missing";
    if (record.enabled === true || record.present === true || record.configured === true) return "configured";
  }
  return value == null ? "unknown" : String(value);
}

function OverviewPage({
  runtime,
  instance,
  mode,
  runs,
  dag,
  selectedRun,
  selectedStage,
  nodesReadyCount,
  managedNodes,
  runEvents,
  artifactCount,
  streamStatus,
  onOpenRun,
  onOpenWorkflow,
  onOpenNode,
}: {
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  mode: DataMode;
  runs: Run[];
  dag: Dag | undefined;
  selectedRun: Run | undefined;
  selectedStage: DagNode | undefined;
  nodesReadyCount: number;
  managedNodes: NodeRegistryItem[];
  runEvents: NodeEvent[];
  artifactCount: number;
  streamStatus: "live" | "reconnecting" | "polling fallback" | "closed";
  onOpenRun: (pipelineId?: string) => void;
  onOpenWorkflow: () => void;
  onOpenNode: (nodeId: string) => void;
}) {
  const activeRuns = runs.filter((run) => run.status === "running").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const recentRuns = [...runs].sort((a, b) => {
    const score = (run: Run) => run.status === "running" ? 0 : run.status === "failed" ? 1 : 2;
    return score(a) - score(b) || b.updatedAt.localeCompare(a.updatedAt);
  }).slice(0, 4);
  const selectedNodeDefinition = managedNodes.find((node) => node.nodeId === selectedStage?.id);
  return (
    <>
      <section className="concept-hero">
        <div>
          <span className="status-pill running"><Activity size={14} />Concept A · Ops Console</span>
          <h1>用一个操作台掌控 Runtime、Run 和节点状态</h1>
          <p>默认聚焦运行健康、失败节点、最近产物和下一步操作。适合日常看板和运维。</p>
        </div>
        <div className="context-card">
          <strong>{instance?.title || "Wiki SOP Workspace"}</strong>
          <span>{runtime?.name || "Runtime"} · {mode === "real" ? "Real data" : "Mock data"}</span>
          <code>{runtime?.endpoint || "-"}</code>
        </div>
      </section>
      <section className="console-metrics">
        <Metric label="Active runs" value={activeRuns} subtext={`${activeRuns} running, ${runs.length - activeRuns} other`} />
        <Metric label="Nodes ready" value={`${nodesReadyCount}/${managedNodes.length || 0}`} subtext="metadata complete" />
        <Metric label="Artifacts" value={artifactCount || "-"} subtext="run scoped" />
        <Metric label="Events" value={streamStatus} subtext={streamStatusHint(streamStatus)} />
      </section>
      <section className="console-grid">
        <div className="flow-panel compact-flow">
          <div className="panel-head">
            <div><strong>Workflow Definition Map</strong><span>节点来自定义；状态来自当前 Workflow Run</span></div>
            <button type="button" onClick={onOpenWorkflow}>Open Definition</button>
          </div>
          <div className="stage-map">
            {(dag?.nodes || []).map((node) => {
              const state = selectedRun?.nodes[node.id] || "waiting";
              return (
                <button key={node.id} type="button" className={`stage-map-node ${state}`} onClick={() => onOpenNode(node.id)}>
                  <span className={`dot ${state}`} />
                  <strong>{node.title}</strong>
                  <small>{node.mode}</small>
                </button>
              );
            })}
            {!dag?.nodes.length && <Empty text="选择 Runtime Host 和 Instance 后加载 Workflow Definition Map" />}
          </div>
        </div>
        <div className="runs-table-panel">
          <div className="panel-head">
            <div><strong>Recent Workflow Runs</strong><span>优先显示 running / failed / latest</span></div>
            <button type="button" onClick={() => onOpenRun()}>View all</button>
          </div>
          <RunTable runs={recentRuns} selectedRunId={selectedRun?.pipelineId || ""} onSelect={onOpenRun} />
        </div>
        <aside className="decision-panel">
          <div className="panel-head compact"><div><strong>{selectedStage?.title || "Wiki Build"}</strong><span>{selectedStage?.id || "wiki-build"} · hermes-agent-skill</span></div></div>
          <DetailBlock title="Decision summary">
            <KeyValues data={{
              health: failedRuns ? `${failedRuns} failed run signals` : "ready, no missing contract fields",
              input: selectedStage ? Object.values(selectedStage.inputs || {}).join(", ") || "-" : "notebooklm-research.outputs.reports",
              output: selectedStage ? Object.values(selectedStage.outputs || {}).join(", ") || "-" : "index.md, wiki/**",
            }} />
          </DetailBlock>
          <DetailBlock title="Attached capabilities">
            {selectedNodeDefinition ? <CapabilityMini node={selectedNodeDefinition} /> : <div className="cap-mini"><span className="on">GitHub</span><span>TG</span><span className="on">SSE</span></div>}
          </DetailBlock>
          <DetailBlock title="Recent events">
            <div className="event-list">
              {runEvents.slice(-3).reverse().map((event, index) => <EventRow key={event.sequence || index} event={event} />)}
              {!runEvents.length && <Empty text="当前 Run 暂无事件" />}
            </div>
          </DetailBlock>
          <DetailBlock title="CLI">
            <code className="overview-cli">{selectedNodeDefinition?.cli?.inspect || "选择节点后显示 inspect CLI"}</code>
          </DetailBlock>
          <DetailBlock title="Actions">
            <div className="action-row"><button type="button" onClick={onOpenWorkflow}>Inspect</button><button type="button" onClick={() => onOpenRun()}>Runs</button></div>
          </DetailBlock>
        </aside>
      </section>
    </>
  );
}

function WorkflowHome({
  runtime,
  instance,
  mode,
  selectedRun,
  dag,
  runArtifacts,
  streamStatus,
  nodesReadyCount,
  managedNodeCount,
  runs,
  onOpenWorkflow,
}: {
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  mode: DataMode;
  selectedRun: Run | undefined;
  dag: Dag | undefined;
  runArtifacts: Artifact[];
  streamStatus: StreamStatus;
  nodesReadyCount: number;
  managedNodeCount: number;
  runs: Run[];
  onOpenWorkflow: () => void;
}) {
  return (
    <section className="workflow-home">
      <div className="workflow-command-bar">
        <div className="workflow-title">
          <span className="status-pill running"><Workflow size={14} />Workflow Definition</span>
          <div>
            <h1>Definition 与 Run 分开观察</h1>
            <p>{instance?.title || "SOP Workflow"} · {runtime?.endpoint || "No endpoint"} · {mode}</p>
          </div>
        </div>
        <div className="workflow-metrics">
          <Metric label="Selected Run" value={`${runProgressFromNodes(selectedRun, dag).percent}%`} subtext={`${runProgressFromNodes(selectedRun, dag).done}/${runProgressFromNodes(selectedRun, dag).total} nodes`} />
          <Metric label="Artifacts" value={selectedRun?.artifactCount ?? runArtifacts.length} subtext="run scoped" />
          <Metric label="Node Definitions" value={`${nodesReadyCount}/${managedNodeCount || 0}`} subtext="metadata ready" />
          <Metric label="SSE" value={streamStatus} subtext={streamStatusHint(streamStatus)} />
        </div>
      </div>

      <section className="workflow-entry-panel">
        <div className="panel-head">
          <div>
            <strong>Workflow Definition</strong>
            <span>选择 Instance 绑定的 SOP 定义后进入执行观察</span>
          </div>
          <span>{instance ? 1 : 0}</span>
        </div>
        {instance ? (
          <button type="button" className="workflow-entry-card" onClick={onOpenWorkflow}>
            <div>
              <span className="status-pill done"><GitBranch size={14} />Active Definition</span>
              <h2>{instance.title || "YouTube Wiki SOP"}</h2>
              <p>{instance.repo || instance.instanceId}</p>
            </div>
            <div className="workflow-entry-meta">
              <Metric label="Workflow Runs" value={runs.length} subtext={selectedRun?.pipelineId ? shortId(selectedRun.pipelineId) : "no run selected"} />
              <span className={`status-pill ${selectedRun?.status || "waiting"}`}>{selectedRun ? statusLabel(selectedRun.status) : "No run"}</span>
            </div>
          </button>
        ) : (
          <Empty text="当前 Runtime Host 没有可用 Workflow Definition" />
        )}
      </section>
    </section>
  );
}

function WorkflowWorkspace({
  runtime,
  instance,
  instances,
  provider,
  mode,
  runs,
  executionSearch,
  executionFilter,
  executionPage,
  executionHasNext,
  executionTotal,
  executionSource,
  onExecutionSearch,
  onExecutionFilter,
  onExecutionPage,
  selectedRun,
  selectedRunMissing,
  selectedStage,
  selectedStatus,
  dag,
  dagLoading,
  flowNodes,
  flowEdges,
  nodeDetail,
  nodeLog,
  runEvents,
  runArtifacts,
  streamStatus,
  inspectorTab,
  setInspectorTab,
  rawLogOpen,
  setRawLogOpen,
  openNodeConfig,
  onValidateNodeWithRun,
  onSwitchInstance,
  onSelectRun,
  onSelectNode,
  onCancelRun,
  onRetryNode,
  onCancelNode,
  cancelRunPending,
  retryPending,
  cancelNodePending,
}: {
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  instances: Instance[];
  provider: SopDataProvider;
  mode: DataMode;
  runs: Run[];
  executionSearch: string;
  executionFilter: "all" | StageStatus;
  executionPage: number;
  executionHasNext: boolean;
  executionTotal: number;
  executionSource: string;
  onExecutionSearch: (value: string) => void;
  onExecutionFilter: (value: "all" | StageStatus) => void;
  onExecutionPage: (value: number) => void;
  selectedRun: Run | undefined;
  selectedRunMissing: boolean;
  selectedStage: DagNode | undefined;
  selectedStatus: StageStatus;
  dag: Dag | undefined;
  dagLoading: boolean;
  flowNodes: Node<StageNodeData>[];
  flowEdges: Edge[];
  nodeDetail: NodeDetail | undefined;
  nodeLog: NodeLog | undefined;
  runEvents: NodeEvent[];
  runArtifacts: Artifact[];
  streamStatus: StreamStatus;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  rawLogOpen: boolean;
  setRawLogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openNodeConfig: (nodeId: string) => void;
  onValidateNodeWithRun: (nodeId: string, pipelineId: string) => void;
  onSwitchInstance: (instanceId: string) => void;
  onSelectRun: (pipelineId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onCancelRun: () => void;
  onRetryNode: () => void;
  onCancelNode: () => void;
  cancelRunPending: boolean;
  retryPending: boolean;
  cancelNodePending: boolean;
}) {
  const gitEvents = runEvents.filter((event) => event.event.startsWith("git."));
  const tgEvents = runEvents.filter((event) => event.event.startsWith("telegram.") || event.event.startsWith("tg_notify"));
  const runningExecutionCount = runs.filter((run) => run.status === "running").length;
  const topRuns = runs.slice(0, 20);
  const displayedRuns = selectedRun && !topRuns.some((run) => run.pipelineId === selectedRun.pipelineId)
    ? [selectedRun, ...topRuns.filter((run) => run.pipelineId !== selectedRun.pipelineId)].slice(0, 8)
    : topRuns;
  const selectedProgress = runProgressFromNodes(selectedRun, dag);
  const workflowBinding = instance?.workflowBinding;
  return (
    <section className="workflow-workspace">
      {selectedRunMissing && (
        <div className="warning-banner">
          URL 指向的 Workflow Run 不存在或当前 Runtime 未返回该 Run。页面不会静默切换到其他 Run，请从 Workflow Runs 重新选择。
        </div>
      )}

      <div className="workflow-context-strip">
        <span>Runtime Host</span>
        <strong>{runtime?.displayName || runtime?.name || runtime?.id || "-"}</strong>
        <span>/ Instance</span>
        <label className="workflow-instance-select">
          <select value={instance?.instanceId || ""} onChange={(event) => onSwitchInstance(event.target.value)} disabled={!instances.length}>
            {!instances.length && <option value="">No instance</option>}
            {instances.map((item) => <option key={item.instanceId} value={item.instanceId}>{item.instanceId}</option>)}
          </select>
        </label>
        <span>/ Workflow Definition</span>
        <strong>{workflowBinding?.workflowName || instance?.sopType || "workflow"}</strong>
        <span>/ Workflow Run</span>
        <strong>{selectedRun?.pipelineId ? shortId(selectedRun.pipelineId) : "-"}</strong>
      </div>

      <section className="workflow-definition-overview">
        <article className="workflow-definition-card">
          <span className="status-pill done"><GitBranch size={14} />Workflow Definition</span>
          <strong>{workflowBinding?.workflowName || instance?.sopType || "No workflow binding"}</strong>
          <small>{workflowBinding?.definitionPath || workflowBinding?.definitionSource || "agent-brains SOP definition"}</small>
          <KeyValues data={{
            scope: "stateless SOP definition",
            workflow_id: workflowBinding?.workflowId || "-",
            version: workflowBinding?.workflowVersion || "-",
            node_definitions: workflowBinding?.nodeCount ?? dag?.nodes.length ?? 0,
            enabled_nodes: workflowBinding?.enabledNodeCount ?? dag?.nodes.length ?? 0,
          }} />
        </article>
        <article className="workflow-definition-card">
          <span className={`status-pill ${selectedRun?.status || "waiting"}`}><ListChecks size={14} />Selected Workflow Run</span>
          <strong>{selectedRun?.pipelineId ? shortId(selectedRun.pipelineId) : "No run selected"}</strong>
          <small>{formatBeijingTime(selectedRun?.updatedAt || selectedRun?.startedAt, "select a workflow run from the list")}</small>
          <KeyValues data={{
            scope: "stateful workflow run",
            status: selectedRun ? statusLabel(selectedRun.status) : "-",
            progress: selectedRun ? `${selectedProgress.done}/${selectedProgress.total} nodes · ${selectedProgress.percent}%` : "-",
            running_node: selectedRun?.runningNode || "-",
            failed_node: selectedRun?.failedNode || "-",
          }} />
        </article>
        <article className="workflow-definition-card">
          <span className="status-pill waiting"><Boxes size={14} />Node Definition / Node Run</span>
          <strong>{selectedStage?.title || "Select a node"}</strong>
          <small>{selectedStage?.id || "Node definition and node run state are inspected separately."}</small>
          <KeyValues data={{
            scope: "definition plus selected run state",
            definition_mode: selectedStage?.mode || "-",
            selected_state: selectedStage ? statusLabel(selectedStatus) : "-",
            artifacts: nodeDetail?.artifacts?.length ?? "-",
            events: runEvents.length,
          }} />
        </article>
      </section>

      <div className="workflow-primary-grid">
        <aside className="workflow-run-panel">
          <section className="workflow-execution-list">
            <div className="panel-head compact">
              <div>
                <strong>Workflow Runs</strong>
                <span>{runningExecutionCount ? `${runningExecutionCount} running · ${executionSource || "runtime-spi"}` : `total ${executionTotal} · ${executionSource || "runtime-spi"}`}</span>
              </div>
              <span>{runs.length}/{executionTotal}</span>
            </div>
            <div className="execution-tools workflow-tools">
              <label className="search-box">
                <Search size={14} />
                <input
                  value={executionSearch}
                  onChange={(event) => {
                    onExecutionPage(1);
                    onExecutionSearch(event.target.value);
                  }}
                  placeholder="Search workflow run"
                />
              </label>
              <label className="filter-box">
                <SlidersHorizontal size={14} />
                <select
                  value={executionFilter}
                  onChange={(event) => {
                    onExecutionPage(1);
                    onExecutionFilter(event.target.value as "all" | StageStatus);
                  }}
                >
                  <option value="all">All status</option>
                  {statusOrder.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                </select>
              </label>
            </div>
            <div className="workflow-run-list">
              {displayedRuns.map((run) => (
                <button
                  key={run.pipelineId}
                  type="button"
                  title={`${run.pipelineId}\n${statusLabel(run.status)} · ${runProgressFromNodes(run, dag).percent}%\n${run.sourceUrl || run.repo}\n${formatBeijingTime(run.updatedAt || run.startedAt)}`}
                  className={`workflow-run-row ${run.status} ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`}
                  onClick={() => onSelectRun(run.pipelineId)}
                >
                  <strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong>
                  <span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span>
                  <small>{runProgressFromNodes(run, dag).percent}% · {formatBeijingTime(run.updatedAt || run.startedAt)}</small>
                  <small>{run.sourceUrl || run.repo}</small>
                </button>
              ))}
              {!runs.length && <Empty text="当前 Workspace 还没有 Workflow Run" />}
            </div>
            <div className="list-pagination">
              <button type="button" className="ghost-btn compact" disabled={executionPage <= 1} onClick={() => onExecutionPage(Math.max(1, executionPage - 1))}>
                Previous
              </button>
              <span>Page {executionPage}</span>
              <button type="button" className="ghost-btn compact" disabled={!executionHasNext} onClick={() => onExecutionPage(executionPage + 1)}>
                Next
              </button>
            </div>
          </section>
        </aside>

        <section className="flow-panel workflow-dag-panel">
          <div className="panel-head workflow-dag-head">
            <div className="dag-title-block">
              <strong>Definition DAG + Run State</strong>
              <span>{workflowBinding?.definitionPath || selectedRun?.pipelineId || instance?.instanceId || "-"}</span>
            </div>
            <div className="head-actions dag-actions">
              {selectedRun?.status === "running" && (
                <button type="button" className="btn-danger-sm" disabled={cancelRunPending} onClick={onCancelRun}>
                  <X size={14} />Cancel Run
                </button>
              )}
              <div className="dag-status-strip">
                <div className="dag-progress" aria-label={`Run progress ${selectedProgress.percent}%`}>
                  <span style={{ width: `${selectedProgress.percent}%` }} />
                </div>
                {selectedRun && <span className="status-pill running">{selectedProgress.percent}%</span>}
                {selectedRun && <span className="status-pill waiting">{selectedProgress.done}/{selectedProgress.total} nodes</span>}
                <span className={`status-pill ${streamStatus === "live" ? "done" : streamStatus === "closed" ? "waiting" : "running"}`}>SSE {streamStatus}</span>
                {selectedRun && <span className={`status-pill ${selectedRun.status}`}>{statusLabel(selectedRun.status)}</span>}
              </div>
            </div>
          </div>
          <div className="flow-wrap workflow-flow-wrap">
            {dagLoading ? <Skeleton /> : dag?.nodes.length ? (
              <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .22 }} minZoom={.35} maxZoom={1.7} nodesDraggable onNodeClick={(_, node) => onSelectNode(node.id)} defaultEdgeOptions={{ className: "flow-edge" }}>
                <Background color="#dfe4ec" gap={24} /><Controls showInteractive={false} /><MiniMap nodeStrokeWidth={3} zoomable pannable />
              </ReactFlow>
            ) : <Empty text="选择 Runtime 和 Instance 后加载 Workflow Definition DAG" />}
          </div>
        </section>

        <aside className="workflow-node-inspector">
          <div className="panel-head compact">
            <div>
              <strong>{selectedStage?.title || "Node Definition / Node Run"}</strong>
              <span>{selectedStage ? `${selectedStage.mode} · ${selectedStage.id}` : "选择 DAG 节点"}</span>
            </div>
            <div className="head-actions compact-actions">
              {selectedStage && <span className={`status-pill ${selectedStatus}`}>{statusIcon(selectedStatus)}{statusLabel(selectedStatus)}</span>}
              {selectedStage && (
                <button type="button" className="icon-btn" title="查看节点配置" onClick={() => openNodeConfig(selectedStage.id)}>
                  <Info size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="tabs">
            {(["config", "run", "artifacts", "logs"] as InspectorTab[]).map((tab) => (
              <button key={tab} type="button" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>{inspectorTabLabel(tab)}</button>
            ))}
          </div>

          <div className="workflow-inspector-body">
            {!selectedStage || !selectedRun || !instance || !runtime ? <Empty text="选择一个 Workflow Run 和 Node 查看详情" /> : (
              <>
                {inspectorTab === "config" && (
                  <>
                    <DetailBlock title="Node Definition">
                      <KeyValues data={{
                        stage_id: selectedStage.id,
                        title: nodeDetail?.definition?.titleZh || nodeDetail?.definition?.title || selectedStage.title,
                        branch: nodeDetail?.definition?.branch || nodeDetail?.branch || selectedStage.branch || "-",
                        purpose: nodeDetail?.definition?.purposeZh || nodeDetail?.definition?.purpose || nodeDetail?.purpose || selectedStage.purpose || "-",
                        mode: selectedStage.mode,
                        retryable: nodeDetail?.definition?.retryable ?? nodeDetail?.retryable ?? "-",
                        summary: selectedStage.summary || "-"
                      }} />
                    </DetailBlock>
                    <DetailBlock title="Executor">
                      {nodeDetail?.definition?.executor || nodeDetail?.executor ? <KeyValues data={Object.fromEntries(Object.entries(nodeDetail.definition?.executor || nodeDetail.executor).filter(([, value]) => value))} /> : <Empty text="选择节点后加载" />}
                    </DetailBlock>
                    <DetailBlock title="Action Steps">
                      <StepList items={nodeActionSteps(selectedStage.id, nodeDetail?.actions || [])} status={selectedStatus} />
                    </DetailBlock>
                    <DetailBlock title="Input Contract">
                      <KeyValues data={nodeDetail?.declaredInputs || selectedStage.inputs} />
                    </DetailBlock>
                    <DetailBlock title="Output Contract">
                      <KeyValues data={nodeDetail?.declaredOutputs || selectedStage.outputs} />
                    </DetailBlock>
                    <DetailBlock title="Capabilities">
                      <KeyValues data={nodeDetail?.capabilities || {
                        github: { enabled: true },
                        telegram: { enabled: nodeDetail?.infra?.tgNotify !== false },
                        sse: { enabled: true },
                        log: { enabled: nodeDetail?.infra?.logRecord !== false }
                      }} />
                    </DetailBlock>
                    {nodeDetail?.plan && <DetailBlock title="Wiki Build Plan"><KeyValues data={nodeDetail.plan} /></DetailBlock>}
                    <DetailBlock title="Node Validation">
                      <div className="node-validation-entry">
                        <div>
                          <strong>Validate using this run</strong>
                          <span>跳转到 Node 页面，并使用当前 Run 的上游产物作为测试输入。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => onValidateNodeWithRun(selectedStage.id, selectedRun.pipelineId)}>
                          <Play size={14} />
                          Open Node Test
                        </button>
                      </div>
                    </DetailBlock>
                  </>
                )}

                {inspectorTab === "run" && (
                  <>
                    <DetailBlock title="Node Run">
                      <KeyValues data={{
                        workflow_run: selectedRun.pipelineId,
                        run_id: nodeDetail?.runId || "-",
                        started: formatBeijingTime(nodeDetail?.startedAt),
                        finished: formatBeijingTime(nodeDetail?.finishedAt),
                        instance: instance.instanceId,
                        repo: instance.repo,
                        status: selectedStatus,
                        attempt: selectedRun.nodeStates?.[selectedStage.id]?.attempt || "-",
                        duration: formatDuration(selectedRun.nodeStates?.[selectedStage.id]?.durationS || 0),
                      }} />
                    </DetailBlock>
                    {nodeDetail?.validation && (
                      <DetailBlock title="Output Validation">
                        <ValidationSummary validation={nodeDetail.validation} />
                      </DetailBlock>
                    )}
                    <DetailBlock title="Business Inputs">
                      <InfoList items={nodeDetail?.inputModel?.business || []} emptyText="没有业务输入定义" />
                    </DetailBlock>
                    <DetailBlock title="Environment Config">
                      <InfoList items={nodeDetail?.inputModel?.environment || []} emptyText="没有环境配置输入" />
                    </DetailBlock>
                    <DetailBlock title="Secrets">
                      <InfoList items={nodeDetail?.inputModel?.secrets || []} emptyText="没有 secret 输入" />
                    </DetailBlock>
                    <DetailBlock title="Resolved Inputs">
                      <KeyValues data={nodeDetail?.inputModel?.resolved || nodeDetail?.resolvedInputs || {}} />
                    </DetailBlock>
                    <DetailBlock title="Recorded Outputs">
                      <KeyValues data={nodeDetail?.outputModel?.actual || nodeDetail?.actualOutputs || {}} />
                    </DetailBlock>
                    <DetailBlock title="Git / TG">
                      <div className="event-list">
                        {[...gitEvents, ...tgEvents].slice(-8).reverse().map((event, index) => <EventRow key={event.sequence || index} event={event} />)}
                        {!gitEvents.length && !tgEvents.length && <Empty text="当前 Run 暂无 Git / TG 事件" />}
                      </div>
                    </DetailBlock>
                    {nodeDetail?.error && (
                      <DetailBlock title="Error">
                        <pre className="log-box error-log">{nodeDetail.error}</pre>
                      </DetailBlock>
                    )}
                    {(nodeDetail?.reportReason || (nodeDetail?.reportDetail && Object.keys(nodeDetail.reportDetail).length > 0)) && (
                      <DetailBlock title="Node Report">
                        {nodeDetail.reportReason && <pre className="log-box error-log">{nodeDetail.reportReason}</pre>}
                        {nodeDetail.reportDetail && Object.keys(nodeDetail.reportDetail).length > 0 && <KeyValues data={nodeDetail.reportDetail} />}
                      </DetailBlock>
                    )}
                    {nodeDetail?.manualFixHint && (
                      <DetailBlock title="Manual Fix Hint">
                        <pre className="log-box">{nodeDetail.manualFixHint}</pre>
                      </DetailBlock>
                    )}
                    {nodeDetail?.reportManualFixHint && nodeDetail.reportManualFixHint !== nodeDetail.manualFixHint && (
                      <DetailBlock title="Report Fix Hint">
                        <pre className="log-box">{nodeDetail.reportManualFixHint}</pre>
                      </DetailBlock>
                    )}
                    <DetailBlock title="Operations">
                      <div className="action-row">
                        {selectedRun.status === "running" && <button type="button" className="cancel-button" disabled={cancelRunPending} onClick={onCancelRun}>Cancel Run</button>}
                        {(selectedStatus === "failed" || selectedStatus === "cancelled" || selectedStatus === "done") && (
                          <button type="button" className="retry-button" disabled={retryPending} onClick={onRetryNode}>Retry Node</button>
                        )}
                        {selectedStatus === "running" && <button type="button" className="cancel-button" disabled={cancelNodePending} onClick={onCancelNode}>Cancel Node</button>}
                      </div>
                    </DetailBlock>
                  </>
                )}

                {inspectorTab === "artifacts" && (
                  <>
                    <DetailBlock title="Output Meaning">
                      <KeyValues data={nodeDetail?.outputModel?.artifactExplanations || {}} />
                    </DetailBlock>
                    <DetailBlock title="Key Results">
                      <InfoList items={nodeDetail?.outputModel?.keyResults || []} emptyText="该节点暂未提取关键结果" />
                    </DetailBlock>
                    <DetailBlock title={`Recorded Artifacts · ${nodeDetail?.artifacts?.length || 0}`}>
                      <ArtifactList artifacts={nodeDetail?.artifacts || []} />
                    </DetailBlock>
                    <DetailBlock title={`Unverified Candidates · ${nodeDetail?.discoveredCandidates?.length || 0}`}>
                      <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Workflow Run，不会作为下游节点输入。</p>
                      <ArtifactList artifacts={nodeDetail?.discoveredCandidates || []} />
                    </DetailBlock>
                    {!nodeDetail?.artifacts?.length && runArtifacts.length > 0 && (
                      <DetailBlock title={`Run Artifacts · ${runArtifacts.length}`}>
                        <ArtifactList artifacts={runArtifacts} />
                      </DetailBlock>
                    )}
                  </>
                )}

                {inspectorTab === "logs" && (
                  <>
                    <DetailBlock title="Troubleshooting">
                      <TroubleshootingBlock nodeDetail={nodeDetail} />
                    </DetailBlock>
                    {(nodeLog?.events ?? []).length > 0 && (
                      <DetailBlock title="Events">
                        <div className="event-list">
                          {(nodeLog?.events ?? []).map((event, index) => <EventRow key={event.sequence || index} event={event} />)}
                        </div>
                      </DetailBlock>
                    )}
                    <DetailBlock title={
                      <button type="button" className="log-toggle" onClick={() => setRawLogOpen((value) => !value)}>
                        Raw Log {rawLogOpen ? "▲" : "▼"}
                      </button>
                    }>
                      {rawLogOpen && <pre className="log-box">{nodeLog?.log || "没有日志"}</pre>}
                      {!rawLogOpen && <div className="empty-state" style={{ fontSize: 12 }}>点击 Raw Log 展开</div>}
                    </DetailBlock>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function RunsPage({
  runs,
  selectedRun,
  selectedStage,
  selectedStatus,
  dag,
  nodeDetail,
  nodeLog,
  runEvents,
  runArtifacts,
  streamStatus,
  onSelectRun,
  onSelectNode,
  onOpenWorkflow,
  onCancelRun,
  onRetryNode,
  onCancelNode,
  cancelRunPending,
  retryPending,
  cancelNodePending,
}: {
  runs: Run[];
  selectedRun: Run | undefined;
  selectedStage: DagNode | undefined;
  selectedStatus: StageStatus;
  dag: Dag | undefined;
  nodeDetail: NodeDetail | undefined;
  nodeLog: NodeLog | undefined;
  runEvents: NodeEvent[];
  runArtifacts: Artifact[];
  streamStatus: "live" | "reconnecting" | "polling fallback" | "closed";
  onSelectRun: (pipelineId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onOpenWorkflow: (nodeId: string) => void;
  onCancelRun: () => void;
  onRetryNode: () => void;
  onCancelNode: () => void;
  cancelRunPending: boolean;
  retryPending: boolean;
  cancelNodePending: boolean;
}) {
  const progress = runProgressFromNodes(selectedRun, dag);
  const gitEvents = runEvents.filter((event) => event.event.startsWith("git."));
  const tgEvents = runEvents.filter((event) => event.event.startsWith("telegram."));
  return (
    <>
      <section className="concept-hero">
        <div>
          <span className="status-pill running"><ListChecks size={14} />Concept C · Run Observatory</span>
          <h1>围绕单个 Run 做全链路观察</h1>
          <p>适合排查一次任务：左边看 timeline，右边看节点产物、日志、Git 和 TG 结果。</p>
        </div>
        <div className="context-card">
          <strong>{selectedRun?.pipelineId || "No selected run"}</strong>
          <span>{selectedRun?.status || "waiting"} · SSE {streamStatus}</span>
          <code>{selectedRun?.repo || "-"}</code>
        </div>
      </section>
      <section className="console-metrics">
        <Metric label="Pipeline" value={`${progress.percent}%`} subtext={`${progress.done}/${progress.total} stages done`} />
        <Metric label="Git commits" value={selectedRun?.gitEventCount ?? gitEvents.length} subtext="run scoped" />
        <Metric label="TG events" value={selectedRun?.telegramEventCount ?? tgEvents.length} subtext="sent / skipped / failed" />
        <Metric label="Pages" value={selectedRun?.pageCount || "-"} subtext="30-40 target" />
        <Metric label="Duration" value={formatDuration(selectedRun?.durationS || 0)} subtext="whole run" />
        <Metric label="Artifacts" value={selectedRun?.artifactCount ?? runArtifacts.length} subtext="recorded outputs" />
      </section>
      <section className="run-observatory">
        <aside className="runs-table-panel">
          <div className="panel-head compact"><div><strong>Runs</strong><span>选择一个 pipeline</span></div></div>
          <RunTable runs={runs} selectedRunId={selectedRun?.pipelineId || ""} onSelect={onSelectRun} />
        </aside>
        <section className="timeline-panel run-timeline-panel">
          <div className="panel-head"><div><strong>Run timeline</strong><span>节点级耗时、事件和产物</span></div><span className="status-pill running">SSE {streamStatus}</span></div>
          <div className="run-stage-list">
            {(dag?.nodes || []).map((stage) => {
              const state = selectedRun?.nodes[stage.id] || "waiting";
              const stateDetail = selectedRun?.nodeStates?.[stage.id];
              return (
                <button key={stage.id} type="button" className={`run-stage-row ${state} ${selectedStage?.id === stage.id ? "active" : ""}`} onClick={() => onSelectNode(stage.id)}>
                  <span className={`dot ${state}`} />
                  <span><strong>{stage.title}</strong><small>{stage.ui?.stageLetter || stage.mode} · {String(stage.executor?.type || "executor")} · {formatDuration(stateDetail?.durationS || 0)} · {stateDetail?.artifactCount || 0} artifacts</small>{stateDetail?.error && <small className="error-text">{stateDetail.error}</small>}</span>
                  <span><span className={`status-pill ${state}`}>{statusLabel(state)}</span><small>{stateDetail?.attempt ? `attempt ${stateDetail.attempt}` : "not started"}</small></span>
                </button>
              );
            })}
            {!dag?.nodes.length && <Empty text="没有 DAG 数据" />}
          </div>
          <DetailBlock title="Artifacts">
            <ArtifactList artifacts={runArtifacts} />
          </DetailBlock>
        </section>
        <aside className="run-command-panel">
          <div className="panel-head compact"><div><strong>Run command center</strong><span>{selectedRun?.pipelineId || "-"}</span></div><span className={`status-pill ${selectedRun?.status || "waiting"}`}>{statusLabel(selectedRun?.status || "waiting")}</span></div>
          <DetailBlock title="Current node">
            <KeyValues data={{
              node: selectedStage?.id || "-",
              executor: nodeDetail?.executor?.type || nodeDetail?.mode || "-",
              page_target: nodeDetail?.plan ? formatValue(nodeDetail.plan) : "30-40 pages",
            }} />
          </DetailBlock>
          <DetailBlock title="Operations">
            <div className="action-row">
              <button type="button" disabled>Pause</button>
              <button type="button" className="cancel-button" disabled={!selectedRun || cancelRunPending} onClick={onCancelRun}>Cancel Run</button>
              <button type="button" className="retry-button" disabled={!selectedRun || retryPending} onClick={onRetryNode}>Retry Node</button>
              <button type="button" disabled={selectedStatus !== "running" || cancelNodePending} onClick={onCancelNode}>Cancel Node</button>
            </div>
          </DetailBlock>
          <DetailBlock title="Navigate">
            <button type="button" className="wide" disabled={!selectedStage} onClick={() => selectedStage && onOpenWorkflow(selectedStage.id)}>Open in Workflow</button>
          </DetailBlock>
          <DetailBlock title="Git / TG">
            <div className="event-list">
              {runEvents.filter((event) => event.event.startsWith("git.") || event.event.startsWith("telegram.")).slice(-8).reverse().map((event, index) => <EventRow key={event.sequence || index} event={event} />)}
              {!gitEvents.length && !tgEvents.length && <Empty text="当前 Run 暂无 Git / TG 事件" />}
            </div>
          </DetailBlock>
          <DetailBlock title="Node output">
            <KeyValues data={nodeDetail?.actualOutputs || {}} />
          </DetailBlock>
          <DetailBlock title="Latest log">
            <pre className="log-box compact-log">{nodeLog?.log || "该节点暂无日志"}</pre>
          </DetailBlock>
        </aside>
      </section>
    </>
  );
}

function RunTable({ runs, selectedRunId, onSelect }: { runs: Run[]; selectedRunId: string; onSelect: (pipelineId: string) => void }) {
  if (!runs.length) return <Empty text="当前 Workspace 还没有 Run" />;
  return (
    <div className="run-table">
      <div className="run-table-head"><span>Run</span><span>Status</span><span>Updated</span><span>Progress</span><span>Action</span></div>
      {runs.map((run) => (
        <button key={run.pipelineId} type="button" className={`run-table-row ${selectedRunId === run.pipelineId ? "active" : ""}`} onClick={() => onSelect(run.pipelineId)}>
          <strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong>
          <span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span>
          <span>{formatBeijingTime(run.updatedAt || run.startedAt)}</span>
          <span>{runProgressFromNodes(run).percent}%</span>
          <span>{run.status === "failed" ? "Retry" : "Open"}</span>
        </button>
      ))}
    </div>
  );
}

function ArtifactsPage({
  selectedRun,
  selectedStage,
  recorded,
  candidates,
  selectedArtifactId,
  onSelectArtifact,
  onOpenProducer,
}: {
  selectedRun: Run | undefined;
  selectedStage: DagNode | undefined;
  recorded: Artifact[];
  candidates: Artifact[];
  selectedArtifactId: string;
  onSelectArtifact: (artifactId: string) => void;
  onOpenProducer: (nodeId: string) => void;
}) {
  const selectedArtifact = [...recorded, ...candidates].find((artifact) => artifact.id === selectedArtifactId) || recorded[0] || candidates[0];
  return (
    <>
      <section className="concept-hero">
        <div>
          <span className="status-pill running"><PackageSearch size={14} />Run-scoped Artifacts</span>
          <h1>只展示当前 Run 的实际产物</h1>
          <p>Recorded artifacts 用作下游输入；Unverified candidates 来自共享路径扫描，必须单独隔离。</p>
        </div>
        <div className="context-card">
          <strong>{selectedRun?.pipelineId || "No selected run"}</strong>
          <span>{selectedArtifact?.producer || selectedStage?.title || "Selected node"} · {recorded.length} recorded</span>
          <code>{selectedRun?.repo || "-"}</code>
        </div>
      </section>
      <section className="console-metrics">
        <Metric label="Recorded" value={recorded.length} subtext="current run only" />
        <Metric label="Unverified" value={candidates.length} subtext="not downstream input" />
        <Metric label="Producer" value={selectedArtifact?.producer || selectedStage?.id || "-"} subtext="selected artifact" />
        <Metric label="Resolution" value={selectedArtifact?.resolution || "-"} subtext="artifact ownership" />
      </section>
      <section className="artifacts-layout">
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Recorded Artifacts</strong><span>作为当前 Run 的实际产物展示</span></div></div>
          <div className="panel-body artifact-browser-list">
            {recorded.map((artifact) => (
              <button key={artifact.id} type="button" className={selectedArtifact?.id === artifact.id ? "active" : ""} onClick={() => onSelectArtifact(artifact.id)}>
                <PackageSearch size={16} /><span><strong>{artifact.title}</strong><small>{artifact.producer} · {artifact.format} · {formatBytes(artifact.size)}</small></span><span className="status-pill done">recorded</span>
              </button>
            ))}
            {!recorded.length && <Empty text="当前 Run 没有确认产物" />}
          </div>
        </div>
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Unverified Candidates</strong><span>不会作为下游输入</span></div></div>
          <div className="panel-body">
            <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Run。页面需要显示，但下游节点不能依赖它们。</p>
            <div className="artifact-browser-list">
              {candidates.map((artifact) => (
                <button key={artifact.id} type="button" className={selectedArtifact?.id === artifact.id ? "active" : ""} onClick={() => onSelectArtifact(artifact.id)}>
                  <AlertTriangle size={16} /><span><strong>{artifact.title}</strong><small>{artifact.path}</small></span><span className="status-pill waiting">unverified</span>
                </button>
              ))}
              {!candidates.length && <Empty text="没有未确认候选文件" />}
            </div>
          </div>
        </div>
        <aside className="artifact-preview-panel">
          <div className="panel-head"><div><strong>Artifact Preview</strong><span>{selectedArtifact?.path || "选择一个产物"}</span></div></div>
          {selectedArtifact ? (
            <div className="artifact-preview-body">
              <div className="artifact-preview-meta">
                <span className={`status-pill ${selectedArtifact.ownership === "unconfirmed" ? "waiting" : "done"}`}>{selectedArtifact.ownership === "unconfirmed" ? "unverified" : "recorded"}</span>
                <button type="button" onClick={() => onOpenProducer(selectedArtifact.producer)}>Open producer</button>
              </div>
              <KeyValues data={{ producer: selectedArtifact.producer, output: selectedArtifact.output, type: selectedArtifact.type, format: selectedArtifact.format, size: formatBytes(selectedArtifact.size), resolution: selectedArtifact.resolution }} />
              <pre className="artifact-preview-content">{selectedArtifact.preview || "当前产物没有文本预览。"}</pre>
            </div>
          ) : <Empty text="选择一个产物查看预览" />}
        </aside>
      </section>
    </>
  );
}

function SettingsPage({
  mode,
  managementConfig,
  managementConfigLoading,
  managementConfigError,
  settingRegistry,
  settingRegistryLoading,
  settingRegistryError,
  machines,
  machinesError,
  onOpenMachines,
  managementConfigValues,
  setManagementConfigValues,
  saveManagementConfigPending,
  saveManagementConfigError,
  onRefreshManagementConfig,
  onSaveManagementConfig,
  globalTunnelApiUrl,
  globalTunnelAdminUrl,
}: {
  mode: DataMode;
  managementConfig: RuntimeManagementConfigPreview | undefined;
  managementConfigLoading: boolean;
  managementConfigError: string;
  settingRegistry?: CapabilityConfigPreview;
  settingRegistryLoading: boolean;
  settingRegistryError: string;
  machines: MachineConfig[];
  machinesError: string;
  onOpenMachines: () => void;
  managementConfigValues: Record<string, string>;
  setManagementConfigValues: (value: Record<string, string>) => void;
  saveManagementConfigPending: boolean;
  saveManagementConfigError: string;
  onRefreshManagementConfig: () => void;
  onSaveManagementConfig: (event: FormEvent) => void;
  globalTunnelApiUrl: string;
  globalTunnelAdminUrl: string;
}) {
  const [selectedSettingsSection, setSelectedSettingsSection] = useState("cloudflare");
  const itemByKey = useMemo(() => {
    const items = new Map<string, RuntimeInheritancePreview["items"][number]>();
    (managementConfig?.items || []).forEach((item) => {
      items.set(item.key, item);
      (item.aliases || []).forEach((alias) => items.set(alias, item));
    });
    return items;
  }, [managementConfig]);
  const updateConfigValue = (key: string, value: string) => {
    setManagementConfigValues({ ...managementConfigValues, [key]: value });
  };
  const editedCount = Object.values(managementConfigValues).filter((value) => value.trim()).length;
  const configCards = SETTING_CONFIG_GROUPS.map((group) => ({
    ...group,
    icon: settingGroupIcon(group.id),
    keys: group.keys.map((field) => ({
      ...field,
      placeholder: field.key === "TUNNEL_API"
        ? globalTunnelApiUrl
        : field.key === "SOP_UI_URL"
          ? window.location.origin
          : field.placeholder,
    })),
  }));
  const renderedConfigKeys = new Set<string>();
  configCards.forEach((card) => {
    card.keys.forEach((field) => {
      renderedConfigKeys.add(field.key);
      const item = itemByKey.get(field.key);
      (item?.aliases || []).forEach((alias) => renderedConfigKeys.add(alias.toUpperCase()));
    });
  });
  ["CF_EMAIL", "CF_API_KEY"].forEach((key) => renderedConfigKeys.add(key));
  const extraConfigFields = (managementConfig?.items || [])
    .filter((item) => item.key && !renderedConfigKeys.has(item.key))
    .map((item) => ({
      key: item.key,
      label: item.key.replace(/_/g, " "),
      placeholder: item.present ? "已配置；填写则覆盖" : "填写全局配置值",
    }));
  const settingsSections = [
    ...configCards.map((card) => ({
      id: card.id,
      title: card.title,
      subtitle: card.subtitle,
      count: card.keys.filter((field) => itemByKey.get(field.key)?.present).length,
      total: card.keys.length,
    })),
    ...(extraConfigFields.length ? [{
      id: "other",
      title: "Other Settings",
      subtitle: "未归入固定分组的配置项",
      count: extraConfigFields.filter((field) => itemByKey.get(field.key)?.present).length,
      total: extraConfigFields.length,
    }] : []),
    { id: "machines", title: "Machine Nodes", subtitle: "SSH 节点入口", count: machines.length, total: machines.length },
  ];
  const activeConfigCard = configCards.find((card) => card.id === selectedSettingsSection);
  const renderConfigField = (field: { key: string; label: string; placeholder: string }) => {
    const item = itemByKey.get(field.key);
    const edited = Boolean(managementConfigValues[field.key]?.trim());
    const present = Boolean(item?.present);
    const currentValue = item?.present
      ? item?.maskedValue || "已配置"
      : "未配置";
    const currentHint = item?.present
      ? `${item?.source || "management_config"} · ${item?.secret ? "secret" : "plain"}`
      : field.placeholder;
    return (
      <label key={field.key} className={`global-config-field ${present ? "present" : "absent"} ${edited ? "edited" : ""}`}>
        <span>
          <strong>{field.label}</strong>
          <code>{field.key}</code>
        </span>
        <div className="global-config-field-current">
          <strong>{item?.present ? "当前值" : "当前状态"}</strong>
          <code title={item?.maskedValue || field.placeholder}>{currentValue}</code>
        </div>
        <small>{currentHint}</small>
        <input
          type={item?.secret || /TOKEN|KEY|SECRET|PRIVATE/.test(field.key) ? "password" : "text"}
          value={managementConfigValues[field.key] || ""}
          onChange={(event) => updateConfigValue(field.key, event.target.value)}
          placeholder={field.placeholder}
          autoComplete="off"
        />
        <small>{edited ? "将保存覆盖值" : present ? "留空则保留当前值" : "输入后保存为全局配置"}</small>
      </label>
    );
  };
  return (
    <>
      <section className="ops-page-header settings-compact-header">
        <div className="ops-page-title">
          <span className="status-pill waiting"><Settings size={14} />Settings 默认值</span>
          <div>
            <h1>Control Plane Settings</h1>
            <p>{managementConfig?.updatedAt ? `updated ${formatBeijingTime(managementConfig.updatedAt)}` : "server-side config"} · {editedCount} edited · {settingRegistry?.registryTotal || settingRegistry?.items.length || 0} registry keys</p>
          </div>
        </div>
        <div className="ops-header-chips">
          <span>{mode} · settings</span>
          <span>{managementConfig?.backend || "d1"}</span>
          <span>{machines.length} machines</span>
          <button type="button" className="ghost-btn compact" onClick={onRefreshManagementConfig} disabled={managementConfigLoading}>
            {managementConfigLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </section>
      <section className="global-settings-toolbar">
        <div>
          <strong>{settingsSections.find((section) => section.id === selectedSettingsSection)?.title || "Settings"}</strong>
          <span>{settingsSections.find((section) => section.id === selectedSettingsSection)?.subtitle || controlPlaneApiUrl}</span>
        </div>
        <div className="settings-actions">
          <button type="submit" form="global-settings-form" disabled={saveManagementConfigPending || !editedCount}>
            {saveManagementConfigPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
            Save {editedCount ? `(${editedCount})` : ""}
          </button>
        </div>
      </section>
      {(managementConfigError || saveManagementConfigError || machinesError || settingRegistryError) && (
        <div className="inline-error">{managementConfigError || saveManagementConfigError || machinesError || settingRegistryError}</div>
      )}
      <form id="global-settings-form" className="global-settings-layout settings-section-layout" onSubmit={onSaveManagementConfig}>
        <aside className="global-settings-summary settings-section-nav">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={selectedSettingsSection === section.id ? "active" : ""}
              onClick={() => setSelectedSettingsSection(section.id)}
            >
              <strong>{section.title}</strong>
              <span>{section.subtitle}</span>
              <em>{section.count}/{section.total}</em>
            </button>
          ))}
          <button type="button" className="ghost-btn compact" onClick={() => window.open(globalTunnelAdminUrl, "_blank", "noopener,noreferrer")}>Tunnel Admin</button>
          {editedCount > 0 && <button type="button" className="ghost-btn compact" onClick={() => setManagementConfigValues({})}>Clear edits</button>}
        </aside>
        <section className="global-config-card-grid settings-active-card-grid">
          {activeConfigCard && (
            <article className="global-config-card settings-wide">
              <div className="global-config-card-head">
                <span>{activeConfigCard.icon}</span>
                <div>
                  <strong>{activeConfigCard.title}</strong>
                  <small>{activeConfigCard.subtitle}</small>
                </div>
                <em>{activeConfigCard.keys.filter((field) => itemByKey.get(field.key)?.present).length}/{activeConfigCard.keys.length}</em>
              </div>
              <div className="settings-scope-note">
                {activeConfigCard.id === "telegram-defaults" ? "作为 create-instance 默认通知配置；每个 Instance 可以覆盖。" : "保存到 Settings 默认值；Runtime 和 Instance 可以分别覆盖。"}
              </div>
              <div className="settings-group-tags">
                {settingWorkflowTags(activeConfigCard.id).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              {settingRegistryLoading ? <Skeleton /> : null}
              <div className="global-config-fields">
                {activeConfigCard.keys.map(renderConfigField)}
              </div>
            </article>
          )}
          {selectedSettingsSection === "other" && extraConfigFields.length > 0 && (
            <article className="global-config-card settings-wide">
              <div className="global-config-card-head">
                <span><SlidersHorizontal size={18} /></span>
                <div>
                  <strong>Other Global Settings</strong>
                  <small>D1 返回但未归入固定卡片的配置项，仍可直接查看和覆盖</small>
                </div>
                <em>{extraConfigFields.filter((field) => itemByKey.get(field.key)?.present).length}/{extraConfigFields.length}</em>
              </div>
              <div className="global-config-fields">
                {extraConfigFields.map(renderConfigField)}
              </div>
            </article>
          )}
          {selectedSettingsSection === "machines" && (
            <article className="global-config-card settings-wide">
              <div className="global-config-card-head">
                <span><Server size={18} /></span>
                <div>
                  <strong>Machine Nodes</strong>
                  <small>SSH 节点配置来自 Control Plane D1，Runtime 创建/删除时可以选择节点</small>
                </div>
                <em>{machines.length}</em>
              </div>
              <div className="machine-settings-link">
                <KeyValues data={{ machines: machines.length, store: "runtime-settings-db", api: controlPlaneApiUrl }} />
                <button type="button" className="primary" onClick={onOpenMachines}>
                  <Server size={14} />
                  Open Machine Manager
                </button>
              </div>
            </article>
          )}
        </section>
      </form>
      <section className="settings-note-panel">
        <Info size={15} />
        <span>Secret 字段不会从后端返回明文；输入框留空会保留当前值，填写内容才会覆盖保存。</span>
      </section>
    </>
  );
}

function MachinesPage({
  machines,
  machineList,
  loading,
  error,
  machineSearch,
  setMachineSearch,
  machineStatusFilter,
  setMachineStatusFilter,
  machineRoleFilter,
  setMachineRoleFilter,
  machineAuthFilter,
  setMachineAuthFilter,
  machinePage,
  setMachinePage,
  selectedMachineId,
  setSelectedMachineId,
  machineName,
  setMachineName,
  machineSshCommand,
  setMachineSshCommand,
  machineAuthType,
  setMachineAuthType,
  machinePrivateKey,
  setMachinePrivateKey,
  machinePassword,
  setMachinePassword,
  machineRole,
  setMachineRole,
  machineStatus,
  setMachineStatus,
  duplicateReuseSecret,
  setDuplicateReuseSecret,
  saveMachinePending,
  saveMachineError,
  onSaveMachine,
  testPending,
  testResult,
  testError,
  onTestMachine,
  deletePending,
  onDeleteMachine,
  duplicatePending,
  onDuplicateMachine,
  onToast,
}: {
  machines: MachineConfig[];
  machineList?: MachineList;
  loading: boolean;
  error: string;
  machineSearch: string;
  setMachineSearch: (value: string) => void;
  machineStatusFilter: string;
  setMachineStatusFilter: (value: string) => void;
  machineRoleFilter: string;
  setMachineRoleFilter: (value: string) => void;
  machineAuthFilter: string;
  setMachineAuthFilter: (value: string) => void;
  machinePage: number;
  setMachinePage: (value: number) => void;
  selectedMachineId: string;
  setSelectedMachineId: (value: string) => void;
  machineName: string;
  setMachineName: (value: string) => void;
  machineSshCommand: string;
  setMachineSshCommand: (value: string) => void;
  machineAuthType: "private_key" | "password";
  setMachineAuthType: (value: "private_key" | "password") => void;
  machinePrivateKey: string;
  setMachinePrivateKey: (value: string) => void;
  machinePassword: string;
  setMachinePassword: (value: string) => void;
  machineRole: string;
  setMachineRole: (value: string) => void;
  machineStatus: string;
  setMachineStatus: (value: string) => void;
  duplicateReuseSecret: boolean;
  setDuplicateReuseSecret: (value: boolean) => void;
  saveMachinePending: boolean;
  saveMachineError: string;
  onSaveMachine: (event: FormEvent) => void;
  testPending: boolean;
  testResult: Record<string, unknown> | null;
  testError: string;
  onTestMachine: (id: string) => void;
  deletePending: boolean;
  onDeleteMachine: (id: string) => void;
  duplicatePending: boolean;
  onDuplicateMachine: (id: string, reuseSecret: boolean) => void;
  onToast: (message: string) => void;
}) {
  const [creatingMachine, setCreatingMachine] = useState(false);
  const [editingMachine, setEditingMachine] = useState(false);
  const selectedMachine = selectedMachineId ? machines.find((machine) => machine.id === selectedMachineId) : undefined;
  const machineTotal = machineList?.total ?? machines.length;
  const hasNextPage = Boolean(machineList?.hasMore);
  const loadMachine = (machine: MachineConfig) => {
    setCreatingMachine(false);
    setEditingMachine(false);
    setSelectedMachineId(machine.id);
    setMachineName(machine.name);
    setMachineSshCommand(machine.sshCommand);
    setMachineAuthType(machine.authType === "password" ? "password" : "private_key");
    setMachineRole(machine.role || "target");
    setMachineStatus(machine.status || "active");
    setMachinePrivateKey("");
    setMachinePassword("");
  };
  const clearForm = () => {
    setCreatingMachine(true);
    setEditingMachine(true);
    setSelectedMachineId("");
    setMachineName("");
    setMachineSshCommand("");
    setMachineAuthType("private_key");
    setMachineRole("target");
    setMachineStatus("active");
    setMachinePrivateKey("");
    setMachinePassword("");
  };
  useEffect(() => {
    if (!creatingMachine && !selectedMachineId && machines.length) {
      loadMachine(machines[0]);
    }
  }, [creatingMachine, machines, selectedMachineId]);
  const copySsh = async (machine: MachineConfig) => {
    try {
      await navigator.clipboard.writeText(machine.sshCommand || `ssh ${machine.user}@${machine.host}`);
      onToast("SSH Command 已复制");
    } catch {
      onToast("复制失败，请手动复制 SSH Command");
    }
  };
  const duplicateMachine = (machine: MachineConfig) => {
    if (duplicateReuseSecret) {
      onDuplicateMachine(machine.id, true);
      return;
    }
    setSelectedMachineId("");
    setMachineName(`${machine.name || machine.host} copy`);
    setMachineSshCommand(machine.sshCommand);
    setMachineAuthType(machine.authType === "password" ? "password" : "private_key");
    setMachineRole(machine.role || "target");
    setMachineStatus("active");
    setMachinePrivateKey("");
    setMachinePassword("");
    onToast("已复制非敏感字段，请补充 secret 后保存为新机器");
    setCreatingMachine(true);
    setEditingMachine(true);
  };
  return (
    <>
      <section className="ops-page-header machines-compact-header">
        <div className="ops-page-title">
          <span className="status-pill waiting"><Server size={14} />Machines</span>
          <div>
            <h1>Machine Nodes</h1>
            <p>SSH targets for runtime lifecycle workflows · secrets stay in Control Plane D1</p>
          </div>
        </div>
        <div className="ops-header-chips">
          <span>{machineTotal} machines</span>
          <span>{machines.filter((machine) => machine.status === "active").length} active</span>
          <span>{machines.filter((machine) => machine.privateKeyPresent || machine.passwordPresent).length} secrets</span>
          <button type="button" className="primary compact" onClick={clearForm}><Plus size={14} />New Machine</button>
        </div>
      </section>
      {(error || saveMachineError || testError) && <div className="inline-error">{error || saveMachineError || testError}</div>}
      <section className="machines-workspace">
        <aside className="machines-list-panel">
          <div className="panel-head machines-list-head">
            <div><strong>Machine List</strong><span>{loading ? "loading" : `${machines.length}/${machineTotal} records`}</span></div>
            <span className="machine-filter-note">{machineStatusFilter === "deleted" ? "showing deleted" : "deleted hidden"}</span>
          </div>
          <div className="execution-tools machine-tools">
            <label className="search-box">
              <Search size={14} />
              <input
                value={machineSearch}
                onChange={(event) => {
                  setMachinePage(1);
                  setMachineSearch(event.target.value);
                }}
                placeholder="Search machine"
              />
            </label>
            <label className="filter-box">
              <SlidersHorizontal size={14} />
              <select
                value={machineStatusFilter}
                onChange={(event) => {
                  setMachinePage(1);
                  setMachineStatusFilter(event.target.value);
                }}
              >
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="offline">Offline</option>
                <option value="disabled">Disabled</option>
                <option value="deleted">Deleted</option>
              </select>
            </label>
            <label className="filter-box">
              <SlidersHorizontal size={14} />
              <select
                value={machineRoleFilter}
                onChange={(event) => {
                  setMachinePage(1);
                  setMachineRoleFilter(event.target.value);
                }}
              >
                <option value="all">All roles</option>
                <option value="target">Target</option>
                <option value="executor">Executor</option>
                <option value="dev-machine">Dev Machine</option>
              </select>
            </label>
            <label className="filter-box">
              <ShieldCheck size={14} />
              <select
                value={machineAuthFilter}
                onChange={(event) => {
                  setMachinePage(1);
                  setMachineAuthFilter(event.target.value);
                }}
              >
                <option value="all">All auth</option>
                <option value="private_key">Private Key</option>
                <option value="password">Password</option>
              </select>
            </label>
          </div>
          <div className="machine-list">
            {machines.map((machine) => {
              const isSelected = selectedMachine?.id === machine.id;
              const secretSaved = machine.privateKeyPresent || machine.passwordPresent;
              return (
              <div key={machine.id} className={`machine-row machine-row-button ${selectedMachine?.id === machine.id ? "active" : ""}`}>
                <button type="button" className="machine-row-main" aria-pressed={isSelected} onClick={() => loadMachine(machine)}>
                  <span className="machine-avatar"><Server size={15} /></span>
                  <div className="machine-row-copy">
                    <span className="machine-row-title">
                      <strong>{machine.name}</strong>
                      <em className={`machine-state ${machine.status || "active"}`}>{machine.status || "active"}</em>
                    </span>
                    <code>{machine.user}@{machine.host}:{machine.port}</code>
                    <span className="machine-row-meta">
                      <span>{machine.role || "target"}</span>
                      <span>{machine.authType === "password" ? "password" : "private key"}</span>
                      <span>{secretSaved ? "secret saved" : "secret missing"}</span>
                      <span>{machine.lastCheckAt ? `checked ${formatBeijingTime(machine.lastCheckAt)}` : "not checked"}</span>
                    </span>
                  </div>
                </button>
                <div className="machine-row-actions" aria-label={`${machine.name} actions`}>
                  <button type="button" title="Test SSH" onClick={() => onTestMachine(machine.id)} disabled={testPending}>
                    <Activity size={14} />
                  </button>
                  <button type="button" title="Copy SSH" onClick={() => copySsh(machine)}>
                    <Copy size={14} />
                  </button>
                  <button type="button" title="Duplicate Machine" onClick={() => duplicateMachine(machine)} disabled={duplicatePending}>
                    {duplicatePending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                  </button>
                <button type="button" title="Edit" onClick={() => loadMachine(machine)}>
                    <Edit3 size={14} />
                  </button>
                  <button type="button" title="Delete" className="danger-icon" onClick={() => onDeleteMachine(machine.id)} disabled={deletePending}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              );
            })}
            {!machines.length && <LoadingOrEmpty loading={loading} text="还没有机器节点配置" />}
          </div>
          <div className="list-pagination">
            <button type="button" className="ghost-btn compact" disabled={machinePage <= 1 || loading} onClick={() => setMachinePage(Math.max(1, machinePage - 1))}>
              Previous
            </button>
            <span>Page {machinePage}</span>
            <button type="button" className="ghost-btn compact" disabled={!hasNextPage || loading} onClick={() => setMachinePage(machinePage + 1)}>
              Next
            </button>
          </div>
        </aside>
        <section className="machine-detail-panel">
          <div className="panel-head machine-detail-head">
            <div className="machine-detail-title">
              <strong>{creatingMachine ? "Create Machine" : selectedMachine ? selectedMachine.name : "Machine Detail"}</strong>
              <span>{creatingMachine ? "new machine" : selectedMachine?.id || "select a machine"}</span>
            </div>
            {selectedMachine && (
              <div className="machine-detail-actions">
                <button type="button" title="Test SSH" className="machine-action-btn primary-action" onClick={() => onTestMachine(selectedMachine.id)} disabled={testPending}>
                  {testPending ? <Loader2 size={14} className="spin" /> : <Activity size={14} />}
                  <span className="machine-action-label">Test</span>
                </button>
                <button type="button" title="Copy SSH" className="machine-action-btn" onClick={() => copySsh(selectedMachine)}>
                  <Copy size={14} /><span className="machine-action-label">Copy SSH</span>
                </button>
                <label className="machine-inline-toggle">
                  <input type="checkbox" checked={duplicateReuseSecret} onChange={(event) => setDuplicateReuseSecret(event.target.checked)} />
                  <span>Reuse secret</span>
                </label>
                <button type="button" title="Duplicate Machine" className="machine-action-btn" onClick={() => duplicateMachine(selectedMachine)} disabled={duplicatePending}>
                  {duplicatePending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                  <span className="machine-action-label">Duplicate</span>
                </button>
                <button type="button" title={editingMachine ? "View" : "Edit"} className="machine-action-btn" onClick={() => setEditingMachine((value) => !value)}>
                  <Edit3 size={14} /><span className="machine-action-label">{editingMachine ? "View" : "Edit"}</span>
                </button>
                <button type="button" title="Delete Machine" className="machine-action-btn danger" onClick={() => onDeleteMachine(selectedMachine.id)} disabled={deletePending}>
                  <Trash2 size={14} /><span className="machine-action-label">Delete</span>
                </button>
              </div>
            )}
          </div>
          {selectedMachine ? (
            <div className="machine-summary-strip">
              <div>
                <span>Host</span>
                <strong>{selectedMachine.host}:{selectedMachine.port}</strong>
              </div>
              <div>
                <span>User</span>
                <strong>{selectedMachine.user}</strong>
              </div>
              <div>
                <span>Auth</span>
                <strong>{selectedMachine.authType === "password" ? "Password" : "Private Key"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{selectedMachine.status || "active"}</strong>
              </div>
              <div>
                <span>Secret</span>
                <strong>{selectedMachine.privateKeyPresent || selectedMachine.passwordPresent ? "Saved" : "Missing"}</strong>
              </div>
            </div>
          ) : <Empty text="填写下面字段创建新机器" />}
          {testResult && <MachineTestResult result={testResult} />}
          {!creatingMachine && selectedMachine && !editingMachine && (
            <div className="machine-readonly-detail">
              <KeyValues data={{
                name: selectedMachine.name,
                ssh_command: selectedMachine.sshCommand,
                role: selectedMachine.role || "target",
                status: selectedMachine.status || "active",
                auth_type: selectedMachine.authType,
                private_key: selectedMachine.privateKeyPresent ? "saved" : "missing",
                password: selectedMachine.passwordPresent ? "saved" : "missing",
                last_check: formatBeijingTime(selectedMachine.lastCheckAt),
                updated_at: formatBeijingTime(selectedMachine.updatedAt),
              }} />
              <button type="button" className="primary compact" onClick={() => setEditingMachine(true)}><Edit3 size={14} />Edit Machine</button>
            </div>
          )}
          {(creatingMachine || editingMachine || !selectedMachine) && <form className="machine-editor" onSubmit={onSaveMachine}>
            <label>
              <span>Name</span>
              <input value={machineName} onChange={(event) => setMachineName(event.target.value)} placeholder="Runtime target machine" disabled={saveMachinePending} />
            </label>
            <label>
              <span>SSH Command</span>
              <input value={machineSshCommand} onChange={(event) => setMachineSshCommand(event.target.value)} placeholder="ssh -i ~/.ssh/id_ed25519 user@host" disabled={saveMachinePending} />
            </label>
            <label>
              <span>Auth Type</span>
              <select value={machineAuthType} onChange={(event) => setMachineAuthType(event.target.value as "private_key" | "password")} disabled={saveMachinePending}>
                <option value="private_key">Private Key</option>
                <option value="password">Password</option>
              </select>
            </label>
            <div className="machine-editor-grid">
              <label>
                <span>Role</span>
                <select value={machineRole} onChange={(event) => setMachineRole(event.target.value)} disabled={saveMachinePending}>
                  <option value="target">Target</option>
                  <option value="executor">Executor</option>
                  <option value="dev-machine">Dev Machine</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={machineStatus} onChange={(event) => setMachineStatus(event.target.value)} disabled={saveMachinePending}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                  <option value="offline">Offline</option>
                </select>
              </label>
            </div>
            {machineAuthType === "private_key" ? (
              <label>
                <span>Private Key</span>
                <textarea value={machinePrivateKey} onChange={(event) => setMachinePrivateKey(event.target.value)} rows={6} placeholder={selectedMachine?.privateKeyPresent ? "已配置；留空保存会保留原 secret，填写则替换" : "粘贴 OpenSSH private key；保存后不回显明文"} disabled={saveMachinePending} />
              </label>
            ) : (
              <label>
                <span>Password</span>
                <input type="password" value={machinePassword} onChange={(event) => setMachinePassword(event.target.value)} placeholder={selectedMachine?.passwordPresent ? "已配置；留空保存会保留原 secret，填写则替换" : "SSH password；保存后不回显明文"} disabled={saveMachinePending} />
              </label>
            )}
            <button type="submit" className="primary" disabled={saveMachinePending || !machineSshCommand.trim()}>
              {saveMachinePending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              {selectedMachineId ? "Save Changes" : "Create Machine"}
            </button>
          </form>}
        </section>
      </section>
    </>
  );
}

function MachineTestResult({ result }: { result: Record<string, unknown> }) {
  const job = (result.job && typeof result.job === "object" ? result.job : {}) as Record<string, unknown>;
  const status = String(result.status || job.status || result.check_status || "unknown");
  const isExecutorRequired = status === "not_implemented" || status === "executor_required";
  const isRunning = status === "queued" || status === "running";
  const isAccepted = status === "accepted" || status === "succeeded" || Boolean(result.ok);
  const tone = isExecutorRequired || isRunning ? "warning" : isAccepted ? "ok" : "failed";
  const title = isExecutorRequired ? "SSH 测试执行器未接入" : status === "succeeded" ? "SSH 测试通过" : isRunning ? "SSH 测试执行中" : isAccepted ? "测试请求已接收" : "SSH 测试未通过";
  const reason = status === "succeeded"
    ? "SSH Executor 已完成真实 SSH 连接测试，目标机器返回了预期探针输出。"
    : status === "failed"
    ? "SSH Executor 已执行测试，但目标机器连接或认证未通过。"
    : isRunning
    ? "测试任务已进入 Control Plane，正在等待 SSH Executor 领取或回写结果。"
    : isExecutorRequired
    ? "Control Plane 已收到测试请求，但 Cloudflare Worker 不能直接打开 SSH 连接，需要开发机或 Runtime agent 执行真实 SSH 检测。"
    : String(result.reason || "查看原始返回确认状态。");
  const stdout = String(job.stdout || "");
  const stderr = String(job.stderr || job.error || "");

  return (
    <section className={`machine-test-result ${tone}`}>
      <div className="machine-test-title">
        {tone === "ok" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <strong>{title}</strong>
        <span>{status}</span>
      </div>
      <p>{reason}</p>
      <KeyValues data={{
        machine_id: result.machine_id || job.machine_id || "-",
        control_plane: "reachable",
        ssh_check: status,
        executor: job.executor_id || "-",
        latency_ms: job.latency_ms || 0,
        exit_code: job.exit_code ?? "-",
        finished_at: job.finished_at || "-",
      }} />
      {(stdout || stderr) && (
        <div className="machine-test-output">
          {stdout && <pre className="machine-test-pre">{stdout}</pre>}
          {stderr && <pre className="machine-test-pre">{stderr}</pre>}
        </div>
      )}
      <details>
        <summary>Raw response</summary>
        <pre className="machine-test-pre">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </section>
  );
}

function NodesWorkspace({
  instance,
  runtime,
  provider,
  mode,
  runs,
  nodes,
  visibleNodes,
  selectedNode,
  modules,
  selectedModule,
  moduleDetail,
  moduleLoading,
  drafts,
  loading,
  routeNodeId,
  routeModuleId,
  nodeRunList,
  selectedNodeId,
  selectedNodeRunId,
  nodeSearch,
  nodeFilter,
  nodeFilters,
  onNodeSearch,
  onNodeFilter,
  onSelectNode,
  onOpenNodeRuns,
  onOpenNodeRun,
  onRelayNodeRun,
  onOpenSettings,
  onSelectModule,
  onOpenDraft,
}: {
  instance: Instance | undefined;
  runtime: Runtime | undefined;
  provider: SopDataProvider;
  mode: DataMode;
  runs: Run[];
  nodes: NodeRegistryItem[];
  visibleNodes: NodeRegistryItem[];
  selectedNode: NodeRegistryItem | undefined;
  modules: NodeModule[];
  selectedModule: NodeModule | undefined;
  moduleDetail: NodeModuleDetail | undefined;
  moduleLoading: boolean;
  drafts: NodeDraft[];
  loading: boolean;
  routeNodeId: string;
  routeModuleId: string;
  nodeRunList: boolean;
  selectedNodeId: string;
  selectedNodeRunId: string;
  nodeSearch: string;
  nodeFilter: string;
  nodeFilters: string[];
  onNodeSearch: (value: string) => void;
  onNodeFilter: (value: string) => void;
  onSelectNode: (nodeId: string, moduleId?: string) => void;
  onOpenNodeRuns: (nodeId: string) => void;
  onOpenNodeRun: (nodeId: string, nodeRunId: string) => void;
  onRelayNodeRun: (nodeId: string, sourceNodeRunId: string, options?: NodeRelayOptions) => void;
  onOpenSettings: () => void;
  onSelectModule: (moduleId: string) => void;
  onOpenDraft: () => void;
}) {
  const completeNodes = nodes.filter((node) => (node.missingFields || []).length === 0).length;
  const groupCounts = Object.fromEntries(nodeFilters.map((filter) => [filter, nodes.filter((node) => matchesNodeGroup(node, filter)).length]));
  const [nodeView, setNodeView] = useState<"list" | "dag" | "contracts">("list");
  const workflowBinding = instance?.workflowBinding;
  const workflowId = workflowBinding?.workflowId || workflowBinding?.workflowName || instance?.sopType || "workflow";
  const isRouteNode = Boolean(routeNodeId && selectedNode);
  const isNodeRunDetailRoute = Boolean(isRouteNode && selectedNodeRunId);
  const isNodeRunsRoute = Boolean(isRouteNode && nodeRunList && !selectedNodeRunId);
  const relayTargets = selectedNode ? buildRelayTargetNodes(nodes, selectedNode.nodeId) : [];
  const queryClient = useQueryClient();
  const [definitionEditOpen, setDefinitionEditOpen] = useState(false);
  const [definitionEditError, setDefinitionEditError] = useState("");
  const [confirmDefinitionEdit, setConfirmDefinitionEdit] = useState(false);
  const [latestDefinitionDraft, setLatestDefinitionDraft] = useState<NodeDraft | undefined>(undefined);
  const [definitionEditInput, setDefinitionEditInput] = useState<NodeDefinitionEditInput>({
    nodeId: "",
    title: "",
    description: "",
    mode: "",
    needs: "",
    executor: "{}",
    skill: "",
    entry: "",
    agent: "",
    webhookRoute: "",
    inputs: "{}",
    optionalInputs: "{}",
    outputs: "{}",
    capabilities: "{}",
  });
  const nodeDraftSchemaQuery = useQuery({
    queryKey: queryKeys.nodeDraftSchema(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.getNodeDraftSchema(runtime!, instance!.instanceId),
    enabled: Boolean(runtime && instance && definitionEditOpen),
  });
  const createDefinitionDraftMutation = useMutation({
    mutationFn: () => {
      const payload: NodeDraftInput = {
        draft_type: "edit_node_definition",
        node_id: definitionEditInput.nodeId,
        title: definitionEditInput.title,
        description: definitionEditInput.description,
        mode: definitionEditInput.mode,
        needs: definitionEditInput.needs.split(",").map((item) => item.trim()).filter(Boolean),
        executor: parseEditorObject("Executor", definitionEditInput.executor),
        skill: definitionEditInput.skill,
        entry: definitionEditInput.entry,
        agent: definitionEditInput.agent,
        webhook_route: definitionEditInput.webhookRoute,
        inputs: parseEditorObject("Inputs", definitionEditInput.inputs),
        optional_inputs: parseEditorObject("Optional Inputs", definitionEditInput.optionalInputs),
        outputs: parseEditorObject("Outputs", definitionEditInput.outputs),
        capabilities: parseEditorObject("Capabilities", definitionEditInput.capabilities),
      };
      return provider.createNodeDraft(runtime!, instance!.instanceId, payload);
    },
    onSuccess: async (draft) => {
      setDefinitionEditError("");
      setConfirmDefinitionEdit(false);
      setLatestDefinitionDraft(draft);
      await queryClient.invalidateQueries({ queryKey: queryKeys.nodeDrafts(mode, runtime, instance?.instanceId || "") });
    },
    onError: (error) => {
      setDefinitionEditError(String((error as Error).message || error));
    }
  });

  useEffect(() => {
    if (isRouteNode && !isNodeRunDetailRoute) removeSearchParams(["step"], "replace");
  }, [isRouteNode, isNodeRunDetailRoute, routeNodeId]);

  function openDefinitionEditor(node: NodeRegistryItem | undefined) {
    if (!node) return;
    setDefinitionEditInput({
      nodeId: node.nodeId,
      title: node.title || node.nodeId,
      description: node.description || node.purpose || "",
      mode: node.mode || "blocking",
      needs: (node.needs || []).join(", "),
      executor: formatJsonForEditor(node.executor || {}),
      skill: String((node.skill || {}).id || node.executor?.skill || ""),
      entry: String(node.executor?.entry || ""),
      agent: String(node.executor?.agent || ""),
      webhookRoute: String(node.executor?.webhook_route || node.executor?.webhookRoute || ""),
      inputs: formatJsonForEditor(node.inputs || {}),
      optionalInputs: formatJsonForEditor(node.optionalInputs || {}),
      outputs: formatJsonForEditor(node.outputs || {}),
      capabilities: formatJsonForEditor(node.capabilities || {}),
    });
    setDefinitionEditError("");
    setConfirmDefinitionEdit(false);
    setLatestDefinitionDraft(undefined);
    setDefinitionEditOpen(true);
  }

  function submitDefinitionEdit(event: FormEvent) {
    event.preventDefault();
    if (!definitionEditInput.nodeId.trim()) {
      setDefinitionEditError("Node ID 不能为空");
      return;
    }
    try {
      parseEditorObject("Inputs", definitionEditInput.inputs);
      parseEditorObject("Optional Inputs", definitionEditInput.optionalInputs);
      parseEditorObject("Outputs", definitionEditInput.outputs);
      parseEditorObject("Capabilities", definitionEditInput.capabilities);
      parseEditorObject("Executor", definitionEditInput.executor);
    } catch (error) {
      setDefinitionEditError(String((error as Error).message || error));
      return;
    }
    setDefinitionEditError("");
    createDefinitionDraftMutation.mutate();
  }

  const nodeListPanel = (
    <aside className="node-list-panel">
      <div className="panel-head compact">
        <div><strong>Definition Groups</strong><span>{visibleNodes.length}/{nodes.length} definitions</span></div>
        <button type="button" className="primary" disabled={!instance || !runtime} onClick={onOpenDraft}><CheckCircle2 size={16} />Draft</button>
      </div>
      <div className="node-list-tools">
        <label className="search-box"><Search size={14} /><input value={nodeSearch} onChange={(event) => onNodeSearch(event.target.value)} placeholder="Search node definition" /></label>
        <div className="node-group-list" role="tablist" aria-label="Node group">
          {nodeFilters.map((filter) => (
            <button key={filter} type="button" className={nodeFilter === filter ? "active" : ""} onClick={() => onNodeFilter(filter)}>
              <strong>{nodeGroupLabel(filter)}</strong>
              <span className={`status-pill ${filter === "failed" && (groupCounts[filter] || 0) ? "waiting" : "done"}`}>{groupCounts[filter] || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="node-catalog-heading">
        <strong>Node Definitions</strong>
        <span>{nodeGroupLabel(nodeFilter)}</span>
      </div>
      {loading ? <Skeleton /> : (
        <div className="node-picker-list">
          {visibleNodes.map((node) => (
            <button key={node.nodeId} type="button" className={`node-picker-row ${selectedNodeId === node.nodeId ? "active" : ""}`} onClick={() => onSelectNode(node.nodeId)}>
              <div>
                <strong>{node.title || node.nodeId}</strong>
                <span>{node.nodeId}</span>
                <span>{categoryLabel(String(node.ui?.category || "custom"))} · {String(node.executor?.type || node.case || "node")}</span>
              </div>
              <span className="stage-letter">{node.ui?.stageLetter || node.nodeId.slice(0, 1).toUpperCase()}</span>
              <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>{(node.missingFields || []).length ? "warning" : "ready"}</span>
            </button>
          ))}
          {!visibleNodes.length && <Empty text="没有匹配的 Node Definition" />}
        </div>
      )}
    </aside>
  );

  const definitionViews = (
    <section className="node-modules-panel">
      <div className="panel-head compact node-module-head">
        <div><strong>Module Definitions</strong><span>{selectedNode?.nodeId || "No node definition"}</span></div>
        <div className="node-module-head-actions">
          {selectedNode ? <button type="button" className="btn" onClick={() => onSelectNode(selectedNode.nodeId)}>Open Node</button> : null}
          <div className="segmented compact">
            <button type="button" className={nodeView === "list" ? "active" : ""} onClick={() => setNodeView("list")}>List</button>
            <button type="button" className={nodeView === "dag" ? "active" : ""} onClick={() => setNodeView("dag")}>DAG</button>
            <button type="button" className={nodeView === "contracts" ? "active" : ""} onClick={() => setNodeView("contracts")}>Contracts</button>
          </div>
        </div>
      </div>
      {nodeView === "list" && (
        <div className="node-module-list">
          {modules.map((module) => (
            <button key={module.id} type="button" className={`node-module-row ${selectedModule?.id === module.id ? "active" : ""}`} onClick={() => onSelectModule(module.id)}>
              <span className={`dot ${module.status}`} />
              <span>
                <strong>{module.title}</strong>
                {module.lane && <small>{module.lane}</small>}
                <small>{module.description}</small>
                <small>{module.summary || "-"}</small>
              </span>
              <span className={`status-pill ${module.status}`}>{module.status}</span>
            </button>
          ))}
          {!modules.length && <Empty text="该节点暂未返回 modules" />}
        </div>
      )}
      {nodeView === "dag" && (
        <div className="node-catalog-dag">
          {visibleNodes.map((node) => (
            <button key={node.nodeId} type="button" className={`node-dag-card ${selectedNodeId === node.nodeId ? "active" : ""}`} onClick={() => onSelectNode(node.nodeId)}>
              <span className="stage-letter">{node.ui?.stageLetter || node.nodeId.slice(0, 1).toUpperCase()}</span>
              <strong>{node.title || node.nodeId}</strong>
              <small>{contractSummary(node)}</small>
            </button>
          ))}
          {!visibleNodes.length && <Empty text="没有匹配的 Node Definition" />}
        </div>
      )}
      {nodeView === "contracts" && (
        <div className="node-contract-list">
          {visibleNodes.map((node) => (
            <button key={node.nodeId} type="button" className={`node-contract-card ${selectedNodeId === node.nodeId ? "active" : ""}`} onClick={() => onSelectNode(node.nodeId)}>
              <strong>{node.nodeId}</strong>
              <span>{Object.keys(node.inputs || {}).length} inputs</span>
              <span>{Object.keys(node.outputs || {}).length} outputs</span>
              <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>{(node.missingFields || []).length ? "review" : "ok"}</span>
            </button>
          ))}
          {!visibleNodes.length && <Empty text="没有契约数据" />}
        </div>
      )}
      <div className="draft-strip">
        <div className="section-title"><span>Drafts</span><span>{drafts.length}</span></div>
        {drafts.slice(0, 3).map((draft) => <article key={draft.draftId} className="draft-item"><strong>{draft.draftId}</strong><code>{formatValue(draft.validation)}</code></article>)}
        {!drafts.length && <Empty text="还没有节点草稿" />}
      </div>
    </section>
  );

  return (
    <>
      {!isNodeRunsRoute && !isNodeRunDetailRoute ? <section className="ops-page-header node-compact-header">
        <div className="ops-page-title">
          <span className="status-pill running"><Boxes size={14} />Node Catalog</span>
          <div>
            <h1>Node Definition Catalog</h1>
            <p>{runtime?.id || "Runtime"} · {instance?.instanceId || "Instance"} · {workflowBinding?.workflowName || instance?.sopType || "workflow"}</p>
          </div>
        </div>
        <div className="ops-header-chips">
          <span>{visibleNodes.length}/{nodes.length} definitions</span>
          <span>{completeNodes}/{nodes.length || 0} ready</span>
          <span>{drafts.length} drafts</span>
          <span>{groupCounts.failed || 0} review</span>
        </div>
      </section> : null}

      {!isRouteNode ? (
        <section className="node-list-route-workbench node-catalog-workbench">
          {nodeListPanel}
          <section className="node-list-main-panel">
            <div className="panel-head compact">
              <div><strong>Node List</strong><span>Open a node to inspect, run, and repair it in its own workspace.</span></div>
              <span className="status-pill done">{visibleNodes.length} visible</span>
            </div>
            <div className="node-route-table">
              {visibleNodes.map((node) => (
                <article key={node.nodeId} className={`node-route-row ${selectedNodeId === node.nodeId ? "active" : ""}`}>
                  <span className="stage-letter">{node.ui?.stageLetter || node.nodeId.slice(0, 1).toUpperCase()}</span>
                  <div className="node-route-copy">
                    <strong>{node.title || node.nodeId}</strong>
                    <small>{node.nodeId}</small>
                    <span>{node.description || contractSummary(node)}</span>
                  </div>
                  <div className="node-route-meta">
                    <span>{String(node.executor?.type || node.case || "node")}</span>
                    <span>{Object.keys(node.inputs || {}).length} inputs</span>
                    <span>{Object.keys(node.outputs || {}).length} outputs</span>
                    <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>{(node.missingFields || []).length ? "review" : "ready"}</span>
                  </div>
                  <div className="node-row-actions">
                    <button type="button" className="btn primary" onClick={() => onSelectNode(node.nodeId)}>Open</button>
                    <button type="button" className="btn" onClick={() => onOpenNodeRuns(node.nodeId)}>Run</button>
                    <button type="button" className="btn" onClick={() => onOpenNodeRuns(node.nodeId)}>History</button>
                  </div>
                </article>
              ))}
              {!visibleNodes.length && <Empty text="没有匹配的 Node Definition" />}
            </div>
          </section>
        </section>
      ) : isNodeRunDetailRoute ? (
        <NodeRunDetailPage
          provider={provider}
          runtime={runtime}
          instance={instance}
          workflowId={workflowId}
          node={selectedNode}
          runs={runs}
          mode={mode}
          selectedNodeRunId={selectedNodeRunId}
          onOpenNode={onSelectNode}
          onOpenNodeRuns={onOpenNodeRuns}
          onOpenNodeRun={onOpenNodeRun}
          relayTargets={relayTargets}
          onRelayNodeRun={onRelayNodeRun}
          onOpenSettings={onOpenSettings}
        />
      ) : isNodeRunsRoute ? (
        <NodeRunsIndexPage
          provider={provider}
          runtime={runtime}
          instance={instance}
          workflowId={workflowId}
          node={selectedNode}
          runs={runs}
          mode={mode}
          onOpenNode={onSelectNode}
          onOpenNodeRun={onOpenNodeRun}
        />
      ) : (
        <section className="node-detail-route-workbench node-catalog-workbench">
          {nodeListPanel}
          <section className="node-detail-route-main">
            <div className="node-detail-action-strip">
              <div>
                <strong>Node Detail</strong>
                <span>{runtime?.id || "Runtime"} · {instance?.instanceId || "Instance"} · {workflowId}</span>
              </div>
              <button type="button" className="btn primary" disabled={!selectedNode} onClick={() => openDefinitionEditor(selectedNode)}>
                <Edit3 size={14} />Edit Definition
              </button>
            </div>
            <section className="node-three-layer-grid">
              <article>
                <span className="status-pill done">Definition</span>
                <strong>节点定义层</strong>
                <small>来自 SOP / agent-brains 定义：Executor、Skill、Inputs、Outputs、默认 capability 和 GitHub 路径。</small>
                <KeyValues data={{
                  node_id: selectedNode?.nodeId || "-",
                  executor: String(selectedNode?.executor?.type || selectedNode?.case || "-"),
                  skill: String((selectedNode?.skill || {}).id || selectedNode?.executor?.skill || "-"),
                  outputs: Object.keys(selectedNode?.outputs || {}).length,
                }} />
              </article>
              <article>
                <span className="status-pill running">Runtime Context</span>
                <strong>运行环境层</strong>
                <small>当前 Runtime + Instance 提供执行环境、repo、workspace、Hermes、TG/GitHub 配置。</small>
                <KeyValues data={{
                  runtime_id: runtime?.id || "-",
                  instance_id: instance?.instanceId || "-",
                  repo: instance?.repo || "-",
                  wiki_local_path: instance?.wikiLocalPath || "-",
                }} />
              </article>
              <article>
                <span className="status-pill waiting">Runs</span>
                <strong>执行记录层</strong>
                <small>Node Run 保存本次输入、override、执行流、events、产物和能力结果。</small>
                <button type="button" className="btn primary" disabled={!selectedNode} onClick={() => selectedNode && onOpenNodeRuns(selectedNode.nodeId)}>打开运行工作台</button>
              </article>
            </section>
            <NodeDetailOverviewPanel
              node={selectedNode}
              modules={modules}
              selectedModuleId={selectedModule?.id || routeModuleId}
              loading={loading}
              onSelectModule={onSelectModule}
            />
            <NodeModuleInlinePanel node={selectedNode} module={selectedModule} detail={moduleDetail} loading={moduleLoading} />
            <details className="node-definition-details">
              <summary><span>Developer Definition Details</span><ChevronDown size={15} /></summary>
              <NodeDetailPanel node={selectedNode} loading={loading} />
            </details>
          </section>
        </section>
      )}
      {definitionEditOpen && runtime && instance ? (
        <NodeDefinitionEditorDrawer
          mode={mode}
          runtime={runtime}
          instance={instance}
          schema={nodeDraftSchemaQuery.data}
          input={definitionEditInput}
          setInput={(next) => { setDefinitionEditError(""); setDefinitionEditInput(next); }}
          confirmRealDraft={confirmDefinitionEdit}
          setConfirmRealDraft={setConfirmDefinitionEdit}
          creatingDraft={createDefinitionDraftMutation.isPending}
          createError={definitionEditError || (createDefinitionDraftMutation.error ? String(createDefinitionDraftMutation.error.message) : "")}
          latestDraft={latestDefinitionDraft || drafts.find((draft) => draft.changeRequest?.["node_id"] === definitionEditInput.nodeId || draft.node?.["id"] === definitionEditInput.nodeId)}
          onClose={() => setDefinitionEditOpen(false)}
          onCreateDraft={submitDefinitionEdit}
        />
      ) : null}
    </>
  );
}

function ModuleDetailPanel({
  node,
  module,
  detail,
  loading,
  onOpenNode,
}: {
  node: NodeRegistryItem | undefined;
  module: NodeModule | undefined;
  detail: NodeModuleDetail | undefined;
  loading: boolean;
  onOpenNode?: () => void;
}) {
  if (loading) return <section className="module-detail-panel"><Skeleton /></section>;
  if (!node || !module) return <section className="module-detail-panel"><Empty text="选择一个 Node 和 Module 查看详情" /></section>;
  const payload = detail?.detail || {};
  return (
    <section className="module-detail-panel">
      <div className="node-detail-hero compact-hero">
        <div>
          <span className={`status-pill ${module.status}`}>{module.status}</span>
          <h2>{node.title || node.nodeId}</h2>
          <p>{module.title} · {module.description || "模块详情"}</p>
          <div className="overview-tags">
            <span>{node.nodeId}</span>
            <span>{String(node.executor?.type || node.case || "node")}</span>
            <span>{module.runScoped ? "Run scoped" : "Definition"}</span>
            {module.contractVersion && <span>{module.contractVersion}</span>}
          </div>
        </div>
        {onOpenNode ? <button type="button" className="btn primary" onClick={onOpenNode}>Open Node</button> : null}
      </div>
      <div className="module-detail-body">
        {(module.lane || module.contractVersion || module.schema?.length || module.metrics) && (
          <div className="module-contract-strip">
            {module.lane && <span>{module.lane}</span>}
            {module.contractVersion && <span>{module.contractVersion}</span>}
            {module.schema?.slice(0, 4).map((item) => <code key={item}>{item}</code>)}
            {module.metrics && Object.entries(module.metrics).slice(0, 4).map(([key, value]) => (
              <span key={key}>{key}: {String(value)}</span>
            ))}
          </div>
        )}
        <DetailBlock title={`${module.title} Detail`}>
          <KeyValues data={payload} />
        </DetailBlock>
        {module.id === "skill" && <DetailBlock title="Skill README"><pre className="log-box compact-log">{String((payload.skill_readme as string) || node.skillReadme || "No README")}</pre></DetailBlock>}
        {module.id === "artifacts" && <DetailBlock title="Artifacts"><ArtifactList artifacts={((payload.artifacts as Artifact[]) || [])} /></DetailBlock>}
        {module.id === "actions" && <DetailBlock title="CLI"><KeyValues data={(payload.cli as Record<string, unknown>) || node.cli || {}} /></DetailBlock>}
      </div>
    </section>
  );
}

function NodeDetailPanel({ node, loading }: { node: NodeRegistryItem | undefined; loading: boolean }) {
  if (loading) return <section className="node-detail-panel"><Skeleton /></section>;
  if (!node) return <section className="node-detail-panel"><Empty text="选择一个 Node 查看完整定义" /></section>;
  return (
    <section className="node-detail-panel">
      <div className="node-detail-hero">
        <div>
          <span className="status-pill running">{String(node.case || node.executor?.type || node.mode || "node")}</span>
          <h2>{node.title || node.nodeId}</h2>
          <p>{node.description || "该节点暂未提供描述。"}</p>
          <div className="overview-tags">
            <span>Skill command</span>
            <span>Input mapping</span>
            <span>Output declaration</span>
          </div>
        </div>
        <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>
          {(node.missingFields || []).length ? `${node.missingFields?.length} missing` : "ready"}
        </span>
      </div>

      <div className="node-detail-grid">
        <DetailBlock title="Node Definition">
          <KeyValues data={{
            node_id: node.nodeId,
            type: node.case || node.executor?.type || "-",
            mode: node.mode || "-",
            editable: node.editable ? "yes" : "no",
            publish_enabled: node.publishEnabled ? "yes" : "no",
          }} />
        </DetailBlock>
        <DetailBlock title="Skill / Executor">
          <KeyValues data={node.skill && Object.keys(node.skill).length ? node.skill : {
            executor_skill: node.executor?.skill || "-",
            install_command: node.executor?.install_command || "-",
          }} />
        </DetailBlock>
        <DetailBlock title="Input Mapping">
          <KeyValues data={(node.inputs as Record<string, unknown>) || {}} />
        </DetailBlock>
        <DetailBlock title="Output Declaration">
          <KeyValues data={(node.outputs as Record<string, unknown>) || {}} />
        </DetailBlock>
        <DetailBlock title="Attached Capabilities">
          <div className="capability-stack">
            <CapabilityRow label="GitHub Persist" enabled={capabilityEnabled((node.capabilities || {}).github ?? true)} />
            <CapabilityRow label="Telegram Notify" enabled={capabilityEnabled((node.capabilities || {}).telegram ?? (node.infra?.tgNotify !== false))} />
            <CapabilityRow label="SSE Events" enabled={capabilityEnabled((node.capabilities || {}).sse ?? true)} />
          </div>
        </DetailBlock>
        <DetailBlock title="Action Steps">
          <StepList items={nodeActionSteps(node.nodeId)} status={(node.missingFields || []).length ? "waiting" : "done"} />
        </DetailBlock>
        <DetailBlock title="Actions">
          <ActionList actions={(node.actions as Record<string, unknown>) || {}} />
        </DetailBlock>
      </div>

      <DetailBlock title="CLI Examples">
        <details className="cli-fold">
          <summary><span>查看远程调用示例</span><ChevronDown size={15} /></summary>
          <div className="cli-list">
            {Object.entries(node.cli || {}).length ? Object.entries(node.cli || {}).map(([key, value]) => (
              <div key={key} className="cli-item">
                <span>{key}</span>
                <code>{value}</code>
              </div>
            )) : <Empty text="该节点暂未返回 CLI 示例" />}
          </div>
        </details>
      </DetailBlock>
    </section>
  );
}

function NodeAssistPanel({
  node,
  drafts,
  runtime,
  instance,
  onOpenDraft,
}: {
  node: NodeRegistryItem | undefined;
  drafts: NodeDraft[];
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  onOpenDraft: () => void;
}) {
  return (
    <aside className="node-assist-panel">
      <section>
        <div className="section-title"><span>Draft / Publish</span><span>disabled</span></div>
        <button type="button" className="primary wide" disabled={!instance || !runtime} onClick={onOpenDraft}>
          <CheckCircle2 size={16} />Create Node Draft
        </button>
        <p className="body-copy">Draft 只写入 `raw/node-drafts` 并返回校验结果；Apply / Publish 第一版保持禁用。</p>
      </section>
      <section>
        <div className="section-title"><span>Validation</span><span>{(node?.missingFields || []).length ? "warning" : "ready"}</span></div>
        {(node?.missingFields || []).length ? (
          <div className="needs-list">{node!.missingFields!.map((field) => <span key={field} className="needs-chip">{field}</span>)}</div>
        ) : <div className="validation-summary"><div className="row"><strong>Metadata ready</strong><span className="status-pill done">ready</span></div><p>当前节点没有缺失必填字段。</p></div>}
      </section>
      <section>
        <div className="section-title"><span>Capabilities</span><span>{node ? "node" : "-"}</span></div>
        {node ? <CapabilityMini node={node} /> : <Empty text="选择节点后查看附属能力" />}
      </section>
      <section>
        <div className="section-title"><span>Draft History</span><span>{drafts.length}</span></div>
        <div className="draft-list">
          {drafts.slice(0, 5).map((draft) => (
            <article key={draft.draftId} className="draft-item">
              <strong>{draft.draftId}</strong>
              <code>{formatValue(draft.validation)}</code>
            </article>
          ))}
          {!drafts.length && <Empty text="还没有节点草稿" />}
        </div>
      </section>
    </aside>
  );
}

function NodeDraftDrawer({
  mode,
  runtime,
  instance,
  schema,
  draftInput,
  setDraftInput,
  confirmRealDraft,
  setConfirmRealDraft,
  creatingDraft,
  createError,
  onClose,
  onCreateDraft,
}: {
  mode: DataMode;
  runtime: Runtime;
  instance: Instance;
  schema: NodeDraftSchema | undefined;
  draftInput: NodeDraftInput;
  setDraftInput: (input: NodeDraftInput) => void;
  confirmRealDraft: boolean;
  setConfirmRealDraft: (value: boolean) => void;
  creatingDraft: boolean;
  createError: string;
  onClose: () => void;
  onCreateDraft: (event: FormEvent) => void;
}) {
  return (
    <div className="drawer-backdrop" role="presentation">
      <form className="side-drawer" onSubmit={onCreateDraft}>
        <div className="drawer-head">
          <div>
            <h2>Create Node Draft</h2>
            <span>{instance.instanceId} · {runtime.name}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭草稿抽屉" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>安全边界</strong>
            <span>该操作只创建草稿；正式发布、写入 `sop.yaml` 和重启 Runtime 当前仍禁用。</span>
          </div>
          {schema && (
            <div className="schema-note">
              <span>{schema.schemaId}</span>
              <span>{schema.fields.filter((field) => field.required).length} required fields</span>
              <span>{schema.safety.publish_enabled ? "publish enabled" : "draft only"}</span>
              <span>{((schema.safety.writes as string[]) || []).slice(0, 1)[0] || "raw/node-drafts"}</span>
            </div>
          )}
          <label>Skill install command<input value={draftInput.skill_install_command} onChange={(event) => setDraftInput({ ...draftInput, skill_install_command: event.target.value })} /></label>
          <div className="draft-grid">
            <label>Skill ID<input value={draftInput.skill_id} onChange={(event) => setDraftInput({ ...draftInput, skill_id: event.target.value })} /></label>
            <label>Node ID<input value={draftInput.node_id} onChange={(event) => setDraftInput({ ...draftInput, node_id: event.target.value })} /></label>
            <label>Title<input value={draftInput.title} onChange={(event) => setDraftInput({ ...draftInput, title: event.target.value })} /></label>
            <label>Upstream<input value={draftInput.upstream || ""} onChange={(event) => setDraftInput({ ...draftInput, upstream: event.target.value })} /></label>
            <label>Upstream output<input value={draftInput.upstream_output || ""} onChange={(event) => setDraftInput({ ...draftInput, upstream_output: event.target.value })} /></label>
            <label>Input name<input value={draftInput.input_name || ""} onChange={(event) => setDraftInput({ ...draftInput, input_name: event.target.value })} /></label>
            <label>Output name<input value={draftInput.output_name || ""} onChange={(event) => setDraftInput({ ...draftInput, output_name: event.target.value })} /></label>
            <label>Output path<input value={draftInput.output_path || ""} onChange={(event) => setDraftInput({ ...draftInput, output_path: event.target.value })} /></label>
          </div>
          <label>Description<textarea value={draftInput.description || ""} onChange={(event) => setDraftInput({ ...draftInput, description: event.target.value })} /></label>
          {mode === "real" && (
            <label className="confirm-row"><input type="checkbox" checked={confirmRealDraft} onChange={(event) => setConfirmRealDraft(event.target.checked)} />我确认要在真实 Runtime 上创建 Node Draft</label>
          )}
          {createError && <div className="inline-error">{createError}</div>}
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={creatingDraft || (mode === "real" && !confirmRealDraft)}>
            {creatingDraft ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            {creatingDraft ? "Creating" : "Create draft"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NodeDefinitionEditorDrawer({
  mode,
  runtime,
  instance,
  schema,
  input,
  setInput,
  confirmRealDraft,
  setConfirmRealDraft,
  creatingDraft,
  createError,
  latestDraft,
  onClose,
  onCreateDraft,
}: {
  mode: DataMode;
  runtime: Runtime;
  instance: Instance;
  schema: NodeDraftSchema | undefined;
  input: NodeDefinitionEditInput;
  setInput: (input: NodeDefinitionEditInput) => void;
  confirmRealDraft: boolean;
  setConfirmRealDraft: (value: boolean) => void;
  creatingDraft: boolean;
  createError: string;
  latestDraft?: NodeDraft;
  onClose: () => void;
  onCreateDraft: (event: FormEvent) => void;
}) {
  const changeRequest = latestDraft?.changeRequest || {};
  const targets = (changeRequest.targets as Record<string, unknown>) || {};
  const changeSummary = Array.isArray(changeRequest.change_summary) ? changeRequest.change_summary as Array<Record<string, unknown>> : [];
  return (
    <div className="drawer-backdrop" role="presentation">
      <form className="side-drawer node-definition-editor-drawer" onSubmit={onCreateDraft}>
        <div className="drawer-head">
          <div>
            <h2>Edit Definition</h2>
            <span>{instance.instanceId} · {runtime.name} · {input.nodeId}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭节点定义编辑器" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>保存边界</strong>
            <span>这里只生成 definition draft/change request，不直接修改 Runtime 或生产 workflow。正式应用必须走 agent-brain-plugins repo-first 流程。</span>
          </div>
          <div className="schema-note">
            <span>{schema?.schemaId || "node-draft-schema"}</span>
            <span>draft_type: edit_node_definition</span>
            <span>target: agent-brain-plugins</span>
            <span>publish disabled</span>
          </div>
          <section className="definition-editor-targets">
            <div className="section-title"><span>保存目标</span><span>draft only</span></div>
            <KeyValues data={{
              runtime_sop_file: targets.runtime_sop_file || "runtime sop.yaml 不直接修改",
              project_skill_node_yaml: targets.project_skill_node_yaml || `agent-brain-plugins/youtube-wiki/skills/sop-${input.nodeId}/node.yaml`,
              project_template_sop_yaml: targets.project_template_sop_yaml || "agent-brain-plugins/youtube-wiki/templates/wiki-repo/sop.yaml",
              draft_workspace: latestDraft?.draftPath || "raw/node-drafts/{draft_id}",
            }} />
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Identity</span><span>definition</span></div>
            <div className="draft-grid">
              <label>Node ID<input value={input.nodeId} disabled /></label>
              <label>Title<input value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} /></label>
              <label>Mode<input value={input.mode} onChange={(event) => setInput({ ...input, mode: event.target.value })} /></label>
              <label>Needs<input value={input.needs} onChange={(event) => setInput({ ...input, needs: event.target.value })} placeholder="youtube-fetch, notebooklm-research" /></label>
            </div>
            <label>Description<textarea value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Executor / Skill Binding</span><span>agent-skill</span></div>
            <div className="draft-grid">
              <label>Skill<input value={input.skill} onChange={(event) => setInput({ ...input, skill: event.target.value })} placeholder="sop-wiki-build" /></label>
              <label>Entry<input value={input.entry} onChange={(event) => setInput({ ...input, entry: event.target.value })} placeholder="scripts/run_wiki_build.sh" /></label>
              <label>Agent<input value={input.agent} onChange={(event) => setInput({ ...input, agent: event.target.value })} placeholder="hermes" /></label>
              <label>Webhook Route<input value={input.webhookRoute} onChange={(event) => setInput({ ...input, webhookRoute: event.target.value })} placeholder="sop-wiki-build" /></label>
            </div>
            <textarea className="definition-json-editor compact" value={input.executor} onChange={(event) => setInput({ ...input, executor: event.target.value })} spellCheck={false} />
            <small className="field-hint">这些字段属于节点定义草稿，保存目标是 agent-brain-plugins，不是 Runtime 运行配置。</small>
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Inputs Contract</span><span>required / accepts / resolvers</span></div>
            <textarea className="definition-json-editor" value={input.inputs} onChange={(event) => setInput({ ...input, inputs: event.target.value })} spellCheck={false} />
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Optional Inputs</span><span>non-blocking</span></div>
            <textarea className="definition-json-editor" value={input.optionalInputs} onChange={(event) => setInput({ ...input, optionalInputs: event.target.value })} spellCheck={false} />
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Outputs Contract</span><span>path / relayable / role</span></div>
            <textarea className="definition-json-editor" value={input.outputs} onChange={(event) => setInput({ ...input, outputs: event.target.value })} spellCheck={false} />
          </section>
          <section className="definition-editor-section">
            <div className="section-title"><span>Capabilities</span><span>GitHub / Telegram / SSE</span></div>
            <textarea className="definition-json-editor compact" value={input.capabilities} onChange={(event) => setInput({ ...input, capabilities: event.target.value })} spellCheck={false} />
          </section>
          {latestDraft ? (
            <section className="definition-editor-review">
              <div className="section-title"><span>Latest Draft Review</span><span>{latestDraft.validation?.status ? String(latestDraft.validation.status) : "created"}</span></div>
              <KeyValues data={{
                draft_id: latestDraft.draftId,
                draft_type: latestDraft.draftType || "edit_node_definition",
                change_count: latestDraft.validation?.change_count ?? changeSummary.length,
              }} />
              {changeSummary.length ? (
                <div className="definition-change-list">
                  {changeSummary.slice(0, 8).map((row, index) => (
                    <article key={`${row.field || "field"}-${index}`}>
                      <strong>{String(row.field || "field")}</strong>
                      <small>before</small>
                      <code>{formatValue(row.before)}</code>
                      <small>after</small>
                      <code>{formatValue(row.after)}</code>
                    </article>
                  ))}
                </div>
              ) : <Empty text="还没有生成本节点的编辑草稿" />}
            </section>
          ) : null}
          {mode === "real" && (
            <label className="confirm-row"><input type="checkbox" checked={confirmRealDraft} onChange={(event) => setConfirmRealDraft(event.target.checked)} />我确认只在真实 Runtime 上创建定义草稿，不发布生产 DAG</label>
          )}
          {createError && <div className="inline-error">{createError}</div>}
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={creatingDraft || (mode === "real" && !confirmRealDraft)}>
            {creatingDraft ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
            {creatingDraft ? "Creating" : "Save Draft"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ExecutionStartDrawer({
  mode,
  runtime,
  instance,
  triggerUrl,
  setTriggerUrl,
  pending,
  error,
  onClose,
  onStart,
}: {
  mode: DataMode;
  runtime: Runtime;
  instance: Instance;
  triggerUrl: string;
  setTriggerUrl: (value: string) => void;
  pending: boolean;
  error: string;
  onClose: () => void;
  onStart: (event: FormEvent) => void;
}) {
  return (
    <div className="drawer-backdrop" role="presentation">
      <form className="side-drawer execution-start-drawer" onSubmit={onStart}>
        <div className="drawer-head">
          <div>
            <h2>Start Workflow Run</h2>
            <span>{mode === "real" ? "Real SOP Runtime" : "Mock Runtime"} · {instance.instanceId}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭创建面板" onClick={onClose} disabled={pending}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>连续运行体验</strong>
            <span>点击后会立即在 Workflow Runs 中插入 Starting 状态，并自动聚焦到新 Run。</span>
          </div>
          <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />
          <label>YouTube URL<input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} disabled={pending} /></label>
          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="primary" disabled={pending || !triggerUrl.trim()}>
            {pending ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            {pending ? "Starting..." : "Start Run"}
          </button>
        </div>
      </form>
    </div>
  );
}

function RuntimeManagementStartDrawer({
  mode,
  runtime,
  instance,
  instances,
  action,
  setAction,
  createSshCommand,
  setCreateSshCommand,
  createPrivateKey,
  setCreatePrivateKey,
  createEnvText,
  setCreateEnvText,
  createConfigOverrides,
  setCreateConfigOverrides,
  createMachineId,
  setCreateMachineId,
  deleteRuntimeId,
  deleteTargetRuntimeId,
  setDeleteTargetRuntimeId,
  setDeleteRuntimeId,
  deleteSshCommand,
  setDeleteSshCommand,
  deletePrivateKey,
  setDeletePrivateKey,
  deleteMachineId,
  setDeleteMachineId,
  deleteForce,
  setDeleteForce,
  deleteConfirmed,
  setDeleteConfirmed,
  deleteCandidates,
  deleteCandidatesLoading,
  machines,
  machinesLoading,
  githubRepos,
  githubReposLoading,
  githubReposError,
  instanceCreateId,
  setInstanceCreateId,
  instanceCreateRepo,
  setInstanceCreateRepo,
  suggestedInstanceCreateId,
  instanceTelegramTokenMode,
  setInstanceTelegramTokenMode,
  instanceTelegramToken,
  setInstanceTelegramToken,
  instanceTelegramChatId,
  setInstanceTelegramChatId,
  inheritedTelegramToken,
  inheritedTelegramChatId,
  instanceDeleteId,
  setInstanceDeleteId,
  instanceDeleteRepo,
  setInstanceDeleteRepo,
  instanceDeleteForce,
  setInstanceDeleteForce,
  inheritance,
  inheritanceLoading,
  inheritanceError,
  onRefreshInheritance,
  onSaveDefaults,
  onResetDefaults,
  onLoadInheritanceToEnv,
  createPending,
  deletePending,
  error,
  onClose,
  onCreate,
  onDelete,
}: {
  mode: DataMode;
  runtime: Runtime;
  instance: Instance;
  instances: Instance[];
  action: RuntimeManagementAction;
  setAction: (value: RuntimeManagementAction) => void;
  createSshCommand: string;
  setCreateSshCommand: (value: string) => void;
  createPrivateKey: string;
  setCreatePrivateKey: (value: string) => void;
  createEnvText: string;
  setCreateEnvText: (value: string) => void;
  createConfigOverrides: Record<string, string>;
  setCreateConfigOverrides: (value: Record<string, string>) => void;
  createMachineId: string;
  setCreateMachineId: (value: string) => void;
  deleteRuntimeId: string;
  deleteTargetRuntimeId: string;
  setDeleteTargetRuntimeId: (value: string) => void;
  setDeleteRuntimeId: (value: string) => void;
  deleteSshCommand: string;
  setDeleteSshCommand: (value: string) => void;
  deletePrivateKey: string;
  setDeletePrivateKey: (value: string) => void;
  deleteMachineId: string;
  setDeleteMachineId: (value: string) => void;
  deleteForce: boolean;
  setDeleteForce: (value: boolean) => void;
  deleteConfirmed: boolean;
  setDeleteConfirmed: (value: boolean) => void;
  deleteCandidates: Runtime[];
  deleteCandidatesLoading: boolean;
  machines: MachineConfig[];
  machinesLoading: boolean;
  githubRepos: GitHubRepoOption[];
  githubReposLoading: boolean;
  githubReposError: string;
  instanceCreateId: string;
  setInstanceCreateId: (value: string) => void;
  instanceCreateRepo: string;
  setInstanceCreateRepo: (value: string) => void;
  suggestedInstanceCreateId: string;
  instanceTelegramTokenMode: "global" | "override";
  setInstanceTelegramTokenMode: (value: "global" | "override") => void;
  instanceTelegramToken: string;
  setInstanceTelegramToken: (value: string) => void;
  instanceTelegramChatId: string;
  setInstanceTelegramChatId: (value: string) => void;
  inheritedTelegramToken: RuntimeInheritanceItem | undefined;
  inheritedTelegramChatId: string;
  instanceDeleteId: string;
  setInstanceDeleteId: (value: string) => void;
  instanceDeleteRepo: string;
  setInstanceDeleteRepo: (value: string) => void;
  instanceDeleteForce: boolean;
  setInstanceDeleteForce: (value: boolean) => void;
  inheritance: RuntimeInheritancePreview | undefined;
  inheritanceLoading: boolean;
  inheritanceError: string;
  onRefreshInheritance: () => void;
  onSaveDefaults: () => void;
  onResetDefaults: () => void;
  onLoadInheritanceToEnv: () => void;
  createPending: boolean;
  deletePending: boolean;
  error: string;
  onClose: () => void;
  onCreate: (event: FormEvent) => void;
  onDelete: (event: FormEvent) => void;
}) {
  const pending = createPending || deletePending;
  const isCreateRuntime = action === "create-runtime";
  const isDeleteRuntime = action === "delete-runtime";
  const isCreateInstance = action === "create-instance";
  const isDeleteInstance = action === "delete-instance";
  const isCreate = isCreateRuntime || isCreateInstance;
  const resolvedCreateInstanceId = instanceCreateId.trim() || suggestedInstanceCreateId;
  const createReady = isCreateInstance ? Boolean(instanceCreateRepo.trim()) : true;
  const submitLabel = isCreateRuntime ? "Create Runtime" : isDeleteRuntime ? "Delete Runtime" : isCreateInstance ? "Create Instance" : "Delete Instance";
  const selectedCreateMachine = machines.find((machine) => machine.id === createMachineId);
  const selectedDeleteMachine = machines.find((machine) => machine.id === deleteMachineId);
  const selectedDeleteRuntime = deleteCandidates.find((item) => item.id === deleteTargetRuntimeId);
  const selectedDeleteInstance = instances.find((item) => item.instanceId === instanceDeleteId);
  const protectedDeleteInstance = instanceDeleteId.trim() === "runtime-management";
  const selectedDeleteWorkspace = selectedDeleteInstance?.wikiLocalPath || "";
  const selectedDeleteRepo = selectedDeleteInstance?.repo || instanceDeleteRepo.trim();
  const sharedDeleteRefs = selectedDeleteInstance
    ? instances.filter((item) => item.instanceId !== selectedDeleteInstance.instanceId && (
      Boolean(selectedDeleteWorkspace && item.wikiLocalPath === selectedDeleteWorkspace)
      || Boolean(selectedDeleteRepo && item.repo === selectedDeleteRepo)
    ))
    : [];
  const inferredDeleteRuntimeId = machineRuntimeId(selectedDeleteMachine);
  const targetHost = runtimeHost(selectedDeleteRuntime) || selectedDeleteMachine?.host || "";
  const deleteHasCredential = Boolean(selectedDeleteMachine?.privateKeyPresent || selectedDeleteMachine?.passwordPresent || deleteSshCommand.trim());
  const deleteReady = isDeleteRuntime ? Boolean(selectedDeleteRuntime && deleteConfirmed && deleteHasCredential) : true;
  const deleteInstanceReady = isDeleteInstance ? Boolean(instanceDeleteId.trim() && !protectedDeleteInstance) : true;
  const operationBoundaryTitle = isCreateRuntime || isDeleteRuntime ? "Target Machine Boundary" : "Current Runtime Boundary";
  const operationBoundaryText = isCreateRuntime || isDeleteRuntime
    ? "Runtime 创建/删除需要目标机器；优先选择 Machine Node，Control Plane 会注入保存的 SSH 凭据。"
    : "Instance 创建/删除只作用于当前 Runtime Host，不选择目标机器，也不注入 SSH 凭据。";
  const renderMachineSelect = (
    value: string,
    onChange: (value: string) => void,
    onApplySsh: (value: string) => void,
  ) => (
    <label>
      <span>Machine Node</span>
      <select
        value={value}
        onChange={(event) => {
          const nextId = event.target.value;
          onChange(nextId);
          const machine = machines.find((item) => item.id === nextId);
          if (machine?.sshCommand) onApplySsh(machine.sshCommand);
        }}
        disabled={pending || machinesLoading}
      >
        <option value="">{machinesLoading ? "Loading machine nodes..." : "Manual SSH / saved defaults"}</option>
        {machines.map((machine) => (
          <option key={machine.id} value={machine.id}>{machine.name} · {machine.user}@{machine.host}</option>
        ))}
      </select>
      <span className="field-hint">{value ? "选择后会从 Control Plane 加载 SSH 配置，并按旧 workflow 入参提交 ssh_command / private_key_b64 / ssh_password。" : "不选择时沿用后端保存默认值，或在高级覆盖中手填 SSH。"}</span>
    </label>
  );

  return (
    <div className="drawer-backdrop" role="presentation">
      <form className="side-drawer execution-start-drawer runtime-management-drawer" onSubmit={isCreate ? onCreate : onDelete}>
        <div className="drawer-head">
          <div>
            <h2>Host Operations</h2>
            <span>{mode === "real" ? "Real SOP Runtime" : "Mock Runtime"} · {instance.instanceId}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭 Runtime 管理面板" onClick={onClose} disabled={pending}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>{operationBoundaryTitle}</strong>
            <span>{operationBoundaryText}</span>
          </div>
          <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />

          <div className="segmented runtime-action-toggle" role="tablist" aria-label="Runtime action">
            <button type="button" className={isCreateRuntime ? "active" : ""} onClick={() => setAction("create-runtime")} disabled={pending}>
              Create Runtime
            </button>
            <button type="button" className={isDeleteRuntime ? "active" : ""} onClick={() => setAction("delete-runtime")} disabled={pending}>
              Delete Runtime
            </button>
            <button type="button" className={isCreateInstance ? "active" : ""} onClick={() => setAction("create-instance")} disabled={pending}>
              Create Instance
            </button>
            <button type="button" className={isDeleteInstance ? "active" : ""} onClick={() => setAction("delete-instance")} disabled={pending}>
              Delete Instance
            </button>
          </div>

          {isCreateRuntime ? (
            <div className="runtime-drawer-form">
              {renderMachineSelect(createMachineId, setCreateMachineId, setCreateSshCommand)}
              {selectedCreateMachine ? (
                <section className="selected-machine-summary">
                  <div>
                    <strong>{selectedCreateMachine.name}</strong>
                    <span>{selectedCreateMachine.user}@{selectedCreateMachine.host}:{selectedCreateMachine.port}</span>
                  </div>
                  <KeyValues data={{
                    machine_id: selectedCreateMachine.id,
                    auth: selectedCreateMachine.authType,
                    secret: selectedCreateMachine.privateKeyPresent || selectedCreateMachine.passwordPresent ? "saved" : "missing",
                    last_check: formatBeijingTime(selectedCreateMachine.lastCheckAt),
                  }} />
                </section>
              ) : (
                <div className="inline-warning">未选择 Machine 时会使用后端默认 SSH 配置；需要临时覆盖时打开下面的 Manual SSH Override。</div>
              )}
              <details className="advanced-runtime-overrides">
                <summary>Manual SSH Override</summary>
                <label>
                  <span>SSH Command</span>
                  <input value={createSshCommand} onChange={(event) => setCreateSshCommand(event.target.value)} disabled={pending} placeholder="仅临时覆盖时填写；优先使用 Machine Node" />
                </label>
                <label>
                  <span>Private Key</span>
                  <textarea value={createPrivateKey} onChange={(event) => setCreatePrivateKey(event.target.value)} disabled={pending} placeholder="仅临时覆盖时填写；正常情况下由 Control Plane 注入" rows={7} />
                  <span className="field-hint">高级覆盖项。选择 Machine Node 后正常不用填，后端会注入已保存的目标 SSH 凭据。</span>
                </label>
              </details>
              <RuntimeInheritancePreviewPanel
                preview={inheritance}
                loading={inheritanceLoading}
                error={inheritanceError}
                overrides={createConfigOverrides}
                onOverridesChange={setCreateConfigOverrides}
                onRefresh={onRefreshInheritance}
                hideCreateRuntimeIdentity
              />
              <details className="advanced-runtime-overrides">
                <summary>Advanced Runtime Env Overrides</summary>
                <label>
                  <span>Runtime Env Overrides</span>
                  <textarea
                    value={createEnvText}
                    onChange={(event) => setCreateEnvText(event.target.value)}
                    disabled={pending}
                    placeholder={"GITHUB_TOKEN=\nDEEPSEEK_API_KEY=\nGOOGLE_CLOUD_API_KEY=\nNOTEBOOKLM_BRIDGE_URL=\nNOTEBOOKLM_BRIDGE_TOKEN=\nYOUTUBE_WIKI_TG_TOKEN=\nCLOUDFLARE_API_KEY="}
                    rows={8}
                  />
                  <span className="field-hint">高级覆盖项。正常创建时保持为空，系统会自动继承上方 Resolved Config。</span>
                  <button type="button" className="inline-tool-btn" onClick={onLoadInheritanceToEnv} disabled={pending || inheritanceLoading}>
                    <RefreshCw size={14} />Load inherited template
                  </button>
                </label>
              </details>
            </div>
          ) : isDeleteRuntime ? (
            <div className="runtime-drawer-form">
              <section className="runtime-delete-boundary">
                <div className="runtime-delete-boundary-card executor">
                  <strong>Executor Runtime</strong>
                  <span>{runtime.id}</span>
                  <KeyValues data={{
                    channel_url: runtime.channelUrl || runtime.endpoint || "-",
                    client_ip: runtime.clientIp || runtime.machine || "-",
                  }} />
                </div>
                <div className="runtime-delete-boundary-card target">
                  <strong>Delete Target</strong>
                  <span>{selectedDeleteRuntime?.id || "Select a runtime below"}</span>
                  <KeyValues data={{
                    channel_url: selectedDeleteRuntime ? runtimeChannelUrl(selectedDeleteRuntime) : "-",
                    client_ip: targetHost || "-",
                  }} />
                </div>
              </section>
              <label>
                <span>Runtime Target</span>
                <select
                  value={deleteTargetRuntimeId}
                  onChange={(event) => {
                    const nextRuntimeId = event.target.value;
                    setDeleteTargetRuntimeId(nextRuntimeId);
                    const target = deleteCandidates.find((item) => item.id === nextRuntimeId);
                    setDeleteRuntimeId(target?.id || "");
                    setDeleteConfirmed(false);
                    const matchedMachine = target ? machines.find((machine) => machineMatchesRuntime(machine, target)) : undefined;
                    setDeleteMachineId(matchedMachine?.id || "");
                    if (matchedMachine?.sshCommand) setDeleteSshCommand(matchedMachine.sshCommand);
                  }}
                  disabled={pending || deleteCandidatesLoading}
                >
                  <option value="">{deleteCandidatesLoading ? "Loading active runtimes..." : "Select active runtime to delete"}</option>
                  {deleteCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.id} · {candidate.clientIp || candidate.machine || "no host"} · {candidate.localStatus}
                    </option>
                  ))}
                </select>
                <span className="field-hint">列表来自 Runtime discovery，只展示 active/local ok 的 SOP Runtime，并排除当前执行 Runtime。</span>
              </label>
              {!deleteCandidates.length && (
                <div className="inline-warning">当前没有可删除的其他 active Runtime。需要先确认 runtime discovery 是否正常，或目标是否已经离线。</div>
              )}
              {selectedDeleteRuntime ? (
                <section className="selected-machine-summary delete-runtime-summary">
                  <div>
                    <strong>{selectedDeleteRuntime.displayName || selectedDeleteRuntime.id}</strong>
                    <span>{runtimeChannelUrl(selectedDeleteRuntime)}</span>
                  </div>
                  <KeyValues data={{
                    runtime_id: selectedDeleteRuntime.id,
                    target_host: targetHost || "-",
                    channel_name: selectedDeleteRuntime.channelName || "-",
                    spi_base_url: runtimeSpiBaseUrl(selectedDeleteRuntime) || "-",
                    machine_credentials: deleteHasCredential ? "resolved" : "missing",
                  }} />
                </section>
              ) : (
                <div className="inline-warning">请先选择要删除的 Runtime。当前执行 Runtime 不会出现在目标列表中。</div>
              )}
              {selectedDeleteMachine ? (
                <section className="selected-machine-summary">
                  <div>
                    <strong>{selectedDeleteMachine.name}</strong>
                    <span>{selectedDeleteMachine.user}@{selectedDeleteMachine.host}:{selectedDeleteMachine.port}</span>
                  </div>
                  <KeyValues data={{
                    machine_id: selectedDeleteMachine.id,
                    inferred_runtime_id: inferredDeleteRuntimeId || "-",
                    auth: selectedDeleteMachine.authType,
                    secret: selectedDeleteMachine.privateKeyPresent || selectedDeleteMachine.passwordPresent ? "saved" : "missing",
                    last_check: formatBeijingTime(selectedDeleteMachine.lastCheckAt),
                  }} />
                </section>
              ) : (
                <div className="inline-warning">没有匹配到 Machine Node。需要在 Machines 中保存该目标机器，或在 Manual SSH Override 填写临时 SSH。</div>
              )}
              <details className="advanced-runtime-overrides">
                <summary>Target Override</summary>
                <label>
                  <span>Runtime ID</span>
                  <input value={deleteRuntimeId} onChange={(event) => setDeleteRuntimeId(event.target.value)} disabled={pending} placeholder={inferredDeleteRuntimeId || "留空时按 Machine Host 推导"} />
                  <span className="field-hint">高级覆盖项。选择 Machine Node 后正常不用填；系统会按目标机器 host 推导 runtime id。</span>
                </label>
              </details>
              <details className="advanced-runtime-overrides">
                <summary>Manual SSH Override</summary>
                <label>
                  <span>SSH Command</span>
                  <input value={deleteSshCommand} onChange={(event) => setDeleteSshCommand(event.target.value)} disabled={pending} placeholder="仅临时覆盖时填写；优先使用 Machine Node" />
                </label>
                <label>
                  <span>Private Key</span>
                  <textarea value={deletePrivateKey} onChange={(event) => setDeletePrivateKey(event.target.value)} disabled={pending} placeholder="仅临时覆盖时填写；正常情况下由 Control Plane 注入" rows={6} />
                  <span className="field-hint">高级覆盖项。选择 Machine Node 后正常不用填，后端会注入已保存的目标 SSH 凭据。</span>
                </label>
              </details>
              <label className="inline-check drawer-inline-check">
                <input type="checkbox" checked={deleteForce} onChange={(event) => setDeleteForce(event.target.checked)} disabled={pending} />
                <span>Force when running executions exist</span>
              </label>
              <label className="inline-check drawer-inline-check delete-confirm-check">
                <input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} disabled={pending || !selectedDeleteRuntime || !deleteHasCredential} />
                <span>Confirm deleting {selectedDeleteRuntime?.id || "selected runtime"} from {runtime.id}</span>
              </label>
              {selectedDeleteRuntime && !deleteHasCredential && (
                <div className="inline-error">缺少该目标 Runtime 的 SSH 凭据：请先选择/保存 Machine Node，或填写 Manual SSH Override。</div>
              )}
            </div>
          ) : isCreateInstance ? (
            <div className="runtime-drawer-form">
              <section className="selected-machine-summary current-runtime-summary">
                <div>
                  <strong>Current Runtime Host</strong>
                  <span>Instance 会在当前 Runtime 内创建，不选择目标机器。</span>
                </div>
                <KeyValues data={{
                  runtime_id: runtime?.id || "-",
                  channel_url: runtime?.channelUrl || runtime?.endpoint || "-",
                  management_instance: instance.instanceId,
                }} />
              </section>
              <label>
                <span>Instance Repo</span>
                <select
                  value={instanceCreateRepo}
                  onChange={(event) => setInstanceCreateRepo(event.target.value)}
                  disabled={pending || githubReposLoading}
                >
                  <option value="">{githubReposLoading ? "Loading GitHub repos..." : "Select repo from GitHub settings"}</option>
                  {instanceCreateRepo && !githubRepos.some((repo) => repo.fullName === instanceCreateRepo) && (
                    <option value={instanceCreateRepo}>{instanceCreateRepo} · manual</option>
                  )}
                  {githubRepos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}{repo.private ? " · private" : ""}
                    </option>
                  ))}
                </select>
                <span className="field-hint">优先从 Settings 的 GitHub token 拉 repo 列表。列表加载失败时，在 Advanced 里手填 repo。</span>
              </label>
              {githubReposError && <div className="inline-warning">Repo 列表暂不可用：{githubReposError}。可在 Advanced 里手填 repo。</div>}
              <label>
                <span>Instance ID</span>
                <input value={instanceCreateId} onChange={(event) => setInstanceCreateId(event.target.value)} disabled={pending} placeholder={suggestedInstanceCreateId} />
                <span className="field-hint">留空时使用下方建议 ID；需要固定命名时可以直接修改。</span>
              </label>
              <div className="inline-warning">Will create: {resolvedCreateInstanceId || "select a repo first"}。Instance 只是当前 Runtime 上的执行工作空间，不绑定 Workflow Definition。</div>
              <section className="selected-machine-summary current-runtime-summary">
                <div>
                  <strong>Telegram Notification</strong>
                  <span>默认继承 Settings 的全局 TG 配置；可为该 Instance 覆盖 bot 或 chat。</span>
                </div>
                <KeyValues data={{
                  bot_token: inheritedTelegramToken?.present ? `Using global ${inheritedTelegramToken.key}` : "global token missing",
                  chat_id: instanceTelegramChatId || inheritedTelegramChatId || "-",
                }} />
              </section>
              <div className="segmented-control">
                <button type="button" className={instanceTelegramTokenMode === "global" ? "active" : ""} disabled={pending} onClick={() => setInstanceTelegramTokenMode("global")}>Use global bot</button>
                <button type="button" className={instanceTelegramTokenMode === "override" ? "active" : ""} disabled={pending} onClick={() => setInstanceTelegramTokenMode("override")}>Override bot</button>
              </div>
              {instanceTelegramTokenMode === "override" && (
                <label>
                  <span>Telegram Bot Token</span>
                  <input value={instanceTelegramToken} onChange={(event) => setInstanceTelegramToken(event.target.value)} disabled={pending} placeholder="Paste bot token for this Instance" />
                  <span className="field-hint">只用于本次创建，后端会写入 Runtime 本地 env，不写入 registry。</span>
                </label>
              )}
              <label>
                <span>Telegram Chat ID</span>
                <input value={instanceTelegramChatId} onChange={(event) => setInstanceTelegramChatId(event.target.value)} disabled={pending} placeholder={inheritedTelegramChatId || "Use global YOUTUBE_WIKI_TG_CHAT_ID"} />
                <span className="field-hint">默认来自 Settings；改这里即可让该 Instance 通知到不同 chat。</span>
              </label>
              <details className="advanced-runtime-overrides">
                <summary>Advanced Instance Overrides</summary>
                <label>
                  <span>Manual Repo</span>
                  <input value={instanceCreateRepo} onChange={(event) => setInstanceCreateRepo(event.target.value)} disabled={pending} placeholder="owner/repo-name" />
                  <span className="field-hint">仅当 GitHub repo 列表不可用或要使用未列出的 repo 时填写。</span>
                </label>
              </details>
              <RuntimeInheritancePreviewPanel
                preview={inheritance}
                loading={inheritanceLoading}
                error={inheritanceError}
                overrides={createConfigOverrides}
                onOverridesChange={setCreateConfigOverrides}
                onRefresh={onRefreshInheritance}
              />
            </div>
          ) : (
            <div className="runtime-drawer-form">
              <section className="selected-machine-summary current-runtime-summary">
                <div>
                  <strong>Current Runtime Host</strong>
                  <span>Instance 会在当前 Runtime 内删除，不选择目标机器。</span>
                </div>
                <KeyValues data={{
                  runtime_id: runtime?.id || "-",
                  channel_url: runtime?.channelUrl || runtime?.endpoint || "-",
                  management_instance: instance.instanceId,
                }} />
              </section>
              <label>
                <span>Instance Target</span>
                <select
                  value={instanceDeleteId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const target = instances.find((item) => item.instanceId === nextId);
                    setInstanceDeleteId(nextId);
                    setInstanceDeleteRepo(target?.repo || "");
                  }}
                  disabled={pending}
                >
                  <option value="">{instances.length ? "Select instance to delete" : "No instances loaded"}</option>
                  {instances.map((item) => (
                    <option key={item.instanceId} value={item.instanceId}>
                      {item.instanceId}{item.instanceId === "runtime-management" ? " · protected" : ""}{item.repo ? ` · ${item.repo}` : ""}
                    </option>
                  ))}
                  {instanceDeleteId && !instances.some((item) => item.instanceId === instanceDeleteId) && (
                    <option value={instanceDeleteId}>{instanceDeleteId} · manual</option>
                  )}
                </select>
                <span className="field-hint">列表来自当前 Runtime 的 Instance Registry。选择后会自动带出 repo 和 workspace。</span>
              </label>
              {selectedDeleteInstance ? (
                <section className="delete-instance-target-card">
                  <div>
                    <strong>{selectedDeleteInstance.title || selectedDeleteInstance.instanceId}</strong>
                    <span>{selectedDeleteInstance.instanceId}</span>
                  </div>
                  <KeyValues data={{
                    repo: selectedDeleteInstance.repo || "-",
                    wiki_local_path: selectedDeleteInstance.wikiLocalPath || "-",
                    workspace_status: selectedDeleteInstance.workspaceStatus || "-",
                    run_index_status: selectedDeleteInstance.runIndexStatus || "-",
                    latest_run: selectedDeleteInstance.latestExecution?.pipelineId || "-",
                  }} />
                </section>
              ) : (
                <label>
                  <span>Instance Repo</span>
                  <input value={instanceDeleteRepo} onChange={(event) => setInstanceDeleteRepo(event.target.value)} disabled={pending} placeholder="skkeoriw/wiki-sop-old-instance" />
                  <span className="field-hint">仅用于手动目标；从列表选择时不需要填写。</span>
                </label>
              )}
              {protectedDeleteInstance && (
                <div className="inline-error">runtime-management 是默认管理 Instance，不能删除。请先选择业务 Instance。</div>
              )}
              {selectedDeleteInstance && sharedDeleteRefs.length > 0 && (
                <div className="inline-warning shared-workspace-warning">
                  <strong>Shared workspace detected</strong>
                  <span>这些 Instance 共享 repo 或本地目录：{sharedDeleteRefs.map((item) => item.instanceId).join(", ")}。delete-instance 会删除 registry 关系，但后端会跳过 workspace 文件清理。</span>
                </div>
              )}
              <label className="inline-check drawer-inline-check">
                <input type="checkbox" checked={instanceDeleteForce} onChange={(event) => setInstanceDeleteForce(event.target.checked)} disabled={pending} />
                <span>Force when running executions exist</span>
              </label>
            </div>
          )}

          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={onResetDefaults} disabled={pending}>Reset saved</button>
          <button type="button" onClick={onSaveDefaults} disabled={pending}>Save defaults</button>
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className={isCreate ? "primary" : "primary danger-action"} disabled={pending || (isCreate ? !createReady : !(deleteReady && deleteInstanceReady))}>
            {pending ? <Loader2 size={16} className="spin" /> : isCreate ? <Play size={16} /> : <X size={16} />}
            {pending ? "Starting..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function RuntimeInheritancePreviewPanel({
  preview,
  loading,
  error,
  overrides,
  onOverridesChange,
  onRefresh,
  hideCreateRuntimeIdentity = false,
}: {
  preview: RuntimeInheritancePreview | undefined;
  loading: boolean;
  error: string;
  overrides: Record<string, string>;
  onOverridesChange: (value: Record<string, string>) => void;
  onRefresh: () => void;
  hideCreateRuntimeIdentity?: boolean;
}) {
  const items = preview?.items || [];
  const editedCount = Object.values(overrides).filter((value) => value.trim()).length;
  const importantKeys = new Set([
    "GITHUB_TOKEN",
    "DEEPSEEK_API_KEY",
    "WIKI_LLM_PROVIDER",
    "WIKI_DEEPSEEK_MODEL",
    "HERMES_MODEL_PROVIDER",
    "HERMES_MODEL",
    "HERMES_MODEL_BASE_URL",
    "HERMES_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_CLOUD_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_PROJECT_ID",
    "VERTEX_LOCATION",
    "WIKI_VERTEX_MODEL",
    "NOTEBOOKLM_BRIDGE_URL",
    "NOTEBOOKLM_BRIDGE_TOKEN",
    "YOUTUBE_WIKI_TG_TOKEN",
    "YOUTUBE_WIKI_TG_CHAT_ID",
    "CLOUDFLARE_API_KEY",
    "TUNNEL_API",
    "SOP_UI_URL",
    "RUNTIME_TARGET_SSH_COMMAND",
    "RUNTIME_TARGET_PRIVATE_KEY",
    "RUNTIME_TARGET_PRIVATE_KEY_B64",
    "RUNTIME_TARGET_RUNTIME_ID",
    "RUNTIME_TARGET_CHANNEL_URL",
  ]);
  const visibleItems = items.filter((item) => {
    if (hideCreateRuntimeIdentity && CREATE_RUNTIME_IDENTITY_KEYS.has(item.key)) return false;
    return importantKeys.has(item.key) || item.required;
  });
  const updateOverride = (key: string, value: string) => {
    onOverridesChange({ ...overrides, [key]: value });
  };
  const displayResolvedValue = (item: RuntimeInheritancePreview["items"][number]) => {
    if (Object.prototype.hasOwnProperty.call(overrides, item.key)) return overrides[item.key];
    if (item.secret) return "";
    if (item.present) return item.maskedValue;
    return "";
  };
  const placeholderForResolvedValue = (item: RuntimeInheritancePreview["items"][number]) => {
    if (item.present && item.secret) return `已加载：${item.source}${item.maskedValue ? ` (${item.maskedValue})` : ""}；填写则覆盖本次运行`;
    if (item.present) return `已加载：${item.source}`;
    return item.required ? "缺失，直接在这里填写本次运行值" : "可选，留空";
  };
  const statusForItem = (item: RuntimeInheritancePreview["items"][number]) => {
    if (item.key === "GOOGLE_CLOUD_API_KEY" || item.key === "GEMINI_API_KEY") {
      const vertexReady = items.some((candidate) => candidate.key === "GOOGLE_PROJECT_ID" && candidate.present)
        && items.some((candidate) => candidate.key === "VERTEX_LOCATION" && candidate.present)
        && items.some((candidate) => candidate.key === "WIKI_VERTEX_MODEL" && candidate.present);
      if (!item.present && vertexReady) return "optional: Vertex ready";
    }
    if (overrides[item.key]?.trim()) return "edited for this run";
    if (item.present) return item.secret ? "loaded secret" : "loaded";
    return item.required ? "required missing" : "optional missing";
  };
  const groups = [
    ["github", "GitHub"],
    ["hermes", "Hermes"],
    ["llm", "LLM"],
    ["notebooklm", "NotebookLM"],
    ["cloudflare", "Tunnel"],
    ["telegram", "Telegram"],
    ["target", "Target SSH"],
  ] as const;

  return (
    <section className="runtime-inheritance-panel">
      <div className="inheritance-head">
        <div>
          <strong>Resolved Runtime Config</strong>
          <span>这些配置已加载到本次创建空间；可直接编辑覆盖本次运行，留空则继续使用已加载值。</span>
        </div>
        <div className="resolved-config-actions">
          {editedCount > 0 && <span>{editedCount} edited</span>}
          {editedCount > 0 && <button type="button" className="ghost-btn compact" onClick={() => onOverridesChange({})}>Clear edits</button>}
          <button type="button" className="ghost-btn compact" onClick={onRefresh} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </div>
      {error ? <div className="inline-error">{error}</div> : (
        <>
          <div className="inheritance-groups">
            {groups.map(([key, label]) => {
              const ready = Boolean(preview?.groups?.[key]);
              return <span key={key} className={ready ? "ready" : "missing"}>{label}: {ready ? "ready" : "missing"}</span>;
            })}
          </div>
          <div className="inheritance-meta">
            <span>env_file</span>
            <code>{preview?.envFile || (loading ? "loading..." : "unknown")}</code>
          </div>
          <div className="resolved-config-grid" aria-label="Resolved Runtime Config">
            {(loading && !visibleItems.length) ? (
              <label className="resolved-config-field"><span>loading</span><input disabled readOnly value="checking..." /></label>
            ) : visibleItems.map((item) => (
              <label key={item.key} className={`resolved-config-field ${item.present ? "present" : "absent"} ${overrides[item.key]?.trim() ? "edited" : ""}`}>
                <span>
                  <code title={(item.aliases || []).join(", ")}>{item.key}</code>
                  <small>{item.source} · {statusForItem(item)}</small>
                </span>
                <input
                  type="text"
                  value={displayResolvedValue(item)}
                  onChange={(event) => updateOverride(item.key, event.target.value)}
                  placeholder={placeholderForResolvedValue(item)}
                />
              </label>
            ))}
          </div>
          {preview?.note && <span className="field-hint">{preview.note}</span>}
        </>
      )}
    </section>
  );
}

function NodeConfigDrawer({
  nodeId,
  node,
  loading,
  error,
  onClose,
}: {
  nodeId: string;
  node: NodeConfig | undefined;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" role="presentation">
      <aside className="side-drawer node-config-drawer" aria-label="Node configuration">
        <div className="drawer-head">
          <div>
            <h2>{node?.title || nodeId || "节点配置"}</h2>
            <span>{node?.mode || "Node Definition"}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭节点配置" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          {loading ? <Skeleton /> : error ? <div className="inline-error">{error}</div> : !node ? <Empty text="节点配置加载失败" /> : (
            <>
              <DetailBlock title="Executor">
                <KeyValues data={Object.fromEntries(Object.entries(node.executor || {}).filter(([, value]) => value))} />
                {node.skillScript && <div className="kv"><div className="kv-row"><span>script</span><code title={node.skillScript}>{node.skillScript}</code></div></div>}
              </DetailBlock>
              {(node.needs?.length ?? 0) > 0 && (
                <DetailBlock title="Depends On">
                  <div className="needs-list">{node.needs!.map((item) => <span key={item} className="needs-chip">{item}</span>)}</div>
                </DetailBlock>
              )}
              <DetailBlock title="Input Contract">
                <KeyValues data={node.inputs || {}} />
              </DetailBlock>
              <DetailBlock title="Output Contract">
                <KeyValues data={node.outputs || {}} />
              </DetailBlock>
              {node.optionalInputs && Object.keys(node.optionalInputs).length > 0 && (
                <DetailBlock title="Optional Inputs">
                  <KeyValues data={node.optionalInputs} />
                </DetailBlock>
              )}
              <DetailBlock title="Capabilities">
                <div className="capabilities-grid">
                  <CapabilityRow label="TG Notify" enabled={node.infra?.tgNotify !== false} />
                  <CapabilityRow label="Log Record" enabled={node.infra?.logRecord !== false} />
                </div>
              </DetailBlock>
              {node.params && Object.keys(node.params).length > 0 && (
                <DetailBlock title="Params"><KeyValues data={node.params} /></DetailBlock>
              )}
              {node.skillReadme && (
                <DetailBlock title="Skill README">
                  <pre className="log-box">{node.skillReadme}</pre>
                </DetailBlock>
              )}
              {node.manifest && Object.keys(node.manifest).length > 0 && (
                <DetailBlock title="Node Manifest"><KeyValues data={node.manifest} /></DetailBlock>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function NodeManagerInspector({ node, drafts, loading }: { node: NodeRegistryItem | undefined; drafts: NodeDraft[]; loading: boolean }) {
  return (
    <>
      <div className="inspector-head">
        <div className="row">
          <div>
            <h2>{node?.title || "Node Manager"}</h2>
            <span>{node?.nodeId || "选择一个节点查看完整能力"}</span>
          </div>
          {node && <span className={`status-pill ${node.publishEnabled ? "done" : "waiting"}`}>{node.publishEnabled ? "publishable" : "draft only"}</span>}
        </div>
      </div>
      <div className="inspector-body">
        {loading ? <Skeleton /> : !node ? <Empty text="没有选中的节点" /> : (
          <>
            <DetailBlock title="Node Model">
              <KeyValues data={{
                node_id: node.nodeId,
                type: node.case || node.executor?.type || "-",
                mode: node.mode || "-",
                editable: node.editable ? "yes" : "no",
                publish_enabled: node.publishEnabled ? "yes" : "no",
              }} />
            </DetailBlock>

            <DetailBlock title="Skill">
              <KeyValues data={node.skill && Object.keys(node.skill).length ? node.skill : {
                executor_skill: node.executor?.skill || "-",
                install_command: node.executor?.install_command || "-",
              }} />
            </DetailBlock>

            <DetailBlock title="Input Contract">
              <KeyValues data={(node.inputs as Record<string, unknown>) || {}} />
            </DetailBlock>
            <DetailBlock title="Output Contract">
              <KeyValues data={(node.outputs as Record<string, unknown>) || {}} />
            </DetailBlock>

            <DetailBlock title="Attached Capabilities">
              <KeyValues data={node.capabilities || {
                github: { enabled: true },
                telegram: { enabled: node.infra?.tgNotify !== false },
                sse: { enabled: true },
              }} />
            </DetailBlock>

            <DetailBlock title="Actions">
              <KeyValues data={node.actions || {}} />
            </DetailBlock>

            <DetailBlock title="CLI Examples">
              <details className="cli-fold">
                <summary><span>查看远程调用示例</span><ChevronDown size={15} /></summary>
                <div className="cli-list">
                  {Object.entries(node.cli || {}).length ? Object.entries(node.cli || {}).map(([key, value]) => (
                    <div key={key} className="cli-item">
                      <span>{key}</span>
                      <code>{value}</code>
                    </div>
                  )) : <Empty text="该节点暂未返回 CLI 示例" />}
                </div>
              </details>
            </DetailBlock>

            {(node.missingFields || []).length > 0 && (
              <DetailBlock title="Missing Fields">
                <div className="needs-list">{node.missingFields!.map((field) => <span key={field} className="needs-chip">{field}</span>)}</div>
              </DetailBlock>
            )}

            <DetailBlock title={`Drafts · ${drafts.length}`}>
              {drafts.length ? (
                <div className="draft-list">
                  {drafts.slice(0, 5).map((draft) => (
                    <article key={draft.draftId} className="draft-item">
                      <strong>{draft.draftId}</strong>
                      <code>{formatValue(draft.validation)}</code>
                    </article>
                  ))}
                </div>
              ) : <Empty text="还没有节点草稿" />}
            </DetailBlock>
          </>
        )}
      </div>
    </>
  );
}

function CapabilityMini({ node }: { node: NodeRegistryItem }) {
  const caps = node.capabilities || {};
  const github = caps.github === undefined ? true : capabilityEnabled(caps.github);
  const telegram = caps.telegram === undefined ? node.infra?.tgNotify !== false : capabilityEnabled(caps.telegram);
  const sse = caps.sse === undefined ? true : capabilityEnabled(caps.sse);
  return (
    <div className="cap-mini" aria-label="node capabilities">
      <span className={github ? "on" : ""}>GitHub</span>
      <span className={telegram ? "on" : ""}>TG</span>
      <span className={sse ? "on" : ""}>SSE</span>
    </div>
  );
}

function categoryLabel(category: string) {
  if (category === "input") return "Input";
  if (category === "research") return "Research";
  if (category === "build") return "Build";
  if (category === "notify") return "Notify";
  if (category === "custom") return "Custom";
  return category;
}

function nodeGroupLabel(group: string) {
  if (group === "all") return "All nodes";
  if (group === "create-runtime") return "Create Runtime";
  if (group === "delete-runtime") return "Delete Runtime";
  if (group === "create-instance") return "Create Instance";
  if (group === "common") return "Common";
  if (group === "failed") return "Needs review";
  return group;
}

function matchesNodeGroup(node: NodeRegistryItem, group: string): boolean {
  if (group === "all") return true;
  if (group === "failed") return Boolean((node.missingFields || []).length);
  const text = [node.nodeId, node.title, node.description, node.branch, node.case, node.ui?.category].filter(Boolean).join(" ").toLowerCase();
  if (group === "create-runtime") return text.includes("create-runtime") || (text.includes("create") && text.includes("runtime"));
  if (group === "delete-runtime") return text.includes("delete-runtime") || (text.includes("delete") && text.includes("runtime"));
  if (group === "create-instance") return text.includes("create-instance") || (text.includes("create") && text.includes("instance"));
  if (group === "common") return !matchesNodeGroup(node, "create-runtime") && !matchesNodeGroup(node, "delete-runtime") && !matchesNodeGroup(node, "create-instance");
  return true;
}

function contractSummary(node: NodeRegistryItem) {
  const inputs = Object.keys(node.inputs || {});
  const outputs = Object.keys(node.outputs || {});
  const left = inputs.slice(0, 2).join(", ") || "no input";
  const right = outputs.slice(0, 2).join(", ") || "no output";
  return `${left} → ${right}`;
}

function capabilityEnabled(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && value) return (value as Record<string, unknown>).enabled !== false;
  return false;
}

function mergeRuns(serverRuns: Run[], optimisticRuns: Run[], overlays: Record<string, RunOverlay>): Run[] {
  const ids = new Set<string>();
  const ordered = [...optimisticRuns, ...serverRuns].filter((run) => {
    if (ids.has(run.pipelineId)) return false;
    ids.add(run.pipelineId);
    return true;
  });
  return ordered.map((run) => applyRunOverlay(run, overlays[run.pipelineId]));
}

function applyRunOverlay(run: Run, overlay: RunOverlay | undefined): Run {
  if (!overlay) return run;
  return {
    ...run,
    ...overlay,
    nodes: { ...run.nodes, ...(overlay.nodes || {}) },
    nodeStates: { ...(run.nodeStates || {}), ...(overlay.nodeStates || {}) },
  };
}

function createOptimisticRun(pipelineId: string, url: string, repo: string, dag: Dag | undefined): Run {
  const now = new Date().toISOString();
  const firstNode = dag?.nodes[0]?.id || "";
  const nodes = Object.fromEntries((dag?.nodes || []).map((node, index) => [node.id, index === 0 ? "running" : "waiting"])) as Record<string, StageStatus>;
  const nodeStates = firstNode ? { [firstNode]: { status: "running", startedAt: now, progress: 5 } as RunNodeState } : {};
  return {
    pipelineId,
    status: "running",
    sourceUrl: url,
    sourceType: "youtube",
    repo,
    nodes,
    nodeStates,
    startedAt: now,
    updatedAt: now,
    nodeCount: dag?.nodes.length || 0,
    doneCount: 0,
    failedCount: 0,
    runningNode: firstNode,
    progress: 1,
    artifactCount: 0,
    gitEventCount: 0,
    telegramEventCount: 0,
  };
}

function applyStreamEvent(overlays: Record<string, RunOverlay>, pipelineId: string, eventType: string, rawData: string, dag: Dag | undefined): Record<string, RunOverlay> {
  const data = parseEventData(rawData);
  const current = overlays[pipelineId] || { pipelineId };
  const nodes = { ...(current.nodes || {}) };
  const nodeStates = { ...(current.nodeStates || {}) };
  const nodeId = eventNodeId(data);
  const now = new Date().toISOString();
  let next: RunOverlay = { ...current, nodes, nodeStates, updatedAt: now };

  const setNode = (status: StageStatus, progress?: number) => {
    if (!nodeId) return;
    nodes[nodeId] = status;
    nodeStates[nodeId] = { ...(nodeStates[nodeId] || { status }), status, progress: progress ?? nodeStates[nodeId]?.progress };
    next.runningNode = status === "running" ? nodeId : next.runningNode;
  };

  if (eventType === "node.started") setNode("running", 5);
  if (eventType === "node.progress") setNode("running", eventProgress(data));
  if (eventType === "node.completed") setNode("done", 100);
  if (eventType === "node.failed") setNode("failed", 100);
  if (eventType === "node.skipped") setNode("skipped", 100);
  if (eventType === "node.cancelled") setNode("cancelled", 100);
  if (eventType === "artifact.created") next.artifactCount = Number(current.artifactCount || 0) + 1;
  if (eventType === "git.committed" || eventType === "git.failed") next.gitEventCount = Number(current.gitEventCount || 0) + 1;
  if (eventType === "telegram.sent" || eventType === "telegram.failed") next.telegramEventCount = Number(current.telegramEventCount || 0) + 1;
  if (eventType === "run.completed") next = { ...next, status: "done", progress: 100 };
  if (eventType === "run.failed") next = { ...next, status: "failed" };
  if (eventType === "run.cancelled") next = { ...next, status: "cancelled" };

  const total = dag?.nodes.length || Object.keys(nodes).length;
  const done = Object.values(nodes).filter((status) => status === "done").length;
  const failed = Object.values(nodes).filter((status) => status === "failed").length;
  if (total) {
    next.nodeCount = total;
    next.doneCount = done;
    next.failedCount = failed;
    next.progress = Math.max(Number(next.progress || 0), Math.round((done / total) * 100));
  }
  if (!next.status && Object.values(nodes).includes("running")) next.status = "running";
  return { ...overlays, [pipelineId]: next };
}

function parseEventData(rawData: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawData || "{}");
    return typeof parsed === "object" && parsed ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function eventNodeId(data: Record<string, unknown>) {
  return String(data.node_id || data.nodeId || data.stage || data.stage_id || data.node || "");
}

function eventProgress(data: Record<string, unknown>) {
  const value = Number(data.progress ?? data.percent ?? data.progress_pct ?? 20);
  return Number.isFinite(value) ? value : 20;
}

function minimumDelay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildFlowNodes(
  dag: Dag | undefined,
  run: Run | undefined,
  selectedStageId: string,
  onSelect: (id: string) => void,
  onInfo: (id: string) => void
): Node<StageNodeData>[] {
  if (!dag) return [];
  const seenStageIds = new Set<string>();
  const stages = dag.nodes.filter((stage) => {
    if (!stage.id || seenStageIds.has(stage.id)) return false;
    seenStageIds.add(stage.id);
    return true;
  });
  const seenEdgeIds = new Set<string>();
  const edges = dag.edges.filter((edge) => {
    if (!seenStageIds.has(edge.source) || !seenStageIds.has(edge.target)) return false;
    const id = `${edge.source}-${edge.target}`;
    if (seenEdgeIds.has(id)) return false;
    seenEdgeIds.add(id);
    return true;
  });
  const depths = new Map<string, number>();
  const parents = new Map<string, string[]>();
  stages.forEach((node) => parents.set(node.id, []));
  edges.forEach((edge) => parents.set(edge.target, [...(parents.get(edge.target) || []), edge.source]));
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id) || 0;
    const value = (parents.get(id) || []).length ? Math.max(...(parents.get(id) || []).map(depth)) + 1 : 0;
    depths.set(id, value);
    return value;
  };
  const rows = new Map<number, number>();
  return stages.map((stage) => {
    const column = depth(stage.id);
    const row = rows.get(column) || 0;
    rows.set(column, row + 1);
    return {
      id: stage.id,
      type: "stage",
      position: { x: 36 + column * 250, y: 58 + row * 158 },
      data: { stage, status: run?.nodes[stage.id] || "waiting", selected: selectedStageId === stage.id, onSelect, onInfo }
    };
  });
}

function buildFlowEdges(dag: Dag | undefined, run: Run | undefined): Edge[] {
  const nodeIds = new Set((dag?.nodes || []).map((node) => node.id).filter(Boolean));
  const edgeIds = new Set<string>();
  return (dag?.edges || []).filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
    const id = `${edge.source}-${edge.target}`;
    if (edgeIds.has(id)) return false;
    edgeIds.add(id);
    return true;
  }).map((edge) => ({
    id: `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    animated: run?.nodes[edge.target] === "running"
  }));
}

function Metric({ label, value, subtext }: { label: string; value: string | number; subtext: string }) {
  return <div className="metric-panel"><span>{label}</span><strong>{value}</strong><small>{subtext}</small></div>;
}

function DetailBlock({ title, children }: { title: string | React.ReactNode; children: React.ReactNode }) {
  return <section className="detail-block"><div className="section-title"><span>{title}</span></div>{children}</section>;
}

function StepList({ items, status }: { items: string[]; status: StageStatus }) {
  const steps = items.filter(Boolean);
  if (!steps.length) return <Empty text="该节点暂未配置执行步骤说明" />;
  return (
    <ol className="node-step-list">
      {steps.map((item, index) => (
        <li key={`${item}-${index}`} className={status === "failed" ? "failed" : status === "done" ? "done" : ""}>
          <span>{index + 1}</span>
          <p>{item}</p>
        </li>
      ))}
    </ol>
  );
}

function InfoList({ items, emptyText }: { items: Array<Record<string, unknown>>; emptyText: string }) {
  if (!items.length) return <Empty text={emptyText} />;
  return (
    <div className="node-info-list">
      {items.map((item, index) => (
        <div key={`${String(item.key || item.label || index)}-${index}`} className="node-info-row">
          <strong>{String(item.label || item.key || `item-${index + 1}`)}</strong>
          <code>{formatValue(item.value ?? item.source ?? item)}</code>
        </div>
      ))}
    </div>
  );
}

function TroubleshootingBlock({ nodeDetail }: { nodeDetail: NodeDetail | undefined }) {
  const hints = nodeDetail?.troubleshooting?.failureHints || [];
  const validation = nodeDetail?.troubleshooting?.validation || nodeDetail?.validation;
  return (
    <div className="troubleshooting-block">
      <KeyValues data={{
        safe_to_retry: nodeDetail?.troubleshooting?.safeToRetry ?? nodeDetail?.retryable ?? "-",
        retryable: nodeDetail?.troubleshooting?.retryable ?? nodeDetail?.retryable ?? "-",
        validation: validation ? formatValue(validation) : "-",
      }} />
      {nodeDetail?.error && <pre className="log-box error-log">{nodeDetail.error}</pre>}
      {hints.length ? (
        <ul className="hint-list">
          {hints.map((hint, index) => <li key={`${hint}-${index}`}>{hint}</li>)}
        </ul>
      ) : <Empty text="该节点暂未配置排障建议" />}
      {nodeDetail?.manualFixHint && <pre className="log-box">{nodeDetail.manualFixHint}</pre>}
    </div>
  );
}

function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <Empty text="没有数据" />;
  return <div className="kv">{entries.map(([key, value]) => <div key={key} className="kv-row"><span>{key}</span><code>{formatValue(value)}</code></div>)}</div>;
}

function ActionList({ actions }: { actions: Record<string, unknown> }) {
  const entries = Object.entries(actions || {});
  if (!entries.length) return <Empty text="没有操作定义" />;
  return (
    <div className="action-list">
      {entries.map(([name, value]) => {
        const action = typeof value === "object" && value ? value as Record<string, unknown> : {};
        const enabled = action.enabled !== false;
        const destructive = action.destructive === true;
        return (
          <div key={name} className="action-item">
            <div>
              <strong>{name}</strong>
              <code>{String(action.path || "-")}</code>
            </div>
            <span className="action-meta">
              <span>{String(action.method || "-")}</span>
              <span className={`status-pill ${enabled ? "done" : "waiting"}`}>{enabled ? "enabled" : "disabled"}</span>
              {destructive && <span className="status-pill failed">confirm</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatJsonForEditor(value: unknown) {
  if (!value || (typeof value === "object" && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).length === 0)) return "{}";
  return JSON.stringify(value, null, 2);
}

function parseEditorObject(label: string, value: string) {
  const text = value.trim();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function ValidationSummary({ validation }: { validation: { status: string; missingOutputs: string[]; unexpectedOutputs: string[] } }) {
  const ok = validation.status === "passed";
  return (
    <div className={`validation-summary ${ok ? "passed" : "warn"}`}>
      <div className="row"><strong>{ok ? "Contract passed" : "Contract warning"}</strong><span className={`status-pill ${ok ? "done" : "waiting"}`}>{validation.status}</span></div>
      {validation.missingOutputs.length > 0 && <p>缺失输出：{validation.missingOutputs.join(", ")}</p>}
      {!validation.missingOutputs.length && !validation.unexpectedOutputs.length && <p>声明输出均已解析到实际产物。</p>}
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  const [openId, setOpenId] = useState("");
  if (!artifacts.length) return <Empty text="该节点暂无 Artifact 记录" />;
  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <article key={artifact.id} className="artifact-item">
          <button type="button" className="artifact-head" onClick={() => setOpenId(openId === artifact.id ? "" : artifact.id)}>
            <div><strong>{artifact.title}</strong><span>{artifact.type} · {artifact.format} · {formatBytes(artifact.size)}</span></div>
            <span className={`resolution ${artifact.resolution}`}>{artifact.resolution}</span>
          </button>
          <code>{artifact.path}</code>
          {artifact.tags.length > 0 && <div className="artifact-tags">{artifact.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
          {openId === artifact.id && <pre className="artifact-preview">{artifact.preview || "该 Artifact 暂不支持内联预览。"}</pre>}
        </article>
      ))}
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(value: number) {
  if (!value) return "-";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function LoadingOrEmpty({ loading, text }: { loading: boolean; text: string }) {
  return loading ? <Skeleton /> : <Empty text={text} />;
}

function Skeleton() {
  return <div className="skeleton" aria-label="loading"><i /><i /><i /></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
