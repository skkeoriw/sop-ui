import type { GitHubRepoOption, ListQueryOptions, MachineConfig, MachineList, MachineSecretConfig, RuntimeInheritancePreview, RuntimeManagementConfigSaveInput, WorkflowSettingsResolve } from "./types";

const DEFAULT_CONTROL_PLANE_API = "https://sop-control-plane.hb67egcim4.workers.dev";

export const controlPlaneApiUrl = normalizeBaseUrl(
  import.meta.env.VITE_SOP_CONTROL_PLANE_API || DEFAULT_CONTROL_PLANE_API
);

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

async function requestJsonFallback<T>(urls: string[], init?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await requestJson<T>(url, init);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Request failed"));
}

function normalizeBaseUrl(value: string) {
  return String(value || DEFAULT_CONTROL_PLANE_API).trim().replace(/\/+$/, "");
}

function toQuery(options?: ListQueryOptions) {
  const params = new URLSearchParams();
  if (options?.page) params.set("page", String(options.page));
  if (options?.pageSize) params.set("page_size", String(options.pageSize));
  if (options?.q) params.set("q", options.q);
  if (options?.status) params.set("status", options.status);
  if (options?.role) params.set("role", options.role);
  if (options?.authType) params.set("auth_type", options.authType);
  if (options?.sort) params.set("sort", options.sort);
  if (options?.order) params.set("order", options.order);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function mapRuntimeInheritancePreview(raw: Record<string, unknown>): RuntimeInheritancePreview {
  const rawItems = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
  return {
    instanceId: String(raw.instance_id || raw.instanceId || "global-settings"),
    envFile: String(raw.env_file || raw.envFile || ""),
    groups: (raw.groups as Record<string, boolean>) || {},
    note: raw.note ? String(raw.note) : undefined,
    updatedAt: raw.updated_at ? String(raw.updated_at) : raw.updatedAt ? String(raw.updatedAt) : undefined,
    items: rawItems.map((item) => ({
      key: String(item.key || ""),
      aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
      matchedKey: item.matched_key ? String(item.matched_key) : item.matchedKey ? String(item.matchedKey) : "",
      source: String(item.source || "missing"),
      present: Boolean(item.present),
      maskedValue: String(item.masked_value || item.maskedValue || ""),
      secret: Boolean(item.secret),
      required: Boolean(item.required),
      category: String(item.category || "runtime"),
    })),
  };
}

function mapMachine(raw: Record<string, unknown>): MachineConfig {
  return {
    id: String(raw.id || ""),
    name: String(raw.name || raw.id || ""),
    host: String(raw.host || ""),
    port: Number(raw.port || 22),
    user: String(raw.user || ""),
    sshCommand: String(raw.ssh_command || raw.sshCommand || ""),
    authType: String(raw.auth_type || raw.authType || "private_key"),
    privateKeyPresent: Boolean(raw.private_key_present ?? raw.privateKeyPresent),
    privateKey: raw.private_key ? String(raw.private_key) : raw.privateKey ? String(raw.privateKey) : undefined,
    passwordPresent: Boolean(raw.password_present ?? raw.passwordPresent),
    password: raw.password ? String(raw.password) : undefined,
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    role: String(raw.role || ""),
    status: String(raw.status || "active"),
    lastCheckAt: raw.last_check_at ? String(raw.last_check_at) : raw.lastCheckAt ? String(raw.lastCheckAt) : undefined,
    createdAt: raw.created_at ? String(raw.created_at) : raw.createdAt ? String(raw.createdAt) : undefined,
    updatedAt: raw.updated_at ? String(raw.updated_at) : raw.updatedAt ? String(raw.updatedAt) : undefined,
    updatedBy: raw.updated_by ? String(raw.updated_by) : raw.updatedBy ? String(raw.updatedBy) : undefined,
  };
}

function mapMachineSecret(raw: Record<string, unknown>): MachineSecretConfig {
  const machine = mapMachine(raw);
  return {
    ...machine,
    privateKey: raw.private_key ? String(raw.private_key) : raw.privateKey ? String(raw.privateKey) : "",
    password: raw.password ? String(raw.password) : "",
  };
}

export const controlPlaneProvider = {
  apiUrl: controlPlaneApiUrl,

  async getSettings(): Promise<RuntimeInheritancePreview> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/settings`,
      `${controlPlaneApiUrl}/api/settings`,
    ]);
    return {
      ...mapRuntimeInheritancePreview(raw),
      backend: raw.backend,
      d1: raw.d1,
    } as RuntimeInheritancePreview;
  },

  async resolveSettingsForWorkflow(): Promise<WorkflowSettingsResolve> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/settings/resolve`,
      `${controlPlaneApiUrl}/api/settings/resolve`,
    ]);
    const payload = raw.payload && typeof raw.payload === "object" ? raw.payload as Record<string, unknown> : {};
    const values = raw.values && typeof raw.values === "object" ? raw.values as Record<string, unknown> : {};
    return {
      ok: Boolean(raw.ok),
      backend: raw.backend ? String(raw.backend) : undefined,
      source: raw.source ? String(raw.source) : undefined,
      payload: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])),
      values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
      presentKeys: Array.isArray(raw.present_keys) ? raw.present_keys.map(String) : [],
      payloadKeys: Array.isArray(raw.payload_keys) ? raw.payload_keys.map(String) : [],
    };
  },

  async listGithubRepos(options: { q?: string } = {}): Promise<GitHubRepoOption[]> {
    const query = toQuery({ page: 1, pageSize: 100, q: options.q || "" });
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/github/repos${query}`,
      `${controlPlaneApiUrl}/api/github/repos${query}`,
    ]);
    const repos = Array.isArray(raw.repos) ? raw.repos as Array<Record<string, unknown>> : Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
    return repos.map((repo) => {
      const fullName = String(repo.full_name || repo.fullName || repo.name || "");
      const [owner, name] = fullName.includes("/") ? fullName.split("/", 2) : [String(repo.owner || ""), fullName];
      return {
        fullName,
        name: String(repo.repo || repo.name || name || fullName),
        owner: String(repo.owner || owner || ""),
        private: Boolean(repo.private),
        defaultBranch: repo.default_branch ? String(repo.default_branch) : repo.defaultBranch ? String(repo.defaultBranch) : undefined,
      };
    }).filter((repo) => repo.fullName);
  },

  async saveSettings(input: RuntimeManagementConfigSaveInput): Promise<RuntimeInheritancePreview> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/settings`,
      `${controlPlaneApiUrl}/api/settings`,
    ], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: input.values }),
    });
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
  },

  async listMachines(options?: ListQueryOptions): Promise<MachineList> {
    const query = toQuery({
      page: options?.page || 1,
      pageSize: options?.pageSize || 25,
      q: options?.q || "",
      status: options?.status || "active",
      role: options?.role || "",
      authType: options?.authType || "",
      sort: options?.sort,
      order: options?.order,
    });
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/machines${query}`,
      `${controlPlaneApiUrl}/api/machines${query}`,
    ]);
    const machines = Array.isArray(raw.machines) ? raw.machines as Array<Record<string, unknown>> : Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
    return {
      machines: machines.map(mapMachine),
      total: Number(raw.total || machines.length),
      page: Number(raw.page || 1),
      pageSize: Number(raw.page_size || raw.pageSize || machines.length),
      hasMore: Boolean(raw.has_more ?? raw.hasMore),
    };
  },

  async saveMachine(input: {
    id?: string;
    name: string;
    sshCommand: string;
    authType: "private_key" | "password";
    privateKey?: string;
    password?: string;
    role?: string;
    status?: string;
  }): Promise<MachineConfig> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/machines`,
      `${controlPlaneApiUrl}/api/machines`,
    ], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: input.id,
        name: input.name,
        ssh_command: input.sshCommand,
        auth_type: input.authType,
        private_key: input.privateKey,
        password: input.password,
        role: input.role || "target",
        status: input.status || "active",
      }),
    });
    const machine = raw.machine as Record<string, unknown> | undefined;
    if (!machine) throw new Error(String(raw.error || "Machine save failed"));
    return mapMachine(machine);
  },

  async deleteMachine(id: string): Promise<{ ok: boolean; deleted?: boolean; id?: string }> {
    return requestJsonFallback<{ ok: boolean; deleted?: boolean; id?: string }>([
      `${controlPlaneApiUrl}/api/sop/v1/machines/${encodeURIComponent(id)}`,
      `${controlPlaneApiUrl}/api/machines/${encodeURIComponent(id)}`,
    ], {
      method: "DELETE",
    });
  },

  async duplicateMachine(id: string, input: { reuseSecret?: boolean } = {}): Promise<MachineConfig> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/machines/${encodeURIComponent(id)}/duplicate`,
      `${controlPlaneApiUrl}/api/machines/${encodeURIComponent(id)}/duplicate`,
    ], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reuse_secret: Boolean(input.reuseSecret) }),
    });
    const machine = raw.machine as Record<string, unknown> | undefined;
    if (!machine) throw new Error(String(raw.error || "Machine duplicate failed"));
    return mapMachine(machine);
  },

  async getMachineSecret(id: string): Promise<MachineSecretConfig> {
    const raw = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/machines/${encodeURIComponent(id)}/resolve`,
      `${controlPlaneApiUrl}/api/machines/${encodeURIComponent(id)}/resolve`,
    ]);
    const machine = raw.machine as Record<string, unknown> | undefined;
    if (!machine) throw new Error(String(raw.error || "Machine secret load failed"));
    return mapMachineSecret(machine);
  },

  async testMachine(id: string): Promise<Record<string, unknown>> {
    const created = await requestJsonFallback<Record<string, unknown>>([
      `${controlPlaneApiUrl}/api/sop/v1/machines/${encodeURIComponent(id)}/test`,
      `${controlPlaneApiUrl}/api/machines/${encodeURIComponent(id)}/test`,
    ], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const job = created.job as Record<string, unknown> | undefined;
    const jobId = job?.id ? String(job.id) : "";
    if (!jobId) return created;

    let latest = created;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await delay(attempt < 4 ? 1000 : 2000);
      latest = await requestJson<Record<string, unknown>>(`${controlPlaneApiUrl}/api/machine-check-jobs/${encodeURIComponent(jobId)}`);
      const status = String(latest.status || (latest.job as Record<string, unknown> | undefined)?.status || "");
      if (status === "succeeded" || status === "failed") return latest;
    }
    return {
      ...latest,
      status: "running",
      reason: "SSH check is still running. Refresh or test again to fetch the latest result.",
    };
  },
};

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
