import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Background, Controls, Edge, Handle, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
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
  RotateCcw,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Workflow,
  X
} from "lucide-react";
import { getMode, getProvider, normalizeEndpoint, setMode as writeMode } from "./data/provider";
import { queryKeys } from "./data/query-keys";
import type {
  Artifact,
  Dag,
  DagNode,
  DataMode,
  Instance,
  NodeDraft,
  NodeDraftInput,
  NodeDetail,
  NodeConfig,
  NodeEvent,
  NodeLog,
  NodeModule,
  NodeModuleDetail,
  NodeRegistryItem,
  Run,
  RunNodeState,
  Runtime,
  StageStatus
} from "./data/types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";
type AppView = "workflow" | "nodes" | "settings";
type AppRoute = { view: AppView; nodeId: string; pipelineId: string; artifactId: string; moduleId: string };
type StreamStatus = "live" | "reconnecting" | "polling fallback" | "closed";
type RunOverlay = Partial<Omit<Run, "pipelineId" | "nodes" | "nodeStates">> & {
  pipelineId: string;
  nodes?: Record<string, StageStatus>;
  nodeStates?: Record<string, RunNodeState>;
};

interface StageNodeData extends Record<string, unknown> {
  stage: DagNode;
  status: StageStatus;
  selected: boolean;
  onSelect: (id: string) => void;
  onInfo: (id: string) => void;
}

const statusOrder: StageStatus[] = ["failed", "running", "waiting", "skipped", "done"];

function readRoute(): AppRoute {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const empty = { nodeId: "", pipelineId: "", artifactId: "", moduleId: "" };
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
  if (view === "nodes") return entityId ? `/nodes/${encodeURIComponent(entityId)}${secondaryId ? `/modules/${encodeURIComponent(secondaryId)}` : ""}` : "/nodes";
  if (view === "workflow") return entityId ? `/workflow/runs/${encodeURIComponent(entityId)}${secondaryId ? `/${encodeURIComponent(secondaryId)}` : ""}` : "/workflow";
  return "/settings";
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
          <span className="node-mode">{stage.mode}</span>
        </div>
        <div className="flow-node-title"><span className="stage-letter">{stage.ui?.stageLetter || stage.id.slice(0, 1).toUpperCase()}</span><strong>{stage.title}</strong></div>
        <span>{String(stage.executor?.type || stage.mode)} · {stage.id}</span>
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

  const dagQuery = useQuery({ queryKey: queryKeys.dag(mode, runtime, instance?.instanceId || ""), queryFn: () => provider.getDag(runtime, instance.instanceId), enabled: Boolean(runtime && instance) });
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
      setConfirmRealDraft(false);
      setToast(`节点草稿已创建：${draft.draftId}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.nodeDrafts(mode, runtime, instance.instanceId) });
    }
  });

  useEffect(() => {
    const routePrefixes = ["/overview", "/runs", "/workflow", "/nodes", "/artifacts", "/settings"];
    if (window.location.pathname === "/" || !routePrefixes.some((prefix) => window.location.pathname === prefix || window.location.pathname.startsWith(`${prefix}/`))) {
      window.history.replaceState(null, "", `${routePath("workflow")}${window.location.search}`);
      setRoute(readRoute());
    }
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => { if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id); }, [runtimeId, runtimes]);
  useEffect(() => { if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId); }, [instanceId, instances]);
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
    const delta = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    return delta || b.updatedAt.localeCompare(a.updatedAt);
  });
  const visibleExecutions = sortedRuns.filter((run) => {
    const query = executionSearch.trim().toLowerCase();
    const matchedStatus = executionFilter === "all" || run.status === executionFilter;
    const searchable = [run.pipelineId, run.sourceUrl, run.repo, run.status].filter(Boolean).join(" ").toLowerCase();
    return matchedStatus && (!query || searchable.includes(query));
  });
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
    const nextPath = routePath(view, entityId, secondaryId);
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
          <button type="button" className={viewMode === "workflow" ? "active" : ""} onClick={() => navigateTo("workflow")}>
            <Network size={17} /><span>Workflow</span><small>{runs.length || "-"} runs</small>
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
          {runtimes.slice(0, 2).map((item) => (
            <button key={item.id} type="button" className={`rail-runtime ${runtime?.id === item.id ? "active" : ""}`} onClick={() => setRuntimeId(item.id)}>
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
            <strong>{instance?.title || "Workspace"}</strong>
          </div>
          <code>{runtime?.endpoint || "No endpoint"}</code>
          <span className={`status-pill ${runtime?.localStatus === "ok" ? "done" : "waiting"}`}>{runtime?.name || "runtime"} · {runtime?.localStatus || "unknown"}</span>
        </div>
        <div className="top-actions">
          <div className="mode-switch" aria-label="数据模式">
            <button type="button" className={mode === "real" ? "active" : ""} onClick={() => changeMode("real")}>Real</button>
            <button type="button" className={mode === "mock" ? "active" : ""} onClick={() => changeMode("mock")}>Mock</button>
          </div>
          <button type="button" onClick={refresh}><RefreshCw size={16} />Refresh</button>
          <button type="button" className="primary" disabled={!runtime || !instance} onClick={() => setTriggerOpen(true)}><Play size={16} />New Execution</button>
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
        {viewMode === "workflow" && !route.pipelineId ? (
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
            runs={visibleExecutions}
            onOpenWorkflow={() => navigateTo("workflow", selectedRun?.pipelineId || runs[0]?.pipelineId || "", selectedStage?.id || dag?.nodes[0]?.id || "")}
          />
        ) : viewMode === "workflow" ? (
          <WorkflowWorkspace
            runtime={runtime}
            instance={instance}
            runs={visibleExecutions}
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
          />
        )}
      </main>

      {triggerOpen && runtime && instance && (
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
          draftInput={draftInput}
          setDraftInput={setDraftInput}
          confirmRealDraft={confirmRealDraft}
          setConfirmRealDraft={setConfirmRealDraft}
          creatingDraft={createDraftMutation.isPending}
          createError={createDraftMutation.error ? String(createDraftMutation.error.message) : ""}
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
            <div className="panel-head compact"><div><strong>Executions</strong><span>选择一个 run 查看 DAG</span></div><span>{runs.length}</span></div>
            <div className="workflow-run-list">
              {runs.slice(0, 8).map((run) => (
                <button
                  key={run.pipelineId}
                  type="button"
                  title={`${run.pipelineId}\n${statusLabel(run.status)} · ${run.progress ?? 0}%\n${run.sourceUrl || run.repo}\n${run.updatedAt || run.startedAt}`}
                  className={`workflow-run-row ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`}
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
                        title: selectedStage.title,
                        mode: selectedStage.mode,
                        summary: selectedStage.summary || "-"
                      }} />
                    </DetailBlock>
                    <DetailBlock title="Executor">
                      {nodeDetail?.executor ? <KeyValues data={Object.fromEntries(Object.entries(nodeDetail.executor).filter(([, value]) => value))} /> : <Empty text="选择节点后加载" />}
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
                    <DetailBlock title="Resolved Inputs">
                      <KeyValues data={nodeDetail?.resolvedInputs || {}} />
                    </DetailBlock>
                    <DetailBlock title="Recorded Outputs">
                      <KeyValues data={nodeDetail?.actualOutputs || {}} />
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
}) {
  return (
    <>
      <section className="concept-hero">
        <div>
          <span className="status-pill waiting"><Settings size={14} />Runtime Settings</span>
          <h1>Runtime / Endpoint / Registry config</h1>
          <p>当前页面只读为主，用于确认 SPI、Registry、Mode 和 SSE/CORS 相关状态。</p>
        </div>
        <div className="context-card">
          <strong>{runtime?.name || "Runtime"}</strong>
          <span>{mode} · {runtime?.localStatus || "unknown"}</span>
          <code>{runtime?.endpoint || "-"}</code>
        </div>
      </section>
      <section className="settings-grid">
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Runtime endpoint</strong><span>SPI consumer context</span></div></div>
          <div className="settings-block">
            <KeyValues data={{
              mode,
              endpoint: runtime?.endpoint || "-",
              runtime_id: runtime?.id || "-",
              local_status: runtime?.localStatus || "-",
              machine: runtime?.machine || "-",
              available_runtimes: runtimes.length,
            }} />
          </div>
        </div>
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Registry instance</strong><span>Enabled workspace</span></div></div>
          <div className="settings-block">
            <KeyValues data={{
              instance: instance?.instanceId || "-",
              title: instance?.title || "-",
              repo: instance?.repo || "-",
              enabled_workspaces: instances.length,
              nodes_ready: `${nodesReadyCount}/${nodesTotal || 0}`,
            }} />
          </div>
        </div>
        <div className="flow-panel">
          <div className="panel-head"><div><strong>SSE / CORS / Health</strong><span>Read-only checks</span></div></div>
          <div className="settings-block">
            <KeyValues data={{
              sse_status: streamStatus,
              cors_options: "public endpoint expected",
              post_trigger_auth: "not configured in UI",
              data_source: "SOP SPI",
            }} />
          </div>
        </div>
        <div className="flow-panel">
          <div className="panel-head"><div><strong>Manual endpoint</strong><span>Real mode helper</span></div></div>
          <form className="settings-block manual-endpoint" onSubmit={onAddManualEndpoint}>
            <label htmlFor="settings-manual-endpoint">Endpoint</label>
            <div><input id="settings-manual-endpoint" value={manualEndpoint} onChange={(event) => setManualEndpoint(event.target.value)} placeholder="https://..." /><button>Apply</button></div>
          </form>
        </div>
      </section>
    </>
  );
}

function NodesWorkspace({
  instance,
  runtime,
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
                  <small>{module.description}</small>
                  <small>{module.summary || "-"}</small>
                </span>
                <span className={`status-pill ${module.status}`}>{module.status}</span>
              </button>
            ))}
            {!modules.length && <Empty text="该节点暂未返回 modules" />}
          </div>
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
          </div>
        </div>
      </div>
      <div className="module-detail-body">
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
