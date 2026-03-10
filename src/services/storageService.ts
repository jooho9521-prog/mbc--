const STORAGE_KEY = "trendpulse_history";

// ✅ Prompt favorites (localStorage)
const PROMPT_FAV_KEY = "trendpulse_prompt_favorites_v1";
const PROMPT_FAV_LIMIT = 30;

export interface SavedReport {
  id: string;
  date: string;
  keyword: string;
  summary: string;
  expanded: string;
}

const safeJsonParse = <T,>(raw: string | null, fallback: T): T => {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const normalizePrompt = (p: string) => String(p || "").trim();

export const storageService = {
  /** -----------------------------
   *  Report history
   * ------------------------------ */

  save: (report: Omit<SavedReport, "id" | "date">): SavedReport => {
    const history = storageService.getAll();
    const newReport: SavedReport = {
      ...report,
      id: Date.now().toString(),
      date: new Date().toLocaleString("ko-KR"),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([newReport, ...history]));
    return newReport;
  },

  getAll: (): SavedReport[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return safeJsonParse<SavedReport[]>(data, []);
  },

  delete: (id: string): SavedReport[] => {
    const history = storageService.getAll();
    const filtered = history.filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return filtered;
  },

  /** -----------------------------
   *  Prompt favorites
   * ------------------------------ */

  getPromptFavorites: (): string[] => {
    const data = localStorage.getItem(PROMPT_FAV_KEY);
    const arr = safeJsonParse<any[]>(data, []);
    const cleaned = Array.isArray(arr)
      ? arr.map((x) => normalizePrompt(String(x))).filter(Boolean)
      : [];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of cleaned) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= PROMPT_FAV_LIMIT) break;
    }

    try {
      localStorage.setItem(PROMPT_FAV_KEY, JSON.stringify(out));
    } catch {}
    return out;
  },

  setPromptFavorites: (prompts: string[]) => {
    const cleaned = (prompts || [])
      .map((x) => normalizePrompt(String(x)))
      .filter(Boolean);

    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of cleaned) {
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= PROMPT_FAV_LIMIT) break;
    }

    try {
      localStorage.setItem(PROMPT_FAV_KEY, JSON.stringify(out));
    } catch {}
  },

  isPromptFavorite: (prompt: string): boolean => {
    const p = normalizePrompt(prompt);
    if (!p) return false;
    return storageService.getPromptFavorites().includes(p);
  },

  addPromptFavorite: (prompt: string): string[] => {
    const p = normalizePrompt(prompt);
    if (!p) return storageService.getPromptFavorites();

    const current = storageService.getPromptFavorites();
    const next = [p, ...current.filter((x) => x !== p)].slice(0, PROMPT_FAV_LIMIT);
    storageService.setPromptFavorites(next);
    return next;
  },

  removePromptFavorite: (prompt: string): string[] => {
    const p = normalizePrompt(prompt);
    const current = storageService.getPromptFavorites();
    const next = current.filter((x) => x !== p);
    storageService.setPromptFavorites(next);
    return next;
  },

  clearPromptFavorites: () => {
    try {
      localStorage.setItem(PROMPT_FAV_KEY, JSON.stringify([]));
    } catch {}
  },
};
