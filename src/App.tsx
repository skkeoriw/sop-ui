import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelNode,
  cancelRun,
  DEFAULT_ENDPOINT,
  getDag,
  getManifest,
  getNodeConfig,
  getRuntimeChannels,
  getNodeDetail,
  getNodeLog,
  getRun,
  getRuns,
  nodeTitle,
  normalizeEndpoint,
  retryNode,
  triggerRun
} from "./api";
import type { Artifact, DagEdge, DagNode, NodeConfig, NodeDetail, NodeEvent, NodeLog, NodeValidation, RuntimeChannel, SopDag, SopRun, SopSummary } from "./types";

type InspectorTab = "config" | "run" | "artifacts" | "logs";

const STATUS_ORDER = ["failed", "running", "waiting", "skipped", "done"];
const PREFERRED_INSTANCE_ID = "wiki-sop-dag-smoke";

function statusClass(status = "waiting") {
  if (status === "done") return "done";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "skipped") return "skipped";
  if (status === "cancelled") return "failed";
  return "waiting";
}

function getInitialEndpoint() {
  const url = new URL(window.location.href);
  return normalizeEndpoint(url.searchParams.get("endpoint") || DEFAULT_ENDPOINT);
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

function KeyValueBlock({ title, data }: { title: string; data?: Record<string, unknown> }) {
  const entries = Object.entries(data || {});
  return (
    <section>
      <div className="section-title">{title}</div>
      {entries.length === 0 ? (
        <div className="empty">No data</div>
      ) : (
        <div className="kv">
          {entries.map(([key, value]) => {
            const display =
              value === null || value === undefined
                ? "-"
                : typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
            const short = display.length > 90 ? `${display.slice(0, 88)}…` : display;
            return (
              <div className="kv-row" key={key}>
                <span>{key}</span>
                <code title={display}>{short}</code>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ValidationBlock({ validation }: { validation: NodeValidation }) {
  const ok = validation.status === "passed";
  return (
    <section>
      <div className="section-title">Output Validation</div>
      <div className={`validation-summary ${ok ? "passed" : "warn"}`}>
        <div className="val-row">
          <strong>{ok ? "Contract passed" : "Contract warning"}</strong>
          <span className={`pill ${ok ? "done" : "waiting"}`}>{validation.status}</span>
        </div>
        {validation.missing_outputs.length > 0 && (
          <p>缺失输出：{validation.missing_outputs.join(", ")}</p>
        )}
        {!validation.missing_outputs.length && !validation.unexpected_outputs.length && (
          <p>声明输出均已解析到实际产物。</p>
        )}
      </div>
    </section>
  );
}

function ArtifactList({ artifacts, unconfirmed }: { artifacts: Artifact[]; unconfirmed?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!artifacts.length)
    return <div className="empty">{unconfirmed ? "无候选文件" : "暂无 Artifact"}</div>;
  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="artifact-item">
          <button
            type="button"
            className="artifact-row"
            onClick={() => setOpenId(openId === artifact.id ? null : artifact.id)}
          >
            <span className="artifact-type">{artifact.type || artifact.format || "file"}</span>
            <span className="artifact-title">{artifact.title || artifact.path}</span>
            <span className="artifact-meta">{artifact.size ? `${(artifact.size / 1024).toFixed(1)} KB` : ""}</span>
            {artifact.resolution && (
              <span className="pill waiting" style={{ fontSize: 10 }}>{artifact.resolution}</span>
            )}
          </button>
          {openId === artifact.id && (
            <pre className="artifact-preview">
              {artifact.preview || "该 Artifact 暂不支持内联预览。"}
              {artifact.preview_truncated && "\n\n[内容已截断]"}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function CapabilityRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="capability-row">
      <span>{label}</span>
      <span className={`pill ${enabled ? "done" : "waiting"}`}>{enabled ? "enabled" : "disabled"}</span>
    </div>
  );
}

const EVENT_META: Record<string, { icon: string; label: string }> = {
  stage_start:         { icon: "⏳", label: "开始执行" },
  stage_done:          { icon: "✅", label: "执行完成" },
  stage_failed:        { icon: "❌", label: "执行失败" },
  stage_skipped:       { icon: "⏭️", label: "已跳过" },
  tg_notify_sent:      { icon: "📤", label: "TG 通知" },
  tg_notify_failed:    { icon: "📤", label: "TG 通知失败" },
  pipeline_cancelled:  { icon: "🚫", label: "Pipeline 已取消" },
  node_retry:          { icon: "🔄", label: "节点重试" },
  node_cancelled:      { icon: "🚫", label: "节点已取消" },
};

function EventRow({ event }: { event: NodeEvent }) {
  const meta = EVENT_META[event.event] || { icon: "•", label: event.event };
  const time = event.ts ? event.ts.slice(11, 19) : "";
  const isTg = event.event.startsWith("tg_notify");
  const ok = event.ok !== false;

  let detail = "";
  if (event.duration_s) detail = `${event.duration_s}s`;
  if (event.trigger) detail = `(${event.trigger})`;
  if (event.error) detail = event.error.slice(0, 60);

  return (
    <div className={`event-row ${isTg && !ok ? "event-error" : ""}`}>
      <span className="event-icon">{meta.icon}</span>
      <span className="event-time">{time}</span>
      <span className="event-label">{meta.label}</span>
      {detail && <span className="event-detail">{detail}</span>}
      {isTg && <span className={`pill ${ok ? "done" : "failed"}`}>{ok ? "✅" : "❌"}</span>}
    </div>
  );
}

function DagView({
  dag,
  run,
  selectedNode,
  onSelectNode,
  onOpenConfig
}: {
  dag?: SopDag;
  run?: SopRun;
  selectedNode?: string;
  onSelectNode: (id: string) => void;
  onOpenConfig?: (id: string) => void;
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
            <div
              key={node.id}
              className={`dag-node-wrap ${selectedNode === node.id ? "selected" : ""}`}
              style={{ left: pos.x, top: pos.y, position: "absolute" }}
            >
              <button
                type="button"
                className={`dag-node ${statusClass(state)}`}
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
              {onOpenConfig && (
                <button
                  type="button"
                  className="node-config-btn"
                  title="查看节点配置"
                  onClick={(e) => { e.stopPropagation(); onOpenConfig(node.id); }}
                >ⓘ</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [endpoint, setEndpoint] = useState(getInitialEndpoint);
  const [endpointDraft, setEndpointDraft] = useState(endpoint);
  const [runtimeChannels, setRuntimeChannels] = useState<RuntimeChannel[]>([]);
  const [runtimeError, setRuntimeError] = useState("");
  const [sops, setSops] = useState<SopSummary[]>([]);
  const [runtimeId, setRuntimeId] = useState("");
  const [channelName, setChannelName] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
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
  const [opBusy, setOpBusy] = useState(false);
  const [opMsg, setOpMsg] = useState("");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("config");
  const [nodeConfig, setNodeConfig] = useState<NodeConfig | null>(null);
  const [showNodeConfig, setShowNodeConfig] = useState(false);

  const selectedSopSummary = sops.find((sop) => sop.id === selectedSop);
  const selectedRuntime = runtimeChannels.find((runtime) => normalizeEndpoint(runtime.channel_url) === endpoint);
  const running = run?.status === "running" || Object.values(run?.nodes || {}).some((status) => status === "running");

  function resetSopState() {
    setSops([]);
    setRuntimeId("");
    setChannelName("");
    setChannelUrl("");
    setSelectedSop("");
    setDag(undefined);
    setRuns([]);
    setSelectedRunId("");
    setRun(undefined);
    setSelectedNode("");
    setNodeDetail(undefined);
    setNodeLog(undefined);
  }

  const loadManifest = useCallback(async () => {
    setError("");
    const manifest = await getManifest(endpoint);
    setRuntimeId(manifest.runtime_id || manifest.runtime || "");
    setChannelName(manifest.channel?.name || "");
    setChannelUrl(manifest.channel?.url || endpoint);
    const items = manifest.sops || [];
    setSops(items);
    if (!selectedSop && items[0]) {
      const preferred =
        items.find((item) => (item.instance_id || item.id) === PREFERRED_INSTANCE_ID) || items[0];
      setSelectedSop(preferred.id);
      setRepo(preferred.repo || repo);
    }
  }, [endpoint, repo, selectedSop]);

  const loadRuntimeChannels = useCallback(async () => {
    setRuntimeError("");
    const channels = await getRuntimeChannels();
    setRuntimeChannels(channels);
  }, []);

  function applyEndpointValue(value: string) {
    const next = normalizeEndpoint(value);
    setEndpoint(next);
    setEndpointDraft(next);
    const url = new URL(window.location.href);
    url.searchParams.set("endpoint", next);
    window.history.replaceState({}, "", url);
    resetSopState();
  }

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
    loadRuntimeChannels().catch((err) => setRuntimeError(err.message));
  }, [loadRuntimeChannels]);

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
    setInspectorTab("config");
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
    applyEndpointValue(endpointDraft);
  }

  async function refreshAll() {
    try {
      setBusy(true);
      await loadRuntimeChannels();
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

  async function openNodeConfig(nodeId: string) {
    if (!selectedSop) return;
    setNodeConfig(null);
    setShowNodeConfig(true);
    try {
      const cfg = await getNodeConfig(endpoint, selectedSop, nodeId);
      setNodeConfig(cfg);
    } catch {
      setShowNodeConfig(false);
    }
  }

  async function handleCancelRun() {
    if (!selectedSop || !selectedRunId) return;
    if (!window.confirm(`确认取消 Run: ${selectedRunId}？\n当前阶段完成后不会触发下一阶段。`)) return;
    try {
      setOpBusy(true);
      setOpMsg("");
      await cancelRun(endpoint, selectedSop, selectedRunId);
      setOpMsg("Run 已取消");
      await loadRunData(selectedRunId);
    } catch (err) {
      setOpMsg(`取消失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpBusy(false);
    }
  }

  async function handleRetryNode() {
    if (!selectedSop || !selectedRunId || !selectedNode) return;
    if (!window.confirm(`确认重试节点: ${selectedNode}？\n将重新启动该阶段的执行脚本。`)) return;
    try {
      setOpBusy(true);
      setOpMsg("");
      await retryNode(endpoint, selectedSop, selectedRunId, selectedNode);
      setOpMsg(`节点 ${selectedNode} 重试中`);
      setTimeout(() => {
        loadRunData(selectedRunId).catch(() => {});
        loadNode(selectedNode).catch(() => {});
      }, 1500);
    } catch (err) {
      setOpMsg(`重试失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpBusy(false);
    }
  }

  async function handleCancelNode() {
    if (!selectedSop || !selectedRunId || !selectedNode) return;
    if (!window.confirm(`确认取消节点: ${selectedNode}？\n节点状态将标记为 cancelled。`)) return;
    try {
      setOpBusy(true);
      setOpMsg("");
      await cancelNode(endpoint, selectedSop, selectedRunId, selectedNode);
      setOpMsg(`节点 ${selectedNode} 已取消`);
      await loadRunData(selectedRunId);
      await loadNode(selectedNode);
    } catch (err) {
      setOpMsg(`取消节点失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setOpBusy(false);
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
          <label>Channel URL</label>
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
          <div className="section-title">Runtime</div>
          {runtimeError && <div className="inline-error">{runtimeError}</div>}
          {runtimeChannels.map((runtime) => (
            <button
              type="button"
              className={`list-item runtime-item ${normalizeEndpoint(runtime.channel_url) === endpoint ? "active" : ""}`}
              key={`${runtime.subdomain}-${runtime.runtime_id}`}
              onClick={() => {
                setRepo(runtime.wiki_repo || repo);
                applyEndpointValue(runtime.channel_url);
              }}
            >
              <div className="run-row">
                <strong>{runtime.channel_name}</strong>
                <span className={`pill ${runtime.status === "active" ? "done" : "waiting"}`}>
                  {runtime.local_status || runtime.status || "unknown"}
                </span>
              </div>
              <span>{runtime.runtime_id}</span>
              <span>{runtime.channel_url}</span>
            </button>
          ))}
          {!runtimeChannels.length && !runtimeError && <div className="empty">No runtimes discovered</div>}
        </section>

        <section>
          <div className="section-title">Instances</div>
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
              <span>{sop.instance_id || sop.id}</span>
              <span>{sop.repo || sop.sop_type || sop.id}</span>
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
            <p>
              Channel: {channelName || selectedRuntime?.channel_name || "-"} | Runtime:{" "}
              {runtimeId || selectedRuntime?.runtime_id || "-"} | URL: {channelUrl || endpoint}
            </p>
            <p>
              Instance: {selectedSopSummary?.instance_id || selectedSop || "-"} | Repo:{" "}
              {selectedSopSummary?.repo || repo || "-"}
            </p>
          </div>
          <form className="trigger-form" onSubmit={submitTrigger}>
            <input value={repo} onChange={(event) => setRepo(event.target.value)} aria-label="repo" />
            <input value={triggerUrl} onChange={(event) => setTriggerUrl(event.target.value)} aria-label="url" />
            <button type="submit" disabled={busy || !selectedSop}>
              Trigger
            </button>
            {running && (
              <button
                type="button"
                className="btn-danger"
                disabled={opBusy}
                onClick={handleCancelRun}
              >
                Cancel Run
              </button>
            )}
          </form>
          {opMsg && <div className={`op-msg ${opMsg.includes("失败") ? "op-error" : "op-ok"}`}>{opMsg}</div>}
        </div>
        <DagView dag={dag} run={run} selectedNode={selectedNode} onSelectNode={setSelectedNode} onOpenConfig={openNodeConfig} />
      </main>

      <aside className="detail">
        {showNodeConfig ? (
          /* ── Node Config Panel (static, run-independent) ── */
          <div className="node-config-panel">
            <div className="detail-head">
              <div className="detail-head-top">
                <div>
                  <h2>{nodeConfig?.title || nodeConfig?.node_id || "节点配置"}</h2>
                  <span className="node-mode">{nodeConfig?.mode || "loading…"}</span>
                </div>
                <button type="button" className="btn-op" style={{ fontSize: 12 }} onClick={() => setShowNodeConfig(false)}>
                  ← 返回 Inspector
                </button>
              </div>
            </div>
            <div className="inspector-body">
              {!nodeConfig ? (
                <div className="empty">加载节点配置…</div>
              ) : (
                <>
                  <section>
                    <div className="section-title">Executor</div>
                    <div className="kv">
                      {Object.entries(nodeConfig.executor || {}).filter(([, v]) => v).map(([k, v]) => (
                        <div className="kv-row" key={k}><span>{k}</span><code>{String(v)}</code></div>
                      ))}
                      {nodeConfig.skill_script && (
                        <div className="kv-row"><span>script</span><code title={nodeConfig.skill_script}>{nodeConfig.skill_script}</code></div>
                      )}
                    </div>
                  </section>
                  {(nodeConfig.needs?.length ?? 0) > 0 && (
                    <section>
                      <div className="section-title">Depends On</div>
                      <div className="needs-list">
                        {nodeConfig.needs!.map((n) => <span key={n} className="needs-chip">{n}</span>)}
                      </div>
                    </section>
                  )}
                  <KeyValueBlock title="Input Contract" data={nodeConfig.inputs as Record<string, unknown>} />
                  <KeyValueBlock title="Output Contract" data={nodeConfig.outputs as Record<string, unknown>} />
                  {nodeConfig.optional_inputs && Object.keys(nodeConfig.optional_inputs).length > 0 && (
                    <KeyValueBlock title="Optional Inputs" data={nodeConfig.optional_inputs as Record<string, unknown>} />
                  )}
                  <section>
                    <div className="section-title">Capabilities</div>
                    <div className="capabilities-grid">
                      <CapabilityRow label="TG Notify" enabled={nodeConfig.infra?.tg_notify !== false} />
                      <CapabilityRow label="Log Record" enabled={nodeConfig.infra?.log_record !== false} />
                    </div>
                  </section>
                  {nodeConfig.params && Object.keys(nodeConfig.params).length > 0 && (
                    <KeyValueBlock title="Params" data={nodeConfig.params as Record<string, unknown>} />
                  )}
                  {nodeConfig.skill_readme && (
                    <section>
                      <div className="section-title">Skill README</div>
                      <pre className="log-box" style={{ fontSize: 11, maxHeight: 300 }}>{nodeConfig.skill_readme}</pre>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── Run Inspector (runtime, shown when Node Config Panel is hidden) ── */
          <>
            <div className="detail-head">
              <div className="detail-head-top">
                <div>
                  <h2>{nodeDetail?.node_id || selectedNode || "Node Inspector"}</h2>
                  <span className="node-mode">
                    {nodeDetail?.mode || dag?.nodes.find((n) => n.id === selectedNode)?.mode || "选择节点"}
                  </span>
                </div>
                <div className="detail-head-right">
                  <span className={`pill ${statusClass(nodeDetail?.status || run?.nodes?.[selectedNode] || "waiting")}`}>
                    {nodeDetail?.status || run?.nodes?.[selectedNode] || "waiting"}
                  </span>
                  {selectedNode && selectedRunId && (
                    <div className="node-ops">
                      {(nodeDetail?.status === "failed" || nodeDetail?.status === "cancelled" || nodeDetail?.status === "done") && (
                        <button type="button" className="btn-op btn-retry" disabled={opBusy} onClick={handleRetryNode} title="重新执行该节点">Retry</button>
                      )}
                      {nodeDetail?.status === "running" && (
                        <button type="button" className="btn-op btn-danger" disabled={opBusy} onClick={handleCancelNode} title="取消该节点">Cancel</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="inspector-tabs">
                {(["config", "run", "artifacts", "logs"] as InspectorTab[]).map((tab) => (
                  <button key={tab} type="button" className={`inspector-tab ${inspectorTab === tab ? "active" : ""}`} onClick={() => setInspectorTab(tab)}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="inspector-body">
              {inspectorTab === "config" && (() => {
                const dagNode = dag?.nodes.find((n) => n.id === selectedNode);
                const executor = nodeDetail?.executor;
                const needs = dagNode ? (dagNode as DagNode & { needs?: string[] }).needs : undefined;
                const infra = (nodeDetail as NodeDetail & { infra?: Record<string, unknown> })?.infra;
                return (
                  <>
                    <section>
                      <div className="section-title">Executor</div>
                      {executor ? (
                        <div className="kv">
                          {Object.entries(executor).filter(([, v]) => v).map(([k, v]) => (
                            <div className="kv-row" key={k}><span>{k}</span><code>{String(v)}</code></div>
                          ))}
                        </div>
                      ) : <div className="empty">选择节点后加载</div>}
                    </section>
                    {needs && needs.length > 0 && (
                      <section>
                        <div className="section-title">Depends On</div>
                        <div className="needs-list">
                          {needs.map((n) => <span key={n} className="needs-chip">{n}</span>)}
                        </div>
                      </section>
                    )}
                    <KeyValueBlock title="Input Contract" data={nodeDetail?.declared_inputs as Record<string, unknown> || dagNode?.inputs as Record<string, unknown>} />
                    <KeyValueBlock title="Output Contract" data={nodeDetail?.declared_outputs as Record<string, unknown> || dagNode?.outputs as Record<string, unknown>} />
                    {dagNode?.optional_inputs && Object.keys(dagNode.optional_inputs).length > 0 && (
                      <KeyValueBlock title="Optional Inputs" data={nodeDetail?.declared_inputs as Record<string, unknown> || dagNode.optional_inputs as Record<string, unknown>} />
                    )}
                    <section>
                      <div className="section-title">Capabilities</div>
                      <div className="capabilities-grid">
                        <CapabilityRow label="TG Notify" enabled={infra ? Boolean(infra["tg_notify"] ?? true) : true} />
                        <CapabilityRow label="Log Record" enabled={infra ? Boolean(infra["log_record"] ?? true) : true} />
                      </div>
                    </section>
                  </>
                );
              })()}

              {inspectorTab === "run" && (
                <>
                  <section>
                    <div className="section-title">Execution</div>
                    <div className="fact-grid">
                      <span>pipeline</span><code>{run?.pipeline_id || "-"}</code>
                      <span>run_id</span><code>{nodeDetail?.run_id || "-"}</code>
                      <span>started</span><code>{nodeDetail?.started_at || "-"}</code>
                      <span>finished</span><code>{nodeDetail?.finished_at || "-"}</code>
                      <span>instance</span><code>{selectedSopSummary?.instance_id || selectedSop || "-"}</code>
                      <span>repo</span><code>{selectedSopSummary?.repo || run?.repo || "-"}</code>
                    </div>
                  </section>
                  {nodeDetail?.validation && <ValidationBlock validation={nodeDetail.validation} />}
                  <KeyValueBlock title="Resolved Inputs" data={nodeDetail?.resolved_inputs as Record<string, unknown>} />
                  <KeyValueBlock title="Actual Outputs" data={nodeDetail?.actual_outputs as Record<string, unknown>} />
                  {nodeDetail?.error && (
                    <section>
                      <div className="section-title">Error</div>
                      <pre className="log-box error-log">{nodeDetail.error}</pre>
                    </section>
                  )}
                </>
              )}

              {inspectorTab === "artifacts" && (
                <section>
                  <div className="section-title">Artifacts · {nodeDetail?.artifacts?.length ?? 0}</div>
                  <ArtifactList artifacts={nodeDetail?.artifacts || []} />
                </section>
              )}

              {inspectorTab === "logs" && (
                <>
                  {(nodeLog?.events ?? []).length > 0 && (
                    <section>
                      <div className="section-title">Events</div>
                      <div className="event-list">
                        {(nodeLog?.events ?? []).map((ev, i) => <EventRow key={i} event={ev} />)}
                      </div>
                    </section>
                  )}
                  <section>
                    <div className="section-title">Raw Log</div>
                    <pre className="log-box">{nodeLog?.log || "No log loaded."}</pre>
                  </section>
                </>
              )}
            </div>
          </>
        )}
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
