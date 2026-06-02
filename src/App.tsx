import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ENDPOINT,
  getDag,
  getManifest,
  getNodeDetail,
  getNodeLog,
  getRun,
  getRuns,
  nodeTitle,
  normalizeEndpoint,
  triggerRun
} from "./api";
import type { DagEdge, DagNode, NodeDetail, NodeLog, SopDag, SopRun, SopSummary } from "./types";

const STATUS_ORDER = ["failed", "running", "waiting", "skipped", "done"];

function statusClass(status = "waiting") {
  if (status === "done") return "done";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  return "waiting";
}

function getInitialEndpoint() {
  const url = new URL(window.location.href);
  return normalizeEndpoint(url.searchParams.get("endpoint") || DEFAULT_ENDPOINT);
}

function compact(value?: string) {
  if (!value) return "-";
  return value.length > 90 ? `${value.slice(0, 88)}...` : value;
}

function KeyValues({ data }: { data?: Record<string, string> }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <div className="empty">No data</div>;
  return (
    <div className="kv">
      {entries.map(([key, value]) => (
        <div className="kv-row" key={key}>
          <span>{key}</span>
          <code title={value}>{compact(value)}</code>
        </div>
      ))}
    </div>
  );
}

function layoutDag(nodes: DagNode[], edges: DagEdge[]) {
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => incoming.set(node.id, []));
  edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]));

  const depth = new Map<string, number>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id) || 0;
    const parents = incoming.get(id) || [];
    const value = parents.length ? Math.max(...parents.map(visit)) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  nodes.forEach((node) => visit(node.id));

  const columns = new Map<number, DagNode[]>();
  nodes.forEach((node) => {
    const col = depth.get(node.id) || 0;
    columns.set(col, [...(columns.get(col) || []), node]);
  });

  const positions = new Map<string, { x: number; y: number }>();
  Array.from(columns.entries()).forEach(([col, items]) => {
    items.forEach((node, index) => {
      positions.set(node.id, {
        x: 36 + col * 260,
        y: 72 + index * 154
      });
    });
  });
  return positions;
}

function DagView({
  dag,
  run,
  selectedNode,
  onSelectNode
}: {
  dag?: SopDag;
  run?: SopRun;
  selectedNode?: string;
  onSelectNode: (id: string) => void;
}) {
  const positions = useMemo(() => layoutDag(dag?.nodes || [], dag?.edges || []), [dag]);
  const positionList: Array<{ x: number; y: number }> = Array.from(positions.values());
  const width = Math.max(900, ...positionList.map((position) => position.x + 230));
  const height = Math.max(430, ...positionList.map((position) => position.y + 120));

  if (!dag) {
    return <div className="canvas-empty">Select a SOP to load its DAG.</div>;
  }

  return (
    <div className="dag-scroll">
      <div className="dag" style={{ width, height }}>
        <svg className="edges" width={width} height={height}>
          {(dag.edges || []).map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            if (!from || !to) return null;
            const x1 = from.x + 210;
            const y1 = from.y + 45;
            const x2 = to.x;
            const y2 = to.y + 45;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`${edge.source}-${edge.target}`}
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                markerEnd="url(#arrow)"
              />
            );
          })}
          <defs>
            <marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 z" />
            </marker>
          </defs>
        </svg>

        {(dag.nodes || []).map((node) => {
          const pos = positions.get(node.id) || { x: 0, y: 0 };
          const state = run?.nodes?.[node.id] || "waiting";
          return (
            <button
              key={node.id}
              type="button"
              className={`dag-node ${statusClass(state)} ${selectedNode === node.id ? "selected" : ""}`}
              style={{ left: pos.x, top: pos.y }}
              onClick={() => onSelectNode(node.id)}
            >
              <div className="node-head">
                <strong>{nodeTitle(node)}</strong>
                <span className={`pill ${statusClass(state)}`}>{state}</span>
              </div>
              <div className="node-meta">{node.id}</div>
              <div className="node-meta">{node.mode || "blocking"}</div>
              {node.mode === "sidecar" && <span className="pill sidecar">sidecar</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [endpoint, setEndpoint] = useState(getInitialEndpoint);
  const [endpointDraft, setEndpointDraft] = useState(endpoint);
  const [sops, setSops] = useState<SopSummary[]>([]);
  const [selectedSop, setSelectedSop] = useState("");
  const [dag, setDag] = useState<SopDag>();
  const [runs, setRuns] = useState<SopRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<SopRun>();
  const [selectedNode, setSelectedNode] = useState("");
  const [nodeDetail, setNodeDetail] = useState<NodeDetail>();
  const [nodeLog, setNodeLog] = useState<NodeLog>();
  const [triggerUrl, setTriggerUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [repo, setRepo] = useState("skkeoriw/wiki-sop-dag-smoke");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSopSummary = sops.find((sop) => sop.id === selectedSop);
  const running = run?.status === "running" || Object.values(run?.nodes || {}).some((status) => status === "running");

  const loadManifest = useCallback(async () => {
    setError("");
    const manifest = await getManifest(endpoint);
    const items = manifest.sops || [];
    setSops(items);
    if (!selectedSop && items[0]) {
      setSelectedSop(items[0].id);
      setRepo(items[0].repo || repo);
    }
  }, [endpoint, repo, selectedSop]);

  const loadSopData = useCallback(
    async (sopId: string) => {
      if (!sopId) return;
      setError("");
      const [nextDag, nextRuns] = await Promise.all([getDag(endpoint, sopId), getRuns(endpoint, sopId)]);
      setDag(nextDag);
      setRuns(nextRuns);
      const firstRun = selectedRunId ? nextRuns.find((item) => item.pipeline_id === selectedRunId) : nextRuns[0];
      if (firstRun) {
        setSelectedRunId(firstRun.pipeline_id);
      }
      if (!selectedNode && nextDag.nodes[0]) {
        setSelectedNode(nextDag.nodes[0].id);
      }
    },
    [endpoint, selectedNode, selectedRunId]
  );

  const loadRunData = useCallback(
    async (pipelineId: string) => {
      if (!selectedSop || !pipelineId) return;
      const nextRun = await getRun(endpoint, selectedSop, pipelineId);
      setRun(nextRun);
      setRuns((items) => {
        const others = items.filter((item) => item.pipeline_id !== nextRun.pipeline_id);
        return [nextRun, ...others].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      });
    },
    [endpoint, selectedSop]
  );

  const loadNode = useCallback(
    async (nodeId: string) => {
      if (!selectedSop || !selectedRunId || !nodeId) return;
      setError("");
      const [detail, log] = await Promise.all([
        getNodeDetail(endpoint, selectedSop, selectedRunId, nodeId),
        getNodeLog(endpoint, selectedSop, selectedRunId, nodeId)
      ]);
      setNodeDetail(detail);
      setNodeLog(log);
    },
    [endpoint, selectedRunId, selectedSop]
  );

  useEffect(() => {
    loadManifest().catch((err) => setError(err.message));
  }, [loadManifest]);

  useEffect(() => {
    if (!selectedSop) return;
    loadSopData(selectedSop).catch((err) => setError(err.message));
  }, [loadSopData, selectedSop]);

  useEffect(() => {
    if (!selectedRunId) {
      setRun(undefined);
      return;
    }
    loadRunData(selectedRunId).catch((err) => setError(err.message));
  }, [loadRunData, selectedRunId]);

  useEffect(() => {
    if (!selectedNode) return;
    loadNode(selectedNode).catch((err) => setError(err.message));
  }, [loadNode, selectedNode]);

  useEffect(() => {
    if (!running || !selectedRunId) return;
    const timer = window.setInterval(() => {
      loadRunData(selectedRunId).catch((err) => setError(err.message));
      if (selectedNode) loadNode(selectedNode).catch((err) => setError(err.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadNode, loadRunData, running, selectedNode, selectedRunId]);

  function applyEndpoint(event: FormEvent) {
    event.preventDefault();
    const next = normalizeEndpoint(endpointDraft);
    setEndpoint(next);
    const url = new URL(window.location.href);
    url.searchParams.set("endpoint", next);
    window.history.replaceState({}, "", url);
    setSelectedSop("");
    setDag(undefined);
    setRuns([]);
    setSelectedRunId("");
    setRun(undefined);
    setNodeDetail(undefined);
    setNodeLog(undefined);
  }

  async function refreshAll() {
    try {
      setBusy(true);
      await loadManifest();
      if (selectedSop) await loadSopData(selectedSop);
      if (selectedRunId) await loadRunData(selectedRunId);
      if (selectedNode) await loadNode(selectedNode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitTrigger(event: FormEvent) {
    event.preventDefault();
    if (!selectedSop) return;
    try {
      setBusy(true);
      setError("");
      const result = await triggerRun(endpoint, selectedSop, repo, triggerUrl);
      if (result.pipeline_id) {
        setSelectedRunId(result.pipeline_id);
        setTimeout(() => loadRunData(result.pipeline_id as string).catch((err) => setError(err.message)), 1200);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const statusDiff = STATUS_ORDER.indexOf(statusClass(a.status)) - STATUS_ORDER.indexOf(statusClass(b.status));
      if (statusDiff !== 0) return statusDiff;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
  }, [runs]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo">S</div>
          <div>
            <strong>SOP UI</strong>
            <span>Workflow console</span>
          </div>
        </div>
        <form className="endpoint-form" onSubmit={applyEndpoint}>
          <label>Runtime endpoint</label>
          <input value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} />
          <button type="submit">Apply</button>
        </form>
        <button type="button" onClick={refreshAll} disabled={busy}>
          {busy ? "Refreshing" : "Refresh"}
        </button>
        <span className={`pill ${statusClass(run?.status || "waiting")}`}>{run?.status || "idle"}</span>
      </header>

      {error && <div className="error">API error: {error}</div>}

      <aside className="sidebar">
        <section>
          <div className="section-title">SOPs</div>
          {sops.map((sop) => (
            <button
              type="button"
              className={`list-item ${sop.id === selectedSop ? "active" : ""}`}
              key={sop.id}
              onClick={() => {
                setSelectedSop(sop.id);
                setRepo(sop.repo || repo);
              }}
            >
              <strong>{sop.title || sop.id}</strong>
              <span>{sop.repo || sop.id}</span>
            </button>
          ))}
        </section>

        <section>
          <div className="section-title">Runs</div>
          {sortedRuns.map((item) => (
            <button
              type="button"
              className={`list-item ${item.pipeline_id === selectedRunId ? "active" : ""}`}
              key={item.pipeline_id}
              onClick={() => setSelectedRunId(item.pipeline_id)}
            >
              <div className="run-row">
                <strong>{item.pipeline_id}</strong>
                <span className={`pill ${statusClass(item.status)}`}>{item.status}</span>
              </div>
              <span>{item.updated_at || item.started_at || item.source_url || "-"}</span>
            </button>
          ))}
        </section>
      </aside>

      <main className="main">
        <div className="main-head">
          <div>
            <h1>{selectedSopSummary?.title || "SOP DAG"}</h1>
            <p>{endpoint}</p>
          </div>
          <form className="trigger-form" onSubmit={submitTrigger}>
            <input value={repo} onChange={(event) => setRepo(event.target.value)} aria-label="repo" />
            <input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} aria-label="url" />
            <button type="submit" disabled={busy || !selectedSop}>
              Trigger
            </button>
          </form>
        </div>
        <DagView dag={dag} run={run} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
      </main>

      <aside className="detail">
        <div className="detail-head">
          <h2>{nodeDetail?.node_id || selectedNode || "Node detail"}</h2>
          <span className={`pill ${statusClass(nodeDetail?.status || run?.nodes?.[selectedNode] || "waiting")}`}>
            {nodeDetail?.status || run?.nodes?.[selectedNode] || "waiting"}
          </span>
        </div>
        <section>
          <div className="section-title">Runtime</div>
          <div className="fact-grid">
            <span>pipeline</span>
            <code>{run?.pipeline_id || "-"}</code>
            <span>run_id</span>
            <code>{nodeDetail?.run_id || "-"}</code>
            <span>mode</span>
            <code>{nodeDetail?.mode || dag?.nodes.find((node) => node.id === selectedNode)?.mode || "-"}</code>
            <span>updated</span>
            <code>{nodeDetail?.updated_at || run?.updated_at || "-"}</code>
          </div>
        </section>
        <section>
          <div className="section-title">Inputs</div>
          <KeyValues data={nodeDetail?.inputs || dag?.nodes.find((node) => node.id === selectedNode)?.inputs} />
        </section>
        <section>
          <div className="section-title">Outputs</div>
          <KeyValues data={nodeDetail?.outputs || dag?.nodes.find((node) => node.id === selectedNode)?.outputs} />
        </section>
        <section>
          <div className="section-title">Optional Inputs</div>
          <KeyValues
            data={nodeDetail?.optional_inputs || dag?.nodes.find((node) => node.id === selectedNode)?.optional_inputs}
          />
        </section>
        <section>
          <div className="section-title">Node Log</div>
          <pre className="log-box">{nodeLog?.log || "No log loaded."}</pre>
        </section>
      </aside>

      <footer className="timeline">
        <div className="section-title">Run Timeline</div>
        <div className="timeline-row">
          {Object.entries(run?.nodes || {}).map(([nodeId, status]) => (
            <button type="button" key={nodeId} onClick={() => setSelectedNode(nodeId)}>
              <span className={`dot ${statusClass(status)}`} />
              <strong>{nodeId}</strong>
              <span>{status}</span>
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
