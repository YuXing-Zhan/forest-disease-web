export type Role =
  | "leaf_front"
  | "leaf_back"
  | "lesion_closeup"
  | "healthy_control";
export interface Review {
  provider: string;
  model: string;
  status: string;
  primary_diagnosis: string;
  conclusion: string;
  supports_initial_candidate: string;
  confidence_level: string;
  confidence_basis: string;
  confirmed_evidence: string[];
  supporting_evidence: string[];
  uncertainties: string[];
  differential_diagnoses: string[];
  next_actions: string[];
  warning: string;
}
export interface Case {
  case_id: string;
  species_input: string | null;
  status: string;
  created_at: string;
  error_message: string | null;
  timings: Record<string, number | null>;
  result: null | {
    strength: string;
    information: { score: number; provided: string[]; missing: string[] };
    candidates: {
      candidate_id: string;
      display_name: string;
      evidence_level: string;
      supporting_evidence: string[];
      conflicting_evidence: string[];
    }[];
    llm_review: {
      status: string;
      summary: string;
      agreement: string;
      requested_evidence: string[];
      reviews: Review[];
    };
    next_actions: string[];
    safety_note: string;
  };
}
export interface Settings {
  base: string;
  kindwise: string;
  deepseek: string;
  token: string;
  expires: string;
  providers: string[];
}
const key = "forest-web-settings-v1";
export function normalizeBase(value: string) {
  const base = value.trim().replace(/\/+$/, "");
  if (!base) return "";
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("请填写后端根地址，例如 https://api.example.com");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("后端请使用 HTTPS 地址；本机调试可使用 HTTP。");
  return base;
}
export function loadSettings(): Settings {
  const empty: Settings = {
    base: import.meta.env.VITE_API_BASE_URL || "",
    kindwise: "",
    deepseek: "",
    token: "",
    expires: "",
    providers: [],
  };
  try {
    const saved = {
      ...empty,
      ...JSON.parse(sessionStorage.getItem(key) || "{}"),
    };
    if (!saved.expires || Date.parse(saved.expires) <= Date.now()) {
      saved.token = "";
      saved.providers = [];
    }
    return saved;
  } catch {
    return empty;
  }
}
export function storeSettings(value: Settings) {
  sessionStorage.setItem(key, JSON.stringify(value));
}
export async function request<T>(
  base: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(30000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error("无法连接识别后端，请检查接口地址、HTTPS 和后端跨域设置。");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `请求失败（${response.status}），请检查输入和服务配置。`,
    );
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("这个地址返回了网页，请填写识别后端根地址。");
  return response.json();
}
export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
export function access(settings: Settings) {
  return {
    kindwise_api_key: settings.kindwise || undefined,
    deepseek_api_key: settings.deepseek || undefined,
    developer_access_token:
      settings.token && Date.parse(settings.expires) > Date.now()
        ? settings.token
        : undefined,
  };
}
export interface HistoryItem {
  id: string;
  species: string;
  date: string;
  base: string;
}
export function readHistory(): HistoryItem[] {
  try {
    const data = JSON.parse(
      localStorage.getItem("forest-web-history-v1") || "[]",
    );
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
export function remember(item: HistoryItem) {
  const records = [
    item,
    ...readHistory().filter((x) => x.id !== item.id || x.base !== item.base),
  ].slice(0, 30);
  localStorage.setItem("forest-web-history-v1", JSON.stringify(records));
}
export function clearHistory() {
  localStorage.removeItem("forest-web-history-v1");
}
