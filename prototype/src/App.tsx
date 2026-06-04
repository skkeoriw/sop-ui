import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Background, Controls, Edge, Handle, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Info,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  X
} from "lucide-react";
import { getMode, getProvider, normalizeEndpoint, setMode as writeMode } from "./data/provider";
import { queryKeys } from "./data/query-keys";
import type { Artifact, Dag, DagNode, DataMode, Instance, NodeEvent, Run, Runtime, StageStatus } from "./data/types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";

interface StageNodeData extends Record<string, unknown> {
  stage: DagNode;
  status: StageStatus;
  selected: boolean;
  onInfo: (id: string) => void;
}

const statusOrder: StageStatus[] = ["failed", "running", "waiting", "skipped", "done"];

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
  stage_start:        { icon: "⏳", label: "开始执行" },
  stage_done:         { icon: "✅", label: "执行完成" },
  stage_failed:       { icon: "❌", label: "执行失败" },
  stage_skipped:      { icon: "⏭️", label: "已跳过" },
  tg_notify_sent:     { icon: "📤", label: "TG 通知" },
  tg_notify_failed:   { icon: "📤", label: "TG 通知失败" },
  pipeline_cancelled: { icon: "🚫", label: "Pipeline 已取消" },
  node_retry:         { icon: "🔄", label: "节点重试" },
  node_cancelled:     { icon: "🚫", label: "节点已取消" },
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
      {isTg && <span className={`status-pill ${ok ? "done" : "failed"}`}>{ok ? "✅" : "❌"}</span>}
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

  useEffect(() => { if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id); }, [runtimeId, runtimes]);
  useEffect(() => { if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId); }, [instanceId, instances]);
  useEffect(() => { if (runs.length && !runs.some((run) => run.pipelineId === selectedRunId)) setSelectedRunId(runs[0].pipelineId); }, [runs, selectedRunId]);
  useEffect(() => { if (dag?.nodes.length && !dag.nodes.some((stage) => stage.id === selectedStageId)) setSelectedStageId(dag.nodes[0].id); }, [dag, selectedStageId]);
  useEffect(() => { setInstanceId(""); setSelectedRunId(""); setSelectedStageId(""); }, [runtimeId]);
  useEffect(() => { setSelectedRunId(""); setSelectedStageId(""); }, [instanceId]);
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
  const queryError = [runtimesQuery.error, instancesQuery.error, dagQuery.error, runsQuery.error, runQuery.error, nodeQuery.error].find(Boolean);
  const completedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "done").length : 0;
  const failedCount = selectedRun ? Object.values(selectedRun.nodes).filter((v) => v === "failed").length : 0;

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SOP Prototype</strong>
            <span>{mode === "real" ? "真实 SOP SPI" : "Mock workflow console"}</span>
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
          <div className="mode-switch" aria-label="数据模式">
            <button type="button" className={mode === "real" ? "active" : ""} onClick={() => changeMode("real")}>Real</button>
            <button type="button" className={mode === "mock" ? "active" : ""} onClick={() => changeMode("mock")}>Mock</button>
          </div>
          <button type="button" onClick={refresh}><RefreshCw size={16} />Refresh</button>
          <button type="button" className="primary" disabled={!runtime || !instance} onClick={() => setTriggerOpen(true)}><Play size={16} />Trigger</button>
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
          <div className="section-title"><span>Instances</span><span>{instances.length}</span></div>
          {instances.map((item) => (
            <button key={item.instanceId} type="button" className={`list-card ${instance?.instanceId === item.instanceId ? "active" : ""}`} onClick={() => setInstanceId(item.instanceId)}>
              <strong>{item.title}</strong><span>{item.instanceId}</span><span>{item.repo}</span>
            </button>
          ))}
          {!instances.length && <LoadingOrEmpty loading={instancesQuery.isLoading} text="当前 Runtime 没有 enabled instance" />}
        </section>
        <section className="runs-section">
          <div className="section-title"><span>Runs</span><span>{runs.length}</span></div>
          {sortedRuns.map((run) => (
            <button key={run.pipelineId} type="button" className={`run-card ${selectedRun?.pipelineId === run.pipelineId ? "active" : ""}`} onClick={() => setSelectedRunId(run.pipelineId)}>
              <div className="row"><strong>{run.pipelineId}</strong><span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span></div>
              <span>{run.updatedAt || run.startedAt}</span><span>{run.sourceUrl || run.repo}</span>
            </button>
          ))}
          {!runs.length && <LoadingOrEmpty loading={runsQuery.isLoading} text="当前 Instance 还没有 Run" />}
        </section>
      </aside>

      <main className="main">
        <section className="summary-grid">
          <div className="overview-panel">
            <div className="row">
              <span className={`status-pill ${runtime?.localStatus === "ok" ? "done" : "waiting"}`}><Activity size={14} />{mode === "real" ? "真实数据" : "Mock 数据"}</span>
              <span>{runtime?.endpoint || "-"}</span>
            </div>
            <h1>{instance?.title || "SOP Workflow"}</h1>
            <p>{mode === "real" ? "当前页面直接读取 tunnel-admin 和 SOP SPI，不在前端保存业务数据。" : "Mock 模式用于交互开发和接口异常 fallback。"}</p>
          </div>
          <Metric label="Stages done" value={`${completedCount}/${dag?.nodes.length || 0}`} subtext="selected run" />
          <Metric label="Active runs" value={runs.filter((run) => run.status === "running").length} subtext="current runtime" />
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
                  <X size={14} />Cancel Run
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
          <div className="panel-head compact"><strong>Run Timeline</strong><span>点击 Stage 查看详情 · ⓘ 查看节点配置</span></div>
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
      </main>

      {/* ── Inspector panel ── */}
      <aside className="inspector">
        {showNodeConfig ? (
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
                  <button key={tab} type="button" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>{tab}</button>
                ))}
              </div>
            </div>

            <div className="inspector-body">
              {!selectedStage || !selectedRun || !instance || !runtime ? <Empty text="选择一个 Run 和 Stage 查看详情" /> : (
                <>
                  {/* ── config tab: static node configuration ── */}
                  {inspectorTab === "config" && (
                    <>
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
                            ["pipeline", selectedRun.pipelineId],
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

                      <DetailBlock title="Actual Outputs">
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
                      <DetailBlock title={`Actual Artifacts · ${nodeQuery.data?.artifacts.length || 0}`}>
                        <ArtifactList artifacts={nodeQuery.data?.artifacts || []} />
                      </DetailBlock>
                      <DetailBlock title={`Discovered Candidates · ${nodeQuery.data?.discoveredCandidates?.length || 0}`}>
                        <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Run，不会作为下游节点输入。</p>
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
              <div><h2>{mode === "real" ? "触发真实 SOP Run" : "Trigger mock run"}</h2><span>{mode === "real" ? "此操作会在服务机器上启动真实流程。" : "创建模拟 pipeline 并观察状态推进。"}</span></div>
              <button type="button" onClick={() => setTriggerOpen(false)}>Close</button>
            </div>
            <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />
            <label>YouTube URL<input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} /></label>
            {mode === "real" && <label className="confirm-row"><input type="checkbox" checked={confirmRealTrigger} onChange={(event) => setConfirmRealTrigger(event.target.checked)} />我确认要触发真实 SOP Run</label>}
            {triggerMutation.error && <div className="inline-error">{String(triggerMutation.error.message)}</div>}
            <div className="modal-actions">
              <button type="button" onClick={() => setTriggerOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={triggerMutation.isPending || (mode === "real" && !confirmRealTrigger)}>
                <Play size={16} />{triggerMutation.isPending ? "Submitting" : mode === "real" ? "Trigger real run" : "Start mock run"}
              </button>
            </div>
          </form>
        </div>
      )}
      {toast && <div className="toast"><CircleDot size={15} />{toast}</div>}
    </div>
  );
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
