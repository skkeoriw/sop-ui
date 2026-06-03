import { FormEvent, memo, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Edge,
  Handle,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  useReactFlow
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  GitBranch,
  ListRestart,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Terminal
} from "lucide-react";
import { baseRuns, nodeLog, RunMock, runtimes, StageMock, stages, stageState, StageStatus } from "./mock";

type InspectorTab = "overview" | "inputs" | "outputs" | "logs";

interface StageNodeData extends Record<string, unknown> {
  stage: StageMock;
  status: StageStatus;
  selected: boolean;
}

const statusOrder: StageStatus[] = ["failed", "running", "waiting", "done"];

function statusLabel(status: StageStatus) {
  return status === "done" ? "Done" : status === "running" ? "Running" : status === "failed" ? "Failed" : "Waiting";
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
      <span>{stage.summary}</span>
      <div className="node-progress">
        <i style={{ width: status === "done" ? "100%" : status === "running" ? "62%" : status === "failed" ? "100%" : "0%" }} />
      </div>
      <Handle type="source" position={Position.Right} />
    </button>
  );
});

const nodeTypes = { stage: StageNode };

function useMockQuery<T>(key: string[], data: T) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      return data;
    }
  });
}

export default function App() {
  const [runtimeId, setRuntimeId] = useState(runtimes[0].id);
  const [runs, setRuns] = useState<RunMock[]>(baseRuns);
  const [selectedRunId, setSelectedRunId] = useState(baseRuns[0].pipelineId);
  const [selectedStageId, setSelectedStageId] = useState("notebooklm-research");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerUrl, setTriggerUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  const runtime = runtimes.find((item) => item.id === runtimeId) || runtimes[0];
  const runtimeQuery = useMockQuery(["runtime", runtimeId], runtime);
  const selectedRun = runs.find((run) => run.pipelineId === selectedRunId) || runs[0];
  const states = stageState(selectedRun.profile, selectedRun.status);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) || stages[0];
  const selectedStatus = states[selectedStage.id] || "waiting";

  useEffect(() => {
    setSelectedRunId(runs[0].pipelineId);
    setSelectedStageId("notebooklm-research");
  }, [runtimeId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const nodes: Node<StageNodeData>[] = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {
      "youtube-fetch": { x: 40, y: 128 },
      "notebooklm-research": { x: 330, y: 82 },
      "youtube-deep-research": { x: 330, y: 258 },
      "wiki-build": { x: 635, y: 82 },
      "tg-notify": { x: 930, y: 82 }
    };
    return stages.map((stage) => ({
      id: stage.id,
      type: "stage",
      position: positions[stage.id],
      data: {
        stage,
        status: states[stage.id] || "waiting",
        selected: selectedStageId === stage.id
      }
    }));
  }, [selectedStageId, states]);

  const edges: Edge[] = useMemo(
    () => [
      { id: "fetch-notebook", source: "youtube-fetch", target: "notebooklm-research" },
      { id: "fetch-deep", source: "youtube-fetch", target: "youtube-deep-research", animated: states["youtube-deep-research"] === "running" },
      { id: "notebook-wiki", source: "notebooklm-research", target: "wiki-build", animated: states["wiki-build"] === "running" },
      { id: "wiki-tg", source: "wiki-build", target: "tg-notify", animated: states["tg-notify"] === "running" }
    ],
    [states]
  );

  function refresh() {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setToast("Mock runtime state refreshed");
    }, 520);
  }

  function trigger(event: FormEvent) {
    event.preventDefault();
    const now = new Date();
    const id = `mock-${now.toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;
    const nextRun: RunMock = {
      pipelineId: id,
      status: "running",
      sourceUrl: triggerUrl,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      profile: "initial"
    };
    setRuns((items) => [nextRun, ...items]);
    setSelectedRunId(id);
    setSelectedStageId("youtube-fetch");
    setTriggerOpen(false);
    setToast("Mock run created");

    window.setTimeout(() => {
      setRuns((items) => items.map((run) => (run.pipelineId === id ? { ...run, profile: "wiki-running", updatedAt: new Date().toISOString() } : run)));
      setSelectedStageId("wiki-build");
    }, 1500);

    window.setTimeout(() => {
      setRuns((items) =>
        items.map((run) => (run.pipelineId === id ? { ...run, profile: "done", status: "done", updatedAt: new Date().toISOString() } : run))
      );
      setToast("Mock run completed");
    }, 3400);
  }

  function retryStage() {
    if (selectedStatus !== "failed") return;
    setToast(`Retrying ${selectedStage.title}`);
    setRuns((items) => items.map((run) => (run.pipelineId === selectedRunId ? { ...run, status: "running", profile: "wiki-running" } : run)));
    window.setTimeout(() => {
      setRuns((items) => items.map((run) => (run.pipelineId === selectedRunId ? { ...run, status: "done", profile: "done" } : run)));
      setToast(`${selectedStage.title} recovered`);
    }, 1800);
  }

  const completedCount = Object.values(states).filter((status) => status === "done").length;
  const sortedRuns = [...runs].sort((a, b) => {
    const statusDelta = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
    if (statusDelta !== 0) return statusDelta;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div>
            <strong>SOP Prototype</strong>
            <span>Mock workflow console</span>
          </div>
        </div>

        <div className="runtime-switch" role="tablist" aria-label="Runtime selector">
          {runtimes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`runtime-tab ${runtimeId === item.id ? "active" : ""}`}
              role="tab"
              aria-selected={runtimeId === item.id}
              onClick={() => setRuntimeId(item.id)}
            >
              <Server size={16} />
              <span>{item.name}</span>
              <small>{item.machine}</small>
            </button>
          ))}
        </div>

        <div className="top-actions">
          <button type="button" onClick={refresh} disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Refresh
          </button>
          <button type="button" className="primary" onClick={() => setTriggerOpen(true)}>
            <Play size={16} />
            Trigger
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <section>
          <div className="section-title">
            <span>Runtime</span>
            <span>{runtimeQuery.isLoading ? "loading" : "mock"}</span>
          </div>
          <div className="runtime-card">
            <div className="row">
              <strong>{runtime.name}</strong>
              <span className="status-pill done">
                <CheckCircle2 size={14} />
                ok
              </span>
            </div>
            <code>{runtime.endpoint}</code>
            <span>{runtime.machine} service machine</span>
          </div>
        </section>

        <section>
          <div className="section-title">
            <span>Instance</span>
            <span>enabled</span>
          </div>
          <button type="button" className="list-card active">
            <strong>YouTube Wiki SOP</strong>
            <span>{runtime.instanceId}</span>
            <span>{runtime.repo}</span>
          </button>
        </section>

        <section className="runs-section">
          <div className="section-title">
            <span>Runs</span>
            <span>{runs.length}</span>
          </div>
          {sortedRuns.map((run) => (
            <button
              type="button"
              key={run.pipelineId}
              className={`run-card ${selectedRunId === run.pipelineId ? "active" : ""}`}
              onClick={() => {
                setSelectedRunId(run.pipelineId);
                setSelectedStageId("notebooklm-research");
              }}
            >
              <div className="row">
                <strong>{run.pipelineId}</strong>
                <span className={`status-pill ${run.status}`}>{statusLabel(run.status)}</span>
              </div>
              <span>{run.updatedAt}</span>
              <span>{run.sourceUrl}</span>
            </button>
          ))}
        </section>
      </aside>

      <main className="main">
        <section className="summary-grid">
          <div className="overview-panel">
            <div className="row">
              <span className="status-pill done">
                <Activity size={14} />
                Runtime healthy
              </span>
              <span>{runtime.endpoint}</span>
            </div>
            <h1>YouTube Wiki SOP</h1>
            <p>
              A React mock prototype for validating the workflow operations experience before wiring real SOP SPI data.
            </p>
          </div>
          <Metric label="Stages done" value={`${completedCount}/5`} subtext="selected run" />
          <Metric label="Active runs" value={runs.filter((run) => run.status === "running").length} subtext="mock queue" />
          <Metric label="Failed nodes" value={Object.values(states).filter((status) => status === "failed").length} subtext="retry ready" />
        </section>

        <section className="flow-panel">
          <div className="panel-head">
            <div>
              <strong>DAG Canvas</strong>
              <span>{selectedRun.pipelineId}</span>
            </div>
            <div className="head-actions">
              <span className={`status-pill ${selectedRun.status}`}>{statusLabel(selectedRun.status)}</span>
              <button type="button" onClick={() => setSelectedStageId("youtube-fetch")}>
                <Search size={15} />
                Focus
              </button>
            </div>
          </div>
          <div className="flow-wrap">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.45}
              maxZoom={1.6}
              nodesDraggable
              onNodeClick={(_, node) => setSelectedStageId(node.id)}
              defaultEdgeOptions={{ className: "flow-edge" }}
            >
              <Background color="#dfe4ec" gap={24} />
              <Controls showInteractive={false} />
              <MiniMap nodeStrokeWidth={3} zoomable pannable />
            </ReactFlow>
          </div>
        </section>

        <section className="timeline-panel">
          <div className="panel-head compact">
            <strong>Run Timeline</strong>
            <span>Stage state preview</span>
          </div>
          <div className="timeline">
            {stages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={selectedStageId === stage.id ? "active" : ""}
                onClick={() => setSelectedStageId(stage.id)}
              >
                <span className={`dot ${states[stage.id]}`} />
                <strong>{stage.title}</strong>
                <span>{statusLabel(states[stage.id])}</span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <aside className="inspector">
        <div className="inspector-head">
          <div className="row">
            <div>
              <h2>{selectedStage.title}</h2>
              <span>{selectedStage.mode} node inspector</span>
            </div>
            <span className={`status-pill ${selectedStatus}`}>
              {statusIcon(selectedStatus)}
              {statusLabel(selectedStatus)}
            </span>
          </div>
          <div className="tabs">
            {(["overview", "inputs", "outputs", "logs"] as InspectorTab[]).map((tab) => (
              <button key={tab} type="button" className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="inspector-body">
          {inspectorTab === "overview" && (
            <>
              <DetailBlock title="Runtime Context">
                <KeyValues
                  data={{
                    runtime: runtime.id,
                    instance: runtime.instanceId,
                    repo: runtime.repo,
                    pipeline: selectedRun.pipelineId,
                    mode: selectedStage.mode
                  }}
                />
              </DetailBlock>
              <DetailBlock title="Stage Summary">
                <p className="body-copy">{selectedStage.summary}</p>
                {selectedStatus === "failed" && (
                  <button type="button" className="retry-button" onClick={retryStage}>
                    <RotateCcw size={16} />
                    Retry failed stage
                  </button>
                )}
              </DetailBlock>
            </>
          )}
          {inspectorTab === "inputs" && (
            <DetailBlock title="Inputs">
              <KeyValues data={selectedStage.inputs} />
            </DetailBlock>
          )}
          {inspectorTab === "outputs" && (
            <DetailBlock title="Outputs">
              <KeyValues data={selectedStage.outputs} />
            </DetailBlock>
          )}
          {inspectorTab === "logs" && (
            <DetailBlock title="Logs">
              <pre className="log-box">{nodeLog(selectedStage.id, selectedStatus)}</pre>
            </DetailBlock>
          )}
        </div>
      </aside>

      {triggerOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="trigger-modal" onSubmit={trigger}>
            <div className="modal-head">
              <div>
                <h2>Trigger mock run</h2>
                <span>Create a simulated pipeline and watch stages advance.</span>
              </div>
              <button type="button" onClick={() => setTriggerOpen(false)}>
                Close
              </button>
            </div>
            <label>
              YouTube URL
              <input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} />
            </label>
            <label>
              Repo
              <input value={runtime.repo} readOnly />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setTriggerOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary">
                <Play size={16} />
                Start mock run
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && (
        <div className="toast">
          <CircleDot size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, subtext }: { label: string; value: string | number; subtext: string }) {
  return (
    <div className="metric-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="detail-block">
      <div className="section-title">
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function KeyValues({ data }: { data: Record<string, string> }) {
  return (
    <div className="kv">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="kv-row">
          <span>{key}</span>
          <code>{value}</code>
        </div>
      ))}
    </div>
  );
}
