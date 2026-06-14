import type { MachineConfig, MachineList, RuntimeInheritancePreview, RuntimeManagementConfigSaveInput } from "./types";

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

function normalizeBaseUrl(value: string) {
  return String(value || DEFAULT_CONTROL_PLANE_API).trim().replace(/\/+$/, "");
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

export const controlPlaneProvider = {
  apiUrl: controlPlaneApiUrl,

  async getSettings(): Promise<RuntimeInheritancePreview> {
    const raw = await requestJson<Record<string, unknown>>(`${controlPlaneApiUrl}/api/settings`);
    return {
      ...mapRuntimeInheritancePreview(raw),
      backend: raw.backend,
      d1: raw.d1,
    } as RuntimeInheritancePreview;
  },

  async saveSettings(input: RuntimeManagementConfigSaveInput): Promise<RuntimeInheritancePreview> {
    const raw = await requestJson<Record<string, unknown>>(`${controlPlaneApiUrl}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: input.values }),
    });
    return mapRuntimeInheritancePreview((raw.config as Record<string, unknown>) || raw);
  },

  async listMachines(): Promise<MachineList> {
    const raw = await requestJson<Record<string, unknown>>(`${controlPlaneApiUrl}/api/machines`);
    const machines = Array.isArray(raw.machines) ? raw.machines as Array<Record<string, unknown>> : [];
    return {
      machines: machines.map(mapMachine),
      total: Number(raw.total || machines.length),
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
  }): Promise<MachineConfig> {
    const raw = await requestJson<Record<string, unknown>>(`${controlPlaneApiUrl}/api/machines`, {
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
      }),
    });
    const machine = raw.machine as Record<string, unknown> | undefined;
    if (!machine) throw new Error(String(raw.error || "Machine save failed"));
    return mapMachine(machine);
  },
};
