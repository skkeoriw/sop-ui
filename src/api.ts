import type {
  DagNode,
  NodeDetail,
  NodeLog,
  RunsResponse,
  SopDag,
  SopManifest,
  SopRun,
  TriggerResponse
} from "./types";

export const DEFAULT_ENDPOINT = "https://youtube-wiki.chxyka.ccwu.cc";

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

export function nodeTitle(node: DagNode): string {
  return node.title || node.id;
}
