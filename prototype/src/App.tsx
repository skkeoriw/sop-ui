import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import { Background, Controls, Edge, Handle, MiniMap, Node, NodeProps, Position, ReactFlow } from "@xyflow/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server
} from "lucide-react";
import { getMode, getProvider, normalizeEndpoint, setMode as writeMode } from "./data/provider";
import { queryKeys } from "./data/query-keys";
import type { Artifact, Dag, DagNode, DataMode, Instance, Run, Runtime, StageStatus } from "./data/types";

type InspectorTab = "overview" | "inputs" | "outputs" | "logs";

interface StageNodeData extends Record<string, unknown> {
  stage: DagNode;
  status: StageStatus;
  selected: boolean;
}

const statusOrder: StageStatus[] = ["failed", "running", "waiting", "skipped", "done"];

function statusLabel(status: StageStatus) {
  return status === "done" ? "Done" : status === "running" ? "Running" : status === "failed" ? "Failed" : status === "skipped" ? "Skipped" : "Waiting";
}

function statusIcon(status: StageStatus) {
  if (status === "done") return <CheckCircle2 size={15} />;
  if (status === "running") return <Loader2 size={15} className="spin" />;
  if (status === "failed") return <AlertTriangle size={15} />;
  return <Clock size={15} />;
}

const StageNode = memo(({ data }: NodeProps<Node<StageNodeData>>) => {
  const { stage, status, selected } = data;
  return (
    <button type="button" className={`flow-node ${status} ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-top">
        <span className={`status-pill ${status}`}>
          {statusIcon(status)}
          {statusLabel(status)}
        </span>
        <span className="node-mode">{stage.mode}</span>
      </div>
      <strong>{stage.title}</strong>
      <span>{stage.summary || stage.id}</span>
      <div className="node-progress">
        <i style={{ width: status === "done" ? "100%" : status === "running" ? "62%" : status === "failed" ? "100%" : "0%" }} />
      </div>
      <Handle type="source" position={Position.Right} />
    </button>
  );
});

const nodeTypes = { stage: StageNode };

export default function App() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<DataMode>(getMode);
  const provider = useMemo(() => getProvider(mode), [mode]);
  const [manualRuntime, setManualRuntime] = useState<Runtime>();
  const [manualEndpoint, setManualEndpoint] = useState("");
  const [runtimeId, setRuntimeId] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerUrl, setTriggerUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [confirmRealTrigger, setConfirmRealTrigger] = useState(false);
  const [toast, setToast] = useState("");

  const runtimesQuery = useQuery({
    queryKey: queryKeys.runtimes(mode),
    queryFn: () => provider.listRuntimes(),
    retry: 1
  });
  const runtimes = useMemo(() => {
    const items = runtimesQuery.data || [];
    return manualRuntime && !items.some((item) => item.endpoint === manualRuntime.endpoint) ? [manualRuntime, ...items] : items;
  }, [manualRuntime, runtimesQuery.data]);
  const runtime = runtimes.find((item) => item.id === runtimeId) || runtimes[0];

  const instancesQuery = useQuery({
    queryKey: queryKeys.instances(mode, runtime),
    queryFn: () => provider.listInstances(runtime),
    enabled: Boolean(runtime)
  });
  const instances = instancesQuery.data || [];
  const instance = instances.find((item) => item.instanceId === instanceId) || instances[0];

  const dagQuery = useQuery({
    queryKey: queryKeys.dag(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.getDag(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance)
  });
  const runsQuery = useQuery({
    queryKey: queryKeys.runs(mode, runtime, instance?.instanceId || ""),
    queryFn: () => provider.listRuns(runtime, instance.instanceId),
    enabled: Boolean(runtime && instance),
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === "running") ? 3000 : false)
  });
  const runs = runsQuery.data || [];
  const selectedRunSummary = runs.find((run) => run.pipelineId === selectedRunId) || runs[0];

  const runQuery = useQuery({
    queryKey: queryKeys.run(mode, runtime, instance?.instanceId || "", selectedRunSummary?.pipelineId || ""),
    queryFn: () => provider.getRun(runtime, instance.instanceId, selectedRunSummary.pipelineId),
    enabled: Boolean(runtime && instance && selectedRunSummary),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false)
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
    mutationFn: () => provider.retryNode!(runtime, instance.instanceId, selectedRun.pipelineId, selectedStageKey),
    onSuccess: async () => {
      setToast(`${selectedStage?.title || selectedStageKey} 已进入重试`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.runs(mode, runtime, instance.instanceId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.run(mode, runtime, instance.instanceId, selectedRun.pipelineId) });
    }
  });

  useEffect(() => {
    if (runtimes.length && !runtimes.some((item) => item.id === runtimeId)) setRuntimeId(runtimes[0].id);
  }, [runtimeId, runtimes]);
  useEffect(() => {
    if (instances.length && !instances.some((item) => item.instanceId === instanceId)) setInstanceId(instances[0].instanceId);
  }, [instanceId, instances]);
  useEffect(() => {
    if (runs.length && !runs.some((run) => run.pipelineId === selectedRunId)) setSelectedRunId(runs[0].pipelineId);
  }, [runs, selectedRunId]);
  useEffect(() => {
    if (dag?.nodes.length && !dag.nodes.some((stage) => stage.id === selectedStageId)) setSelectedStageId(dag.nodes[0].id);
  }, [dag, selectedStageId]);
  useEffect(() => {
    setInstanceId("");
    setSelectedRunId("");
    setSelectedStageId("");
  }, [runtimeId]);
  useEffect(() => {
    setSelectedRunId("");
    setSelectedStageId("");
  }, [instanceId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const flowNodes = useMemo(() => buildFlowNodes(dag, selectedRun, selectedStageId), [dag, selectedRun, selectedStageId]);
  const flowEdges = useMemo(() => buildFlowEdges(dag, selectedRun), [dag, selectedRun]);
  const sortedRuns = [...runs].sort((a, b) => {
    const delta = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    return delta || b.updatedAt.localeCompare(a.updatedAt);
  });
  const queryError = [runtimesQuery.error, instancesQuery.error, dagQuery.error, runsQuery.error, runQuery.error, nodeQuery.error, logQuery.error].find(Boolean);

  function changeMode(nextMode: DataMode) {
    writeMode(nextMode);
    setMode(nextMode);
    setManualRuntime(undefined);
    setRuntimeId("");
    setInstanceId("");
    setSelectedRunId("");
    setSelectedStageId("");
  }

  function addManualEndpoint(event: FormEvent) {
    event.preventDefault();
    const endpoint = normalizeEndpoint(manualEndpoint);
    if (!endpoint) return;
    const item: Runtime = {
      id: `manual:${endpoint}`,
      name: endpoint.replace(/^https?:\/\//, ""),
      endpoint,
      status: "manual",
      localStatus: "unknown",
      manual: true
    };
    setManualRuntime(item);
    setRuntimeId(item.id);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["sop", mode] });
    setToast("数据已刷新");
  }

  const completedCount = selectedRun ? Object.values(selectedRun.nodes).filter((value) => value === "done").length : 0;
  const failedCount = selectedRun ? Object.values(selectedRun.nodes).filter((value) => value === "failed").length : 0;

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
            <button
              key={item.id}
              type="button"
              className={`runtime-tab ${runtime?.id === item.id ? "active" : ""}`}
              role="tab"
              aria-selected={runtime?.id === item.id}
              onClick={() => setRuntimeId(item.id)}
            >
              <Server size={16} />
              <span>{item.name}</span>
              <small>{item.machine || item.localStatus}</small>
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
              <div className="row">
                <strong>{runtime.name}</strong>
                <span className={`status-pill ${runtime.localStatus === "ok" ? "done" : "waiting"}`}>{runtime.localStatus}</span>
              </div>
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
          <Metric label="Active runs" value={runs.filter((run) => run.status === "running").length} subtext="自动每 3 秒刷新" />
          <Metric label="Failed nodes" value={failedCount} subtext={mode === "real" ? "真实 Retry SPI 未提供" : "mock retry 可用"} />
        </section>

        <section className="flow-panel">
          <div className="panel-head">
            <div><strong>DAG Canvas</strong><span>{selectedRun?.pipelineId || instance?.instanceId || "-"}</span></div>
            <div className="head-actions">
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
          <div className="panel-head compact"><strong>Run Timeline</strong><span>点击 Stage 查看详情</span></div>
          <div className="timeline">
            {(dag?.nodes || []).map((stage) => {
              const state = selectedRun?.nodes[stage.id] || "waiting";
              return <button key={stage.id} type="button" className={selectedStage?.id === stage.id ? "active" : ""} onClick={() => setSelectedStageId(stage.id)}><span className={`dot ${state}`} /><strong>{stage.title}</strong><span>{statusLabel(state)}</span></button>;
            })}
          </div>
        </section>
      </main>

      <aside className="inspector">
        <div className="inspector-head">
          <div className="row">
            <div><h2>{selectedStage?.title || "Node Inspector"}</h2><span>{selectedStage?.mode || "选择 DAG 节点"}</span></div>
            {selectedStage && <span className={`status-pill ${selectedStatus}`}>{statusIcon(selectedStatus)}{statusLabel(selectedStatus)}</span>}
          </div>
          <div className="tabs">
            {(["overview", "inputs", "outputs", "logs"] as InspectorTab[]).map((tab) => <button key={tab} type="button" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>{tab}</button>)}
          </div>
        </div>
        <div className="inspector-body">
          {!selectedStage || !selectedRun || !instance || !runtime ? <Empty text="选择一个 Run 和 Stage 查看详情" /> : (
            <>
              {inspectorTab === "overview" && (
                <>
                  <DetailBlock title="Runtime Context"><KeyValues data={{ runtime: runtime.id, instance: instance.instanceId, repo: instance.repo, pipeline: selectedRun.pipelineId, mode: nodeQuery.data?.mode || selectedStage.mode }} /></DetailBlock>
                  <DetailBlock title="Executor"><KeyValues data={nodeQuery.data?.executor || {}} /></DetailBlock>
                  {nodeQuery.data?.validation && (
                    <DetailBlock title="Output Validation">
                      <ValidationSummary validation={nodeQuery.data.validation} />
                    </DetailBlock>
                  )}
                  <DetailBlock title="Stage Summary">
                    <p className="body-copy">{nodeQuery.data?.error || selectedStage.summary || selectedStage.id}</p>
                    {selectedStatus === "failed" && (mode === "mock" && provider.retryNode
                      ? <button type="button" className="retry-button" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate()}><RotateCcw size={16} />Retry failed stage</button>
                      : <button type="button" className="retry-button" disabled title="真实 Retry SPI 尚未提供"><RotateCcw size={16} />真实 Retry SPI 尚未提供</button>)}
                  </DetailBlock>
                </>
              )}
              {inspectorTab === "inputs" && (
                <>
                  <DetailBlock title="Declared Inputs"><KeyValues data={nodeQuery.data?.declaredInputs || selectedStage.inputs} /></DetailBlock>
                  <DetailBlock title="Resolved Inputs"><KeyValues data={nodeQuery.data?.resolvedInputs || {}} /></DetailBlock>
                </>
              )}
              {inspectorTab === "outputs" && (
                <>
                  <DetailBlock title="Declared Outputs"><KeyValues data={nodeQuery.data?.declaredOutputs || selectedStage.outputs} /></DetailBlock>
                  <DetailBlock title="Actual Outputs"><KeyValues data={nodeQuery.data?.actualOutputs || {}} /></DetailBlock>
                  <DetailBlock title={`Artifacts · ${nodeQuery.data?.artifacts.length || 0}`}>
                    <ArtifactList artifacts={nodeQuery.data?.artifacts || []} />
                  </DetailBlock>
                  <DetailBlock title={`Discovered Candidates · ${nodeQuery.data?.discoveredCandidates.length || 0}`}>
                    <p className="candidate-warning">这些文件来自共享路径扫描，无法确认属于当前 Run，不会作为下游节点输入。</p>
                    <ArtifactList artifacts={nodeQuery.data?.discoveredCandidates || []} />
                  </DetailBlock>
                </>
              )}
              {inspectorTab === "logs" && <DetailBlock title="Logs">{logQuery.isLoading ? <Skeleton /> : <pre className="log-box">{logQuery.data?.log || "没有日志"}</pre>}</DetailBlock>}
            </>
          )}
        </div>
      </aside>

      {triggerOpen && runtime && instance && (
        <div className="modal-backdrop" role="presentation">
          <form className="trigger-modal" onSubmit={(event) => { event.preventDefault(); triggerMutation.mutate(); }}>
            <div className="modal-head"><div><h2>{mode === "real" ? "触发真实 SOP Run" : "Trigger mock run"}</h2><span>{mode === "real" ? "此操作会在服务机器上启动真实流程。" : "创建模拟 pipeline 并观察状态推进。"}</span></div><button type="button" onClick={() => setTriggerOpen(false)}>Close</button></div>
            <KeyValues data={{ endpoint: runtime.endpoint, instance: instance.instanceId, repo: instance.repo }} />
            <label>YouTube URL<input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} /></label>
            {mode === "real" && <label className="confirm-row"><input type="checkbox" checked={confirmRealTrigger} onChange={(event) => setConfirmRealTrigger(event.target.checked)} />我确认要触发真实 SOP Run</label>}
            {triggerMutation.error && <div className="inline-error">{String(triggerMutation.error.message)}</div>}
            <div className="modal-actions"><button type="button" onClick={() => setTriggerOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={triggerMutation.isPending || (mode === "real" && !confirmRealTrigger)}><Play size={16} />{triggerMutation.isPending ? "Submitting" : mode === "real" ? "Trigger real run" : "Start mock run"}</button></div>
          </form>
        </div>
      )}
      {toast && <div className="toast"><CircleDot size={15} />{toast}</div>}
    </div>
  );
}

function buildFlowNodes(dag: Dag | undefined, run: Run | undefined, selectedStageId: string): Node<StageNodeData>[] {
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
    return { id: stage.id, type: "stage", position: { x: 40 + column * 300, y: 70 + row * 175 }, data: { stage, status: run?.nodes[stage.id] || "waiting", selected: selectedStageId === stage.id } };
  });
}

function buildFlowEdges(dag: Dag | undefined, run: Run | undefined): Edge[] {
  return (dag?.edges || []).map((edge) => ({ id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, animated: run?.nodes[edge.target] === "running" }));
}

function Metric({ label, value, subtext }: { label: string; value: string | number; subtext: string }) {
  return <div className="metric-panel"><span>{label}</span><strong>{value}</strong><small>{subtext}</small></div>;
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
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
  return (
    <div className={`validation-summary ${validation.status}`}>
      <div className="row"><strong>{validation.status === "passed" ? "Contract passed" : "Contract warning"}</strong><span className={`status-pill ${validation.status === "passed" ? "done" : "waiting"}`}>{validation.status}</span></div>
      {validation.missingOutputs.length > 0 && <p>缺失输出：{validation.missingOutputs.join(", ")}</p>}
      {validation.unexpectedOutputs.length > 0 && <p>意外输出：{validation.unexpectedOutputs.join(", ")}</p>}
      {!validation.missingOutputs.length && !validation.unexpectedOutputs.length && <p>声明输出均已解析到实际产物。</p>}
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  const [openId, setOpenId] = useState("");
  if (!artifacts.length) return <Empty text="当前历史 Run 没有解析到 Artifact" />;
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
