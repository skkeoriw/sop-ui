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
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
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
  NodeConfig,
  NodeEvent,
  MachineConfig,
  NodeLog,
  NodeModule,
  NodeModuleDetail,
  NodeRegistryItem,
  NodeContract,
  NodeTestResult,
  Run,
  RunNodeState,
  RuntimeInheritancePreview,
  Runtime,
  SopDataProvider,
  StageStatus
} from "./data/types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";
type AppView = "runtime" | "instance" | "workflow" | "nodes" | "settings";
type AppRoute = { view: AppView; nodeId: string; pipelineId: string; artifactId: string; moduleId: string };
type StreamStatus = "live" | "reconnecting" | "polling fallback" | "closed";
type RunOverlay = Partial<Omit<Run, "pipelineId" | "nodes" | "nodeStates">> & {
  pipelineId: string;
  nodes?: Record<string, StageStatus>;
  nodeStates?: Record<string, RunNodeState>;
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

const statusOrder: StageStatus[] = ["running", "waiting", "failed", "skipped", "done"];
const DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND = "ssh -i ~/.ssh/id_ed25519 a01020323900@34.29.222.183";
const DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID = "runtime-34-29-222-183";
const GLOBAL_TUNNEL_API_URL = "https://tunnel-api.chxyka.ccwu.cc";
const GLOBAL_TUNNEL_ADMIN_URL = "https://tunnel-admin-9vt.pages.dev";
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
  deleteRuntimeId: string;
  deleteSshCommand: string;
  deletePrivateKey: string;
  deleteForce: boolean;
  instanceId: string;
  instanceRepo: string;
  instanceSopType: string;
  deleteInstanceId: string;
  deleteInstanceRepo: string;
  deleteInstanceForce: boolean;
};

function stringFromStorage(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readRuntimeManagementFormDefaults(): RuntimeManagementFormDefaults {
  const defaults = {
    createSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
    createPrivateKey: "",
    createEnvText: "",
    deleteRuntimeId: DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID,
    deleteSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
    deletePrivateKey: "",
    deleteForce: false,
    instanceId: "wiki-sop-new-instance",
    instanceRepo: "skkeoriw/wiki-sop-new-instance",
    instanceSopType: "youtube-research-wiki",
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
      deleteRuntimeId: stringFromStorage(stored.deleteRuntimeId, defaults.deleteRuntimeId),
      deleteSshCommand: stringFromStorage(stored.deleteSshCommand, defaults.deleteSshCommand),
      deletePrivateKey: stringFromStorage(stored.deletePrivateKey, defaults.deletePrivateKey),
      deleteForce: Boolean(stored.deleteForce),
      instanceId: stringFromStorage(stored.instanceId, defaults.instanceId),
      instanceRepo: stringFromStorage(stored.instanceRepo, defaults.instanceRepo),
      instanceSopType: stringFromStorage(stored.instanceSopType, defaults.instanceSopType),
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

function readRoute(): AppRoute {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const empty = { nodeId: "", pipelineId: "", artifactId: "", moduleId: "" };
  if (parts[0] === "runtimes") {
    if (parts[2] === "instances" && parts[4] === "workflow") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[6] || ""), nodeId: decodeURIComponent(parts[7] || "") };
    if (parts[2] === "instances" && parts[4] === "executions") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[5] || ""), nodeId: decodeURIComponent(parts[7] || "") };
    if (parts[2] === "instances" && parts[4] === "nodes") return { view: "nodes", ...empty, nodeId: decodeURIComponent(parts[5] || ""), moduleId: parts[6] === "modules" ? decodeURIComponent(parts[7] || "") : "" };
    if (parts[2] === "instances" && parts[3]) return { view: "instance", ...empty };
    return { view: "runtime", ...empty };
  }
  if (parts[0] === "instances") return { view: parts[2] === "workflow" ? "workflow" : "instance", ...empty, pipelineId: decodeURIComponent(parts[4] || ""), nodeId: decodeURIComponent(parts[5] || "") };
  if (parts[0] === "runs") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[1] || ""), nodeId: decodeURIComponent(parts[2] || "") };
  if (parts[0] === "workflow") {
    const offset = parts[1] === "runs" ? 2 : 1;
    return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[offset] || ""), nodeId: decodeURIComponent(parts[offset + 1] || "") };
  }
  if (parts[0] === "nodes") {
    return { view: "nodes", ...empty, nodeId: decodeURIComponent(parts[1] || ""), moduleId: parts[2] === "modules" ? decodeURIComponent(parts[3] || "") : "" };
  }
  if (parts[0] === "artifacts") return { view: "workflow", ...empty, pipelineId: decodeURIComponent(parts[1] || ""), artifactId: decodeURIComponent(parts[2] || "") };
  if (parts[0] === "settings") return { view: "settings", ...empty };
  return { view: "workflow", ...empty };
}

function routePath(view: AppView, entityId = "", secondaryId = "") {
  if (view === "runtime") return "/runtimes";
  if (view === "instance") return "/instances";
  if (view === "nodes") return entityId ? `/nodes/${encodeURIComponent(entityId)}${secondaryId ? `/modules/${encodeURIComponent(secondaryId)}` : ""}` : "/nodes";
  if (view === "workflow") return entityId ? `/workflow/runs/${encodeURIComponent(entityId)}${secondaryId ? `/${encodeURIComponent(secondaryId)}` : ""}` : "/workflow";
  return "/settings";
}

function readRouteContext() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "runtimes") {
    return {
      runtimeId: decodeURIComponent(parts[1] || ""),
      instanceId: parts[2] === "instances" ? decodeURIComponent(parts[3] || "") : "",
    };
  }
  return { runtimeId: "", instanceId: "" };
}

function inspectorTabLabel(tab: InspectorTab) {
  if (tab === "config") return "Definition";
  if (tab === "run") return "Execution";
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
    ["inputs", "Inputs", "输入契约和当前 Run 的 resolved inputs", `${Object.keys(node.inputs || {}).length} inputs`],
    ["outputs", "Outputs", "输出契约、实际输出和校验结果", `${Object.keys(node.outputs || {}).length} outputs`],
    ["artifacts", "Artifacts", "当前 Run 的记录产物和候选产物", "run-scoped artifacts"],
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

/** Self-contained single-node test surface, mounted in BOTH the asset center
 *  node panel and a Run's node panel. Reads the engine contract for dependency
 *  badges + guards, and launches an isolated --test run via the SPI trigger. */
function isSecretField(name: string): boolean {
  return /key|token|secret|password|private/i.test(name);
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
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [seedRunId, setSeedRunId] = useState("");
  const [confirmMutating, setConfirmMutating] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<NodeTestResult | null>(null);
  const [testPipelineId, setTestPipelineId] = useState("");
  const [error, setError] = useState("");

  const contractQuery = useQuery({
    queryKey: queryKeys.nodeContract(mode, runtime, instanceId, nodeId),
    queryFn: () => provider.getNodeContract(runtime!, instanceId, nodeId),
    enabled: Boolean(runtime && instanceId && nodeId),
  });
  const contract = contractQuery.data;

  const testMutation = useMutation({
    mutationFn: () => {
      const overrides: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fieldValues)) {
        if (v.trim()) overrides[k] = v.trim();
      }
      return provider.triggerNodeTest(runtime!, instanceId, nodeId, {
        requestOverrides: overrides,
        seedFromRunId: seedRunId || undefined,
        fromRunId: runId || undefined,
        confirmMutating,
        dryRun,
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setError("");
      setTestPipelineId(r.status === "triggered" && r.pipelineId ? r.pipelineId : "");
    },
    onError: (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setTestPipelineId(""); },
  });

  // Poll the isolated test's outcome until it reaches a terminal status.
  const testResultQuery = useQuery({
    queryKey: queryKeys.nodeTestResult(mode, runtime, instanceId, nodeId, testPipelineId),
    queryFn: () => provider.getNodeTestResult(runtime!, instanceId, nodeId, testPipelineId),
    enabled: Boolean(runtime && instanceId && testPipelineId),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return !s || s === "running" ? 1500 : false;
    },
  });
  const testRun = testResultQuery.data;

  if (contractQuery.isLoading) return <div className="node-test-panel muted">加载节点契约…</div>;
  if (!contract) return <div className="node-test-panel muted">该节点没有引擎契约，暂不支持独立测试。</div>;

  const isMutating = contract.sideEffect === "mutating";
  const needsSeed = contract.depClass === "artifact_dependent";
  const requestInputs = contract.requestInputs || [];
  // confirm is only required for a REAL run of a mutating node (dry-run is exempt).
  const needsConfirm = isMutating && !dryRun;
  const blockedByConfirm = needsConfirm && !confirmMutating;
  const blockedBySeed = needsSeed && !seedRunId;

  return (
    <div className="node-test-panel">
      <NodeDepBadges contract={contract} />
      {contract.statePreconditions && contract.statePreconditions.length ? (
        <div className="node-test-pre">前置节点：{contract.statePreconditions.map((p) => p.node).join("、")}</div>
      ) : null}
      {contract.artifactDeps && contract.artifactDeps.length ? (
        <div className="node-test-pre">回读产物：{contract.artifactDeps.map((a) => a.file).join("、")}</div>
      ) : null}
      {runId ? (
        <div className="node-test-pre">基于本 Run 的请求执行（目标机 / SSH 凭据沿用 <code>{runId}</code>）</div>
      ) : null}
      <div className="node-test-form">
        {requestInputs.length ? requestInputs.map((field) => (
          <label key={field}>{field}
            <input
              type={isSecretField(field) ? "password" : "text"}
              value={fieldValues[field] || ""}
              onChange={(e) => setFieldValues((prev) => ({ ...prev, [field]: e.target.value }))}
              placeholder={isSecretField(field) ? "留空 = 沿用当前配置；填写 = 覆盖本次" : "留空 = 沿用当前配置"}
              autoComplete="off"
            />
          </label>
        )) : (
          <div className="node-test-pre muted">该节点无需额外入参（沿用当前配置 / 本 Run 请求）。</div>
        )}
        {needsSeed ? (
          <label>Seed 来源 Run
            <select value={seedRunId} onChange={(e) => setSeedRunId(e.target.value)}>
              <option value="">选择历史 Run 作为产物来源</option>
              {runs.map((r) => (
                <option key={r.pipelineId} value={r.pipelineId}>{r.pipelineId}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="inline">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> dry-run 演练（不真正改动目标机）
        </label>
        {needsConfirm ? (
          <label className="inline danger">
            <input type="checkbox" checked={confirmMutating} onChange={(e) => setConfirmMutating(e.target.checked)} />
            确认：真实执行，该节点会改动目标机
          </label>
        ) : null}
      </div>
      <button
        className="btn primary"
        disabled={testMutation.isPending || blockedByConfirm || blockedBySeed}
        onClick={() => testMutation.mutate()}
      >
        <Play size={14} /> {dryRun ? "演练此节点" : "执行此节点"}
      </button>
      {blockedByConfirm ? <span className="node-test-hint">真实执行 mutating 节点前需勾选确认（或改用 dry-run 演练）</span> : null}
      {blockedBySeed ? <span className="node-test-hint">需选择 seed 来源 Run</span> : null}
      {result && result.status !== "triggered" ? (
        <div className="node-test-result warn">未启动：{result.reason || result.status}</div>
      ) : null}
      {testPipelineId ? (
        <div className={`node-test-result ${testRun?.status === "done" ? "ok" : testRun?.status && testRun.status !== "running" ? "err" : "warn"}`}>
          <div>
            隔离测试 <code>{testPipelineId}</code> ·{" "}
            {!testRun || testRun.status === "running"
              ? "执行中…"
              : <strong>{testRun.status}</strong>}
          </div>
          {testRun && testRun.status && testRun.status !== "running" ? (
            <div className="node-test-detail">
              {Object.entries(testRun.detail || {})
                .filter(([k]) => ["ok", "ssh_ok", "permission_ok", "disk_ok", "http_status", "accepted", "target_url", "route"].includes(k))
                .map(([k, v]) => (
                  <span key={k} className={`kv ${v === true ? "good" : v === false ? "bad" : ""}`}>{k}: {String(v)}</span>
                ))}
              {typeof testRun.detail?.stdout === "string" && testRun.detail.stdout ? (
                <pre className="node-test-stdout">{String(testRun.detail.stdout).slice(0, 600)}</pre>
              ) : null}
              {testRun.reason ? <div className="node-test-reason">原因：{testRun.reason}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="node-test-result err">{error}</div> : null}
    </div>
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
  const time = event.ts ? event.ts.slice(11, 19) : "";
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
  const initialEndpoint = useMemo(() => normalizeEndpoint(new URL(window.location.href).searchParams.get("endpoint") || ""), []);
  const initialManualRuntime = useMemo<Runtime | undefined>(() => initialEndpoint ? ({
    id: `manual:${initialEndpoint}`, name: initialEndpoint.replace(/^https?:\/\//, ""), endpoint: initialEndpoint,
    status: "manual", localStatus: "unknown", manual: true
  }) : undefined, [initialEndpoint]);
  const [manualRuntime, setManualRuntime] = useState<Runtime | undefined>(initialManualRuntime);
  const [manualEndpoint, setManualEndpoint] = useState(initialEndpoint);
  const [runtimeId, setRuntimeId] = useState(initialManualRuntime?.id || "");
  const [instanceId, setInstanceId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("config");
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerUrl, setTriggerUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const runtimeManagementDefaults = useMemo(readRuntimeManagementFormDefaults, []);
  const [runtimeManagementAction, setRuntimeManagementAction] = useState<RuntimeManagementAction>("create-runtime");
  const [runtimeCreateSshCommand, setRuntimeCreateSshCommand] = useState(runtimeManagementDefaults.createSshCommand);
  const [runtimeCreatePrivateKey, setRuntimeCreatePrivateKey] = useState(runtimeManagementDefaults.createPrivateKey);
  const [runtimeCreateEnvText, setRuntimeCreateEnvText] = useState(runtimeManagementDefaults.createEnvText);
  const [runtimeCreateConfigOverrides, setRuntimeCreateConfigOverrides] = useState<Record<string, string>>({});
  const [runtimeCreateMachineId, setRuntimeCreateMachineId] = useState("");
  const [runtimeDeleteId, setRuntimeDeleteId] = useState(runtimeManagementDefaults.deleteRuntimeId);
  const [runtimeDeleteSshCommand, setRuntimeDeleteSshCommand] = useState(runtimeManagementDefaults.deleteSshCommand);
  const [runtimeDeletePrivateKey, setRuntimeDeletePrivateKey] = useState(runtimeManagementDefaults.deletePrivateKey);
  const [runtimeDeleteMachineId, setRuntimeDeleteMachineId] = useState("");
  const [runtimeDeleteForce, setRuntimeDeleteForce] = useState(runtimeManagementDefaults.deleteForce);
  const [instanceCreateId, setInstanceCreateId] = useState(runtimeManagementDefaults.instanceId);
  const [instanceCreateRepo, setInstanceCreateRepo] = useState(runtimeManagementDefaults.instanceRepo);
  const [instanceCreateSopType, setInstanceCreateSopType] = useState(runtimeManagementDefaults.instanceSopType);
  const [instanceDeleteId, setInstanceDeleteId] = useState(runtimeManagementDefaults.deleteInstanceId);
  const [instanceDeleteRepo, setInstanceDeleteRepo] = useState(runtimeManagementDefaults.deleteInstanceRepo);
  const [instanceDeleteForce, setInstanceDeleteForce] = useState(runtimeManagementDefaults.deleteInstanceForce);
  const [managementConfigValues, setManagementConfigValues] = useState<Record<string, string>>({});
  const [machineName, setMachineName] = useState("");
  const [machineSshCommand, setMachineSshCommand] = useState("");
  const [machineAuthType, setMachineAuthType] = useState<"private_key" | "password">("private_key");
  const [machinePrivateKey, setMachinePrivateKey] = useState("");
  const [machinePassword, setMachinePassword] = useState("");
  const [toast, setToast] = useState("");
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [nodeConfigId, setNodeConfigId] = useState("");
  const [rawLogOpen, setRawLogOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("closed");
  const [optimisticRuns, setOptimisticRuns] = useState<Run[]>([]);
  const [runOverlays, setRunOverlays] = useState<Record<string, RunOverlay>>({});
  const [executionSearch, setExecutionSearch] = useState("");
  const [executionFilter, setExecutionFilter] = useState<"all" | StageStatus>("all");
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

  const runtimesQuery = useQuery({ queryKey: queryKeys.runtimes(mode), queryFn: () => provider.listRuntimes(), retry: 1 });
  const runtimes = useMemo(() => {
    const items = runtimesQuery.data || [];
    return manualRuntime && !items.some((item) => item.endpoint === manualRuntime.endpoint) ? [manualRuntime, ...items] : items;
  }, [manualRuntime, runtimesQuery.data]);
  const runtime = runtimes.find((item) => item.id === runtimeId) || runtimes[0];

  const instancesQuery = useQuery({ queryKey: queryKeys.instances(mode, runtime), queryFn: () => provider.listInstances(runtime), enabled: Boolean(runtime) });
  const instances = instancesQuery.data || [];
  const instance = instances.find((item) => item.instanceId === instanceId) || instances[0];
  const managementInstance = instances.find((item) => item.instanceId === "runtime-management" || item.sopType === "runtime-management");
  const isRuntimeManagementInstance = Boolean(instance && (instance.instanceId === "runtime-management" || instance.sopType === "runtime-management"));
  const currentRuntimeManagementDefaults = (): RuntimeManagementFormDefaults => ({
    createSshCommand: runtimeCreateSshCommand,
    createPrivateKey: runtimeCreatePrivateKey,
    createEnvText: runtimeCreateEnvText,
    deleteRuntimeId: runtimeDeleteId,
    deleteSshCommand: runtimeDeleteSshCommand,
    deletePrivateKey: runtimeDeletePrivateKey,
    deleteForce: runtimeDeleteForce,
    instanceId: instanceCreateId,
    instanceRepo: instanceCreateRepo,
    instanceSopType: instanceCreateSopType,
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
      deleteRuntimeId: DEFAULT_RUNTIME_MANAGEMENT_RUNTIME_ID,
      deleteSshCommand: DEFAULT_RUNTIME_MANAGEMENT_SSH_COMMAND,
      deletePrivateKey: "",
      deleteForce: false,
      instanceId: "wiki-sop-new-instance",
      instanceRepo: "skkeoriw/wiki-sop-new-instance",
      instanceSopType: "youtube-research-wiki",
      deleteInstanceId: "wiki-sop-new-instance",
      deleteInstanceRepo: "skkeoriw/wiki-sop-new-instance",
      deleteInstanceForce: false,
    };
    window.localStorage.removeItem(RUNTIME_MANAGEMENT_FORM_STORAGE_KEY);
    setRuntimeCreateSshCommand(cleanDefaults.createSshCommand);
    setRuntimeCreatePrivateKey(cleanDefaults.createPrivateKey);
    setRuntimeCreateEnvText(cleanDefaults.createEnvText);
    setRuntimeDeleteId(cleanDefaults.deleteRuntimeId);
    setRuntimeDeleteSshCommand(cleanDefaults.deleteSshCommand);
    setRuntimeDeletePrivateKey(cleanDefaults.deletePrivateKey);
    setRuntimeDeleteForce(cleanDefaults.deleteForce);
    setInstanceCreateId(cleanDefaults.instanceId);
    setInstanceCreateRepo(cleanDefaults.instanceRepo);
    setInstanceCreateSopType(cleanDefaults.instanceSopType);
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
      deleteRuntimeId: runtimeDeleteId,
      deleteSshCommand: runtimeDeleteSshCommand,
      deletePrivateKey: runtimeDeletePrivateKey,
      deleteForce: runtimeDeleteForce,
      instanceId: instanceCreateId,
      instanceRepo: instanceCreateRepo,
      instanceSopType: instanceCreateSopType,
      deleteInstanceId: instanceDeleteId,
      deleteInstanceRepo: instanceDeleteRepo,
      deleteInstanceForce: instanceDeleteForce,
    });
  }, [
    runtimeCreateSshCommand,
    runtimeCreatePrivateKey,
    runtimeCreateEnvText,
    runtimeDeleteId,
    runtimeDeleteSshCommand,
    runtimeDeletePrivateKey,
    runtimeDeleteForce,
    instanceCreateId,
    instanceCreateRepo,
    instanceCreateSopType,
    instanceDeleteId,
    instanceDeleteRepo,
    instanceDeleteForce,
  ]);

  const dagQuery = useQuery({ queryKey: queryKeys.dag(mode, runtime, instance?.instanceId || ""), queryFn: () => provider.getDag(runtime, instance.instanceId), enabled: Boolean(runtime && instance) });
  const runtimeInheritanceQuery = useQuery({
    queryKey: ["runtime-inheritance", mode, runtime?.id || "", managementInstance?.instanceId || ""],
    queryFn: () => provider.getRuntimeInheritance(runtime!, managementInstance!.instanceId),
    enabled: Boolean(runtime && managementInstance),
    retry: 1,
  });
  const runtimeManagementConfigQuery = useQuery({
    queryKey: ["control-plane-settings", mode],
    queryFn: () => controlPlaneProvider.getSettings(),
    enabled: viewMode === "settings",
    retry: 1,
  });
  const machinesQuery = useQuery({
    queryKey: ["control-plane-machines", mode],
    queryFn: () => controlPlaneProvider.listMachines(),
    enabled: viewMode === "settings" || triggerOpen,
    retry: 1,
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.runs(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listRuns(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === "running") && streamStatus !== "live" ? 15000 : false)
  });
  const serverRuns = runsQuery.data || [];
  const runs = useMemo(() => mergeRuns(serverRuns, optimisticRuns, runOverlays), [serverRuns, optimisticRuns, runOverlays]);
  const routeRunMissing = Boolean(selectedRunId && runs.length && !runs.some((run) => run.pipelineId === selectedRunId));
  const selectedRunSummary = selectedRunId ? runs.find((run) => run.pipelineId === selectedRunId) : runs[0];

  const runQuery = useQuery({
    queryKey: queryKeys.run(mode, runtime, instance?.instanceId || "", selectedRunSummary?.pipelineId || ""),
    queryFn: () => provider.getRun(runtime!, instance!.instanceId, selectedRunSummary!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRunSummary),
    refetchInterval: (query) => (query.state.data?.status === "running" && streamStatus !== "live" ? 15000 : false)
  });
  const selectedRun = runQuery.data || selectedRunSummary;
  const runDagQuery = useQuery({
    queryKey: queryKeys.runDag(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunDag(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun),
    retry: false,
  });
  const runEventsQuery = useQuery({
    queryKey: queryKeys.runEvents(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunEvents(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun),
    refetchInterval: selectedRun?.status === "running" && streamStatus !== "live" ? 15000 : false,
  });
  const runArtifactsQuery = useQuery({
    queryKey: queryKeys.runArtifacts(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getRunArtifacts(runtime!, instance!.instanceId, selectedRun!.pipelineId),
    enabled: Boolean(runtime && instance && selectedRun),
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
    enabled: Boolean(runtime && instance && selectedRun && selectedStage)
  });
  const logQuery = useQuery({
    queryKey: queryKeys.log(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || "", selectedStageKey),
    queryFn: () => provider.getNodeLog(runtime!, instance!.instanceId, selectedRun!.pipelineId, selectedStageKey),
    enabled: Boolean(runtime && instance && selectedRun && selectedStage && viewMode === "workflow")
  });
  const nodeConfigQuery = useQuery({
    queryKey: queryKeys.nodeConfig(mode, runtime, instance?.instanceId || "", nodeConfigId),
    queryFn: () => provider.getNodeConfig(runtime!, instance!.instanceId, nodeConfigId),
    enabled: Boolean(runtime && instance && showNodeConfig && nodeConfigId)
  });
  const nodesQuery = useQuery({
    queryKey: queryKeys.nodes(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listNodes(runtime!, instance!.instanceId),
    enabled: Boolean(runtime && instance)
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
  const selectedNodeModule = selectedNodeModules.find((module) => module.id === selectedNodeModuleId) || selectedNodeModules[0];
  const nodeModuleQuery = useQuery({
    queryKey: queryKeys.nodeModule(mode, runtime, instance?.instanceId || "", selectedManagedNode?.nodeId || "", selectedNodeModule?.id || "", selectedRun?.pipelineId || ""),
    queryFn: () => provider.getNodeModule(runtime!, instance!.instanceId, selectedManagedNode!.nodeId, selectedNodeModule!.id, selectedRun?.pipelineId),
    enabled: Boolean(runtime && instance && selectedManagedNode && selectedNodeModule && viewMode === "nodes"),
  });
  const nodeFilters = useMemo(() => {
    const values = new Set<string>();
    managedNodes.forEach((node) => values.add(String(node.ui?.category || "custom")));
    return ["all", ...["input", "research", "build", "notify", "custom"].filter((value) => values.has(value))];
  }, [managedNodes]);
  const visibleManagedNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    return managedNodes.filter((node) => {
      const category = String(node.ui?.category || "custom");
      const searchable = [node.nodeId, node.title, node.description, category, node.case, node.executor?.type].filter(Boolean).join(" ").toLowerCase();
      return (nodeFilter === "all" || nodeFilter === category) && (!query || searchable.includes(query));
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
      setToast("Execution starting...");
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
      setToast(realId ? `Execution started: ${shortId(realId)}` : "Execution started");
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
      setToast(`Execution failed: ${String((error as Error).message || error)}`);
    }
  });

  const createRuntimeMutation = useMutation({
    mutationFn: async () => {
      if (!managementInstance) throw new Error("当前 Runtime 没有 runtime-management instance");
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "create-runtime",
          machine_id: runtimeCreateMachineId || undefined,
          ssh_command: runtimeCreateSshCommand,
          private_key_b64: encodeSecretB64(runtimeCreatePrivateKey),
          ...parseRuntimeEnvOverrides(runtimeCreateEnvText),
          ...Object.fromEntries(Object.entries(runtimeCreateConfigOverrides).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
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
      setTriggerOpen(false);
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
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "delete-runtime",
          machine_id: runtimeDeleteMachineId || undefined,
          runtime_id: runtimeDeleteId,
          ssh_command: runtimeDeleteSshCommand,
          private_key_b64: encodeSecretB64(runtimeDeletePrivateKey),
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
      setTriggerOpen(false);
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
      const instancePayload = {
        instance_id: instanceCreateId.trim(),
        repo: instanceCreateRepo.trim(),
        sop_type: instanceCreateSopType.trim() || "youtube-research-wiki",
        enabled: true,
      };
      if (!instancePayload.instance_id) throw new Error("请填写 Instance ID");
      if (!instancePayload.repo) throw new Error("请填写 Instance Repo");
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "create-instance",
          machine_id: runtimeCreateMachineId || undefined,
          runtime_id: runtime?.id || runtimeId,
          channel_url: runtime?.channelUrl || runtime?.endpoint,
          ssh_command: runtimeCreateSshCommand,
          private_key_b64: encodeSecretB64(runtimeCreatePrivateKey),
          instance_id: instancePayload.instance_id,
          repo: instancePayload.repo,
          instance_repo: instancePayload.repo,
          instance_sop_type: instancePayload.sop_type,
          instances: [instancePayload],
          ...parseRuntimeEnvOverrides(runtimeCreateEnvText),
          ...Object.fromEntries(Object.entries(runtimeCreateConfigOverrides).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
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
      setTriggerOpen(false);
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
      const targetRepo = instanceDeleteRepo.trim() || `skkeoriw/${targetId}`;
      const [result] = await Promise.all([
        provider.triggerRun(runtime, managementInstance.instanceId, {
          action: "delete-instance",
          machine_id: runtimeDeleteMachineId || undefined,
          runtime_id: runtime?.id || runtimeId,
          channel_url: runtime?.channelUrl || runtime?.endpoint,
          ssh_command: runtimeDeleteSshCommand,
          private_key_b64: encodeSecretB64(runtimeDeletePrivateKey),
          instance_id: targetId,
          repo: targetRepo,
          instance_repo: targetRepo,
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
      setTriggerOpen(false);
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
          name: machineName.trim() || machineSshCommand.trim(),
          sshCommand: machineSshCommand.trim(),
          authType: machineAuthType,
          privateKey: machineAuthType === "private_key" ? machinePrivateKey : "",
          password: machineAuthType === "password" ? machinePassword : "",
        }),
        minimumDelay(300),
      ]);
      return result;
    },
    onSuccess: async () => {
      setMachineName("");
      setMachineSshCommand("");
      setMachinePrivateKey("");
      setMachinePassword("");
      setToast("机器节点已保存到 Control Plane D1");
      await machinesQuery.refetch();
    },
    onError: (error) => {
      setToast(`机器节点保存失败：${String((error as Error).message || error)}`);
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
    const routePrefixes = ["/runtimes", "/instances", "/overview", "/runs", "/workflow", "/nodes", "/artifacts", "/settings"];
    if (window.location.pathname === "/" || !routePrefixes.some((prefix) => window.location.pathname === prefix || window.location.pathname.startsWith(`${prefix}/`))) {
      window.history.replaceState(null, "", `${routePath("runtime")}${window.location.search}`);
      setRoute(readRoute());
    }
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => { if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id); }, [runtimeId, runtimes]);
  useEffect(() => { if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId); }, [instanceId, instances]);
  useEffect(() => {
    const context = readRouteContext();
    if (context.runtimeId && runtimes.some((item) => item.id === context.runtimeId) && runtimeId !== context.runtimeId) {
      setRuntimeId(context.runtimeId);
    }
  }, [runtimeId, runtimes]);
  useEffect(() => {
    const context = readRouteContext();
    if (context.instanceId && instances.some((item) => item.instanceId === context.instanceId) && instanceId !== context.instanceId) {
      setInstanceId(context.instanceId);
    }
  }, [instanceId, instances]);
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
  useEffect(() => { setSelectedRunId(""); setSelectedStageId(""); }, [instanceId]);
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
    const baseRuntime = runtime?.id || runtimeId || "runtime";
    const baseInstance = instance?.instanceId || instanceId || "instance";
    let nextPath = routePath(view, entityId, secondaryId);
    if (view === "runtime") nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}`;
    if (view === "instance") nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}`;
    if (view === "workflow") {
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/workflow`;
      if (entityId) nextPath += `/runs/${encodeURIComponent(entityId)}`;
      if (secondaryId) nextPath += `/${encodeURIComponent(secondaryId)}`;
    }
    if (view === "nodes") {
      nextPath = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(baseInstance)}/nodes`;
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
    const nextUrl = `/runtimes/${encodeURIComponent(nextRuntimeId)}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: "runtime", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" });
  }

  function selectInstance(nextInstanceId: string, open = false) {
    setInstanceId(nextInstanceId);
    const baseRuntime = runtime?.id || runtimeId || "runtime";
    const nextPath = open
      ? `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(nextInstanceId)}`
      : `/runtimes/${encodeURIComponent(baseRuntime)}`;
    const nextUrl = `${nextPath}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
    setRoute({ view: open ? "instance" : "runtime", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" });
  }

  function selectManagedNode(nodeId: string, moduleId = selectedNodeModuleId || "basic") {
    setSelectedManagedNodeId(nodeId);
    setSelectedNodeModuleId(moduleId);
    navigateTo("nodes", nodeId, moduleId);
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
          <button type="button" className={viewMode === "runtime" ? "active" : ""} onClick={() => navigateTo("runtime")}>
            <Server size={17} /><span>Runtime</span><small>{instances.length || "-"} instances</small>
          </button>
          <button type="button" className={viewMode === "instance" ? "active" : ""} onClick={() => navigateTo("instance")}>
            <LayoutDashboard size={17} /><span>Instance</span><small>{instance?.status || "workspace"}</small>
          </button>
          <button type="button" className={viewMode === "workflow" ? "active" : ""} onClick={() => navigateTo("workflow")}>
            <Network size={17} /><span>Workflow</span><small>{runs.length || "-"} exec</small>
          </button>
          <button type="button" className={viewMode === "nodes" ? "active" : ""} onClick={() => navigateTo("nodes")}>
            <Boxes size={17} /><span>Nodes</span><small>{managedNodes.length || "-"} modules</small>
          </button>
          <button type="button" className={viewMode === "settings" ? "active" : ""} onClick={() => navigateTo("settings")}>
            <Settings size={17} /><span>Settings</span><small>{mode}</small>
          </button>
        </nav>
        <div className="rail-section">
          <div className="section-title"><span>Runtime</span><span>{mode}</span></div>
          {runtimes.map((item) => (
            <button key={item.id} type="button" className={`rail-runtime ${runtime?.id === item.id ? "active" : ""}`} onClick={() => selectRuntime(item.id)}>
              <Server size={14} />
              <span>{item.name}</span>
              <small>{item.machine || item.localStatus}</small>
            </button>
          ))}
          {!runtimes.length && <div className="rail-empty">No runtime</div>}
        </div>
      </aside>
      <header className="topbar">
        <div className="active-context">
          <div>
            <span>Active context</span>
            <strong>{runtime?.name || "Runtime"} / {instance?.title || "Workspace"}</strong>
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
          <button type="button" className="primary" disabled={!runtime || !instance} onClick={() => setTriggerOpen(true)}>
            <Play size={16} />{isRuntimeManagementInstance ? "Manage Runtime" : "New Execution"}
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
          <div className="section-title"><span>Workspaces</span><span>{instances.length}</span></div>
          {instances.map((item) => (
            <button key={item.instanceId} type="button" className={`list-card ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => setInstanceId(item.instanceId)}>
              <strong>{item.title}</strong><span>{item.instanceId}</span><span>{item.repo}</span>
            </button>
          ))}
          {!instances.length && <LoadingOrEmpty loading={instancesQuery.isLoading} text="当前 Runtime 没有 enabled workspace" />}
        </section>
        <section className="runs-section">
          <div className="section-title"><span>Executions</span><span>{visibleExecutions.length}/{runs.length}</span></div>
          <div className="execution-tools">
            <label className="search-box">
              <Search size={14} />
              <input value={executionSearch} onChange={(event) => setExecutionSearch(event.target.value)} placeholder="Search execution" />
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
              <span>{run.updatedAt || run.startedAt}</span><span>{run.sourceUrl || run.repo}</span>
            </button>
          ))}
          {!visibleExecutions.length && <LoadingOrEmpty loading={runsQuery.isLoading} text={runs.length ? "没有匹配的 Execution" : "当前 Workspace 还没有 Execution"} />}
        </section>
      </aside>}

      <main className={`main ${viewMode === "nodes" ? "nodes-main" : ""}`}>
        {viewMode === "runtime" ? (
          <RuntimeOverview
            runtime={runtime}
            runtimes={runtimes}
            instances={instances}
            loading={runtimesQuery.isLoading || instancesQuery.isLoading}
            mode={mode}
            onOpenInstance={(id) => selectInstance(id, true)}
            managementInstance={managementInstance}
            onOpenWorkflow={(id) => {
              setInstanceId(id);
              const baseRuntime = runtime?.id || runtimeId || "runtime";
              const nextUrl = `/runtimes/${encodeURIComponent(baseRuntime)}/instances/${encodeURIComponent(id)}/workflow${window.location.search}`;
              if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, "", nextUrl);
              setRoute({ view: "workflow", nodeId: "", pipelineId: "", artifactId: "", moduleId: "" });
              setSelectedRunId("");
              setSelectedStageId("");
            }}
            onOpenManagement={(action) => {
              setRuntimeManagementAction(action);
              setTriggerOpen(true);
            }}
          />
        ) : viewMode === "instance" ? (
          <InstanceOverview
            runtime={runtime}
            instance={instance}
            instances={instances}
            runs={runs}
            dag={dag}
            managedNodes={managedNodes}
            runArtifacts={runArtifactsQuery.data || []}
            onSelectInstance={(id) => selectInstance(id, true)}
            onOpenWorkflow={() => navigateTo("workflow", selectedRun?.pipelineId || runs[0]?.pipelineId || "", selectedStage?.id || dag?.nodes[0]?.id || "")}
            onOpenExecutions={() => navigateTo("workflow", selectedRun?.pipelineId || runs[0]?.pipelineId || "")}
            onOpenNodes={() => navigateTo("nodes")}
          />
        ) : viewMode === "workflow" && !route.pipelineId ? (
          <WorkflowHome
            runtime={runtime}
            instance={instance}
            mode={mode}
            selectedRun={selectedRun}
            dag={dag}
            runArtifacts={runArtifactsQuery.data || []}
            streamStatus={streamStatus}
            nodesReadyCount={nodesReadyCount}
            managedNodeCount={managedNodes.length}
            runs={workflowExecutions}
            onOpenWorkflow={() => navigateTo("workflow", selectedRun?.pipelineId || runs[0]?.pipelineId || "", selectedStage?.id || dag?.nodes[0]?.id || "")}
          />
        ) : viewMode === "workflow" ? (
          <WorkflowWorkspace
            runtime={runtime}
            instance={instance}
            provider={provider}
            mode={mode}
            runs={workflowExecutions}
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
            selectedNodeId={selectedManagedNode?.nodeId || ""}
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
            onSelectModule={(moduleId) => {
              setSelectedNodeModuleId(moduleId);
              if (selectedManagedNode) navigateTo("nodes", selectedManagedNode.nodeId, moduleId);
            }}
            onOpenDraft={() => setDraftOpen(true)}
          />
        ) : (
          <SettingsPage
            mode={mode}
            runtime={runtime}
            runtimes={runtimes}
            instance={instance}
            instances={instances}
            manualEndpoint={manualEndpoint}
            setManualEndpoint={setManualEndpoint}
            onAddManualEndpoint={addManualEndpoint}
            streamStatus={streamStatus}
            nodesReadyCount={nodesReadyCount}
            nodesTotal={managedNodes.length}
            managementInstance={managementInstance}
            managementConfig={runtimeManagementConfigQuery.data}
            managementConfigLoading={runtimeManagementConfigQuery.isLoading}
            managementConfigError={runtimeManagementConfigQuery.error ? String(runtimeManagementConfigQuery.error.message) : ""}
            machines={machinesQuery.data?.machines || []}
            machinesLoading={machinesQuery.isLoading}
            machinesError={machinesQuery.error ? String(machinesQuery.error.message) : ""}
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
            saveMachinePending={saveMachineMutation.isPending}
            saveMachineError={saveMachineMutation.error ? String(saveMachineMutation.error.message) : ""}
            onSaveMachine={(event) => { event.preventDefault(); saveMachineMutation.mutate(); }}
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

      {triggerOpen && runtime && instance && isRuntimeManagementInstance && (
        <RuntimeManagementStartDrawer
          mode={mode}
          runtime={runtime}
          instance={instance}
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
          setDeleteRuntimeId={setRuntimeDeleteId}
          deleteSshCommand={runtimeDeleteSshCommand}
          setDeleteSshCommand={setRuntimeDeleteSshCommand}
          deletePrivateKey={runtimeDeletePrivateKey}
          setDeletePrivateKey={setRuntimeDeletePrivateKey}
          deleteMachineId={runtimeDeleteMachineId}
          setDeleteMachineId={setRuntimeDeleteMachineId}
          deleteForce={runtimeDeleteForce}
          setDeleteForce={setRuntimeDeleteForce}
          machines={machinesQuery.data?.machines || []}
          machinesLoading={machinesQuery.isLoading}
          instanceCreateId={instanceCreateId}
          setInstanceCreateId={setInstanceCreateId}
          instanceCreateRepo={instanceCreateRepo}
          setInstanceCreateRepo={setInstanceCreateRepo}
          instanceCreateSopType={instanceCreateSopType}
          setInstanceCreateSopType={setInstanceCreateSopType}
          instanceDeleteId={instanceDeleteId}
          setInstanceDeleteId={setInstanceDeleteId}
          instanceDeleteRepo={instanceDeleteRepo}
          setInstanceDeleteRepo={setInstanceDeleteRepo}
          instanceDeleteForce={instanceDeleteForce}
          setInstanceDeleteForce={setInstanceDeleteForce}
          inheritance={runtimeInheritanceQuery.data}
          inheritanceLoading={runtimeInheritanceQuery.isLoading}
          inheritanceError={runtimeInheritanceQuery.error ? String(runtimeInheritanceQuery.error.message) : ""}
          onRefreshInheritance={() => runtimeInheritanceQuery.refetch()}
          onSaveDefaults={saveRuntimeManagementDefaults}
          onResetDefaults={resetRuntimeManagementDefaults}
          onLoadInheritanceToEnv={() => {
            setRuntimeCreateEnvText(runtimeEnvTemplateFromPreview(runtimeInheritanceQuery.data));
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
          onClose={() => setTriggerOpen(false)}
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

function RuntimeOverview({
  runtime,
  runtimes,
  instances,
  loading,
  mode,
  onOpenInstance,
  onOpenWorkflow,
  managementInstance,
  onOpenManagement,
}: {
  runtime: Runtime | undefined;
  runtimes: Runtime[];
  instances: Instance[];
  loading: boolean;
  mode: DataMode;
  onOpenInstance: (instanceId: string) => void;
  onOpenWorkflow: (instanceId: string) => void;
  managementInstance: Instance | undefined;
  onOpenManagement: (action: RuntimeManagementAction) => void;
}) {
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
  const [hermesRunning, setHermesRunning] = useState(false);
  const [hermesResult, setHermesResult] = useState<{
    ok: boolean;
    httpStatus: number;
    latencyMs: number;
    responseBody: string;
    contentType: string;
    error?: string;
    checkedAt: string;
    target: string;
    curl: string;
  } | null>(null);

  useEffect(() => {
    setProbeResults([]);
    setProbeRunning(false);
  }, [runtime?.id]);

  useEffect(() => {
    setHermesUrl(buildHermesWebhookUrl(runtime));
    setHermesResult(null);
    setHermesRunning(false);
  }, [runtime?.id]);

  const handleRunProbe = async () => {
    if (!runtime) return;
    setProbeRunning(true);
    try {
      setProbeResults(await runRuntimeProbeChecks(runtime, managementInstance));
    } finally {
      setProbeRunning(false);
    }
  };

  const handleRunHermesCheck = async () => {
    if (!runtime) return;
    const target = hermesUrl.trim();
    if (!target) {
      setHermesResult({
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
    setHermesRunning(true);
    try {
      const result = await runHermesConnectivityCheck(runtime, hermesMessage.trim() || "你好 你是谁");
      setHermesResult({
        ok: result.ok,
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        responseBody: result.responseBody,
        contentType: result.contentType,
        error: result.ok ? undefined : result.error || `HTTP ${result.httpStatus}`,
        checkedAt: new Date().toISOString(),
        target: result.targetUrl || target,
        curl: result.curl || buildHermesCurlCommand(target, hermesMessage.trim() || "你好 你是谁"),
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setHermesResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        responseBody: "",
        contentType: "",
        error: errorText,
        checkedAt: new Date().toISOString(),
        target,
        curl: buildHermesCurlCommand(target, hermesMessage.trim() || "你好 你是谁"),
      });
    } finally {
      setHermesRunning(false);
    }
  };

  return (
    <section className="runtime-overview">
      <div className="concept-hero runtime-hero">
        <div>
          <span className="status-pill running"><Server size={14} />Runtime Overview</span>
          <h1>Runtime 承载执行能力，Instance 承载业务隔离。</h1>
          <p>先确认机器、通道、SPI 和 Hermes 所在的运行环境，再进入某个 Instance 查看 Workflow、Executions、Nodes 和 Artifacts。</p>
        </div>
        <div className="context-card">
          <strong>{runtime?.displayName || runtime?.name || "No runtime"}</strong>
          <span>{runtime?.endpoint || "未选择 endpoint"}</span>
          <code>{mode} · {runtime?.localStatus || runtime?.status || "unknown"}</code>
        </div>
      </div>

      <section className="console-metrics">
        <Metric label="Runtimes" value={runtimes.length} subtext="discovered channels" />
        <Metric label="Instances" value={instances.length} subtext={`${readyCount} ready`} />
        <Metric label="Running" value={runningCount} subtext={`${failedCount} failed workspace`} />
        <Metric label="SPI" value={runtime?.localStatus || runtime?.status || "-"} subtext={runtime?.spiBaseUrl || `${runtime?.endpoint || ""}/api/sop`} />
      </section>

      <section className="runtime-detail-grid">
        <div className="flow-panel runtime-identity-panel">
          <div className="panel-head">
            <div><strong>Runtime Detail</strong><span>机器、通道和 SPI 的当前状态</span></div>
            <span className={`status-pill ${runtimeStatus}`}>{runtime?.localStatus || runtime?.status || "unknown"}</span>
          </div>
          <div className="runtime-detail-body">
            <KeyValues data={{
              runtime_id: runtime?.id || "-",
              display_name: runtime?.displayName || runtime?.name || "-",
              endpoint: runtime?.channelUrl || runtime?.endpoint || "-",
              public_endpoint: runtimeMetadataRows.public || "-",
              spi_base_url: runtime?.spiBaseUrl || `${runtime?.endpoint || ""}/api/sop`,
              ...runtimeMetadataRows,
              client_ip: runtime?.clientIp || runtime?.machine || "-",
              local_port: runtime?.localPort || "-",
              supported_sop_types: supportedTypes,
              updated_at: runtime?.updatedAt || "-",
            }} />
          </div>
        </div>

        <div className="flow-panel runtime-health-panel">
          <div className="panel-head">
            <div><strong>Runtime Health</strong><span>面向控制台的可用性摘要</span></div>
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
            <strong>Hermes Connectivity</strong>
            <span>通过 Runtime SPI 服务端签名验证 Hermes webhook 连通性</span>
          </div>
          <button type="button" className="ghost-btn compact" onClick={handleRunHermesCheck} disabled={!runtime || hermesRunning || !hermesUrl.trim()}>
            {hermesRunning ? <Loader2 size={14} className="spin" /> : <Play size={14} />}Run Hermes Check
          </button>
        </div>
        <div className="runtime-hermes-grid">
          <div className="runtime-hermes-form">
            <label>
              <span>Test Message</span>
              <textarea value={hermesMessage} onChange={(event) => setHermesMessage(event.target.value)} rows={4} placeholder="请输入要发送给 Hermes 的文本" />
              <span className="field-hint">页面会调用当前 Runtime SPI 的 hermes-smoke 代理，由服务端签名后发送到 Hermes webhook。</span>
            </label>
            <label>
              <span>Hermes Webhook URL</span>
              <input value={hermesUrl} onChange={(event) => setHermesUrl(event.target.value)} placeholder="Missing in runtime metadata" />
              <span className="field-hint">权威来源是 Runtime metadata 的 hermes_webhook_url / webhook_public_host；缺失时需要 create-runtime 初始化补齐。</span>
            </label>
            <div className={`runtime-hermes-endpoint-state ${hermesUrl.trim() ? "ok" : "missing"}`}>
              <strong>{hermesUrl.trim() ? "Hermes endpoint configured" : "Hermes endpoint missing"}</strong>
              <span>{hermesUrl.trim() ? "Ready for webhook smoke check" : "Runtime metadata 没有 Hermes 公网入口，不能用 SPI 域名代替。"}</span>
            </div>
            <div className="runtime-hermes-actions">
              <button type="button" className="primary" onClick={handleRunHermesCheck} disabled={!runtime || hermesRunning || !hermesUrl.trim()}>
                {hermesRunning ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                {hermesRunning ? "Checking..." : "Run check"}
              </button>
              <div className="runtime-hermes-meta">
                <span>SPI: {runtime?.channelUrl || runtime?.endpoint || "-"}</span>
                <span>Proxy: {buildRuntimeHermesSmokeProxyUrl(runtime) || "-"}</span>
                <span>Hermes: {runtime?.metadata?.hermes_webhook_url || runtime?.metadata?.webhook_public_host || "missing"}</span>
              </div>
            </div>
          </div>
          <div className="runtime-hermes-output">
            <div className="runtime-hermes-command">
              <div className="section-title"><span>curl</span><span>copy and run manually</span></div>
              <pre>{buildHermesCurlCommand(hermesUrl.trim() || buildHermesWebhookUrl(runtime), hermesMessage.trim() || "你好 你是谁")}</pre>
            </div>
            {hermesResult ? (
              <div className={`runtime-hermes-result ${hermesResult.ok ? "ok" : "failed"}`}>
                <div className="runtime-hermes-summary">
                  <strong>{hermesResult.ok ? "Connected" : "Failed"}</strong>
                  <span>{hermesResult.error || `HTTP ${hermesResult.httpStatus}`}</span>
                  <small>{hermesResult.latencyMs}ms · {hermesResult.checkedAt}</small>
                </div>
                <KeyValues data={{
                  target_url: hermesResult.target,
                  http_status: hermesResult.httpStatus || "-",
                  content_type: hermesResult.contentType || "-",
                  latency_ms: `${hermesResult.latencyMs}ms`,
                }} />
                <div className="runtime-hermes-response">
                  <div className="section-title"><span>Response</span><span>{hermesResult.responseBody === "(empty response)" ? "empty" : "body"}</span></div>
                  <pre>{hermesResult.responseBody}</pre>
                </div>
              </div>
            ) : (
              <Empty text="先点击 Run check，或直接复制上方 curl 在终端里执行。" />
            )}
          </div>
        </div>
      </section>

      <section className="runtime-main-grid runtime-main-grid-single">
        <div className="flow-panel instance-list-panel">
          <div className="panel-head">
            <div><strong>Instance Registry</strong><span>当前 Runtime 下的业务隔离单元</span></div>
            <span>{instances.length}</span>
          </div>
          <div className="instance-table">
            {instances.map((item) => <InstanceRow key={item.instanceId} instance={item} onOpen={() => onOpenInstance(item.instanceId)} onWorkflow={() => onOpenWorkflow(item.instanceId)} />)}
            {!instances.length && <LoadingOrEmpty loading={loading} text="当前 Runtime 没有 enabled Instance" />}
          </div>
        </div>
      </section>

      <section className="flow-panel runtime-management-panel">
        <div className="panel-head">
          <div>
            <strong>Runtime Management</strong>
            <span>所有动作都通过 runtime-management workflow 执行和记录</span>
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
            title="Create Instance"
            description="在选中 Runtime 下新增业务工作区。"
            icon={<LayoutDashboard size={16} />}
            disabled={!managementInstance}
            onClick={() => onOpenManagement("create-instance")}
          />
          <ManagementActionCard
            title="Delete Instance"
            description="清理指定业务工作区，不删除 Runtime。"
            icon={<X size={16} />}
            danger
            disabled={!managementInstance}
            onClick={() => onOpenManagement("delete-instance")}
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

function InstanceOverview({
  runtime,
  instance,
  instances,
  runs,
  dag,
  managedNodes,
  runArtifacts,
  onSelectInstance,
  onOpenWorkflow,
  onOpenExecutions,
  onOpenNodes,
}: {
  runtime: Runtime | undefined;
  instance: Instance | undefined;
  instances: Instance[];
  runs: Run[];
  dag: Dag | undefined;
  managedNodes: NodeRegistryItem[];
  runArtifacts: Artifact[];
  onSelectInstance: (instanceId: string) => void;
  onOpenWorkflow: () => void;
  onOpenExecutions: () => void;
  onOpenNodes: () => void;
}) {
  const binding = instance?.workflowBinding;
  const latest = instance?.latestExecution || runs[0];
  return (
    <section className="instance-overview">
      <div className="workflow-command-bar instance-command">
        <div className="workflow-title">
          <span className={`status-pill ${instance?.status === "failed" ? "failed" : instance?.status === "running" ? "running" : "done"}`}><LayoutDashboard size={14} />Instance Workspace</span>
          <div>
            <h1>{instance?.title || "选择 Instance"}</h1>
            <p>{runtime?.name || "Runtime"} · {instance?.repo || "repo pending"} · {instance?.instanceId || "-"}</p>
          </div>
        </div>
        <div className="workflow-metrics">
          <Metric label="Workflow" value={binding?.workflowName || "-"} subtext={binding?.workflowVersion || binding?.bindingStatus || "binding"} />
          <Metric label="Executions" value={instance?.executionCount ?? runs.length} subtext={latest ? `${shortId(latest.pipelineId)} · ${statusLabel(latest.status)}` : "no execution"} />
          <Metric label="Artifacts" value={instance?.artifactCount ?? runArtifacts.length} subtext={`${instance?.pageCount ?? latest?.pageCount ?? 0} pages`} />
          <Metric label="Nodes" value={`${binding?.enabledNodeCount ?? managedNodes.length}/${binding?.nodeCount ?? dag?.nodes.length ?? 0}`} subtext="workflow binding" />
        </div>
      </div>

      <section className="instance-grid">
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Workspace Identity</strong><span>Instance 是业务工作区，不是 Workflow</span></div></div>
          {instance ? (
            <div className="kv-stack">
              <KeyValues data={{
                instance_id: instance.instanceId,
                status: instance.status || "unknown",
                sop_type: instance.sopType || "-",
                repo: instance.repo || "-",
                wiki_local_path: instance.wikiLocalPath || "-",
                workspace_status: instance.workspaceStatus || "-",
                run_index_status: instance.runIndexStatus || "-",
              }} />
            </div>
          ) : <Empty text="请选择一个 Instance" />}
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Workflow Binding</strong><span>Instance 引用的流程定义</span></div><button type="button" onClick={onOpenWorkflow}>Open Workflow</button></div>
          <KeyValues data={{
            workflow_id: binding?.workflowId || "-",
            workflow_name: binding?.workflowName || "-",
            workflow_version: binding?.workflowVersion || "-",
            definition_source: binding?.definitionSource || "-",
            definition_path: binding?.definitionPath || "-",
            binding_status: binding?.bindingStatus || "-",
          }} />
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Capabilities</strong><span>工作区级依赖能力</span></div></div>
          <CapabilityGrid capabilities={instance?.capabilities || {}} />
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Latest Executions</strong><span>运行历史属于 Instance</span></div><button type="button" onClick={onOpenExecutions}>Open Executions</button></div>
          <RunTable runs={runs.slice(0, 5)} selectedRunId={latest?.pipelineId || ""} onSelect={() => onOpenExecutions()} />
        </div>

        <div className="flow-panel wide-panel">
          <div className="panel-head"><div><strong>Node Registry</strong><span>当前 Workflow Binding 中的节点</span></div><button type="button" onClick={onOpenNodes}>Open Nodes</button></div>
          <div className="stage-map compact">
            {(dag?.nodes || []).map((node) => (
              <button key={node.id} type="button" className="stage-map-node waiting" onClick={onOpenNodes}>
                <span className="dot waiting" />
                <strong>{node.title}</strong>
                <small>{node.id}</small>
              </button>
            ))}
            {!dag?.nodes.length && <Empty text="还没有加载 Workflow DAG" />}
          </div>
        </div>

        <div className="flow-panel">
          <div className="panel-head"><div><strong>Other Instances</strong><span>同一 Runtime 下的工作区</span></div></div>
          <div className="runtime-list compact">
            {instances.map((item) => (
              <button key={item.instanceId} type="button" className={`runtime-select-card ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => onSelectInstance(item.instanceId)}>
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

function InstanceRow({ instance, onOpen, onWorkflow }: { instance: Instance; onOpen: () => void; onWorkflow: () => void }) {
  const latest = instance.latestExecution;
  return (
    <div className="instance-row">
      <button type="button" className="instance-main" onClick={onOpen}>
        <div>
          <strong>{instance.title}</strong>
          <span>{instance.instanceId}</span>
        </div>
        <span className={`status-pill ${instance.status === "failed" ? "failed" : instance.status === "running" ? "running" : "done"}`}>{instance.status || "ready"}</span>
      </button>
      <div className="instance-meta">
        <span>{instance.workflowBinding?.workflowName || instance.sopType || "Workflow"}</span>
        <span>{instance.repo || "-"}</span>
        <span>{latest ? `${shortId(latest.pipelineId)} · ${statusLabel(latest.status)} · ${latest.progress ?? 0}%` : "No execution"}</span>
        <span>{instance.artifactCount || 0} artifacts · {instance.pageCount || 0} pages</span>
      </div>
      <div className="instance-actions">
        <button type="button" onClick={onOpen}>Open</button>
        <button type="button" onClick={onWorkflow}>Workflow</button>
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
        const text = String(value || "unknown");
        const ok = ["ok", "ready", "configured"].includes(text);
        return <span key={key} className={`capability-chip ${ok ? "ok" : ""}`}><strong>{key}</strong>{text}</span>;
      })}
    </div>
  );
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
            <div><strong>Workflow Map</strong><span>点击节点后右侧 Inspector 聚焦</span></div>
            <button type="button" onClick={onOpenWorkflow}>Open DAG</button>
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
            {!dag?.nodes.length && <Empty text="选择 Runtime 和 Workspace 后加载 Workflow Map" />}
          </div>
        </div>
        <div className="runs-table-panel">
          <div className="panel-head">
            <div><strong>Recent Runs</strong><span>优先显示 running / failed / latest</span></div>
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
          <span className="status-pill running"><Workflow size={14} />Workflow</span>
          <div>
            <h1>DAG 驱动的执行观察</h1>
            <p>{instance?.title || "SOP Workflow"} · {runtime?.endpoint || "No endpoint"} · {mode}</p>
          </div>
        </div>
        <div className="workflow-metrics">
          <Metric label="Progress" value={`${selectedRun?.progress ?? 0}%`} subtext={`${selectedRun?.doneCount ?? 0}/${selectedRun?.nodeCount ?? dag?.nodes.length ?? 0} nodes`} />
          <Metric label="Artifacts" value={selectedRun?.artifactCount ?? runArtifacts.length} subtext="run scoped" />
          <Metric label="Nodes" value={`${nodesReadyCount}/${managedNodeCount || 0}`} subtext="metadata ready" />
          <Metric label="SSE" value={streamStatus} subtext={streamStatusHint(streamStatus)} />
        </div>
      </div>

      <section className="workflow-entry-panel">
        <div className="panel-head">
          <div>
            <strong>Workflows</strong>
            <span>选择一个 Workflow 后进入 DAG 运行详情</span>
          </div>
          <span>{instance ? 1 : 0}</span>
        </div>
        {instance ? (
          <button type="button" className="workflow-entry-card" onClick={onOpenWorkflow}>
            <div>
              <span className="status-pill done"><GitBranch size={14} />Active Workflow</span>
              <h2>{instance.title || "YouTube Wiki SOP"}</h2>
              <p>{instance.repo || instance.instanceId}</p>
            </div>
            <div className="workflow-entry-meta">
              <Metric label="Executions" value={runs.length} subtext={selectedRun?.pipelineId ? shortId(selectedRun.pipelineId) : "no run selected"} />
              <span className={`status-pill ${selectedRun?.status || "waiting"}`}>{selectedRun ? statusLabel(selectedRun.status) : "No run"}</span>
            </div>
          </button>
        ) : (
          <Empty text="当前 Runtime 没有可用 Workflow" />
        )}
      </section>
    </section>
  );
}

function WorkflowWorkspace({
  runtime,
  instance,
  provider,
  mode,
  runs,
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
  provider: SopDataProvider;
  mode: DataMode;
  runs: Run[];
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
  const topRuns = runs.slice(0, 8);
  const displayedRuns = selectedRun && !topRuns.some((run) => run.pipelineId === selectedRun.pipelineId)
    ? [selectedRun, ...topRuns.filter((run) => run.pipelineId !== selectedRun.pipelineId)].slice(0, 8)
    : topRuns;
  return (
    <section className="workflow-workspace">
      {selectedRunMissing && (
        <div className="warning-banner">
          URL 指向的 Run 不存在或当前 Runtime 未返回该 Run。页面不会静默切换到其他 Run，请从 Executions 重新选择。
        </div>
      )}

      <div className="workflow-primary-grid">
        <aside className="workflow-run-panel">
          <section className="workflow-execution-list">
            <div className="panel-head compact">
              <div>
                <strong>Executions</strong>
                <span>{runningExecutionCount ? `${runningExecutionCount} running · 当前 run 置顶` : "当前 run 置顶，running 优先"}</span>
              </div>
              <span>{runs.length}</span>
            </div>
            <div className="workflow-run-list">
              {displayedRuns.map((run) => (
                <button
                  key={run.pipelineId}
                  type="button"
                  title={`${run.pipelineId}\n${statusLabel(run.status)} · ${run.progress ?? 0}%\n${run.sourceUrl || run.repo}\n${run.updatedAt || run.startedAt}`}
                  className={`workflow-run-row ${run.status} ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`}
                  onClick={() => onSelectRun(run.pipelineId)}
                >
                  <strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong>
                  <span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span>
                  <small>{run.progress ?? 0}% · {run.updatedAt || run.startedAt}</small>
                  <small>{run.sourceUrl || run.repo}</small>
                </button>
              ))}
              {!runs.length && <Empty text="当前 Workspace 还没有 Execution" />}
            </div>
          </section>
        </aside>

        <section className="flow-panel workflow-dag-panel">
          <div className="panel-head workflow-dag-head">
            <div className="dag-title-block">
              <strong>DAG Canvas</strong>
              <span>{selectedRun?.pipelineId || instance?.instanceId || "-"}</span>
            </div>
            <div className="head-actions dag-actions">
              {selectedRun?.status === "running" && (
                <button type="button" className="btn-danger-sm" disabled={cancelRunPending} onClick={onCancelRun}>
                  <X size={14} />Cancel Run
                </button>
              )}
              <div className="dag-status-strip">
                <div className="dag-progress" aria-label={`Run progress ${selectedRun?.progress ?? 0}%`}>
                  <span style={{ width: `${selectedRun?.progress ?? 0}%` }} />
                </div>
                {selectedRun && <span className="status-pill running">{selectedRun.progress ?? 0}%</span>}
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
            ) : <Empty text="选择 Runtime 和 Instance 后加载 DAG" />}
          </div>
        </section>

        <aside className="workflow-node-inspector">
          <div className="panel-head compact">
            <div>
              <strong>{selectedStage?.title || "Node Inspector"}</strong>
              <span>{selectedStage?.mode || selectedStage?.id || "选择 DAG 节点"}</span>
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
            {!selectedStage || !selectedRun || !instance || !runtime ? <Empty text="选择一个 Execution 和 Stage 查看详情" /> : (
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
                      <StepList items={nodeDetail?.actions || []} status={selectedStatus} />
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
                    <DetailBlock title="Test this node">
                      <NodeTestPanel
                        provider={provider}
                        runtime={runtime}
                        instanceId={instance.instanceId}
                        mode={mode}
                        nodeId={selectedStage.id}
                        runs={runs}
                        runId={selectedRun.pipelineId}
                      />
                    </DetailBlock>
                  </>
                )}

                {inspectorTab === "run" && (
                  <>
                    <DetailBlock title="Execution">
                      <KeyValues data={{
                        execution: selectedRun.pipelineId,
                        run_id: nodeDetail?.runId || "-",
                        started: nodeDetail?.startedAt || "-",
                        finished: nodeDetail?.finishedAt || "-",
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
                    {nodeDetail?.manualFixHint && (
                      <DetailBlock title="Manual Fix Hint">
                        <pre className="log-box">{nodeDetail.manualFixHint}</pre>
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
                      <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Execution，不会作为下游节点输入。</p>
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
  const doneCount = selectedRun ? Object.values(selectedRun.nodes).filter((state) => state === "done").length : 0;
  const totalCount = dag?.nodes.length || 0;
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
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
        <Metric label="Pipeline" value={`${selectedRun?.progress ?? progress}%`} subtext={`${selectedRun?.doneCount ?? doneCount}/${selectedRun?.nodeCount ?? totalCount} stages done`} />
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
      <div className="run-table-head"><span>Run</span><span>Status</span><span>Updated</span><span>Source</span><span>Action</span></div>
      {runs.map((run) => (
        <button key={run.pipelineId} type="button" className={`run-table-row ${selectedRunId === run.pipelineId ? "active" : ""}`} onClick={() => onSelect(run.pipelineId)}>
          <strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong>
          <span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span>
          <span>{run.updatedAt || run.startedAt}</span>
          <span>{run.sourceType || "youtube"}</span>
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
  runtime,
  runtimes,
  instance,
  instances,
  manualEndpoint,
  setManualEndpoint,
  onAddManualEndpoint,
  streamStatus,
  nodesReadyCount,
  nodesTotal,
  managementInstance,
  managementConfig,
  managementConfigLoading,
  managementConfigError,
  machines,
  machinesLoading,
  machinesError,
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
  saveMachinePending,
  saveMachineError,
  onSaveMachine,
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
  runtime: Runtime | undefined;
  runtimes: Runtime[];
  instance: Instance | undefined;
  instances: Instance[];
  manualEndpoint: string;
  setManualEndpoint: (value: string) => void;
  onAddManualEndpoint: (event: FormEvent) => void;
  streamStatus: "live" | "reconnecting" | "polling fallback" | "closed";
  nodesReadyCount: number;
  nodesTotal: number;
  managementInstance: Instance | undefined;
  managementConfig: RuntimeManagementConfigPreview | undefined;
  managementConfigLoading: boolean;
  managementConfigError: string;
  machines: MachineConfig[];
  machinesLoading: boolean;
  machinesError: string;
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
  saveMachinePending: boolean;
  saveMachineError: string;
  onSaveMachine: (event: FormEvent) => void;
  managementConfigValues: Record<string, string>;
  setManagementConfigValues: (value: Record<string, string>) => void;
  saveManagementConfigPending: boolean;
  saveManagementConfigError: string;
  onRefreshManagementConfig: () => void;
  onSaveManagementConfig: (event: FormEvent) => void;
  globalTunnelApiUrl: string;
  globalTunnelAdminUrl: string;
}) {
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
  const configCards = [
    {
      id: "cloudflare",
      title: "Cloudflare",
      subtitle: "全局 DNS / tunnel 路由认证",
      icon: <Cloud size={18} />,
      keys: [
        { key: "CLOUDFLARE_EMAIL", label: "Cloudflare Email", placeholder: "name@example.com" },
        { key: "CLOUDFLARE_API_KEY", label: "Global API Key", placeholder: "已保存时会显示 masked；填写则覆盖" },
        { key: "TUNNEL_API", label: "Tunnel API", placeholder: globalTunnelApiUrl },
      ],
    },
    {
      id: "github",
      title: "GitHub",
      subtitle: "全局代码访问凭据和 owner 级 token",
      icon: <Github size={18} />,
      keys: [
        { key: "GITHUB_TOKEN", label: "Default GitHub Token", placeholder: "默认 GitHub token" },
        { key: "GITHUB_CHANGFENGHU_TOKEN", label: "ChangfengHU Token", placeholder: "用于 ChangfengHU 下的基础设施仓库" },
        { key: "GITHUB_SKKEORIW_TOKEN", label: "skkeoriw Token", placeholder: "用于 skkeoriw 下的 runtime brain 仓库" },
      ],
    },
    {
      id: "hermes-model",
      title: "Hermes Model",
      subtitle: "Hermes CLI / gateway 默认 OpenAI-compatible 模型配置",
      icon: <Bot size={18} />,
      keys: [
        { key: "HERMES_MODEL_PROVIDER", label: "Provider", placeholder: "openai" },
        { key: "HERMES_MODEL", label: "Default Model", placeholder: "deepseek-v4-flash 或 deepseek-v4-pro" },
        { key: "HERMES_MODEL_BASE_URL", label: "Base URL", placeholder: "https://api-proxy.chxyka.ccwu.cc/v1" },
        { key: "HERMES_OPENAI_API_KEY", label: "OpenAI-compatible API Key", placeholder: "Bearer token，不要带 Bearer 前缀" },
      ],
    },
    {
      id: "core-repos",
      title: "Core Repositories",
      subtitle: "创建 runtime 时需要继承的核心源码地址",
      icon: <GitBranch size={18} />,
      keys: [
        { key: "AGENT_REPO", label: "Brain Repo", placeholder: "https://github.com/skkeoriw/agent-brain-plugins" },
        { key: "SKILL_REPO", label: "Runtime Skill Repo", placeholder: "https://github.com/skkeoriw/auto-youtube-wiki-skill" },
      ],
    },
    {
      id: "infra-repos",
      title: "Tunnel / Skill Infrastructure",
      subtitle: "非核心但必须可追踪的发布与隧道基础设施",
      icon: <PackageSearch size={18} />,
      keys: [
        { key: "AUTO_DOMAIN_REPO", label: "Auto Domain CLI", placeholder: "https://github.com/ChangfengHU/auto-domain-cli" },
        { key: "AUTO_DOMAIN_TUNNEL_REPO", label: "Auto Domain Tunnel", placeholder: "https://github.com/ChangfengHU/cloudflare-youtube-pipeline/tree/main/auto-domain-tunnel" },
        { key: "SKILL_PUBLISHER_REPO", label: "Skill Publisher", placeholder: "https://github.com/ChangfengHU/skill-publisher" },
      ],
    },
    {
      id: "runtime-control",
      title: "Control Plane",
      subtitle: "SOP UI 和当前控制面状态",
      icon: <ShieldCheck size={18} />,
      keys: [
        { key: "SOP_UI_URL", label: "SOP UI URL", placeholder: window.location.origin },
        { key: "BRIDGE_PORT", label: "Bridge Port", placeholder: "18121" },
      ],
    },
  ];
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
      <section className="concept-hero">
        <div>
          <span className="status-pill waiting"><Settings size={14} />Global Settings</span>
          <h1>全局运维配置（不绑定任意 Runtime）</h1>
          <p>本页展示与项目级别相关的配置入口，Runtime 级别配置保持在 Runtime Overview / Runtime Management 内。</p>
        </div>
        <div className="context-card">
          <strong>Control Plane</strong>
          <span>{mode} · global scope</span>
          <code>{controlPlaneApiUrl}</code>
        </div>
      </section>
      <section className="global-settings-toolbar">
        <div>
          <strong>Global Runtime Management Config</strong>
          <span>{managementConfig?.updatedAt ? `updated ${managementConfig.updatedAt}` : "server-side config"} · {editedCount} edited</span>
        </div>
        <div className="settings-actions">
          <button type="button" className="ghost-btn compact" onClick={onRefreshManagementConfig} disabled={managementConfigLoading}>
            {managementConfigLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh
          </button>
        </div>
      </section>
      {(managementConfigError || saveManagementConfigError || machinesError || saveMachineError) && (
        <div className="inline-error">{managementConfigError || saveManagementConfigError || machinesError || saveMachineError}</div>
      )}
      <form className="global-settings-layout" onSubmit={onSaveManagementConfig}>
        <aside className="global-settings-summary">
          <div className="settings-summary-card">
            <strong>Scope</strong>
            <KeyValues data={{
              mode,
              scope: "global",
              runtime_dependency: "none",
              settings_backend: managementConfig?.backend || "d1",
              settings_store: managementConfig?.d1?.enabled ? managementConfig.d1.database_name || "runtime-settings-db" : "runtime-settings-db",
              control_plane_api: controlPlaneApiUrl,
              tunnel_admin: globalTunnelAdminUrl,
              tunnel_api: globalTunnelApiUrl,
              runtime_count: runtimes.length,
              instance_count: instances.length,
              machine_count: machines.length,
              mode_status: streamStatus,
              nodes_ready: `${nodesReadyCount}/${nodesTotal}`,
            }} />
            <button type="button" onClick={() => window.open(globalTunnelAdminUrl, "_blank", "noopener,noreferrer")}>打开 Tunnel Admin</button>
          </div>
          <button type="submit" disabled={saveManagementConfigPending || !editedCount}>
            {saveManagementConfigPending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
            Save Global Config
          </button>
          {editedCount > 0 && <button type="button" className="ghost-btn" onClick={() => setManagementConfigValues({})}>Clear edits</button>}
        </aside>
        <section className="global-config-card-grid">
          {configCards.map((card) => {
            const readyCount = card.keys.filter((field) => itemByKey.get(field.key)?.present).length;
            return (
              <article key={card.id} className="global-config-card">
                <div className="global-config-card-head">
                  <span>{card.icon}</span>
                  <div>
                    <strong>{card.title}</strong>
                    <small>{card.subtitle}</small>
                  </div>
                  <em>{readyCount}/{card.keys.length}</em>
                </div>
                <div className="global-config-fields">
                  {card.keys.map(renderConfigField)}
                </div>
              </article>
            );
          })}
        </section>
      </form>
      <section className="global-config-card-grid machine-config-grid">
        <article className="global-config-card settings-wide">
          <div className="global-config-card-head">
            <span><Server size={18} /></span>
            <div>
              <strong>Machine Nodes</strong>
              <small>SSH 节点配置来自 Control Plane D1，Runtime 创建/删除时可以选择节点</small>
            </div>
            <em>{machines.length}</em>
          </div>
          <div className="machine-list">
            {machines.map((machine) => (
              <div key={machine.id} className="machine-row">
                <div>
                  <strong>{machine.name}</strong>
                  <code>{machine.sshCommand}</code>
                </div>
                <span>{machine.authType === "password" ? "password" : "private key"} · {machine.privateKeyPresent || machine.passwordPresent ? "secret saved" : "secret missing"}</span>
              </div>
            ))}
            {!machines.length && <LoadingOrEmpty loading={machinesLoading} text="还没有机器节点配置" />}
          </div>
          <form className="machine-editor" onSubmit={onSaveMachine}>
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
            {machineAuthType === "private_key" ? (
              <label>
                <span>Private Key</span>
                <textarea value={machinePrivateKey} onChange={(event) => setMachinePrivateKey(event.target.value)} rows={5} placeholder="粘贴 OpenSSH private key；保存后不回显明文" disabled={saveMachinePending} />
              </label>
            ) : (
              <label>
                <span>Password</span>
                <input type="password" value={machinePassword} onChange={(event) => setMachinePassword(event.target.value)} placeholder="SSH password；保存后不回显明文" disabled={saveMachinePending} />
              </label>
            )}
            <button type="submit" className="primary" disabled={saveMachinePending || !machineSshCommand.trim()}>
              {saveMachinePending ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
              Save Machine
            </button>
          </form>
        </article>
      </section>
      <section className="settings-note-panel">
        <Info size={15} />
        <span>Secret 字段不会从后端返回明文；输入框留空会保留当前值，填写内容才会覆盖保存。</span>
      </section>
    </>
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
  selectedNodeId,
  nodeSearch,
  nodeFilter,
  nodeFilters,
  onNodeSearch,
  onNodeFilter,
  onSelectNode,
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
  selectedNodeId: string;
  nodeSearch: string;
  nodeFilter: string;
  nodeFilters: string[];
  onNodeSearch: (value: string) => void;
  onNodeFilter: (value: string) => void;
  onSelectNode: (nodeId: string, moduleId?: string) => void;
  onSelectModule: (moduleId: string) => void;
  onOpenDraft: () => void;
}) {
  const completeNodes = nodes.filter((node) => (node.missingFields || []).length === 0).length;
  return (
    <>
      <section className="node-summary">
        <div>
          <span className="status-pill running"><Boxes size={14} />Node Studio</span>
          <h1>节点资产中心</h1>
          <p>{instance?.title || "SOP Nodes"} · 按输入、执行、产物和附属能力组织节点。</p>
          <div className="overview-tags">
            <span>Input</span>
            <span>Research</span>
            <span>Build</span>
            <span>Notify</span>
          </div>
        </div>
        <Metric label="Nodes" value={nodes.length} subtext="registered in SOP" />
        <Metric label="Complete" value={`${completeNodes}/${nodes.length || 0}`} subtext="metadata ready" />
        <Metric label="Drafts" value={drafts.length} subtext="not published" />
        <Metric label="Publish" value="off" subtext="draft only" />
      </section>

      <section className="node-module-workbench">
        <aside className="node-list-panel">
          <div className="panel-head compact"><div><strong>Node List</strong><span>{visibleNodes.length}/{nodes.length} registered</span></div><button type="button" className="primary" disabled={!instance || !runtime} onClick={onOpenDraft}><CheckCircle2 size={16} />Create</button></div>
          <div className="node-list-tools">
            <label className="search-box"><Search size={14} /><input value={nodeSearch} onChange={(event) => onNodeSearch(event.target.value)} placeholder="Search node" /></label>
            <div className="lifecycle-tabs" role="tablist" aria-label="Node category">
              {nodeFilters.map((filter) => <button key={filter} type="button" className={nodeFilter === filter ? "active" : ""} onClick={() => onNodeFilter(filter)}>{filter === "all" ? "All" : categoryLabel(filter)}</button>)}
            </div>
          </div>
          {loading ? <Skeleton /> : (
            <div className="node-picker-list">
              {visibleNodes.map((node) => (
                <button key={node.nodeId} type="button" className={`node-picker-row ${selectedNodeId === node.nodeId ? "active" : ""}`} onClick={() => onSelectNode(node.nodeId, selectedModule?.id || "basic")}>
                  <div>
                    <strong>{node.title || node.nodeId}</strong>
                    <span>{node.nodeId}</span>
                    <span>{categoryLabel(String(node.ui?.category || "custom"))} · {String(node.executor?.type || node.case || "node")}</span>
                  </div>
                  <span className="stage-letter">{node.ui?.stageLetter || node.nodeId.slice(0, 1).toUpperCase()}</span>
                  <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>{(node.missingFields || []).length ? "warning" : "ready"}</span>
                </button>
              ))}
              {!visibleNodes.length && <Empty text="没有匹配的 Node" />}
            </div>
          )}
        </aside>

        <section className="node-modules-panel">
          <div className="panel-head compact"><div><strong>Node Modules</strong><span>{selectedNode?.nodeId || "No node"}</span></div></div>
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
          {selectedNode && instance ? (
            <div className="node-test-strip">
              <div className="section-title"><span>Test this node</span><span>独立测试</span></div>
              <NodeTestPanel
                provider={provider}
                runtime={runtime}
                instanceId={instance.instanceId}
                mode={mode}
                nodeId={selectedNode.nodeId}
                runs={runs}
              />
            </div>
          ) : null}
          <div className="draft-strip">
            <div className="section-title"><span>Drafts</span><span>{drafts.length}</span></div>
            {drafts.slice(0, 3).map((draft) => <article key={draft.draftId} className="draft-item"><strong>{draft.draftId}</strong><code>{formatValue(draft.validation)}</code></article>)}
            {!drafts.length && <Empty text="还没有节点草稿" />}
          </div>
        </section>

        <ModuleDetailPanel node={selectedNode} module={selectedModule} detail={moduleDetail} loading={moduleLoading} />
      </section>
    </>
  );
}

function ModuleDetailPanel({
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
            <h2>Start Execution</h2>
            <span>{mode === "real" ? "Real SOP Runtime" : "Mock Runtime"} · {instance.instanceId}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭创建面板" onClick={onClose} disabled={pending}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>连续运行体验</strong>
            <span>点击后会立即在 Executions 中插入 Starting 状态，并自动聚焦到新 Run。</span>
          </div>
          <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />
          <label>YouTube URL<input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} disabled={pending} /></label>
          {error && <div className="inline-error">{error}</div>}
        </div>
        <div className="drawer-actions">
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="primary" disabled={pending || !triggerUrl.trim()}>
            {pending ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            {pending ? "Starting..." : "Start Execution"}
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
  setDeleteRuntimeId,
  deleteSshCommand,
  setDeleteSshCommand,
  deletePrivateKey,
  setDeletePrivateKey,
  deleteMachineId,
  setDeleteMachineId,
  deleteForce,
  setDeleteForce,
  machines,
  machinesLoading,
  instanceCreateId,
  setInstanceCreateId,
  instanceCreateRepo,
  setInstanceCreateRepo,
  instanceCreateSopType,
  setInstanceCreateSopType,
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
  setDeleteRuntimeId: (value: string) => void;
  deleteSshCommand: string;
  setDeleteSshCommand: (value: string) => void;
  deletePrivateKey: string;
  setDeletePrivateKey: (value: string) => void;
  deleteMachineId: string;
  setDeleteMachineId: (value: string) => void;
  deleteForce: boolean;
  setDeleteForce: (value: boolean) => void;
  machines: MachineConfig[];
  machinesLoading: boolean;
  instanceCreateId: string;
  setInstanceCreateId: (value: string) => void;
  instanceCreateRepo: string;
  setInstanceCreateRepo: (value: string) => void;
  instanceCreateSopType: string;
  setInstanceCreateSopType: (value: string) => void;
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
  const createReady = true;
  const deleteReady = true;
  const isCreateRuntime = action === "create-runtime";
  const isDeleteRuntime = action === "delete-runtime";
  const isCreateInstance = action === "create-instance";
  const isDeleteInstance = action === "delete-instance";
  const isCreate = isCreateRuntime || isCreateInstance;
  const submitLabel = isCreateRuntime ? "Create Runtime" : isDeleteRuntime ? "Delete Runtime" : isCreateInstance ? "Create Instance" : "Delete Instance";
  const selectedCreateMachine = machines.find((machine) => machine.id === createMachineId);
  const selectedDeleteMachine = machines.find((machine) => machine.id === deleteMachineId);
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
      <span className="field-hint">{value ? "将提交 machine_id，SSH Command 作为兼容覆盖一起发送；secret 不会从浏览器回读。" : "不选择时沿用手填 SSH 或后端保存默认值。"}</span>
    </label>
  );

  return (
    <div className="drawer-backdrop" role="presentation">
      <form className="side-drawer execution-start-drawer runtime-management-drawer" onSubmit={isCreate ? onCreate : onDelete}>
        <div className="drawer-head">
          <div>
            <h2>Manage Runtime</h2>
            <span>{mode === "real" ? "Real SOP Runtime" : "Mock Runtime"} · {instance.instanceId}</span>
          </div>
          <button type="button" className="icon-btn" title="关闭 Runtime 管理面板" onClick={onClose} disabled={pending}><X size={16} /></button>
        </div>
        <div className="drawer-body">
          <div className="drawer-note">
            <strong>Runtime Management SOP</strong>
            <span>在当前 Runtime 上启动 runtime-management workflow；默认使用管理端已保存的目标 SSH 和 Runtime 配置。</span>
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
              {selectedCreateMachine && <KeyValues data={{ machine_id: selectedCreateMachine.id, host: selectedCreateMachine.host, auth: selectedCreateMachine.authType, secret: selectedCreateMachine.privateKeyPresent || selectedCreateMachine.passwordPresent ? "saved" : "missing" }} />}
              <label>
                <span>SSH Command</span>
                <input value={createSshCommand} onChange={(event) => setCreateSshCommand(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 SSH Command" />
              </label>
              <label>
                <span>Private Key</span>
                <textarea value={createPrivateKey} onChange={(event) => setCreatePrivateKey(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 Private Key" rows={7} />
                <span className="field-hint">覆盖项。正常情况下不用填，后端会注入已保存的目标 SSH 凭据。</span>
              </label>
              <RuntimeInheritancePreviewPanel
                preview={inheritance}
                loading={inheritanceLoading}
                error={inheritanceError}
                overrides={createConfigOverrides}
                onOverridesChange={setCreateConfigOverrides}
                onRefresh={onRefreshInheritance}
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
              {renderMachineSelect(deleteMachineId, setDeleteMachineId, setDeleteSshCommand)}
              {selectedDeleteMachine && <KeyValues data={{ machine_id: selectedDeleteMachine.id, host: selectedDeleteMachine.host, auth: selectedDeleteMachine.authType, secret: selectedDeleteMachine.privateKeyPresent || selectedDeleteMachine.passwordPresent ? "saved" : "missing" }} />}
              <label>
                <span>Runtime ID</span>
                <input value={deleteRuntimeId} onChange={(event) => setDeleteRuntimeId(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 Runtime ID" />
              </label>
              <label>
                <span>SSH Command</span>
                <input value={deleteSshCommand} onChange={(event) => setDeleteSshCommand(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 SSH Command" />
              </label>
              <label>
                <span>Private Key</span>
                <textarea value={deletePrivateKey} onChange={(event) => setDeletePrivateKey(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 Private Key" rows={6} />
                <span className="field-hint">覆盖项。正常情况下不用填，后端会注入已保存的目标 SSH 凭据。</span>
              </label>
              <label className="inline-check drawer-inline-check">
                <input type="checkbox" checked={deleteForce} onChange={(event) => setDeleteForce(event.target.checked)} disabled={pending} />
                <span>Force when running executions exist</span>
              </label>
            </div>
          ) : isCreateInstance ? (
            <div className="runtime-drawer-form">
              {renderMachineSelect(createMachineId, setCreateMachineId, setCreateSshCommand)}
              <label>
                <span>Instance ID</span>
                <input value={instanceCreateId} onChange={(event) => setInstanceCreateId(event.target.value)} disabled={pending} placeholder="wiki-sop-new-instance" />
              </label>
              <label>
                <span>Instance Repo</span>
                <input value={instanceCreateRepo} onChange={(event) => setInstanceCreateRepo(event.target.value)} disabled={pending} placeholder="skkeoriw/wiki-sop-new-instance" />
              </label>
              <label>
                <span>SOP Type</span>
                <input value={instanceCreateSopType} onChange={(event) => setInstanceCreateSopType(event.target.value)} disabled={pending} placeholder="youtube-research-wiki" />
              </label>
              <label>
                <span>SSH Command</span>
                <input value={createSshCommand} onChange={(event) => setCreateSshCommand(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 SSH Command" />
              </label>
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
              {renderMachineSelect(deleteMachineId, setDeleteMachineId, setDeleteSshCommand)}
              <label>
                <span>Instance ID</span>
                <input value={instanceDeleteId} onChange={(event) => setInstanceDeleteId(event.target.value)} disabled={pending} placeholder="wiki-sop-old-instance" />
              </label>
              <label>
                <span>Instance Repo</span>
                <input value={instanceDeleteRepo} onChange={(event) => setInstanceDeleteRepo(event.target.value)} disabled={pending} placeholder="skkeoriw/wiki-sop-old-instance" />
              </label>
              <label>
                <span>SSH Command</span>
                <input value={deleteSshCommand} onChange={(event) => setDeleteSshCommand(event.target.value)} disabled={pending} placeholder="留空时使用管理端保存的 SSH Command" />
              </label>
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
          <button type="submit" className={isCreate ? "primary" : "primary danger-action"} disabled={pending || (isCreate ? !createReady : !deleteReady)}>
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
}: {
  preview: RuntimeInheritancePreview | undefined;
  loading: boolean;
  error: string;
  overrides: Record<string, string>;
  onOverridesChange: (value: Record<string, string>) => void;
  onRefresh: () => void;
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
  const visibleItems = items.filter((item) => importantKeys.has(item.key) || item.required);
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
  const depths = new Map<string, number>();
  const parents = new Map<string, string[]>();
  dag.nodes.forEach((node) => parents.set(node.id, []));
  dag.edges.forEach((edge) => parents.set(edge.target, [...(parents.get(edge.target) || []), edge.source]));
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id) || 0;
    const value = (parents.get(id) || []).length ? Math.max(...(parents.get(id) || []).map(depth)) + 1 : 0;
    depths.set(id, value);
    return value;
  };
  const rows = new Map<number, number>();
  return dag.nodes.map((stage) => {
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
  return (dag?.edges || []).map((edge) => ({
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
