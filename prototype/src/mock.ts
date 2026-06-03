export type StageStatus = "done" | "running" | "waiting" | "failed";

export interface RuntimeMock {
  id: string;
  name: string;
  machine: string;
  endpoint: string;
  instanceId: string;
  repo: string;
  health: "ok" | "degraded";
}

export interface RunMock {
  pipelineId: string;
  status: StageStatus;
  sourceUrl: string;
  startedAt: string;
  updatedAt: string;
  profile: "done" | "wiki-running" | "notebook-failed" | "initial";
}

export interface StageMock {
  id: string;
  title: string;
  mode: "blocking" | "sidecar";
  summary: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export const runtimes: RuntimeMock[] = [
  {
    id: "youtube-wiki",
    name: "youtube-wiki",
    machine: "210",
    endpoint: "https://youtube-wiki.chxyka.ccwu.cc",
    instanceId: "wiki-sop-210-registry-smoke",
    repo: "skkeoriw/wiki-sop-210-registry-smoke",
    health: "ok"
  },
  {
    id: "youtube-wiki-168",
    name: "youtube-wiki-168",
    machine: "168",
    endpoint: "https://youtube-wiki-168.chxyka.ccwu.cc",
    instanceId: "wiki-sop-168-registry-smoke",
    repo: "skkeoriw/wiki-sop-168-registry-smoke",
    health: "ok"
  }
];

export const baseRuns: RunMock[] = [
  {
    pipelineId: "dQw4w9WgXcQ-20260603T061508",
    status: "done",
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    startedAt: "2026-06-03T06:15:08Z",
    updatedAt: "2026-06-03T06:20:41Z",
    profile: "done"
  },
  {
    pipelineId: "mk-runtime-demo-20260603T071220",
    status: "running",
    sourceUrl: "https://www.youtube.com/watch?v=workflow-demo",
    startedAt: "2026-06-03T07:12:20Z",
    updatedAt: "2026-06-03T07:14:03Z",
    profile: "wiki-running"
  },
  {
    pipelineId: "nlm-failure-demo-20260603T064401",
    status: "failed",
    sourceUrl: "https://www.youtube.com/watch?v=notebooklm-error",
    startedAt: "2026-06-03T06:44:01Z",
    updatedAt: "2026-06-03T06:47:29Z",
    profile: "notebook-failed"
  }
];

export const stages: StageMock[] = [
  {
    id: "youtube-fetch",
    title: "YouTube Fetch",
    mode: "blocking",
    summary: "Fetches source metadata and writes the pipeline context.",
    inputs: { source_url: "context.source_url" },
    outputs: { metadata_file: "raw/youtube-metadata/{pipeline_id}.json", source_url: "context.source_url" }
  },
  {
    id: "notebooklm-research",
    title: "NotebookLM Research",
    mode: "blocking",
    summary: "Builds a structured research report from the source metadata.",
    inputs: { source_url: "youtube-fetch.outputs.source_url", metadata_file: "youtube-fetch.outputs.metadata_file" },
    outputs: { reports: "raw/notebooklm-analysis/*.md", mindmaps: "raw/notebooklm-mindmaps/*.json" }
  },
  {
    id: "youtube-deep-research",
    title: "Deep Research",
    mode: "sidecar",
    summary: "Runs sidecar transcript analysis without blocking the main chain.",
    inputs: { source_url: "youtube-fetch.outputs.source_url" },
    outputs: {
      analysis_file: "raw/youtube-deep-research/{pipeline_id}/analysis.md",
      transcript_file: "raw/youtube-deep-research/{pipeline_id}/transcript.txt"
    }
  },
  {
    id: "wiki-build",
    title: "Wiki Build",
    mode: "blocking",
    summary: "Uses Gemini / Vertex to synthesize wiki pages and index.",
    inputs: { reports: "notebooklm-research.outputs.reports" },
    outputs: { index: "index.md", pages: "wiki/**" }
  },
  {
    id: "tg-notify",
    title: "Telegram Notify",
    mode: "blocking",
    summary: "Sends the completion summary and archives the run state.",
    inputs: { index: "wiki-build.outputs.index" },
    outputs: { telegram_message: "logs/pipeline-runs/pipe-{run_id}.json" }
  }
];

export function stageState(profile: RunMock["profile"], runStatus: StageStatus): Record<string, StageStatus> {
  if (runStatus === "running" && profile === "initial") {
    return {
      "youtube-fetch": "running",
      "notebooklm-research": "waiting",
      "youtube-deep-research": "waiting",
      "wiki-build": "waiting",
      "tg-notify": "waiting"
    };
  }

  if (profile === "wiki-running") {
    return {
      "youtube-fetch": "done",
      "notebooklm-research": "done",
      "youtube-deep-research": "done",
      "wiki-build": "running",
      "tg-notify": "waiting"
    };
  }

  if (profile === "notebook-failed") {
    return {
      "youtube-fetch": "done",
      "notebooklm-research": "failed",
      "youtube-deep-research": "done",
      "wiki-build": "waiting",
      "tg-notify": "waiting"
    };
  }

  return {
    "youtube-fetch": "done",
    "notebooklm-research": "done",
    "youtube-deep-research": "done",
    "wiki-build": "done",
    "tg-notify": "done"
  };
}

export function nodeLog(stageId: string, status: StageStatus): string {
  if (status === "failed") {
    return [
      `[06:45:12] start ${stageId}`,
      "[06:45:14] inputs resolved",
      "[06:46:02] remote bridge returned retryable error",
      "[06:46:29] node state: failed",
      "[06:46:29] recovery: retry stage from inspector"
    ].join("\n");
  }

  if (status === "running") {
    return [
      `[07:14:03] start ${stageId}`,
      "[07:14:06] inputs resolved",
      "[07:14:18] writing outputs",
      "[07:14:27] node state: running",
      "[07:14:30] waiting for next event"
    ].join("\n");
  }

  if (status === "waiting") {
    return [`[waiting] ${stageId} has not started`, "[waiting] upstream dependency is not done"].join("\n");
  }

  return [
    `[06:15:18] start ${stageId}`,
    "[06:16:04] inputs resolved",
    "[06:17:21] outputs committed",
    "[06:17:24] node state: done",
    "[06:17:25] forward_next evaluated"
  ].join("\n");
}
