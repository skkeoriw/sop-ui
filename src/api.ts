import type {
  DagNode,
  NodeConfig,
  NodeDetail,
  NodeLog,
  OperationResponse,
  RuntimeChannel,
  RunsResponse,
  SopDag,
  SopManifest,
  SopRun,
  TunnelListResponse,
  TunnelMetadata,
  TriggerResponse
} from "./types";

export const DEFAULT_ENDPOINT = "https://youtube-wiki.chxyka.ccwu.cc";
export const TUNNEL_ADMIN_API = "https://tunnel-api.chxyka.ccwu.cc";

export function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function requestJson<T>(endpoint: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${normalizeEndpoint(endpoint)}${path}`;
  const headers = init?.headers ? { ...(init.headers as Record<string, string>) } : undefined;
  const response = await fetch(url, {
    ...init,
    headers
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 120)}`);
  }
}

export async function getManifest(endpoint: string): Promise<SopManifest> {
  return requestJson<SopManifest>(endpoint, "/api/sop");
}

function parseMetadata(value: unknown): TunnelMetadata | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value as TunnelMetadata;
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as TunnelMetadata;
  } catch {
    return undefined;
  }
}

export async function getRuntimeChannels(): Promise<RuntimeChannel[]> {
  const response = await fetch(`${TUNNEL_ADMIN_API}/admin/tunnels?limit=200`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as TunnelListResponse;
  const channels: RuntimeChannel[] = [];
  for (const tunnel of data.tunnels || []) {
    const metadata = parseMetadata(tunnel.metadata);
    if (metadata?.type !== "sop-runtime") continue;
    const channelUrl = normalizeEndpoint(metadata.channel_url || metadata.endpoint_url || "");
    if (!channelUrl) continue;
    const runtimeId = metadata.runtime_id || tunnel.subdomain;
    channels.push({
      id: runtimeId,
      subdomain: tunnel.subdomain,
      status: tunnel.status,
      local_status: tunnel.local_status,
      runtime_id: runtimeId,
      channel_name: metadata.channel_name || tunnel.subdomain,
      channel_url: channelUrl,
      spi_base_url: metadata.spi_base_url,
      wiki_repo: metadata.wiki_repo
    });
  }
  return channels.sort((a, b) => a.channel_name.localeCompare(b.channel_name));
}

export async function getDag(endpoint: string, sopId: string): Promise<SopDag> {
  return requestJson<SopDag>(endpoint, `/api/sop/${encodeURIComponent(sopId)}/dag`);
}

export async function getRuns(endpoint: string, sopId: string): Promise<SopRun[]> {
  const data = await requestJson<RunsResponse>(endpoint, `/api/sop/${encodeURIComponent(sopId)}/runs`);
  return data.runs || [];
}

export async function getRun(endpoint: string, sopId: string, pipelineId: string): Promise<SopRun> {
  return requestJson<SopRun>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}`
  );
}

export async function getNodeDetail(
  endpoint: string,
  sopId: string,
  pipelineId: string,
  nodeId: string
): Promise<NodeDetail> {
  return requestJson<NodeDetail>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}`
  );
}

export async function getNodeLog(
  endpoint: string,
  sopId: string,
  pipelineId: string,
  nodeId: string
): Promise<NodeLog> {
  return requestJson<NodeLog>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}/logs/${encodeURIComponent(nodeId)}`
  );
}

export async function triggerRun(
  endpoint: string,
  sopId: string,
  repo: string,
  url: string
): Promise<TriggerResponse> {
  return requestJson<TriggerResponse>(endpoint, `/api/sop/${encodeURIComponent(sopId)}/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    body: JSON.stringify({
      repo,
      input: { url }
    })
  });
}

export async function getNodeConfig(
  endpoint: string,
  sopId: string,
  nodeId: string
): Promise<NodeConfig> {
  return requestJson<NodeConfig>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/nodes/${encodeURIComponent(nodeId)}`
  );
}

export async function cancelRun(
  endpoint: string,
  sopId: string,
  pipelineId: string,
  reason = "用户取消"
): Promise<OperationResponse> {
  return requestJson<OperationResponse>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }
  );
}

export async function retryNode(
  endpoint: string,
  sopId: string,
  pipelineId: string,
  nodeId: string
): Promise<OperationResponse> {
  return requestJson<OperationResponse>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
}

export async function cancelNode(
  endpoint: string,
  sopId: string,
  pipelineId: string,
  nodeId: string,
  reason = "用户取消节点"
): Promise<OperationResponse> {
  return requestJson<OperationResponse>(
    endpoint,
    `/api/sop/${encodeURIComponent(sopId)}/runs/${encodeURIComponent(pipelineId)}/nodes/${encodeURIComponent(nodeId)}/cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }
  );
}

export function nodeTitle(node: DagNode): string {
  return node.title || node.id;
}
