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

export interface NodeDetail {
  pipeline_id: string;
  node_id: string;
  run_id?: string;
  status: NodeStatus;
  mode?: string;
  needs?: string[];
  started_at?: string;
  finished_at?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  optional_inputs?: Record<string, string>;
  error?: string;
  updated_at?: string;
}

export interface NodeLog {
  pipeline_id: string;
  node_id: string;
  log: string;
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
