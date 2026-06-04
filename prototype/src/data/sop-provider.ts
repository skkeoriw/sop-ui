import { normalizeEndpoint } from "./provider";
import type {
  Dag,
  Instance,
  NodeDetail,
  NodeLog,
  Run,
  Runtime,
  SopDataProvider,
  StageStatus,
  TriggerInput,
  TriggerResult
} from "./types";

const TUNNEL_API = "https://tunnel-api.chxyka.ccwu.cc";

function status(value?: string): StageStatus {
  return value === "done" || value === "running" || value === "failed" || value === "skipped" ? value : "waiting";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`接口没有返回 JSON：${url}`);
  }
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function mapRun(raw: Record<string, unknown>): Run {
  const nodes: Record<string, StageStatus> = {};
  for (const [key, value] of Object.entries((raw.nodes as Record<string, string>) || {})) nodes[key] = status(value);
  return {
    pipelineId: String(raw.pipeline_id || ""),
    status: status(String(raw.status || "")),
    sourceUrl: String(raw.source_url || ""),
    sourceType: String(raw.source_type || ""),
    repo: String(raw.repo || ""),
    nodes,
    startedAt: String(raw.started_at || ""),
    updatedAt: String(raw.updated_at || "")
  };
}

export const sopProvider: SopDataProvider = {
  mode: "real",

  async listRuntimes() {
    const data = await requestJson<{ tunnels?: Array<Record<string, unknown>> }>(`${TUNNEL_API}/admin/tunnels?limit=200`);
    return (data.tunnels || [])
      .flatMap((tunnel): Runtime[] => {
        const metadata = parseMetadata(tunnel.metadata);
        if (metadata?.type !== "sop-runtime" || tunnel.status !== "active") return [];
        const endpoint = normalizeEndpoint(String(metadata.channel_url || metadata.endpoint_url || ""));
        if (!endpoint) return [];
        const name = String(metadata.channel_name || tunnel.subdomain || metadata.runtime_id || endpoint);
        return [{
          id: String(metadata.runtime_id || name),
          name,
          endpoint,
          machine: name.match(/\d+/)?.[0],
          status: String(tunnel.status || "unknown"),
          localStatus: String(tunnel.local_status || "unknown")
        }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async listInstances(runtime) {
    const data = await requestJson<{ sops?: Array<Record<string, unknown>> }>(`${runtime.endpoint}/api/sop`);
    return (data.sops || []).map((item): Instance => ({
      id: String(item.id || item.instance_id || ""),
      instanceId: String(item.instance_id || item.id || ""),
      sopType: String(item.sop_type || ""),
      title: String(item.title || item.instance_id || item.id || "SOP"),
      version: String(item.version || ""),
      repo: String(item.repo || "")
    }));
  },

  async getDag(runtime, instanceId) {
    const data = await requestJson<{
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    }>(`${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/dag`);
    return {
      instanceId,
      nodes: (data.nodes || []).map((node) => ({
        id: String(node.id || ""),
        title: String(node.title || node.id || ""),
        mode: String(node.mode || "blocking"),
        summary: String(node.webhook_route || ""),
        inputs: (node.inputs as Record<string, string>) || {},
        outputs: (node.outputs as Record<string, string>) || {},
        optionalInputs: (node.optional_inputs as Record<string, string>) || {}
      })),
      edges: (data.edges || []).map((edge) => ({ source: String(edge.source || ""), target: String(edge.target || "") }))
    };
  },

  async listRuns(runtime, instanceId) {
    const data = await requestJson<{ runs?: Array<Record<string, unknown>> }>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs`
    );
    return (data.runs || []).map(mapRun);
  },

  async getRun(runtime, instanceId, pipelineId) {
    return mapRun(
      await requestJson<Record<string, unknown>>(
        `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}`
      )
    );
  },

  async getNode(runtime, instanceId, pipelineId, nodeId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}`
    );
    return {
      pipelineId: String(raw.pipeline_id || pipelineId),
      nodeId: String(raw.node_id || nodeId),
      runId: String(raw.run_id || ""),
      status: status(String(raw.status || "")),
      mode: String(raw.mode || ""),
      startedAt: String(raw.started_at || ""),
      finishedAt: String(raw.finished_at || ""),
      updatedAt: String(raw.updated_at || ""),
      error: String(raw.error || ""),
      inputs: (raw.inputs as Record<string, string>) || {},
      outputs: (raw.outputs as Record<string, string>) || {},
      optionalInputs: (raw.optional_inputs as Record<string, string>) || {},
      executor: (raw.executor as Record<string, unknown>) || {},
      declaredInputs: (raw.declared_inputs as Record<string, unknown>) || {},
      resolvedInputs: (raw.resolved_inputs as Record<string, unknown>) || {},
      declaredOutputs: (raw.declared_outputs as Record<string, unknown>) || {},
      actualOutputs: (raw.actual_outputs as Record<string, unknown>) || {},
      artifacts: ((raw.artifacts as Array<Record<string, unknown>>) || []).map((artifact) => ({
        id: String(artifact.id || ""),
        producer: String(artifact.producer || ""),
        output: String(artifact.output || ""),
        type: String(artifact.type || "file"),
        format: String(artifact.format || "binary"),
        path: String(artifact.path || ""),
        title: String(artifact.title || artifact.path || ""),
        size: Number(artifact.size || 0),
        mimeType: String(artifact.mime_type || "application/octet-stream"),
        tags: (artifact.tags as string[]) || [],
        resolution: String(artifact.resolution || ""),
        preview: artifact.preview ? String(artifact.preview) : undefined,
        previewTruncated: Boolean(artifact.preview_truncated)
      })),
      validation: {
        status: String((raw.validation as Record<string, unknown>)?.status || "unknown"),
        missingOutputs: ((raw.validation as Record<string, unknown>)?.missing_outputs as string[]) || [],
        unexpectedOutputs: ((raw.validation as Record<string, unknown>)?.unexpected_outputs as string[]) || []
      }
    };
  },

  async getNodeLog(runtime, instanceId, pipelineId, nodeId) {
    const raw = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs/${encodeURIComponent(pipelineId)}/logs/${encodeURIComponent(nodeId)}`
    );
    return {
      pipelineId: String(raw.pipeline_id || pipelineId),
      nodeId: String(raw.node_id || nodeId),
      log: String(raw.log || "")
    } satisfies NodeLog;
  },

  async triggerRun(runtime, instanceId, input: TriggerInput): Promise<TriggerResult> {
    const data = await requestJson<Record<string, unknown>>(
      `${runtime.endpoint}/api/sop/${encodeURIComponent(instanceId)}/runs`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ repo: input.repo, input: { url: input.url } })
      }
    );
    return {
      status: String(data.status || "triggered"),
      pipelineId: data.pipeline_id ? String(data.pipeline_id) : undefined,
      message: data.message ? String(data.message) : undefined
    };
  }
};
