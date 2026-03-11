// src/App.tsx
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Search,
  BrainCircuit,
  Loader2,
  LayoutDashboard,
  Globe,
  Key,
  Database,
  X,
  Sparkles,
  MessageSquare,
  ShieldAlert,
  Target,
  TrendingUp,
  Activity,
  Share2,
  Lightbulb,
  Link2Off,
  AlertTriangle,
  Copy,
  UserCog,
  ArrowUpDown,
  Clock,
  Moon,
  Sun,
  Mail,
  Zap,
  FileText,
} from "lucide-react";

import html2canvas from "html2canvas";
import jsPDF from "jspdf";

import {
  GeminiTrendService,
  handleApiError,
  generateExpandedContent,
} from "./services/geminiService";
import { initGoogleAuth, getNewsEmails } from "./services/gmailService";
import {
  fetchNewsSourcesSerper,
  isBlockedByKeyword,
  isBlockedDomain,
  normalizeNewsUrl,
} from "./services/sourceService"; // ✅ A 근거모드(Serper)
import type { AppState, NewsItem } from "./types";

import { NewsCard } from "./components/NewsCard";
import OnePageSummaryCard from "./components/OnePageSummaryCard";
import ContentExpander from "./components/ContentExpander";
import SavedCards from "./components/SavedCards";
import ChatWidget from "./ChatWidget";
import ChartVisualizer from "./components/ChartVisualizer";
import SentimentChart from "./components/SentimentChart";

const DONGA_LOGO_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgc3Ryb2tlPSIjMDA3YTczIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiLz4KICA8cGF0aCBkPSJNNTAgMiB2OTYgTTIgNTAgaDk2IiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIvPgogIDxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjMwIiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==";

const ANALYSIS_MODES = [
  {
    id: "general",
    name: "📋 일반 분석",
    prompt: "종합적인 관점에서 사실 위주로 핵심 트렌드를 정리하세요.",
  },
  {
    id: "sentiment",
    name: "💖 여론 분석",
    prompt: "대중의 반응과 감성(긍정/부정)을 중심으로 분석하세요.",
  },
] as const;

const PERSONAS = [
  {
    id: "analyst",
    name: "냉철한 애널리스트",
    prompt:
      "당신은 월스트리트의 수석 애널리스트입니다. 수치와 데이터에 기반하여 냉철하고 객관적으로 분석하세요.",
  },
  {
    id: "marketer",
    name: "MZ세대 마케터",
    prompt:
      "당신은 트렌드에 민감한 MZ세대 마케터입니다. 최신 유행어와 감각적인 표현을 사용하여 창의적인 인사이트를 제공하세요.",
  },
  {
    id: "teacher",
    name: "친절한 선생님",
    prompt:
      "당신은 어려운 개념을 쉽게 설명해주는 초등학교 선생님입니다. 비유를 활용하여 누구나 이해하기 쉽게 설명하세요.",
  },
  {
    id: "journalist",
    name: "비판적 저널리스트",
    prompt:
      "당신은 날카로운 시각을 가진 탐사 보도 기자입니다. 이면의 진실과 잠재적 리스크를 파헤치는 데 집중하세요.",
  },
] as const;

const DEFAULT_OSMU = `1. 실행 전략: 지금 이 이슈를 어떤 순서와 기준으로 대응해야 하는지 우선순위를 정리합니다.
2. 비즈니스 활용 방향: 시장·산업·투자·정책 관점에서 실제 적용 가능한 대응 포인트를 제시합니다.
3. 후속 확장 아이디어: 카드뉴스, 사내 보고, 블로그, 브리핑 자료 등 다양한 재가공 방향을 함께 제안합니다.`;

const buildStrategyText = (analysis: any, keyword: string) => {
  const points = Array.isArray(analysis?.keyPoints) ? analysis.keyPoints.filter(Boolean) : [];
  const summary = String(analysis?.summary || "").trim();
  const topic = String(keyword || "이 이슈").trim() || "이 이슈";

  const normalizeSentence = (text: string, fallback: string) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t || fallback;
  };

  const summaryPoints = String(summary)
    .split(/\n\s*\n|\n(?=\d+\.)/)
    .map((s) => s.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);

  const a = normalizeSentence(
    points[0] || summaryPoints[0],
    `${topic}의 핵심 흐름과 시장 반응을 먼저 점검해야 합니다.`
  );
  const b = normalizeSentence(
    points[1] || summaryPoints[1],
    `${topic}가 산업 구조와 경쟁 구도에 어떤 변화를 만드는지 함께 봐야 합니다.`
  );
  const c = normalizeSentence(
    points[2] || summaryPoints[2] || summaryPoints[summaryPoints.length - 1],
    `${topic}를 카드뉴스·보고서·브리핑 등으로 확장할 수 있습니다.`
  );

  return `1. 실행 전략: ${a}

2. 활용 방향: ${b}

3. 후속 확장 아이디어: ${c}`;
};

const renderText = (text: string) => {
  if (!text) return "";
  const clean = String(text)
    .replace(/(https?:\/\/[^\s\)]+)/g, "")
    .replace(/\(참조[^)]*\)/gi, "")
    .replace(/\(Source[^)]*\)/gi, "")
    .replace(/\[참조[^\]]*\]/gi, "")
    .replace(/\[Source[^\]]*\]/gi, "")
    .replace(/\(출처[^)]*\)/gi, "")
    .replace(/(참조|Source|출처)\s*:[^\n]*$/gim, "")
    .replace(/\*\*/g, "")
    .replace(/###/g, "")
    .replace(/\+\+\+/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\\n/g, "\n")
    .replace(/(\n|^)(\d+\.)/g, "\n\n$2")
    .replace(/([.?!])\s+(\d+\.)/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean;
};

/**
 * ✅ 날짜 파싱(최신순 정렬 품질 개선)
 * - ISO/RFC/`YYYY-MM-DD`/`YYYY. M. D`/`YYYY/MM/DD` 등 방어
 * - `2 hours ago` 같은 상대시간(영문)도 최소 방어
 * - 파싱 실패 시 0 (정렬에서 뒤로 밀림)
 */
const parseDateToTs = (dateStr?: string): number => {
  if (!dateStr) return 0;
  const raw = String(dateStr).trim();
  if (!raw) return 0;

  // 1) Date로 바로 파싱되는 케이스
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.getTime();

  // 2) YYYY-MM-DD
  const m1 = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const da = Number(m1[3]);
    return new Date(Date.UTC(y, mo - 1, da, 0, 0, 0)).getTime();
  }

  // 3) YYYY/MM/DD
  const m1b = raw.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/);
  if (m1b) {
    const y = Number(m1b[1]);
    const mo = Number(m1b[2]);
    const da = Number(m1b[3]);
    return new Date(Date.UTC(y, mo - 1, da, 0, 0, 0)).getTime();
  }

  // 4) YYYY. M. D
  const m2 = raw.match(/\b(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\b/);
  if (m2) {
    const y = Number(m2[1]);
    const mo = Number(m2[2]);
    const da = Number(m2[3]);
    return new Date(Date.UTC(y, mo - 1, da, 0, 0, 0)).getTime();
  }

  // 5) relative (EN) "2 hours ago"
  const rel = raw.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (rel) {
    const v = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const now = Date.now();
    const mult =
      unit === "minute"
        ? 60_000
        : unit === "hour"
        ? 3_600_000
        : unit === "day"
        ? 86_400_000
        : unit === "week"
        ? 604_800_000
        : unit === "month"
        ? 2_592_000_000
        : 31_536_000_000;
    return now - v * mult;
  }

  return 0;
};

/**
 * ✅ Evidence 정규화 + 중복 제거
 * - Serper/Gmail 모두 (url/title/source/snippet/date) 포맷이 들쑥날쑥해서 단일 함수로 통일
 */
type EvidenceItem = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  date?: string;
};

const isBlockedEvidenceUrl = (url: string, allowBlocked = false) => {
  if (!url || allowBlocked) return false;
  return isBlockedDomain(url) || isBlockedByKeyword(url);
};

const normalizeEvidenceArray = (
  raw: any[],
  max = 12,
  options?: { allowBlocked?: boolean }
): EvidenceItem[] => {
  const map = new Map<string, EvidenceItem>();
  const allowBlocked = !!options?.allowBlocked;

  (raw || [])
    .filter((s) => s && (s.url || s.link))
    .forEach((s) => {
      const rawUrl = String(s.url || s.link || "").trim();
      const url = normalizeNewsUrl(rawUrl);
      if (!url || isBlockedEvidenceUrl(url, allowBlocked)) return;

      const item: EvidenceItem = {
        title: String(s.title || "관련 기사").trim() || "관련 기사",
        url,
        source: String(s.source || "").trim(),
        snippet: String(s.snippet || s.body || "").trim(),
        date: String(s.date || s.publishedAt || s.published_at || "").trim(),
      };

      const prev = map.get(url);
      if (!prev) map.set(url, item);
      else {
        const score = (x: EvidenceItem) =>
          (x.title?.length || 0) * 2 +
          (x.snippet?.length || 0) +
          (x.date ? 10 : 0) +
          (x.source ? 3 : 0);
        map.set(url, score(item) >= score(prev) ? item : prev);
      }
    });

  return Array.from(map.values()).slice(0, max);
};

const PREFERRED_SOURCE_DOMAINS = [
  "hani.co.kr",
  "donga.com",
  "ytn.co.kr",
  "bbc.com",
  "reuters.com",
  "bloomberg.com",
  "yonhapnews.co.kr",
  "joongang.co.kr",
  "chosun.com",
  "khan.co.kr",
  "mk.co.kr",
  "hankyung.com",
  "kbs.co.kr",
  "imbc.com",
  "sbs.co.kr",
];

const getNewsHost = (item: Partial<NewsItem>) => {
  const raw = String(item?.uri || "").trim();
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return String(item?.source || "").trim().toLowerCase();
  }
};

const getKeywordTokens = (keyword: string) => {
  return String(keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .map((v) => v.trim())
    .filter((v) => v.length >= 2);
};

const getNewsRelevanceScore = (item: Partial<NewsItem>, keyword: string, analysis?: any) => {
  const host = getNewsHost(item);
  const title = String(item?.title || "").trim().toLowerCase();
  const snippet = String(item?.snippet || "").trim().toLowerCase();
  const uri = String(item?.uri || "").trim();

  const keywordTokens = getKeywordTokens(keyword);

  const preferredBoost = PREFERRED_SOURCE_DOMAINS.some(
    (d) => host === d || host.endsWith(`.${d}`)
  )
    ? 35
    : 0;

  const titleLengthScore = Math.min(title.length, 90) * 0.45;
  const snippetLengthScore = Math.min(snippet.length, 140) * 0.15;
  const dateScore = parseDateToTs(item?.date) ? 10 : 0;

  let keywordScore = 0;
  for (const token of keywordTokens) {
    if (title.includes(token)) keywordScore += 18;
    if (snippet.includes(token)) keywordScore += 8;
  }

  const citations = Array.isArray(analysis?.citations) ? analysis.citations : [];
  const citationMatchCount = citations.filter((c: any) => {
    const cu = normalizeUrl(String(c?.url || ""));
    const iu = normalizeUrl(uri);
    if (!cu || !iu) return false;
    if (cu === iu) return true;
    return safeHost(cu) && safeHost(iu) && safeHost(cu) === safeHost(iu);
  }).length;

  const citationBoost = citationMatchCount * 22;

  return (
    preferredBoost +
    titleLengthScore +
    snippetLengthScore +
    dateScore +
    keywordScore +
    citationBoost
  );
};

const sanitizeNewsItems = (items: NewsItem[], allowBlocked = false): NewsItem[] => {
  const dedup = new Map<string, NewsItem>();

  for (const item of items || []) {
    const uri = normalizeNewsUrl(String(item?.uri || "").trim());
    if (!uri || isBlockedEvidenceUrl(uri, allowBlocked)) continue;

    const next: NewsItem = {
      ...item,
      uri,
      source: String(item?.source || getNewsHost({ ...item, uri }) || "웹 뉴스").trim() || "웹 뉴스",
    };

    const prev = dedup.get(uri);
    if (!prev) dedup.set(uri, next);
    else {
      const prevScore = (prev.title?.length || 0) + (prev.snippet?.length || 0) + (prev.date ? 6 : 0);
      const nextScore = (next.title?.length || 0) + (next.snippet?.length || 0) + (next.date ? 6 : 0);
      dedup.set(uri, nextScore >= prevScore ? next : prev);
    }
  }

  return Array.from(dedup.values());
};


const App: React.FC = () => {
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // ✅ C 단계: 포인트 ↔ 소스 피드 인터랙션
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const sourceItemRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  const setSourceRef = React.useCallback(
    (url: string) => (el: HTMLDivElement | null) => {
      const u = (url || "").trim();
      if (!u) return;
      sourceItemRefs.current[u] = el;
    },
    []
  );

  const safeHost = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  const normalizeUrl = (u: string) => {
    try {
      const url = new URL(u);
      url.hash = "";
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((k) =>
        url.searchParams.delete(k)
      );
      return url.toString();
    } catch {
      return (u || "").trim();
    }
  };


  const [activeTab, setActiveTab] = useState<"dashboard" | "onepage" | "insights">(
    "dashboard"
  );

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [tempApiKey, setTempApiKey] = useState("");
  const [tempSerperKey, setTempSerperKey] = useState("");

  const [selectedMode, setSelectedMode] = useState<
    (typeof ANALYSIS_MODES)[number]
  >(ANALYSIS_MODES[0]);

  const [selectedPersona, setSelectedPersona] = useState<
    (typeof PERSONAS)[number]
  >(PERSONAS[0]);

  const [newsSources, setNewsSources] = useState<NewsItem[]>([]);
  const [newsSort, setNewsSort] = useState<"relevance" | "latest">("relevance");

  const [isDarkMode, setIsDarkMode] = useState(false);

  // ✅ A 근거모드 토글 (기본 ON)
  const [useEvidenceMode, setUseEvidenceMode] = useState(true);

  const [state, setState] = useState<AppState>({
    keyword: "",
    isLoading: false,
    results: [],
    analysis: null,
    error: null,
  });

  const scrollToSourceByPoint = React.useCallback(
    (point: number) => {
      setActivePoint(point);

      const citations = Array.isArray((state.analysis as any)?.citations)
        ? (state.analysis as any).citations
        : [];
      const target = citations.find(
        (c: any) =>
          Number(c?.point) === Number(point) && String(c?.url || "").trim()
      );

      const targetUrl = target ? normalizeUrl(String(target.url)) : "";
      let el: HTMLDivElement | null = null;

      if (targetUrl && sourceItemRefs.current[targetUrl]) {
        el = sourceItemRefs.current[targetUrl];
      } else if (targetUrl) {
        // host-based fallback
        const th = safeHost(targetUrl);
        if (th) {
          const key = Object.keys(sourceItemRefs.current).find(
            (k) => safeHost(k) === th
          );
          if (key) el = sourceItemRefs.current[key] || null;
        }
      }

      if (el) {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          el.scrollIntoView();
        }
      }
    },
    [state.analysis]
  );

  const [osmuText, setOsmuText] = useState(DEFAULT_OSMU);
  const [currentLangName, setCurrentLangName] = useState("Korean");

  const [expandedContent, setExpandedContent] = useState<{
    image: { img: string; cardData: { title: string; body: string } } | null;
    video: string | null;
    sns: string | null;
  }>({
    image: null,
    video: null,
    sns: null,
  });

  const [isTranslating, setIsTranslating] = useState(false);

  const [isGoogleAuthReady, setIsGoogleAuthReady] = useState(false);

  const LANGUAGES = useMemo(
    () => [
      { code: "KO", label: "🇰🇷", name: "Korean", prompt: "한국 시장 관점" },
      {
        code: "US",
        label: "🇺🇸",
        name: "English",
        prompt: "US Market Perspective",
      },
      {
        code: "JP",
        label: "🇯🇵",
        name: "Japanese",
        prompt: "Japanese Market Perspective",
      },
      {
        code: "CN",
        label: "🇨🇳",
        name: "Chinese",
        prompt: "Chinese Market Perspective",
      },
    ],
    []
  );

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  const [chatCommand, setChatCommand] = useState<{
    text: string;
    time: number;
  } | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message });
    window.setTimeout(
      () => setToast({ visible: false, message: "" }),
      2500
    );
  }, []);

  // ✅ Fact label 스타일 배지
  const factLabelBadge = (label?: string) => {
    const l = (label || "").toLowerCase();
    if (l === "fact") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (l === "speculation") return "bg-rose-50 text-rose-700 border-rose-200";
    return "bg-amber-50 text-amber-700 border-amber-200";
  };

  // ✅ Fact label 한글 표기
  const factLabelTextKo = (label?: string) => {
    const l = (label || "").toLowerCase();
    if (l === "fact") return "팩트";
    if (l === "speculation") return "추정";
    return "해석";
  };

  const safeCitations = useMemo(
    () => (state.analysis?.citations || []) as any[],
    [state.analysis]
  );
  const safeFactChecks = useMemo(
    () => (state.analysis?.factChecks || []) as any[],
    [state.analysis]
  );

  // ✅ SSR-safe window href (1340 장점 이식)
  const getWindowHref = useCallback(
    () => (typeof window !== "undefined" ? window.location.href : ""),
    []
  );

  // ✅ 로컬 키 -> window.process.env 세팅(번들 환경 대응)
  useEffect(() => {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey && typeof window !== "undefined") {
      const win = window as any;
      win.process = win.process || { env: {} };
      win.process.env = win.process.env || {};
      win.process.env.API_KEY = savedKey;
      win.process.env.GEMINI_API_KEY = savedKey;
      win.process.env.VITE_GEMINI_API_KEY = savedKey;
    }

    const savedSerperKey = localStorage.getItem("serper_api_key");
    if (savedSerperKey && typeof window !== "undefined") {
      const win = window as any;
      win.process = win.process || { env: {} };
      win.process.env = win.process.env || {};
      win.process.env.SERPER_API_KEY = savedSerperKey;
      win.process.env.VITE_SERPER_API_KEY = savedSerperKey;
    }
  }, []);

  useEffect(() => {
    if (!isKeyModalOpen) return;
    try {
      setTempApiKey(localStorage.getItem("gemini_api_key") || "");
      setTempSerperKey(localStorage.getItem("serper_api_key") || "");
    } catch {}
  }, [isKeyModalOpen]);

  const getGeminiRuntimeKey = useCallback(() => {
    try {
      const localKey = localStorage.getItem("gemini_api_key");
      if (localKey) return String(localKey).trim();
    } catch {}

    const env = (import.meta as any)?.env || {};
    const winEnv = (window as any)?.process?.env || {};

    return String(
      env?.VITE_GEMINI_API_KEY ||
      env?.GEMINI_API_KEY ||
      env?.VITE_API_KEY ||
      env?.API_KEY ||
      winEnv?.VITE_GEMINI_API_KEY ||
      winEnv?.GEMINI_API_KEY ||
      winEnv?.VITE_API_KEY ||
      winEnv?.API_KEY ||
      ""
    ).trim();
  }, []);

  const getSerperRuntimeKey = useCallback(() => {
    try {
      const localKey = localStorage.getItem("serper_api_key");
      if (localKey) return String(localKey).trim();
    } catch {}

    const env = (import.meta as any)?.env || {};
    const winEnv = (window as any)?.process?.env || {};

    return String(
      env?.VITE_SERPER_API_KEY ||
      env?.SERPER_API_KEY ||
      winEnv?.VITE_SERPER_API_KEY ||
      winEnv?.SERPER_API_KEY ||
      ""
    ).trim();
  }, []);

  // ✅ 구글 인증 준비
  useEffect(() => {
    initGoogleAuth().then((success) => setIsGoogleAuthReady(!!success));
  }, []);

  const handleSaveApiKey = useCallback(() => {
    const trimmedKey = tempApiKey.trim();
    const trimmedSerperKey = tempSerperKey.trim();

    if (!trimmedKey) {
      showToast("Gemini API 키를 입력해주세요.");
      return;
    }

    if (!trimmedSerperKey) {
      showToast("Serper API 키를 입력해주세요.");
      return;
    }

    localStorage.setItem("gemini_api_key", trimmedKey);
    localStorage.setItem("serper_api_key", trimmedSerperKey);

    if (typeof window !== "undefined") {
      const win = window as any;
      win.process = win.process || { env: {} };
      win.process.env = win.process.env || {};
      win.process.env.API_KEY = trimmedKey;
      win.process.env.GEMINI_API_KEY = trimmedKey;
      win.process.env.VITE_GEMINI_API_KEY = trimmedKey;
      win.process.env.SERPER_API_KEY = trimmedSerperKey;
      win.process.env.VITE_SERPER_API_KEY = trimmedSerperKey;
    }

    showToast("Gemini / Serper API 키가 저장되었습니다.");
    setIsKeyModalOpen(false);
    setState((prev) => ({ ...prev, error: null }));
  }, [tempApiKey, tempSerperKey, showToast]);

  // ✅ [업그레이드] performSearch: A 근거모드 분기 + Serper evidence
  const performSearch = useCallback(
    async (searchKeyword: string, modePrompt: string) => {
      if (!searchKeyword.trim()) return;

      const apiKey = getGeminiRuntimeKey();
      if (!apiKey) {
        showToast("Gemini API 키를 입력해주세요.");
        setIsKeyModalOpen(true);
        return;
      }

      const serperKey = getSerperRuntimeKey();
      if (useEvidenceMode && !serperKey) {
        showToast("소스피드를 위해 Serper API 키를 입력해주세요.");
        setIsKeyModalOpen(true);
        return;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        results: [],
        analysis: null,
      }));
      setNewsSources([]);
      setExpandedContent({ image: null, video: null, sns: null });
      setOsmuText(DEFAULT_OSMU);
      setCurrentLangName("Korean");
      setActiveTab("dashboard");
      setNewsSort("relevance");

      try {
        const service = new GeminiTrendService();
        const finalPrompt = `${selectedPersona.prompt}\n\n${modePrompt}`;

        // ✅ A 모드: Serper 근거 기반 요약(citations/factChecks 포함)
        if (useEvidenceMode) {
          let sources: any[] = [];
          try {
            sources = await fetchNewsSourcesSerper(searchKeyword, 6);
          } catch {
            sources = [];
          }

          const evidenceArray = normalizeEvidenceArray(
          (sources || []).map((s: any) => ({
            title: s?.title,
            url: s?.url,
            source: s?.source,
            snippet: s?.snippet,
            date: s?.date,
          })),
          12
        );

          // 근거가 너무 부족하면 기존 모드로 폴백
          if (evidenceArray.length < 3) {
            const { news, analysis } = await service.fetchTrendsAndAnalysis(
              searchKeyword,
              finalPrompt
            );
            const safeNews = sanitizeNewsItems(news);
            setState((prev) => ({
              ...prev,
              results: safeNews,
              analysis,
              isLoading: false,
            }));
            setNewsSources(safeNews);
            setOsmuText(buildStrategyText(analysis, searchKeyword));
            return;
          }

          const { news, analysis } = await service.fetchTrendsAndAnalysisA(
            searchKeyword,
            finalPrompt,
            evidenceArray
          );
          const safeNews = sanitizeNewsItems(news);
          setState((prev) => ({
            ...prev,
            results: safeNews,
            analysis,
            isLoading: false,
          }));
          setNewsSources(safeNews);
          setOsmuText(buildStrategyText(analysis, searchKeyword));
          return;
        }

        // ✅ 기존 모드
        const { news, analysis } = await service.fetchTrendsAndAnalysis(
          searchKeyword,
          finalPrompt
        );
        const safeNews = sanitizeNewsItems(news);
        setState((prev) => ({
          ...prev,
          results: safeNews,
          analysis,
          isLoading: false,
        }));
        setNewsSources(safeNews);
        setOsmuText(buildStrategyText(analysis, searchKeyword));
      } catch (err: any) {
        const apiErrorMessage = handleApiError(err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: apiErrorMessage,
        }));
        showToast(
          apiErrorMessage.includes("503")
            ? "서버가 혼잡합니다. 잠시 후 시도해주세요."
            : "분석 중 오류가 발생했습니다."
        );
      }
    },
    [getGeminiRuntimeKey, getSerperRuntimeKey, selectedPersona.prompt, useEvidenceMode, showToast]
  );

  const handleSearch = useCallback(
    async (e?: React.FormEvent | React.MouseEvent) => {
      if (e) e.preventDefault();
      await performSearch(state.keyword, selectedMode.prompt);
    },
    [performSearch, state.keyword, selectedMode.prompt]
  );

  // ⭐️ [G메일 요약] A 모드(evidence)로 분석 (항상 A로 돌림)
  const handleGmailSummary = useCallback(async () => {
    let currentAuthStatus = isGoogleAuthReady;

    if (!currentAuthStatus) {
      showToast("구글 연동을 준비하는 중입니다...");
      currentAuthStatus = !!(await initGoogleAuth());
      setIsGoogleAuthReady(currentAuthStatus);
    }
    if (!currentAuthStatus) {
      showToast(
        "구글 스크립트 연결 실패! 브라우저의 팝업/광고 차단을 잠시 꺼주세요."
      );
      return;
    }

    const apiKey = getGeminiRuntimeKey();
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      results: [],
      analysis: null,
      keyword: "G메일 '뉴스요약' 브리핑",
    }));
    setNewsSources([]);
    setExpandedContent({ image: null, video: null, sns: null });
    setOsmuText(DEFAULT_OSMU);
    setCurrentLangName("Korean");
    setActiveTab("dashboard");
    setNewsSort("relevance");

    try {
      showToast("G메일에서 뉴스를 가져오는 중...");
      const emailData = (await getNewsEmails()) as any[];

      showToast("가져온 뉴스를 분석하는 중...");
      const service = new GeminiTrendService();

      const combinedEmailText = (emailData || [])
        .map((e: any, index: number) => {
          return `[기사 ${index + 1}]
제목: ${e.title}
출처: ${e.source}
내용: ${e.body}`;
        })
        .join("\n\n");

      const finalPrompt = `${selectedPersona.prompt}

다음은 사용자의 구글 알림(뉴스레터)에서 추출한 실제 최신 뉴스 기사 모음입니다.
이 기사들을 종합적으로 분석하여 핵심 트렌드 보고서를 작성해주세요.

**중요: 분석 결과에 어떤 언론사(출처)의 기사인지 반드시 언급해주세요.**

[뉴스 기사 본문]
${combinedEmailText}
`.trim();

      const evidenceArray = normalizeEvidenceArray(
      (emailData || []).slice(0, 12).map((e: any) => ({
        title: e.title || "G메일 기사",
        url: e.link || e.url || "https://mail.google.com/",
        source: e.source || "Gmail",
        snippet: String(e.body || "").slice(0, 280),
        date: e.publishedAt || e.date || "",
      })),
      12,
      { allowBlocked: true }
    );

      const { analysis } = await service.fetchTrendsAndAnalysisA(
        "G메일 뉴스 요약",
        finalPrompt,
        evidenceArray
      );

      // ✅ 1340 장점: date도 함께 저장(최신순 정렬 품질 향상)
      const mappedSources: NewsItem[] = (emailData || []).map((e: any) => ({
        title: `📰 ${
          String(e.title || "").length > 40
            ? String(e.title).substring(0, 40) + "..."
            : e.title
        }`,
        uri: e.link || "https://mail.google.com/",
        source: e.source || "웹 뉴스",
        date: e.publishedAt || e.date || "",
      }));

      const uniqueSources = sanitizeNewsItems(
        Array.from(new Map(mappedSources.map((item: any) => [item.uri, item])).values()),
        true
      );

      setState((prev) => ({
        ...prev,
        results: uniqueSources,
        analysis,
        isLoading: false,
      }));
      setNewsSources(uniqueSources);
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err?.message || "G메일 연동 또는 분석 중 오류가 발생했습니다.",
      }));
      showToast("G메일 요약 실패: " + (err?.message || "오류"));
    }
  }, [getGeminiRuntimeKey, isGoogleAuthReady, selectedPersona.prompt, showToast]);

  const handleModeChange = useCallback(
    (mode: (typeof ANALYSIS_MODES)[number]) => {
      setSelectedMode(mode);
      if (
        state.keyword &&
        !state.isLoading &&
        state.keyword !== "G메일 '뉴스요약' 브리핑"
      ) {
        void performSearch(state.keyword, mode.prompt);
        showToast(`${mode.name} 모드로 분석을 시작합니다.`);
      }
    },
    [performSearch, showToast, state.keyword, state.isLoading]
  );

  const handleDiscussWithAI = useCallback(() => {
    if (!state.analysis) return;
    setChatCommand({
      text: `"${state.keyword}"에 대해 선택한 [${selectedMode.name}] 관점으로 분석 결과를 더 자세히 설명해줘.`,
      time: Date.now(),
    });
  }, [state.analysis, state.keyword, selectedMode.name]);

  const handleTranslate = useCallback(
    async (targetLang: {
      code: string;
      label: string;
      name: string;
      prompt: string;
    }) => {
      if (!state.analysis || isTranslating) return;
      setIsTranslating(true);
      showToast(`${targetLang.label} ${targetLang.name} 버전으로 분석 중...`);
      setCurrentLangName(targetLang.name);

      try {
        const currentContent = `
Summary: ${state.analysis.summary}
KeyPoints: ${state.analysis.keyPoints.join("\n")}
OSMU_Strategy: ${osmuText}
`.trim();

        const prompt = `
You are a global market analyst. Please translate the following analysis report into **${targetLang.name}**.

[IMPORTANT INSTRUCTION]
1. Translate 'Summary', 'KeyPoints', and 'OSMU_Strategy' naturally.
2. STRICTLY PRESERVE the numbered list format (1., 2., 3...) and line breaks.
3. CRITICAL: Add one specific 'Local Market Insight' for the **${targetLang.name} market** at the end of the summary.
4. Do NOT include any references, URLs, or citations.
5. Output MUST be valid JSON only.

[INPUT DATA]
${currentContent}

[OUTPUT FORMAT]
{
  "summary": "1. Translated point 1\\n\\n2. Translated point 2\\n\\n... + Local Insight",
  "keyPoints": ["Translated point 1", "Translated point 2"...],
  "osmu": "Translated OSMU Strategy text..."
}
`.trim();

        const response = await generateExpandedContent(prompt, "translate", "");
        let jsonString = String(response || "")
          .replace(/```json/g, "")
          .replace(/```/g, "")
          .trim();

        const firstBrace = jsonString.indexOf("{");
        const lastBrace = jsonString.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        }

        const result = JSON.parse(jsonString);

        setState((prev) => ({
          ...prev,
          analysis: prev.analysis
            ? {
                ...prev.analysis,
                summary: result.summary,
                keyPoints: result.keyPoints,
              }
            : null,
        }));
        if (result.osmu) setOsmuText(result.osmu);

        showToast(`✅ ${targetLang.name} 분석 완료`);
      } catch (error) {
        console.error("Translation Error:", error);
        showToast("번역 데이터 처리 중 오류가 발생했습니다.");
      } finally {
        setIsTranslating(false);
      }
    },
    [isTranslating, osmuText, showToast, state.analysis]
  );

  const handleDownloadPDF = useCallback(async () => {
    const element = document.getElementById("print-section");
    if (!element) {
      showToast("PDF 저장 실패: 리포트 영역을 찾지 못했습니다.");
      return;
    }

    // ✅ activeElement 안전 처리
    const active = document.activeElement as HTMLElement | null;
    const btn =
      active && active.tagName === "BUTTON" ? (active as HTMLButtonElement) : null;
    const originalText = btn?.innerText;

    if (btn) btn.innerText = "⏳ 저장 중...";

    // ✅ html2canvas가 oklch() 컬러를 파싱하지 못해 PDF 저장이 실패하는 케이스 방어
    // - clone DOM(#pdf-export-clone)에만 안전한(hex/rgb) 컬러 CSS를 강제로 적용합니다.
    let pdfSafeStyleEl: HTMLStyleElement | null = null;

    try {
      showToast("⏳ PDF 생성 중...");

      // 화면 레이아웃 영향을 피하기 위해 클론을 만들어 렌더
      const clone = element.cloneNode(true) as HTMLElement;
      clone.id = "pdf-export-clone";
      clone.style.width = "210mm";
      clone.style.maxWidth = "210mm";
      clone.style.height = "auto";
      clone.style.maxHeight = "none";
      clone.style.overflow = "visible";
      clone.style.position = "fixed";
      clone.style.top = "-10000px";
      clone.style.left = "0";
      clone.style.background = "white";
      clone.style.zIndex = "-1";
      document.body.appendChild(clone);

      pdfSafeStyleEl = document.createElement("style");
      pdfSafeStyleEl.setAttribute("data-pdf-safe", "1");
      pdfSafeStyleEl.textContent = `
        #pdf-export-clone, #pdf-export-clone * {
          color: #111827 !important;
          border-color: #E5E7EB !important;
          background-color: transparent !important;
          text-decoration-color: #111827 !important;
        }
        #pdf-export-clone { background-color: #FFFFFF !important; }
        #pdf-export-clone a { color: #0071E3 !important; }
      `;
      document.head.appendChild(pdfSafeStyleEl);

      // ✅ html2canvas가 oklch() 색상 함수를 파싱 못하는 문제 방어
      // - clone DOM에 계산된 색상을 rgb(...)로 인라인 주입해 파서 에러를 피합니다.
      try {
        const els = Array.from(clone.querySelectorAll<HTMLElement>("*"));
        for (const el of els) {
          const cs = window.getComputedStyle(el);
          // ⚠️ 일부 환경에서 getComputedStyle이 oklch()를 반환 → html2canvas 파싱 오류
          // oklch 포함 값은 건드리지 않고, 위의 PDF 전용 CSS 오버라이드가 처리하도록 둡니다.
          if (cs.color && !cs.color.includes("oklch")) el.style.color = cs.color;
          if (cs.backgroundColor && !cs.backgroundColor.includes("oklch")) el.style.backgroundColor = cs.backgroundColor;
          if (cs.borderTopColor && !cs.borderTopColor.includes("oklch")) el.style.borderTopColor = cs.borderTopColor;
          if (cs.borderRightColor && !cs.borderRightColor.includes("oklch")) el.style.borderRightColor = cs.borderRightColor;
          if (cs.borderBottomColor && !cs.borderBottomColor.includes("oklch")) el.style.borderBottomColor = cs.borderBottomColor;
          if (cs.borderLeftColor && !cs.borderLeftColor.includes("oklch")) el.style.borderLeftColor = cs.borderLeftColor;
          if (cs.outlineColor && !cs.outlineColor.includes("oklch")) el.style.outlineColor = cs.outlineColor;
          // box-shadow는 색상이 섞여 있어도 보통 안전하지만, 혹시 몰라 그대로 둡니다.
        }
      } catch (e) {
        console.warn("PDF export color-sanitize failed (continuing):", e);
      }


      // 이미지 CORS 방어 (base64/외부 이미지 모두)
      clone.querySelectorAll("img").forEach((img) => {
        try {
          (img as HTMLImageElement).crossOrigin = "anonymous";
        } catch {}
      });

      // DOM 반영을 1프레임 보장 (간헐적 빈 캔버스 방지)
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        windowWidth: clone.scrollWidth || document.documentElement.offsetWidth,
      });

      document.body.removeChild(clone);

      if (pdfSafeStyleEl) {
        try {
          document.head.removeChild(pdfSafeStyleEl);
        } catch {}
        pdfSafeStyleEl = null;
      }

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");

      const imgWidth = 210;
      const pageHeight = 295;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = position - pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`TrendPulse_Report_${Date.now()}.pdf`);
      showToast("✅ PDF 저장이 완료되었습니다.");
    } catch (error) {
      console.error("PDF export failed:", error);
      showToast("PDF 저장 실패 (브라우저/보안 설정 또는 렌더링 문제)");
    } finally {
      if (pdfSafeStyleEl) {
        try {
          document.head.removeChild(pdfSafeStyleEl);
        } catch {}
      }
      if (btn && typeof originalText === "string") btn.innerText = originalText;
    }
  }, [showToast]);

  const handleShare = useCallback(() => setIsShareModalOpen(true), []);


  const summarizeSwotPoint = useCallback((text: string, fallbackLabel: string) => {
    const clean = renderText(String(text || ""))
      .replace(/^\d+\.\s*/, "")
      .replace(/^(강점|약점|기회|위협)\s*[:\-]?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!clean) return `${fallbackLabel} 데이터를 분석하지 못했습니다.`;

    const split = clean
      .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=니다\.)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const first = split[0] || clean;
    return first.length > 90 ? `${first.slice(0, 90).trim()}...` : first;
  }, []);

  const parseSwotSections = useCallback((summary: string) => {
    const raw = String(summary || "").replace(/\r\n/g, "\n");
    if (!raw.trim()) return [];

    const labels = ["강점", "약점", "기회", "위협", "전략 제언"];

    return labels
      .map((label, index) => {
        const current = index + 1;
        const next = index + 2;
        const regex = new RegExp(
          `(?:^|\n)\s*${current}\.\s*${label}\s*[:：]?\s*([\s\S]*?)(?=(?:\n\s*${next}\.\s*(?:${labels.slice(index + 1).join("|")})\s*[:：]?)|$)`,
          "m"
        );
        const match = raw.match(regex);
        const content = String(match?.[1] || "")
          .replace(new RegExp(`^\s*${current}\.\s*${label}\s*[:：]?\s*`, "m"), "")
          .trim();

        return { index, label, content };
      })
      .filter((section) => section.content);
  }, []);

  const getSwotContent = useCallback(
    (index: number, label: string) => {
      const sections = parseSwotSections(state.analysis?.summary || "");
      const target = sections.find((section) => section.index === index && section.label === label);

      if (target?.content) {
        return renderText(target.content)
          .replace(new RegExp(`^\s*${index + 1}\.\s*${label}\s*[:：]?\s*`, "m"), "")
          .trim();
      }

      return `${label} 데이터를 분석하지 못했습니다.`;
    },
    [parseSwotSections, state.analysis]
  );

  const getSwotCardContent = useCallback(
    (index: number, label: string) => summarizeSwotPoint(getSwotContent(index, label), label),
    [getSwotContent, summarizeSwotPoint]
  );

  const renderSwotBody = useCallback(() => {
    const sections = [
      { index: 0, label: "강점" },
      { index: 1, label: "약점" },
      { index: 2, label: "기회" },
      { index: 3, label: "위협" },
      { index: 4, label: "전략 제언" },
    ];

    return (
      <div className="space-y-6">
        {sections.map(({ index, label }) => {
          const content = getSwotContent(index, label);
          if (!content || content.includes("데이터를 분석하지 못했습니다.")) return null;

          return (
            <div key={label} className={`p-8 rounded-[28px] border ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-100"}`}>
              <p className={`text-xl font-medium leading-relaxed whitespace-pre-line break-words ${isDarkMode ? "text-gray-100" : "text-gray-900"}`}>
                {index + 1}. {label}: {content}
              </p>
            </div>
          );
        })}
      </div>
    );
  }, [getSwotContent, isDarkMode]);

  const sortedNewsSources = useMemo(() => {
  const items = [...newsSources].map((item, index) => ({
    ...item,
    __originalIndex: index,
  }));

  if (newsSort === "latest") {
    return items.sort((a: any, b: any) => {
      const at = parseDateToTs(a?.date);
      const bt = parseDateToTs(b?.date);

      if (bt !== at) {
        if (!bt && !at) return a.__originalIndex - b.__originalIndex;
        if (!bt) return -1;
        if (!at) return 1;
        return bt - at;
      }

      const ar = getNewsRelevanceScore(a, state.keyword, state.analysis);
      const br = getNewsRelevanceScore(b, state.keyword, state.analysis);
      if (br !== ar) return br - ar;

      return a.__originalIndex - b.__originalIndex;
    });
  }

  return items.sort((a: any, b: any) => {
    const ar = getNewsRelevanceScore(a, state.keyword, state.analysis);
    const br = getNewsRelevanceScore(b, state.keyword, state.analysis);

    if (br !== ar) return br - ar;

    const at = parseDateToTs(a?.date);
    const bt = parseDateToTs(b?.date);
    if (bt !== at) return bt - at;

    return a.__originalIndex - b.__originalIndex;
  });
}, [newsSources, newsSort, state.keyword, state.analysis]);

  const handleCopyEvidence = useCallback(async () => {
    if (!state.analysis) return;

    const text = [
      `[키워드] ${state.keyword}`,
      ``,
      `[요약]`,
      renderText(state.analysis.summary),
      ``,
      `[팩트체크]`,
      ...(safeFactChecks || [])
        .slice()
        .sort((a, b) => (a.point || 0) - (b.point || 0))
        .map(
          (fc) =>
            `- (${fc.point}) ${factLabelTextKo(fc.label)} / 신뢰도 ${fc.confidence}: ${fc.reason}`
        ),
      ``,
      `[출처]`,
      ...(safeCitations || []).slice().map((c) => `- (${c.point}) ${c.title}: ${c.url}`),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      showToast("✅ 근거/팩트체크가 복사되었습니다.");
    } catch {
      showToast("복사 실패 (브라우저 권한 확인)");
    }
  }, [safeCitations, safeFactChecks, showToast, state.analysis, state.keyword]);

  // ✅ 1340 장점: 공유 링크 복사도 toast로 통일(기존 alert 제거)
  const handleCopyShareLink = useCallback(async () => {
    try {
      const href = getWindowHref();
      if (!href) throw new Error("empty href");
      await navigator.clipboard.writeText(href);
      showToast("✅ 링크가 복사되었습니다.");
      setIsShareModalOpen(false);
    } catch {
      showToast("복사 실패 (브라우저 권한 확인)");
    }
  }, [getWindowHref, showToast]);

  return (
    <div
      className={`flex flex-col h-screen overflow-hidden transition-colors duration-300 ${
        isDarkMode ? "bg-gray-950 text-gray-100" : "bg-[#F5F5F7] text-[#1d1d1f]"
      }`}
    >
      {/* Top Nav */}
      <nav
        className={`w-full border-b px-8 py-4 flex justify-between items-center z-50 no-print shadow-sm backdrop-blur-xl transition-colors duration-300 ${
          isDarkMode ? "bg-gray-900/80 border-gray-800" : "bg-white/80 border-gray-200"
        }`}
      >
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-3">
            <img
              src={DONGA_LOGO_URL}
              alt="동아일보"
              className="h-10 w-10 object-contain"
            />
            <h1 className={`text-2xl font-black tracking-tight ${isDarkMode ? "text-white" : "text-[#1d1d1f]"}`}>
              동아일보
            </h1>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                activeTab === "dashboard"
                  ? "bg-[#0071e3] text-white shadow-sm"
                  : isDarkMode
                  ? "text-gray-400 hover:bg-gray-800 hover:text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <LayoutDashboard size={18} /> 대시보드
            </button>

            <button
              onClick={() => setActiveTab("onepage")}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                activeTab === "onepage"
                  ? "bg-[#0071e3] text-white shadow-sm"
                  : isDarkMode
                  ? "text-gray-400 hover:bg-gray-800 hover:text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <FileText size={18} /> 한 장 요약
            </button>

            <button
              onClick={() => setActiveTab("insights")}
              className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                activeTab === "insights"
                  ? "bg-[#0071e3] text-white shadow-sm"
                  : isDarkMode
                  ? "text-gray-400 hover:bg-gray-800 hover:text-white"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Database size={18} /> DB 보관함
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-2.5 rounded-full transition-all ${
              isDarkMode
                ? "bg-gray-800 text-yellow-400 hover:bg-gray-700"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
            title={isDarkMode ? "라이트 모드로 변경" : "다크 모드로 변경"}
          >
            {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {state.analysis && (
            <div className={`flex items-center gap-1 p-1 rounded-full ${isDarkMode ? "bg-gray-800" : "bg-gray-100"}`}>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => void handleTranslate(lang)}
                  disabled={isTranslating}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-all text-base disabled:opacity-50 ${
                    isDarkMode ? "hover:bg-gray-700" : "hover:bg-white hover:shadow-sm"
                  }`}
                  title={`${lang.name} 관점으로 분석`}
                >
                  {isTranslating ? <Loader2 size={12} className="animate-spin" /> : lang.label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setIsKeyModalOpen(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all text-xs ${
              isDarkMode
                ? "text-gray-400 hover:text-white hover:bg-gray-800"
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <Key size={16} /> API 키 관리
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-y-auto relative z-10 apple-transition">
        <header
          className={`sticky top-0 z-40 px-12 py-8 no-print backdrop-blur-xl transition-colors duration-300 ${
            isDarkMode ? "bg-gray-950/80" : "bg-[#F5F5F7]/80"
          }`}
        >
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex gap-4">
              {/* Search */}
              <form onSubmit={handleSearch} className="relative group flex-1">
                <button
                  type="button"
                  onClick={(e) => void handleSearch(e)}
                  className="absolute left-6 top-1/2 -translate-y-1/2 z-50 text-gray-400 hover:text-[#0071e3] transition-colors cursor-pointer p-2"
                >
                  <Search size={24} />
                </button>

                <input
                  type="text"
                  placeholder="트렌드 키워드 입력..."
                  className={`w-full rounded-full py-5 pl-24 pr-16 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all font-semibold text-xl shadow-sm border ${
                    isDarkMode
                      ? "bg-gray-900 border-gray-800 text-white placeholder-gray-600"
                      : "bg-white border-gray-200 text-gray-900"
                  }`}
                  value={state.keyword}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, keyword: e.target.value }))
                  }
                  disabled={state.isLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSearch(e);
                  }}
                />

                {state.isLoading && (
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 z-10">
                    <Loader2 className="animate-spin text-[#0071e3]" size={24} />
                  </div>
                )}
              </form>

              {/* Persona */}
              <div className="relative group min-w-[200px]">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 z-10">
                  <UserCog size={20} />
                </div>

                <select
                  value={selectedPersona.id}
                  onChange={(e) =>
                    setSelectedPersona(
                      PERSONAS.find((p) => p.id === e.target.value) || PERSONAS[0]
                    )
                  }
                  className={`h-full w-full appearance-none border py-3 pl-12 pr-10 rounded-full leading-tight focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 font-bold text-sm shadow-sm cursor-pointer transition-colors ${
                    isDarkMode
                      ? "bg-gray-900 border-gray-800 text-white hover:bg-gray-800"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {PERSONAS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                  <svg
                    className="fill-current h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Mode buttons */}
            <div className="flex flex-wrap gap-2 items-center px-4">
              {ANALYSIS_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleModeChange(mode)}
                  disabled={state.isLoading}
                  className={`px-4 py-1.5 text-[11px] font-bold rounded-full transition-all border ${
                    selectedMode.id === mode.id
                      ? isDarkMode
                        ? "bg-white text-gray-900 border-white"
                        : "bg-gray-900 border-gray-900 text-white"
                      : isDarkMode
                      ? "bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800"
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {mode.name}
                </button>
              ))}

              {/* ✅ A 근거모드 토글 */}
              <button
                onClick={() => setUseEvidenceMode((v) => !v)}
                disabled={state.isLoading}
                className={`px-5 py-2 text-[12px] font-bold rounded-full transition-all border shadow-sm flex items-center gap-2 ${
                  useEvidenceMode
                    ? isDarkMode
                      ? "bg-emerald-900/30 border-emerald-800 text-emerald-300 hover:bg-emerald-900/50"
                      : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300"
                    : isDarkMode
                    ? "bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800"
                    : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
                title="근거(Evidence) 기반 요약: 출처/팩트체크 포함"
              >
                <ShieldAlert size={14} />
                근거모드 {useEvidenceMode ? "ON" : "OFF"}
              </button>

              <button
                onClick={() => void handleGmailSummary()}
                disabled={state.isLoading}
                className={`ml-auto px-5 py-2 text-[12px] font-bold rounded-full transition-all border shadow-sm flex items-center gap-2 ${
                  isDarkMode
                    ? "bg-red-900/30 border-red-800 text-red-300 hover:bg-red-900/50"
                    : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300"
                }`}
                title="G메일의 '뉴스요약' 라벨에 있는 메일들을 분석합니다"
              >
                {state.isLoading && state.keyword === "G메일 '뉴스요약' 브리핑" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Mail size={14} />
                )}
                G메일 뉴스 요약
              </button>
            </div>
          </div>
        </header>

        <div className="px-12 pb-24 max-w-[1500px] mx-auto">
          <div className="grid grid-cols-12 gap-10">
            <section className="col-span-12 xl:col-span-8 space-y-10">
              {activeTab === "dashboard" ? (
                <>
                  {state.error && (
                    <div className="bg-rose-50 border border-rose-100 p-6 rounded-[2rem] flex items-center gap-4 text-rose-600 animate-in fade-in slide-in-from-top-4 no-print">
                      <ShieldAlert size={24} />
                      <div className="flex-1">
                        <p className="font-bold text-sm">분석 오류 발생</p>
                        <p className="text-xs opacity-80 whitespace-pre-wrap">{state.error}</p>
                      </div>
                      <button
                        onClick={() => void handleSearch()}
                        className="px-4 py-2 bg-rose-600 text-white rounded-full text-[11px] font-bold"
                      >
                        재시도
                      </button>
                    </div>
                  )}

                  {state.analysis ? (
                    <div
                      className={`rounded-[32px] p-12 space-y-12 shadow-sm border animate-in fade-in slide-in-from-bottom-8 duration-500 ${
                        isDarkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-100"
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                        <div className="space-y-2">
                          <h2 className={`text-3xl font-black flex items-center gap-3 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                            <BrainCircuit size={32} className="text-[#0071e3]" />
                            분석 리포트
                          </h2>

                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold ${isDarkMode ? "bg-gray-800 text-gray-300" : "bg-gray-100 text-gray-600"}`}>
                              {selectedMode.name}
                            </span>

                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 ${isDarkMode ? "bg-blue-900/30 text-blue-300" : "bg-[#e1f0ff] text-[#0071e3]"}`}>
                              <UserCog size={10} /> {selectedPersona.name}
                            </span>

                            {/* ✅ A 모드 배지 */}
                            <span
                              className={`px-3 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 ${
                                useEvidenceMode
                                  ? isDarkMode
                                    ? "bg-emerald-900/30 text-emerald-300"
                                    : "bg-emerald-50 text-emerald-700"
                                  : isDarkMode
                                  ? "bg-gray-800 text-gray-400"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              <ShieldAlert size={10} /> {useEvidenceMode ? "근거모드" : "기본"}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 no-print">
                          
                          {typeof (state.analysis as any)?.confidenceScore === "number" ? (
                            <div className="text-right">
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">검증 점수</p>
                              <div className="flex items-center gap-3 justify-end">
                                <span className="text-2xl font-black text-emerald-600">
                                  {(state.analysis as any).confidenceScore}%
                                </span>
                                <div className={`w-20 h-2 rounded-full overflow-hidden ${isDarkMode ? "bg-gray-800" : "bg-gray-100"}`}>
                                  <div
                                    className="h-full bg-emerald-500"
                                    style={{ width: `${(state.analysis as any).confidenceScore}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          ) : null}

<div className="text-right">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">임팩트 지수</p>
                            <div className="flex items-center gap-3">
                              <span className="text-2xl font-black text-[#0071e3]">{state.analysis.growthScore}%</span>
                              <div className={`w-20 h-2 rounded-full overflow-hidden ${isDarkMode ? "bg-gray-800" : "bg-gray-100"}`}>
                                <div className="h-full bg-[#0071e3]" style={{ width: `${state.analysis.growthScore}%` }} />
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={handleDiscussWithAI}
                            className="px-6 py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-full font-bold text-sm transition-all shadow-md active:scale-95 flex items-center gap-2"
                          >
                            <MessageSquare size={16} /> AI 심층 질문
                          </button>
                        </div>
                      </div>

                      {selectedMode.id === "sentiment" && (
                        <div className="mb-8">
                          <SentimentChart keyword={state.keyword} context={state.analysis.summary} isDarkMode={isDarkMode} />
                        </div>
                      )}

                      <div
                        className={`text-xl font-medium leading-relaxed p-12 rounded-[32px] border shadow-sm hover:shadow-md transition-shadow whitespace-pre-line break-words ${
                          isDarkMode ? "bg-gray-800 border-gray-700 text-gray-100" : "bg-white border-gray-100 text-gray-900"
                        }`}
                      >
                        {renderText(state.analysis.summary)}
                      </div>

                      {/* ✅ 근거/팩트체크 섹션 */}
                      {(safeFactChecks.length || safeCitations.length) ? (
                        <div className={`p-8 rounded-[32px] border shadow-sm ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-[#F5F5F7] border-gray-100/50"}`}>
                          <div className="flex items-center justify-between gap-3 mb-5">
                            <div className="flex items-center gap-2">
                              <ShieldAlert className="text-[#0071e3]" size={20} />
                              <h3 className={`font-black text-lg ${isDarkMode ? "text-white" : "text-gray-900"}`}>근거/팩트체크</h3>
                              <span className={`text-[11px] font-black px-2 py-1 rounded-lg ${isDarkMode ? "bg-gray-900 text-gray-300" : "bg-white text-gray-600 border border-gray-200"}`}>
                                {useEvidenceMode ? "근거모드" : "기본"}
                              </span>
                            </div>

                            <button
                              onClick={() => void handleCopyEvidence()}
                              className={`px-4 py-2 rounded-xl font-black text-[11px] flex items-center gap-2 border transition-all ${
                                isDarkMode ? "bg-gray-900 border-gray-700 text-gray-200 hover:bg-gray-950" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                              }`}
                              title="근거/팩트체크 전체 복사"
                            >
                              <Copy size={14} /> 복사
                            </button>
                          </div>

                          {safeFactChecks?.length ? (
                            <div className="space-y-3">
                              {safeFactChecks
                                .slice()
                                .sort((a, b) => (a.point || 0) - (b.point || 0))
                                .map((fc, idx) => (
                                  <div
                                    key={idx}
                                    className={`${isDarkMode ? "bg-gray-900 border-gray-700" : "bg-white border-gray-100"} border rounded-2xl p-5 ${activePoint === fc.point ? (isDarkMode ? "ring-2 ring-emerald-600/60" : "ring-2 ring-emerald-500/40") : ""}`}
                                  >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                      <button
                                        onClick={() => scrollToSourceByPoint(fc.point)}
                                        className={`font-black text-left shrink-0 ${isDarkMode ? "text-white" : "text-gray-900"} hover:underline`}
                                        title="해당 포인트의 대표 출처로 이동"
                                      >
                                        포인트 {fc.point}
                                      </button>
                                      <div className="flex items-center gap-2 shrink-0 sm:justify-end">
                                        <span className={`text-[10px] font-black px-2 py-1 rounded-full border ${factLabelBadge(fc.label)}`}>
                                          {factLabelTextKo(fc.label)}
                                        </span>
                                        <span className={`text-[10px] font-black px-2 py-1 rounded-full ${isDarkMode ? "bg-gray-800 text-gray-300" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>
                                          신뢰도 {fc.confidence}
                                        </span>
                                      </div>
                                    </div>

                                    <p className={`mt-2 pr-0 sm:pr-24 text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? "text-gray-300" : "text-gray-700"}`}>{fc.reason}</p>

                                    {safeCitations?.length ? (
                                      <div className="mt-3 space-y-1">
                                        {safeCitations
                                          .filter((c: any) => c.point === fc.point)
                                          .slice(0, 3)
                                          .map((c: any, i: number) => (
                                            <a
                                              key={i}
                                              href={c.url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className={`block text-sm font-bold hover:underline ${isDarkMode ? "text-blue-300" : "text-[#0071e3]"}`}
                                            >
                                              • {c.title}
                                            </a>
                                          ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <p className={`text-sm font-medium ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>팩트체크 데이터가 없습니다.</p>
                          )}
                        </div>
                      ) : null}

                      <div className="no-print">
                        <ContentExpander
                          keyword={state.keyword}
                          summary={state.analysis.summary}
                          expandedData={expandedContent}
                          setExpandedData={setExpandedContent}
                          onShowToast={showToast}
                          onOpenReport={() => setIsReportModalOpen(true)}
                        />
                      </div>
                    </div>
                  ) : !state.isLoading ? (
                    <div className="py-40 text-center flex flex-col items-center no-print">
                      <div className={`w-24 h-24 rounded-3xl flex items-center justify-center shadow-sm mb-8 p-5 ${isDarkMode ? "bg-gray-800" : "bg-white"}`}>
                        <img src={DONGA_LOGO_URL} alt="로고" className="w-full h-full object-contain animate-pulse" />
                      </div>
                      <p className={`text-lg font-medium max-w-lg mx-auto leading-relaxed whitespace-pre-wrap ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>
                        키워드를 입력하고 분석 모드를 선택하여
                        <br />
                        나만의 미니멀 AI 리포트를 생성해보세요.
                      </p>
                    </div>
                  ) : null}
                </>
              ) : activeTab === "onepage" ? (
                <div className="space-y-6 animate-in fade-in duration-500 no-print">
                  <OnePageSummaryCard
                    keyword={state.keyword}
                    analysis={state.analysis}
                    activePoint={activePoint}
                    onSelectPoint={setActivePoint}
                    isDarkMode={isDarkMode}
                  />
                </div>
              ) : (
                <div className="space-y-8 animate-in fade-in duration-500 no-print">
                  <h2 className={`text-4xl font-black tracking-tight flex items-center gap-4 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                    <Database className="text-[#0071e3]" size={36} /> 보관함
                  </h2>
                  <SavedCards />
                </div>
              )}
            </section>

            {/* Aside */}
            <aside className="col-span-12 xl:col-span-4 space-y-10 no-print">
              <div className={`rounded-[32px] p-10 shadow-sm border sticky top-40 ${isDarkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-100"}`}>
                <div className="flex items-center justify-between mb-8">
                  <h3 className={`text-xl font-black flex items-center gap-3 ${isDarkMode ? "text-white" : "text-gray-900"}`}>
                    <Globe className="text-[#0071e3]" size={24} /> 소스 피드
                  </h3>

                  {/* ✅ 최신순 정렬 유지 */}
                  <div className={`flex gap-1 p-1 rounded-lg ${isDarkMode ? "bg-gray-800" : "bg-gray-50"}`}>
                    <button
                      onClick={() => setNewsSort("latest")}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 ${
                        newsSort === "latest"
                          ? isDarkMode
                            ? "bg-gray-700 text-white shadow-sm"
                            : "bg-white text-[#0071e3] shadow-sm"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      <Clock size={12} /> 최신순
                    </button>
                    <button
                      onClick={() => setNewsSort("relevance")}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 ${
                        newsSort === "relevance"
                          ? isDarkMode
                            ? "bg-gray-700 text-white shadow-sm"
                            : "bg-white text-[#0071e3] shadow-sm"
                          : "text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      <ArrowUpDown size={12} /> 관련도순
                    </button>
                  </div>
                </div>

                <div className="space-y-5 max-h-[700px] overflow-y-auto pr-2">
                  {newsSources.length > 0 ? (
                    sortedNewsSources.map((item, idx) => (
                      <div key={(item as any)?.uri || (item as any)?.url || idx} ref={setSourceRef((item as any)?.uri || (item as any)?.url || "")}>
                        <NewsCard
                          item={item}
                          keyword={state.keyword}
                          analysis={state.analysis}
                          isDarkMode={isDarkMode}
                          activePoint={activePoint}
                          onShowToast={showToast}
                        />
                      </div>
                    ))
                  ) : state.isLoading ? (
                    <div className="py-20 text-center text-gray-400 font-medium">
                      <Loader2 className="animate-spin mx-auto mb-4" />
                      리서치 진행 중...
                    </div>
                  ) : (
                    <div className={`py-24 text-center border-2 border-dashed rounded-3xl ${isDarkMode ? "border-gray-800" : "border-gray-100"}`}>
                      <Search size={32} className={`mx-auto mb-3 ${isDarkMode ? "text-gray-700" : "text-gray-200"}`} />
                      <p className="text-xs font-bold text-gray-400">분석 대기 중</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* API Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-6 no-print">
          <div className={`border rounded-[32px] p-12 w-full max-w-xl shadow-2xl relative animate-in zoom-in-95 ${isDarkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200"}`}>
            <button
              onClick={() => setIsKeyModalOpen(false)}
              className={`absolute right-8 top-8 hover:text-gray-500 ${isDarkMode ? "text-gray-400" : "text-gray-400"}`}
            >
              <X size={28} />
            </button>

            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#0071e3]/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Key size={32} className="text-[#0071e3]" />
              </div>
              <h2 className={`text-2xl font-black mb-2 ${isDarkMode ? "text-white" : "text-gray-900"}`}>API 키 관리</h2>
              <p className="text-gray-500 text-sm font-medium">
                서비스 이용을 위해 Gemini API 키가 필요합니다.
              </p>
            </div>

            <div className={`p-5 rounded-2xl mb-8 text-left border ${isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100"}`}>
              <h4 className={`text-xs font-bold mb-2 ${isDarkMode ? "text-gray-200" : "text-gray-900"}`}>📢 API 키가 없으신가요?</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-3">
                Google AI Studio에서 무료로 빠르고 간편하게 발급받을 수 있습니다.
                <br />
                발급받은 키를 복사하여 아래 입력창에 붙여넣기 해주세요.
              </p>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-[#0071e3] hover:underline flex items-center gap-1"
              >
                👉 구글 API 키 무료로 발급받기
              </a>
            </div>

            <div className="space-y-4">
              <input
                type="password"
                placeholder="Gemini API Key 입력 (AIza...)"
                value={tempApiKey}
                onChange={(e) => setTempApiKey(e.target.value)}
                className={`w-full border rounded-2xl py-4 px-6 font-mono text-sm focus:ring-4 focus:ring-[#0071e3]/10 outline-none transition-all ${
                  isDarkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-gray-50 border-gray-200 text-gray-900"
                }`}
              />
              <input
                type="password"
                placeholder="Serper API Key 입력"
                value={tempSerperKey}
                onChange={(e) => setTempSerperKey(e.target.value)}
                className={`w-full border rounded-2xl py-4 px-6 font-mono text-sm focus:ring-4 focus:ring-[#0071e3]/10 outline-none transition-all ${
                  isDarkMode ? "bg-gray-800 border-gray-700 text-white" : "bg-gray-50 border-gray-200 text-gray-900"
                }`}
              />
              <button
                onClick={handleSaveApiKey}
                className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
              >
                저장 및 적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 공유 모달 */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Share2 size={24} className="text-[#0071e3]" /> 공유하기
              </h3>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-500 font-medium">
              아래 링크를 복사하여 공유하세요.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={getWindowHref()}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-600 focus:outline-none"
              />
              <button
                onClick={() => void handleCopyShareLink()}
                className="bg-[#0071e3] text-white px-4 rounded-xl font-bold flex items-center justify-center hover:bg-[#005bb5]"
                title="링크 복사"
              >
                <Copy size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.visible && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-gray-900 text-white rounded-full font-bold shadow-xl animate-in fade-in slide-in-from-bottom-6 no-print">
          {toast.message}
        </div>
      )}

      {/* 리포트 모달 */}
      {isReportModalOpen && state.analysis && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white w-full max-w-5xl max-h-[94vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <div>
                <h2 className="text-2xl font-black text-[#1d1d1f] flex items-center gap-2">
                  <Sparkles className="text-[#0071e3]" /> 최종 리포트
                </h2>
                <div className="flex items-center gap-3 mt-2">
                  <p className="text-xs text-gray-400 font-bold">
                    GENERATED BY TrendPulse AI • {new Date().toLocaleDateString()}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsReportModalOpen(false)}
                className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
              >
                <X size={24} className="text-gray-600" />
              </button>
            </div>

            <div id="print-section" className="p-8 overflow-y-auto space-y-8 bg-white min-h-0">
              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0071e3]" /> 1단계: 데이터 수집 및 정제
                </h3>
                <p className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">
                  {state.analysis.summary ? renderText(state.analysis.summary) : "수집된 데이터가 없습니다."}
                </p>
              </div>

              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0071e3]" /> 2단계: AI 심층 분석
                </h3>
                <div className="space-y-4">
                  {state.analysis.keyPoints.map((point, idx) => (
                    <p key={idx} className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">
                      {renderText(point)}
                    </p>
                  ))}
                </div>
              </div>

              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0071e3]" /> 3단계: 활용 전략 및 확장 방향
                </h3>
                <p className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">
                  {renderText(osmuText)}
                </p>
              </div>

              {/* ✅ A단계: 근거/팩트체크 (PDF 포함) */}
              {(safeFactChecks.length || safeCitations.length) ? (
                <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                  <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#0071e3]" /> A단계: 근거/팩트체크
                  </h3>

                  {safeFactChecks.length ? (
                    <div className="space-y-4">
                      {safeFactChecks
                        .slice()
                        .sort((a, b) => (a.point || 0) - (b.point || 0))
                        .map((fc, idx) => (
                          <div key={idx} className="bg-white p-5 rounded-2xl border border-gray-100">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="font-black text-gray-900">포인트 {fc.point}</div>
                              <div className="text-xs font-black text-gray-500 shrink-0">
                                {factLabelTextKo(fc.label)} · 신뢰도 {fc.confidence}
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-line break-words sm:pr-24">{fc.reason}</p>

                            {safeCitations.length ? (
                              <div className="mt-3 space-y-1">
                                {safeCitations
                                  .filter((c: any) => c.point === fc.point)
                                  .slice(0, 3)
                                  .map((c: any, i: number) => (
                                    <a
                                      key={i}
                                      href={c.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block text-sm font-bold text-[#0071e3] hover:underline"
                                    >
                                      • {c.title}
                                    </a>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 font-medium">팩트체크 데이터가 없습니다.</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="p-6 border-t border-gray-100 bg-white flex gap-3 print:hidden">
              <button
                onClick={() => void handleDownloadPDF()}
                className="flex-1 py-4 bg-[#0071e3] text-white rounded-xl font-bold hover:bg-[#0077ED] transition-all shadow-lg flex items-center justify-center gap-2"
              >
                <LayoutDashboard size={20} /> 리포트 PDF 다운로드
              </button>
              <button
                onClick={handleShare}
                className="w-32 py-4 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
              >
                <Share2 size={20} /> 공유
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatWidget analysis={state.analysis} externalCommand={chatCommand} keyword={state.keyword} />
    </div>
  );
};

export default App;