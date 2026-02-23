
export interface NewsItem {
  title: string;
  uri: string;
  source: string;
  snippet?: string;
  // Fix: Added date property to resolve NewsCard.tsx error
  date?: string;
}

export interface TrendAnalysis {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  keyPoints: string[];
  growthScore: number;
}

export interface AppState {
  keyword: string;
  isLoading: boolean;
  results: NewsItem[];
  analysis: TrendAnalysis | null;
  error: string | null;
}