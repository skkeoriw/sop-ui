export type NodeStatus = "waiting" | "running" | "done" | "failed" | "skipped" | string;

export interface SopSummary {
  id: string;
  instance_id?: string;
  sop_type?: string;
  title: string;
  version?: string;
  repo?: string;
  wiki_local_path?: string;
  dag_url?: string;
  runs_url?: string;
}

export interface SopChannel {
  name?: string;
  url?: string;
  spi_base_url?: string;
}

export interface SopManifest {
  runtime?: string;
  runtime_id?: string;
  channel?: SopChannel;
  sops: SopSummary[];
}

export interface TunnelMetadata {
  title?: string;
  type?: string;
  runtime_id?: string;
  channel_name?: string;
  channel_url?: string;
  spi_base_url?: string;
  supported_sop_types?: string[];
  ui_url?: string;
  endpoint_url?: string;
  wiki_repo?: string;
}

export interface TunnelRecord {
  subdomain: string;
  status?: string;
  local_status?: string;
  client_ip?: string;
  local_port?: string;
  metadata?: string | TunnelMetadata;
  created_at?: string;
  last_seen_at?: string;
}

export interface TunnelListResponse {
  tunnels: TunnelRecord[];
}

export interface RuntimeChannel {
  id: string;
  subdomain: string;
  status?: string;
  local_status?: string;
  runtime_id: string;
  channel_name: string;
  channel_url: string;
  spi_base_url?: string;
  wiki_repo?: string;
}

export interface DagNode {
  id: string;
  title?: string;
  mode?: "blocking" | "sidecar" | "manual" | string;
  webhook_route?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  optional_inputs?: Record<string, string>;
}

export interface DagEdge {
  source: string;
  target: string;
}

export interface SopDag {
  sop_id: string;
  nodes: DagNode[];
  edges: DagEdge[];
}

export interface SopRun {
  pipeline_id: string;
  sop_id?: string;
  repo?: string;
  status: NodeStatus;
  source_url?: string;
  source_type?: string;
  nodes: Record<string, NodeStatus>;
  started_at?: string;
  updated_at?: string;
}

export interface RunsResponse {
  sop_id: string;
  runs: SopRun[];
}

export interface NodeExecutor {
  type?: string;
  skill?: string;
  webhook_route?: string;
  agent?: string;
  command?: string;
}

export interface NodeValidation {
  status: "passed" | "warning" | "failed" | string;
  missing_outputs: string[];
  unexpected_outputs: string[];
}

export interface Artifact {
  id: string;
  producer?: string;
  output?: string;
  type?: string;
  format?: string;
  path: string;
  title?: string;
  size?: number;
  mime_type?: string;
  resolution?: string;
  ownership?: string;
  preview?: string;
  preview_truncated?: boolean;
  tags?: string[];
}

export interface NodeDetail {
  pipeline_id: string;
  node_id: string;
  run_id?: string;
  status: NodeStatus;
  mode?: string;
  needs?: string[];
  started_at?: string;
  finished_at?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  optional_inputs?: Record<string, unknown>;
  error?: string;
  updated_at?: string;
  executor?: NodeExecutor;
  declared_inputs?: Record<string, unknown>;
  resolved_inputs?: Record<string, unknown>;
  declared_outputs?: Record<string, unknown>;
  actual_outputs?: Record<string, unknown>;
  artifacts?: Artifact[];
  discovered_candidates?: Artifact[];
  validation?: NodeValidation;
}

export interface NodeEvent {
  ts: string;
  event: string;
  stage?: string;
  trigger?: string;
  ok?: boolean;
  error?: string;
  duration_s?: number;
  reason?: string;
  run_id?: string;
}

export interface NodeLog {
  pipeline_id: string;
  node_id: string;
  log: string;
  events?: NodeEvent[];
}

export interface TriggerResponse {
  status: string;
  pipeline_id?: string;
  pipeline?: string;
  url?: string;
  source_type?: string;
  file_written?: string;
  status_url?: string;
  message?: string;
}

export interface NodeConfig {
  node_id: string;
  title?: string;
  mode?: string;
  needs?: string[];
  executor?: NodeExecutor;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  optional_inputs?: Record<string, unknown>;
  infra?: { tg_notify?: boolean; log_record?: boolean };
  params?: Record<string, unknown>;
  skill_script?: string | null;
  skill_readme?: string | null;
}

export interface OperationResponse {
  status: string;
  pipeline_id?: string;
  node_id?: string;
  run_id?: string;
  reason?: string;
  message?: string;
}
