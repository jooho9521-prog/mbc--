// src/types.ts
export interface NewsItem {
  title: string;
  uri: string;
  source: string;
  snippet?: string;
  date?: string;
}

/** ✅ 출처(근거) */
export interface Citation {
  point: number; // 1~5
  title: string;
  url: string;
  publisher?: string;
}

/** ✅ 팩트체크 라벨 */
export type FactLabel = "fact" | "interpretation" | "speculation";

export interface FactCheck {
  point: number; // 1~5
  label: FactLabel;
  confidence: number; // 0~100
  reason: string; // 짧게 (왜 이 라벨인지)
}

export interface TrendAnalysis {
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  keyPoints: string[];
  growthScore: number;

  /** ✅ A 강화: 근거/팩트체크 */
  citations?: Citation[];
  factChecks?: FactCheck[];
}

export interface AppState {
  keyword: string;
  isLoading: boolean;
  results: NewsItem[];
  analysis: TrendAnalysis | null;
  error: string | null;
}