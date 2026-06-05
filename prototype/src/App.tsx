import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Background, Controls, Edge, Handle, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock,
  Info,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
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
  NodeEvent,
  NodeRegistryItem,
  Run,
  Runtime,
  StageStatus
} from "./data/types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";
type AppView = "workflow" | "nodes";

interface StageNodeData extends Record<string, unknown> {
  stage: DagNode;
  status: StageStatus;
  selected: boolean;
  onInfo: (id: string) => void;
}

const statusOrder: StageStatus[] = ["failed", "running", "waiting", "skipped", "done"];

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
  const { stage, status, selected, onInfo } = data;
  return (
    <div className={`flow-node-wrap ${selected ? "selected" : ""}`}>
      <button type="button" className={`flow-node ${status}`}>
        <Handle type="target" position={Position.Left} />
        <div className="node-top">
          <span className={`status-pill ${status}`}>{statusIcon(status)}{statusLabel(status)}</span>
          <span className="node-mode">{stage.mode}</span>
        </div>
        <strong>{stage.title}</strong>
        <span>{stage.summary || stage.id}</span>
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
  const [confirmRealTrigger, setConfirmRealTrigger] = useState(false);
  const [toast, setToast] = useState("");
  const [showNodeConfig, setShowNodeConfig] = useState(false);
  const [nodeConfigId, setNodeConfigId] = useState("");
  const [rawLogOpen, setRawLogOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"live" | "reconnecting" | "polling fallback" | "closed">("closed");
  const [viewMode, setViewMode] = useState<AppView>("workflow");
  const [executionSearch, setExecutionSearch] = useState("");
  const [executionFilter, setExecutionFilter] = useState<"all" | StageStatus>("all");
  const [selectedManagedNodeId, setSelectedManagedNodeId] = useState("");
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
  const runs = runsQuery.data || [];
  const selectedRunSummary = runs.find((run) => run.pipelineId === selectedRunId) || runs[0];

  const runQuery = useQuery({
    queryKey: queryKeys.run(mode, runtime, instance?.instanceId || "", selectedRunSummary?.pipelineId || ""),
    queryFn: () => provider.getRun(runtime, instance.instanceId, selectedRunSummary.pipelineId),
    enabled: Boolean(runtime && instance && selectedRunSummary),
    refetchInterval: (query) => (query.state.data?.status === "running" && streamStatus !== "live" ? 15000 : false)
  });
  const selectedRun = runQuery.data || selectedRunSummary;
  const dag = dagQuery.data;
  const selectedStage = dag?.nodes.find((stage) => stage.id === selectedStageId) || dag?.nodes[0];
  const selectedStageKey = selectedStage?.id || "";
  const selectedStatus = selectedStage ? selectedRun?.nodes[selectedStage.id] || "waiting" : "waiting";

  const nodeQuery = useQuery({
    queryKey: queryKeys.node(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || "", selectedStageKey),
    queryFn: () => provider.getNode(runtime, instance.instanceId, selectedRun.pipelineId, selectedStageKey),
    enabled: Boolean(runtime && instance && selectedRun && selectedStage)
  });
  const logQuery = useQuery({
    queryKey: queryKeys.log(mode, runtime, instance?.instanceId || "", selectedRun?.pipelineId || "", selectedStageKey),
    queryFn: () => provider.getNodeLog(runtime, instance.instanceId, selectedRun.pipelineId, selectedStageKey),
    enabled: Boolean(runtime && instance && selectedRun && selectedStage && inspectorTab === "logs")
  });
  const nodeConfigQuery = useQuery({
    queryKey: queryKeys.nodeConfig(mode, runtime, instance?.instanceId || "", nodeConfigId),
    queryFn: () => provider.getNodeConfig(runtime, instance.instanceId, nodeConfigId),
    enabled: Boolean(runtime && instance && showNodeConfig && nodeConfigId)
  });
  const nodesQuery = useQuery({
    queryKey: queryKeys.nodes(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listNodes(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance && viewMode === "nodes")
  });
  const nodeDraftsQuery = useQuery({
    queryKey: queryKeys.nodeDrafts(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listNodeDrafts(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance && viewMode === "nodes")
  });
  const managedNodes = nodesQuery.data || [];
  const selectedManagedNode = managedNodes.find((node) => node.nodeId === selectedManagedNodeId) || managedNodes[0];

  const triggerMutation = useMutation({
    mutationFn: () => provider.triggerRun(runtime, instance.instanceId, { repo: instance.repo, url: triggerUrl }),
    onSuccess: async (result) => {
      setTriggerOpen(false);
      setConfirmRealTrigger(false);
      setToast(result.pipelineId ? `已触发 ${result.pipelineId}` : "触发请求已提交");
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, instance.instanceId) });
      if (result.pipelineId) setSelectedRunId(result.pipelineId);
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

  useEffect(() => { if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id); }, [runtimeId, runtimes]);
  useEffect(() => { if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId); }, [instanceId, instances]);
  useEffect(() => { if (runs.length && !runs.some((run) => run.pipelineId === selectedRunId)) setSelectedRunId(runs[0].pipelineId); }, [runs, selectedRunId]);
  useEffect(() => { if (dag?.nodes.length && !dag.nodes.some((stage) => stage.id === selectedStageId)) setSelectedStageId(dag.nodes[0].id); }, [dag, selectedStageId]);
  useEffect(() => { setInstanceId(""); setSelectedRunId(""); setSelectedStageId(""); }, [runtimeId]);
  useEffect(() => { setSelectedRunId(""); setSelectedStageId(""); }, [instanceId]);
  useEffect(() => { setSelectedManagedNodeId(""); }, [runtimeId, instanceId]);
  useEffect(() => { if (managedNodes.length && !managedNodes.some((node) => node.nodeId === selectedManagedNodeId)) setSelectedManagedNodeId(managedNodes[0].nodeId); }, [managedNodes, selectedManagedNodeId]);
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
    const refreshFromEvent = () => {
      setStreamStatus("live");
      queryClient.invalidateQueries({ queryKey: ["sop", mode] });
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
      setStreamStatus("live");
    };
    stream.onerror = () => {
      setStreamStatus("reconnecting");
      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => setStreamStatus("polling fallback"), 5000);
    };
    return () => {
      window.clearTimeout(fallbackTimer);
      eventTypes.forEach((eventType) => stream.removeEventListener(eventType, refreshFromEvent));
      stream.close();
      setStreamStatus("closed");
    };
  }, [mode, runtime?.id, instance?.instanceId, selectedRun?.pipelineId, selectedRun?.status, queryClient]);
  useEffect(() => {
    if (!initialEndpoint || !runtimes.length) return;
    const matched = runtimes.find((item) => normalizeEndpoint(item.endpoint) === initialEndpoint);
    if (matched && runtimeId !== matched.id) setRuntimeId(matched.id);
  }, [initialEndpoint, runtimes, runtimeId]);

  const flowNodes = useMemo(() => buildFlowNodes(dag, selectedRun, selectedStageId, openNodeConfig), [dag, selectedRun, selectedStageId]);
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
  const queryError = [runtimesQuery.error, instancesQuery.error, dagQuery.error, runsQuery.error, runQuery.error, nodeQuery.error, nodesQuery.error, nodeDraftsQuery.error].find(Boolean);
  const completedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "done").length : 0;
  const failedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "failed").length : 0;
  const artifactCount = (nodeQuery.data?.artifacts || []).length;

  function changeMode(nextMode: DataMode) {
    writeMode(nextMode);
    setMode(nextMode);
    setManualRuntime(undefined);
    setRuntimeId(""); setInstanceId(""); setSelectedRunId(""); setSelectedStageId("");
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SOP Prototype</strong>
            <span>{mode === "real" ? "Execution console · Real SPI" : "Execution console · Mock data"}</span>
          </div>
        </div>
        <div className="runtime-switch" role="tablist" aria-label="Runtime selector">
          {runtimes.map((item) => (
            <button key={item.id} type="button" className={`runtime-tab ${runtime?.id === item.id ? "active" : ""}`} role="tab" aria-selected={runtime?.id === item.id} onClick={() => setRuntimeId(item.id)}>
              <Server size={16} /><span>{item.name}</span><small>{item.machine || item.localStatus}</small>
            </button>
          ))}
        </div>
        <div className="top-actions">
          <div className="view-switch" aria-label="主视图">
            <button type="button" className={viewMode === "workflow" ? "active" : ""} onClick={() => setViewMode("workflow")}>Workflow</button>
            <button type="button" className={viewMode === "nodes" ? "active" : ""} onClick={() => setViewMode("nodes")}>Nodes</button>
          </div>
          <div className="mode-switch" aria-label="数据模式">
            <button type="button" className={mode === "real" ? "active" : ""} onClick={() => changeMode("real")}>Real</button>
            <button type="button" className={mode === "mock" ? "active" : ""} onClick={() => changeMode("mock")}>Mock</button>
          </div>
          <button type="button" onClick={refresh}><RefreshCw size={16} />Refresh</button>
          <button type="button" className="primary" disabled={!runtime || !instance} onClick={() => setTriggerOpen(true)}><Play size={16} />New Execution</button>
        </div>
      </header>

      {queryError && <div className="error-banner">数据请求失败：{String((queryError as Error).message || queryError)}</div>}

      <aside className="sidebar">
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
            <button key={run.pipelineId} type="button" className={`run-card ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`} onClick={() => setSelectedRunId(run.pipelineId)}>
              <div className="row"><strong title={run.pipelineId}>{shortId(run.pipelineId)}</strong><span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span></div>
              <span>{run.updatedAt || run.startedAt}</span><span>{run.sourceUrl || run.repo}</span>
            </button>
          ))}
          {!visibleExecutions.length && <LoadingOrEmpty loading={runsQuery.isLoading} text={runs.length ? "没有匹配的 Execution" : "当前 Workspace 还没有 Execution"} />}
        </section>
      </aside>

      <main className={`main ${viewMode === "nodes" ? "nodes-main" : ""}`}>
        {viewMode === "workflow" ? (
          <>
            <section className="summary-grid">
              <div className="overview-panel">
                <div className="row">
                  <span className={`status-pill ${runtime?.localStatus === "ok" ? "done" : "waiting"}`}><Activity size={14} />{mode === "real" ? "真实数据" : "Mock 数据"}</span>
                  <span>{runtime?.endpoint || "-"}</span>
                </div>
                <h1>{instance?.title || "SOP Workflow"}</h1>
                <p>{mode === "real" ? "当前页面直接读取 tunnel-admin 和 SOP SPI，不在前端保存业务数据。" : "Mock 模式用于交互开发和接口异常 fallback。"}</p>
              </div>
              <Metric label="Stages done" value={`${completedCount}/${dag?.nodes.length || 0}`} subtext="selected execution" />
              <Metric label="Active executions" value={runs.filter((run) => run.status === "running").length} subtext="current runtime" />
              <Metric label="Artifacts" value={artifactCount} subtext="selected node" />
              <Metric label="Live events" value={streamStatus} subtext={streamStatusHint(streamStatus)} />
            </section>

            <section className="flow-panel">
              <div className="panel-head">
                <div>
                  <strong>DAG Canvas</strong>
                  <span>{selectedRun?.pipelineId || instance?.instanceId || "-"}</span>
                </div>
                <div className="head-actions">
                  {selectedRun?.status === "running" && (
                    <button type="button" className="btn-danger-sm" disabled={cancelRunMutation.isPending} onClick={handleCancelRun}>
                      <X size={14} />Cancel Execution
                    </button>
                  )}
                  {selectedRun && <span className={`status-pill ${selectedRun.status}`}>{statusLabel(selectedRun.status)}</span>}
                  <button type="button" onClick={() => dag?.nodes[0] && setSelectedStageId(dag.nodes[0].id)}><Search size={15} />Focus</button>
                </div>
              </div>
              <div className="flow-wrap">
                {dagQuery.isLoading ? <Skeleton /> : dag?.nodes.length ? (
                  <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .18 }} minZoom={.35} maxZoom={1.7} nodesDraggable onNodeClick={(_, node) => setSelectedStageId(node.id)} defaultEdgeOptions={{ className: "flow-edge" }}>
                    <Background color="#dfe4ec" gap={24} /><Controls showInteractive={false} /><MiniMap nodeStrokeWidth={3} zoomable pannable />
                  </ReactFlow>
                ) : <Empty text="选择 Runtime 和 Instance 后加载 DAG" />}
              </div>
            </section>

            <section className="timeline-panel">
              <div className="panel-head compact"><strong>Execution Timeline</strong><span>点击 Stage 查看详情 · Info 查看节点配置</span></div>
              <div className="timeline">
                {(dag?.nodes || []).map((stage) => {
                  const state = selectedRun?.nodes[stage.id] || "waiting";
                  return (
                    <button key={stage.id} type="button" className={selectedStage?.id === stage.id ? "active" : ""} onClick={() => setSelectedStageId(stage.id)}>
                      <span className={`dot ${state}`} /><strong>{stage.title}</strong><span>{statusLabel(state)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <NodesWorkspace
            instance={instance}
            runtime={runtime}
            nodes={managedNodes}
            drafts={nodeDraftsQuery.data || []}
            loading={nodesQuery.isLoading}
            selectedNodeId={selectedManagedNode?.nodeId || ""}
            onSelectNode={setSelectedManagedNodeId}
            onOpenDraft={() => setDraftOpen(true)}
          />
        )}
      </main>

      {/* ── Inspector panel ── */}
      <aside className="inspector">
        {viewMode === "nodes" ? (
          <NodeManagerInspector node={selectedManagedNode} drafts={nodeDraftsQuery.data || []} loading={nodesQuery.isLoading} />
        ) : showNodeConfig ? (
          /* Node Config Panel — static, run-independent */
          <>
            <div className="inspector-head">
              <div className="row">
                <div>
                  <h2>{nodeConfigQuery.data?.title || nodeConfigId || "节点配置"}</h2>
                  <span>{nodeConfigQuery.data?.mode || "加载中…"}</span>
                </div>
                <button type="button" className="icon-btn" title="返回 Inspector" onClick={() => setShowNodeConfig(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="inspector-body">
              {nodeConfigQuery.isLoading ? <Skeleton /> : !nodeConfigQuery.data ? <Empty text="节点配置加载失败" /> : (() => {
                const cfg = nodeConfigQuery.data;
                return (
                  <>
                    <DetailBlock title="Executor">
                      <KeyValues data={Object.fromEntries(Object.entries(cfg.executor || {}).filter(([, v]) => v))} />
                      {cfg.skillScript && <div className="kv"><div className="kv-row"><span>script</span><code title={cfg.skillScript}>{cfg.skillScript}</code></div></div>}
                    </DetailBlock>

                    {(cfg.needs?.length ?? 0) > 0 && (
                      <DetailBlock title="Depends On">
                        <div className="needs-list">{cfg.needs!.map((n) => <span key={n} className="needs-chip">{n}</span>)}</div>
                      </DetailBlock>
                    )}

                    <DetailBlock title="Input Contract">
                      <KeyValues data={cfg.inputs as Record<string, unknown> || {}} />
                    </DetailBlock>
                    <DetailBlock title="Output Contract">
                      <KeyValues data={cfg.outputs as Record<string, unknown> || {}} />
                    </DetailBlock>

                    {cfg.optionalInputs && Object.keys(cfg.optionalInputs).length > 0 && (
                      <DetailBlock title="Optional Inputs">
                        <KeyValues data={cfg.optionalInputs as Record<string, unknown>} />
                      </DetailBlock>
                    )}

                    <DetailBlock title="Capabilities">
                      <div className="capabilities-grid">
                        <CapabilityRow label="TG Notify" enabled={cfg.infra?.tgNotify !== false} />
                        <CapabilityRow label="Log Record" enabled={cfg.infra?.logRecord !== false} />
                      </div>
                    </DetailBlock>

                    {cfg.params && Object.keys(cfg.params).length > 0 && (
                      <DetailBlock title="Params"><KeyValues data={cfg.params as Record<string, unknown>} /></DetailBlock>
                    )}

                    {cfg.skillReadme && (
                      <DetailBlock title="Skill README">
                        <pre className="log-box" style={{ fontSize: 11, maxHeight: 260 }}>{cfg.skillReadme}</pre>
                      </DetailBlock>
                    )}
                    {cfg.manifest && Object.keys(cfg.manifest).length > 0 && (
                      <DetailBlock title="Node Manifest"><KeyValues data={cfg.manifest} /></DetailBlock>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          /* Run Inspector */
          <>
            <div className="inspector-head">
              <div className="row">
                <div>
                  <h2>{selectedStage?.title || "Node Inspector"}</h2>
                  <span>{selectedStage?.mode || "选择 DAG 节点"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {selectedStage && <span className={`status-pill ${selectedStatus}`}>{statusIcon(selectedStatus)}{statusLabel(selectedStatus)}</span>}
                  {selectedStage && (
                    <button type="button" className="icon-btn" title="查看节点配置" onClick={() => openNodeConfig(selectedStageKey)}>
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
            </div>

            <div className="inspector-body">
              {!selectedStage || !selectedRun || !instance || !runtime ? <Empty text="选择一个 Execution 和 Stage 查看详情" /> : (
                <>
                  {/* ── config tab: static node configuration ── */}
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
                        {nodeQuery.data?.executor ? (
                          <KeyValues data={Object.fromEntries(Object.entries(nodeQuery.data.executor).filter(([, v]) => v))} />
                        ) : <Empty text="选择节点后加载" />}
                      </DetailBlock>

                      <DetailBlock title="Input Contract">
                        <KeyValues data={nodeQuery.data?.declaredInputs || selectedStage.inputs} />
                      </DetailBlock>

                      <DetailBlock title="Output Contract">
                        <KeyValues data={nodeQuery.data?.declaredOutputs || selectedStage.outputs} />
                      </DetailBlock>

                      <DetailBlock title="Capabilities">
                        <KeyValues data={nodeQuery.data?.capabilities || {
                          telegram: { enabled: nodeQuery.data?.infra?.tgNotify !== false },
                          log: { enabled: nodeQuery.data?.infra?.logRecord !== false }
                        }} />
                      </DetailBlock>
                      {nodeQuery.data?.plan && <DetailBlock title="Wiki Build Plan"><KeyValues data={nodeQuery.data.plan} /></DetailBlock>}
                    </>
                  )}

                  {/* ── run tab: runtime execution details ── */}
                  {inspectorTab === "run" && (
                    <>
                      <DetailBlock title="Execution">
                        <div className="kv">
                          {[
                            ["execution", selectedRun.pipelineId],
                            ["run_id", nodeQuery.data?.runId || "-"],
                            ["started", nodeQuery.data?.startedAt || "-"],
                            ["finished", nodeQuery.data?.finishedAt || "-"],
                            ["instance", instance.instanceId],
                            ["repo", instance.repo],
                          ].map(([key, value]) => (
                            <div key={key} className="kv-row"><span>{key}</span><code>{value}</code></div>
                          ))}
                        </div>
                      </DetailBlock>

                      {/* Validation */}
                      {nodeQuery.data?.validation && (
                        <DetailBlock title="Output Validation">
                          <ValidationSummary validation={nodeQuery.data.validation} />
                        </DetailBlock>
                      )}

                      <DetailBlock title="Resolved Inputs">
                        <KeyValues data={nodeQuery.data?.resolvedInputs || {}} />
                      </DetailBlock>

                      <DetailBlock title="Recorded Outputs">
                        <KeyValues data={nodeQuery.data?.actualOutputs || {}} />
                      </DetailBlock>

                      {/* Error */}
                      {nodeQuery.data?.error && (
                        <DetailBlock title="Error">
                          <pre className="log-box error-log">{nodeQuery.data.error}</pre>
                        </DetailBlock>
                      )}

                      {/* Operations */}
                      <DetailBlock title="Operations">
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(selectedStatus === "failed" || selectedStatus === "cancelled" || selectedStatus === "done") && (
                            <button type="button" className="retry-button" disabled={retryMutation.isPending} onClick={handleRetry}>
                              <RotateCcw size={16} />{retryMutation.isPending ? "重试中…" : "Retry"}
                            </button>
                          )}
                          {selectedStatus === "running" && (
                            <button type="button" className="cancel-button" disabled={cancelNodeMutation.isPending} onClick={handleCancelNode}>
                              <X size={16} />{cancelNodeMutation.isPending ? "取消中…" : "Cancel Node"}
                            </button>
                          )}
                        </div>
                      </DetailBlock>
                    </>
                  )}

                  {/* ── artifacts tab ── */}
                  {inspectorTab === "artifacts" && (
                    <>
                      <DetailBlock title={`Recorded Artifacts · ${nodeQuery.data?.artifacts.length || 0}`}>
                        <ArtifactList artifacts={nodeQuery.data?.artifacts || []} />
                      </DetailBlock>
                      <DetailBlock title={`Unverified Candidates · ${nodeQuery.data?.discoveredCandidates?.length || 0}`}>
                        <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Execution，不会作为下游节点输入。</p>
                        <ArtifactList artifacts={nodeQuery.data?.discoveredCandidates || []} />
                      </DetailBlock>
                    </>
                  )}

                  {/* ── logs tab: structured events + raw log ── */}
                  {inspectorTab === "logs" && (
                    <>
                      {logQuery.isLoading ? <Skeleton /> : (
                        <>
                          {(logQuery.data?.events ?? []).length > 0 && (
                            <DetailBlock title="Events">
                              <div className="event-list">
                                {(logQuery.data?.events ?? []).map((ev, i) => <EventRow key={i} event={ev} />)}
                              </div>
                            </DetailBlock>
                          )}
                          <DetailBlock title={
                            <button type="button" className="log-toggle" onClick={() => setRawLogOpen((v) => !v)}>
                              Raw Log {rawLogOpen ? "▲" : "▼"}
                            </button> as unknown as string
                          }>
                            {rawLogOpen && <pre className="log-box">{logQuery.data?.log || "没有日志"}</pre>}
                            {!rawLogOpen && <div className="empty-state" style={{ fontSize: 12 }}>点击 Raw Log 展开</div>}
                          </DetailBlock>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>

      {triggerOpen && runtime && instance && (
        <div className="modal-backdrop" role="presentation">
          <form className="trigger-modal" onSubmit={(event) => { event.preventDefault(); triggerMutation.mutate(); }}>
            <div className="modal-head">
              <div><h2>{mode === "real" ? "创建真实 Execution" : "Create mock execution"}</h2><span>{mode === "real" ? "此操作会在服务机器上启动真实流程。" : "创建模拟 pipeline 并观察状态推进。"}</span></div>
              <button type="button" onClick={() => setTriggerOpen(false)}>Close</button>
            </div>
            <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />
            <label>YouTube URL<input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} /></label>
            {mode === "real" && <label className="confirm-row"><input type="checkbox" checked={confirmRealTrigger} onChange={(event) => setConfirmRealTrigger(event.target.checked)} />我确认要创建真实 Execution</label>}
            {triggerMutation.error && <div className="inline-error">{String(triggerMutation.error.message)}</div>}
            <div className="modal-actions">
              <button type="button" onClick={() => setTriggerOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={triggerMutation.isPending || (mode === "real" && !confirmRealTrigger)}>
                <Play size={16} />{triggerMutation.isPending ? "Submitting" : mode === "real" ? "Create real execution" : "Start mock execution"}
              </button>
            </div>
          </form>
        </div>
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
      {toast && <div className="toast"><CircleDot size={15} />{toast}</div>}
    </div>
  );
}

function NodesWorkspace({
  instance,
  runtime,
  nodes,
  drafts,
  loading,
  selectedNodeId,
  onSelectNode,
  onOpenDraft,
}: {
  instance: Instance | undefined;
  runtime: Runtime | undefined;
  nodes: NodeRegistryItem[];
  drafts: NodeDraft[];
  loading: boolean;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onOpenDraft: () => void;
}) {
  const completeNodes = nodes.filter((node) => (node.missingFields || []).length === 0).length;
  return (
    <>
      <section className="node-summary">
        <div>
          <span className="status-pill running"><Activity size={14} />Node Manager v1</span>
          <h1>{instance?.title || "SOP Nodes"}</h1>
          <p>{runtime?.endpoint || "选择 Runtime 后加载节点注册表"}</p>
        </div>
        <Metric label="Nodes" value={nodes.length} subtext="registered in SOP" />
        <Metric label="Complete" value={`${completeNodes}/${nodes.length || 0}`} subtext="metadata ready" />
        <Metric label="Drafts" value={drafts.length} subtext="not published" />
      </section>

      <section className="nodes-board">
        <div className="panel-head">
          <div>
            <strong>Node Registry</strong>
            <span>节点能力、Skill、输入输出和附属能力</span>
          </div>
          <span className="status-pill waiting">Publish disabled</span>
        </div>
        {loading ? <Skeleton /> : nodes.length ? (
          <div className="node-registry-list">
            {nodes.map((node) => (
              <button key={node.nodeId} type="button" className={`node-registry-row ${selectedNodeId === node.nodeId ? "active" : ""}`} onClick={() => onSelectNode(node.nodeId)}>
                <div>
                  <strong>{node.title || node.nodeId}</strong>
                  <span>{node.description || node.mode || "SOP node"}</span>
                </div>
                <span className="status-pill running">{String(node.case || node.executor?.type || "node")}</span>
                <CapabilityMini node={node} />
                <span className={`status-pill ${(node.missingFields || []).length ? "waiting" : "done"}`}>
                  {(node.missingFields || []).length ? `${node.missingFields?.length} missing` : "ready"}
                </span>
              </button>
            ))}
          </div>
        ) : <Empty text="当前 Instance 没有返回 Node Registry" />}
      </section>

      <section className="node-draft-panel">
        <div className="panel-head compact">
          <div>
            <strong>Create Node Draft</strong>
            <span>草稿创建改为抽屉承载，避免节点列表被表单挤压。</span>
          </div>
          <button type="button" className="primary" disabled={!instance || !runtime} onClick={onOpenDraft}>
            <CheckCircle2 size={16} />Open Draft
          </button>
        </div>
        <div className="compact-draft">
          <p>Draft 只写入 `raw/node-drafts` 并返回校验结果；Apply / Publish 第一版保持禁用。</p>
          <div className="draft-list">
            {drafts.slice(0, 3).map((draft) => (
              <article key={draft.draftId} className="draft-item">
                <strong>{draft.draftId}</strong>
                <code>{formatValue(draft.validation)}</code>
              </article>
            ))}
            {!drafts.length && <Empty text="还没有节点草稿" />}
          </div>
        </div>
      </section>
    </>
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

function capabilityEnabled(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "object" && value) return (value as Record<string, unknown>).enabled !== false;
  return false;
}

function buildFlowNodes(dag: Dag | undefined, run: Run | undefined, selectedStageId: string, onInfo: (id: string) => void): Node<StageNodeData>[] {
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
      position: { x: 40 + column * 300, y: 70 + row * 175 },
      data: { stage, status: run?.nodes[stage.id] || "waiting", selected: selectedStageId === stage.id, onInfo }
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

function LoadingOrEmpty({ loading, text }: { loading: boolean; text: string }) {
  return loading ? <Skeleton /> : <Empty text={text} />;
}

function Skeleton() {
  return <div className="skeleton" aria-label="loading"><i /><i /><i /></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
