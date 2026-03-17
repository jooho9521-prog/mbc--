// src/services/sourceService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Serper 기반 근거 소스 수집기
 * - URL 정규화(utm/hash/www 제거) + 정규화 기준 중복 제거
 * - 날짜 파싱(상대 시간/국문/영문) → timestamp(ms)로 통일
 * - snippet 필드 포함 (App.tsx의 evidenceArray/snippet 유지)
 * - 소셜/동영상 도메인, 검색/프록시 링크 차단
 * - 프론트 전용: AbortController로 타임아웃 적용
 * - 대형 언론사만 허용
 * - 국내/해외 + 진보/보수/중립 균형 분배 강화
 */

export type NewsSourceItem = {
  title: string;
  url: string;
  source?: string;
  date?: string; // 표시용(YYYY-MM-DD로 정규화 시도)
  snippet?: string;
  /** 파싱 성공 시 UTC ms timestamp */
  ts?: number;
};

type SourceOrigin = "news" | "search";
type RankedNewsSourceItem = NewsSourceItem & {
  _origin?: SourceOrigin;
  _score?: number;
};

type MediaRegion = "kr" | "global";
type MediaLeaning = "progressive" | "conservative" | "neutral";
type PerspectiveBucket =
  | "kr-progressive"
  | "kr-conservative"
  | "kr-neutral"
  | "global-progressive"
  | "global-conservative"
  | "global-neutral"
  | "general";

type MediaMeta = {
  region: MediaRegion;
  leaning: MediaLeaning;
  label: string;
  preferred?: boolean;
  maxPerHost?: number;
  outletBoost?: number;
};

const MEDIA_META: Record<string, MediaMeta> = {
  // 국내 진보
  "hani.co.kr": {
    region: "kr",
    leaning: "progressive",
    label: "한겨레",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 170,
  },
  "khan.co.kr": {
    region: "kr",
    leaning: "progressive",
    label: "경향신문",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 162,
  },

  // 국내 보수
  "donga.com": {
    region: "kr",
    leaning: "conservative",
    label: "동아일보",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 170,
  },
  "chosun.com": {
    region: "kr",
    leaning: "conservative",
    label: "조선일보",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 164,
  },
  "joongang.co.kr": {
    region: "kr",
    leaning: "conservative",
    label: "중앙일보",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 162,
  },
  "mk.co.kr": {
    region: "kr",
    leaning: "conservative",
    label: "매일경제",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },
  "hankyung.com": {
    region: "kr",
    leaning: "conservative",
    label: "한국경제",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },

  // 국내 중립
  "hankookilbo.com": {
    region: "kr",
    leaning: "neutral",
    label: "한국일보",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },
  "seoul.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "서울신문",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 148,
  },
  "yonhapnews.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "연합뉴스",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 164,
  },
  "yna.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "연합뉴스",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 164,
  },
  "ytn.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "YTN",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 165,
  },
  "kbs.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "KBS",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 152,
  },
  "imbc.com": {
    region: "kr",
    leaning: "neutral",
    label: "MBC",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 152,
  },
  "mbc.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "MBC",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 152,
  },
  "sbs.co.kr": {
    region: "kr",
    leaning: "neutral",
    label: "SBS",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 152,
  },
  "newsis.com": {
    region: "kr",
    leaning: "neutral",
    label: "뉴시스",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 144,
  },

  // 해외 중립
  "reuters.com": {
    region: "global",
    leaning: "neutral",
    label: "Reuters",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 166,
  },
  "apnews.com": {
    region: "global",
    leaning: "neutral",
    label: "AP",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 164,
  },
  "bloomberg.com": {
    region: "global",
    leaning: "neutral",
    label: "Bloomberg",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 166,
  },
  "bbc.com": {
    region: "global",
    leaning: "neutral",
    label: "BBC",
    preferred: true,
    maxPerHost: 2,
    outletBoost: 166,
  },
  "cnn.com": {
    region: "global",
    leaning: "neutral",
    label: "CNN",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },

  // 해외 진보
  "nytimes.com": {
    region: "global",
    leaning: "progressive",
    label: "New York Times",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 156,
  },
  "theguardian.com": {
    region: "global",
    leaning: "progressive",
    label: "The Guardian",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },

  // 해외 보수
  "wsj.com": {
    region: "global",
    leaning: "conservative",
    label: "Wall Street Journal",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 156,
  },
  "ft.com": {
    region: "global",
    leaning: "conservative",
    label: "Financial Times",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 154,
  },
  "economist.com": {
    region: "global",
    leaning: "conservative",
    label: "The Economist",
    preferred: true,
    maxPerHost: 1,
    outletBoost: 152,
  },
};

/** -----------------------------
 *  Blocklist
 * ------------------------------ */
export const BLOCKED_DOMAINS = [
  "google.com",
  "google.co.kr",
  "m.google.com",
  "news.google.co.kr",
  "news.google.com",
  "tiktok.com",
  "youtube.com",
  "youtube-nocookie.com",
  "m.youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "x.com",
  "m.x.com",
  "twitter.com",
  "m.twitter.com",
  "t.co",
  "threads.net",
  "reddit.com",
  "discord.com",
  "discord.gg",
  "t.me",
  "namu.wiki",
  "wikipedia.org",
  "search.naver.com",
  "m.search.naver.com",
  "section.blog.naver.com",
  "blog.naver.com",
  "cafe.naver.com",
  "kin.naver.com",
  "post.naver.com",
];

export const BLOCKED_URL_KEYWORDS = [
  "google.com/alerts",
  "unsubscribe",
  "preferences",
  "accounts.google",
  "support.google",
  "policies.google",
  "myaccount.google",
  "mail.google.com",
];

const EXCLUDED_OUTLET_HOSTS = ["munhwa.com", "news1.kr"];

export function isBlockedDomain(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

export function isBlockedByKeyword(url: string) {
  const lower = (url || "").toLowerCase();
  return BLOCKED_URL_KEYWORDS.some((k) => lower.includes(k));
}

/** -----------------------------
 *  Text / URL helpers
 * ------------------------------ */
function cleanInlineText(text: string) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function normalizeTitleForDedupe(title: string) {
  return cleanInlineText(title)
    .toLowerCase()
    .replace(/[“”"'‘’`]/g, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]+\)/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNewsUrl(url: string) {
  if (!url) return "";
  try {
    const u = new URL(url);

    const dropPrefixes = ["utm_", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid"];
    [...u.searchParams.keys()].forEach((k) => {
      const lk = k.toLowerCase();
      if (dropPrefixes.some((p) => lk.startsWith(p)) || dropPrefixes.includes(lk)) {
        u.searchParams.delete(k);
      }
    });

    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "");

    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

/** -----------------------------
 *  Date parsing
 * ------------------------------ */
const MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/**
 * Serper date는 포맷이 들쭉날쭉합니다.
 * - ISO/RFC date
 * - "2 hours ago" / "3 days ago"
 * - "3시간 전" / "2일 전" / "방금"
 */
export function parseDateToTimestamp(input?: string): number | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;

  const s = raw.toLowerCase();

  const en = s.match(/(\d+)\s*(minute|minutes|hour|hours|day|days)\s*ago/);
  if (en) {
    const n = Number(en[1]);
    const unit = en[2];
    if (Number.isFinite(n)) {
      if (unit.startsWith("minute")) return Date.now() - n * MS.minute;
      if (unit.startsWith("hour")) return Date.now() - n * MS.hour;
      if (unit.startsWith("day")) return Date.now() - n * MS.day;
    }
  }

  if (s.includes("방금") || s.includes("just now")) return Date.now();
  const ko = raw.match(/(\d+)\s*(분|시간|일)\s*전/);
  if (ko) {
    const n = Number(ko[1]);
    const unit = ko[2];
    if (Number.isFinite(n)) {
      if (unit === "분") return Date.now() - n * MS.minute;
      if (unit === "시간") return Date.now() - n * MS.hour;
      if (unit === "일") return Date.now() - n * MS.day;
    }
  }

  return undefined;
}

function normalizeDateForDisplay(input?: string): { date?: string; ts?: number } {
  const raw = (input || "").trim();
  if (!raw) return {};
  const ts = parseDateToTimestamp(raw);
  if (ts) {
    try {
      const d = new Date(ts);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return { date: `${yyyy}-${mm}-${dd}`, ts };
    } catch {
      return { date: raw, ts };
    }
  }
  return { date: raw };
}

/** -----------------------------
 *  Dedup
 * ------------------------------ */
const uniqByUrl = <T extends NewsSourceItem>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = normalizeNewsUrl((it.url || "").trim());
    if (!key || seen.has(key)) return false;
    seen.add(key);
    it.url = key;
    return true;
  });
};

const uniqByHostAndTitle = <T extends NewsSourceItem>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((it) => {
    const host = getHostFromUrl(String(it.url || ""));
    const title = normalizeTitleForDedupe(String(it.title || ""));
    if (!host || !title) return false;
    const key = `${host}__${title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** -----------------------------
 *  URL filtering
 * ------------------------------ */
export const BAD_INCLUDES = [
  "google.com/search",
  "news.google.com/search",
  "search.naver.com",
  "m.search.naver.com",
  "media.naver.com/press",
  "twitter.com/search",
  "x.com/search",
  "youtube.com/results",
  "trends.google.com",
  "namu.wiki",
  "wikipedia.org",
  "blog.naver.com",
  "cafe.naver.com",
  "kin.naver.com",
  "post.naver.com",
];

const ARTICLE_PATH_HINTS = [
  "/article/",
  "/articles/",
  "/news/",
  "/newsroom/",
  "/story/",
  "/stories/",
  "/world/",
  "/business/",
  "/markets/",
  "/economy/",
  "/technology/",
  "/tech/",
  "/politics/",
  "/opinion/",
  "/view/",
  "/content/",
  "/read/",
];

const ARTICLE_SLUG_RE = /(\/20\d{2}\/\d{1,2}\/\d{1,2}\/)|([_-]\d{5,})|(\/[A-Za-z0-9-]{18,}$)/;

const NON_ARTICLE_PATTERNS = [
  "/tag/",
  "/tags/",
  "/topics/",
  "/topic/",
  "/search",
  "/live/",
  "/videos/",
  "/video/",
  "/photos/",
  "/photo/",
  "/gallery/",
  "/galleries/",
  "/author/",
  "/authors/",
  "/about",
  "/subscribe",
  "/newsletter",
  "/newsletters",
  "/press",
  "/breakingnews",
  "/breaking-news",
];

const PORTALISH_TITLE_PATTERNS = [/(검색|모아보기|바로가기|더보기)/i, /(google|naver|daum)\s*(news|검색)/i];

const BAD_SNIPPET_PATTERNS = [/(실시간|인기기사|많이 본|더보기)/i, /(검색 결과|관련 검색어)/i];
/** -----------------------------
 *  Host helpers
 * ------------------------------ */

function getHostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchHost(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

function findMediaMeta(host: string): MediaMeta | undefined {
  for (const [domain, meta] of Object.entries(MEDIA_META)) {
    if (matchHost(host, domain)) return meta;
  }
  return undefined;
}

function getMajorOutletBoost(host: string) {
  const meta = findMediaMeta(host);
  return meta?.outletBoost || 0;
}

function isPreferredMajorOutlet(host: string) {
  const meta = findMediaMeta(host);
  return !!meta?.preferred;
}

function getHostCap(host: string) {
  const meta = findMediaMeta(host);
  return meta?.maxPerHost ?? 1;
}

function isAllowedMajorOutletHost(host: string) {
  if (EXCLUDED_OUTLET_HOSTS.some((domain) => matchHost(host, domain))) return false;
  return !!findMediaMeta(host);
}

/** -----------------------------
 *  Perspective bucket
 * ------------------------------ */

function getPerspectiveBucket(host: string): PerspectiveBucket {
  const meta = findMediaMeta(host);
  if (!meta) return "general";

  const key = `${meta.region}-${meta.leaning}` as PerspectiveBucket;
  return key;
}

/** -----------------------------
 *  Diversify logic
 * ------------------------------ */

function diversifyRankedNewsSources(
  items: RankedNewsSourceItem[],
  limit = 10
) {
  const hostCounts = new Map<string, number>();
  const bucketCounts = new Map<PerspectiveBucket, number>();
  const regionCounts = new Map<"kr" | "global", number>();

  const selected: RankedNewsSourceItem[] = [];
  const remaining = [...items];

  const BUCKET_TARGET: Record<PerspectiveBucket, number> = {
    "kr-progressive": 1,
    "kr-conservative": 1,
    "kr-neutral": 2,
    "global-neutral": 2,
    "global-progressive": 1,
    "global-conservative": 1,
    general: 2,
  };

  const MIN_REGION_TARGET = {
    kr: Math.min(4, limit),
    global: Math.min(4, limit),
  };

  const getRegion = (host: string): "kr" | "global" | null => {
    const meta = findMediaMeta(host);
    return meta?.region || null;
  };

  const canPick = (item: RankedNewsSourceItem, relaxed = false) => {
    const host = getHostFromUrl(String(item.url || ""));
    const bucket = getPerspectiveBucket(host);
    const region = getRegion(host);

    if (!host || !region) return false;

    const hostCap = getHostCap(host);
    const bucketCap = BUCKET_TARGET[bucket] ?? 2;

    if ((hostCounts.get(host) || 0) >= hostCap) return false;
    if (!relaxed && (bucketCounts.get(bucket) || 0) >= bucketCap) return false;

    return true;
  };

  const register = (item: RankedNewsSourceItem) => {
    const host = getHostFromUrl(String(item.url || ""));
    const bucket = getPerspectiveBucket(host);
    const region = getRegion(host);

    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    if (region) {
      regionCounts.set(region, (regionCounts.get(region) || 0) + 1);
    }
  };

  const pickOne = (
    predicate: (item: RankedNewsSourceItem) => boolean,
    relaxed = false
  ) => {
    const idx = remaining.findIndex((item) => predicate(item) && canPick(item, relaxed));
    if (idx === -1) return false;

    const [chosen] = remaining.splice(idx, 1);
    register(chosen);
    selected.push(chosen);
    return true;
  };

  while ((regionCounts.get("global") || 0) < MIN_REGION_TARGET.global && selected.length < limit) {
    if (
      !pickOne((item) => {
        const host = getHostFromUrl(String(item.url || ""));
        return findMediaMeta(host)?.region === "global" && isPreferredMajorOutlet(host);
      })
    ) {
      if (
        !pickOne((item) => {
          const host = getHostFromUrl(String(item.url || ""));
          return findMediaMeta(host)?.region === "global";
        }, true)
      ) {
        break;
      }
    }
  }
    while ((regionCounts.get("kr") || 0) < MIN_REGION_TARGET.kr && selected.length < limit) {
    if (
      !pickOne((item) => {
        const host = getHostFromUrl(String(item.url || ""));
        return findMediaMeta(host)?.region === "kr" && isPreferredMajorOutlet(host);
      })
    ) {
      if (
        !pickOne((item) => {
          const host = getHostFromUrl(String(item.url || ""));
          return findMediaMeta(host)?.region === "kr";
        }, true)
      ) {
        break;
      }
    }
  }

  for (const bucket of [
    "kr-progressive",
    "kr-conservative",
    "kr-neutral",
    "global-neutral",
    "global-progressive",
    "global-conservative",
  ] as PerspectiveBucket[]) {
    if (selected.length >= limit) break;

    pickOne((item) => {
      const host = getHostFromUrl(String(item.url || ""));
      return getPerspectiveBucket(host) === bucket && isPreferredMajorOutlet(host);
    });
  }

  for (const bucket of [
    "kr-progressive",
    "kr-conservative",
    "kr-neutral",
    "global-neutral",
    "global-progressive",
    "global-conservative",
  ] as PerspectiveBucket[]) {
    if (selected.length >= limit) break;

    pickOne((item) => {
      const host = getHostFromUrl(String(item.url || ""));
      return getPerspectiveBucket(host) === bucket;
    });
  }

  while (selected.length < limit && remaining.length) {
    if (!pickOne(() => true)) {
      if (!pickOne(() => true, true)) break;
    }
  }

  return selected;
}

/** -----------------------------
 *  Article URL detection
 * ------------------------------ */

export function isNewsLikeUrl(url: string) {
  if (!isLikelyArticleUrlSoft(url)) return false;

  try {
    const u = new URL(url);
    const path = (u.pathname || "").toLowerCase();

    if (!path || path === "/") return false;

    if (NON_ARTICLE_PATTERNS.some((bad) => path.includes(bad))) return false;

    return (
      ARTICLE_PATH_HINTS.some((hint) => path.includes(hint)) ||
      ARTICLE_SLUG_RE.test(path)
    );
  } catch {
    return false;
  }
}

/** -----------------------------
 *  Scoring
 * ------------------------------ */

function scoreNewsSource(
  item: RankedNewsSourceItem,
  origin: SourceOrigin
) {
  let score = 0;

  const url = String(item.url || "").trim();
  const title = cleanInlineText(item.title || "");
  const snippet = cleanInlineText(item.snippet || "");

  if (isLikelyArticleUrlStrict(url)) score += 120;
  else if (isLikelyArticleUrlSoft(url)) score += 50;
  else return -9999;

  if (isNewsLikeUrl(url)) score += 80;

  if (origin === "news") score += 25;

  if (item.ts) score += 12;

  if (item.source) score += 10;

  if (title.length >= 18) score += 18;

  if (snippet.length >= 60) score += 18;

  if (snippet.length >= 120) score += 10;

  if (PORTALISH_TITLE_PATTERNS.some((re) => re.test(title))) score -= 120;

  if (BAD_SNIPPET_PATTERNS.some((re) => re.test(snippet))) score -= 80;

  try {
    const host = getHostFromUrl(url);

    score += getMajorOutletBoost(host);

    if (isPreferredMajorOutlet(host)) score += 50;

    const bucket = getPerspectiveBucket(host);

    if (bucket !== "general") score += 8;
  } catch {}

  return score;
}

/** -----------------------------
 *  Ranking pipeline
 * ------------------------------ */

export function filterAndRankNewsSources(
  items: RankedNewsSourceItem[],
  minScore = 80
) {
  const ranked = uniqByHostAndTitle(
    uniqByUrl(items)
      .filter((item) => {
        const url = String(item.url || "");
        const host = getHostFromUrl(url);

        if (!host) return false;

        if (isBlockedDomain(url) || isBlockedByKeyword(url)) return false;

        if (!isAllowedMajorOutletHost(host)) return false;

        return true;
      })
      .map((item) => ({
        ...item,
        _score: scoreNewsSource(item, item._origin || "search"),
      }))
      .filter((item) => (item._score || 0) >= minScore)
      .sort((a, b) => {
        const hostA = getHostFromUrl(String(a.url || ""));
        const hostB = getHostFromUrl(String(b.url || ""));

        const majorDiff = getMajorOutletBoost(hostB) - getMajorOutletBoost(hostA);

        if (majorDiff !== 0) return majorDiff;

        if ((b._score || 0) !== (a._score || 0)) return (b._score || 0) - (a._score || 0);

        return (b.ts || 0) - (a.ts || 0);
      })
  );

  return diversifyRankedNewsSources(ranked, 10).map(({ _score, _origin, ...rest }) => rest);
}
/** -----------------------------
 *  Bad hosts
 * ------------------------------ */

const BAD_HOSTS = [
  "vertexaisearch.cloud.google.com",
  "vertexaisearch.googleapis.com",
  "cloud.google.com",
];

/** -----------------------------
 *  Article URL 판별
 * ------------------------------ */

// ✅ 1차(엄격) 기사 URL 판별
const isLikelyArticleUrlStrict = (url: string) => {
  if (!url) return false;
  if (isBlockedDomain(url) || isBlockedByKeyword(url)) return false;
  if (BAD_INCLUDES.some((b) => url.includes(b))) return false;

  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();
    if (BAD_HOSTS.some((b) => host === b || host.endsWith("." + b))) return false;

    const path = u.pathname || "";
    if (path === "/" || path.length < 2) return false;

    if (NON_ARTICLE_PATTERNS.some((bad) => path.toLowerCase().includes(bad))) return false;

    return true;
  } catch {
    return false;
  }
};

// ✅ 2차(완화) 기사 URL 판별: “최소 N개” 강제 채우기용
const isLikelyArticleUrlSoft = (url: string) => {
  if (!url) return false;
  if (isBlockedDomain(url) || isBlockedByKeyword(url)) return false;
  if (BAD_INCLUDES.some((b) => url.includes(b))) return false;

  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();
    if (BAD_HOSTS.some((b) => host === b || host.endsWith("." + b))) return false;

    const path = u.pathname || "";
    if (!path || path === "/") return false;

    return true;
  } catch {
    return false;
  }
};

/** -----------------------------
 *  Serper client
 * ------------------------------ */

async function serperPost(endpoint: "news" | "search", apiKey: string, body: any) {
  const controller = new AbortController();
  const t = window.setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) return null;

    return resp.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

function getSerperKey(): string {
  const env = (import.meta as any)?.env || {};
  const winEnv = (window as any)?.process?.env || {};

  const candidates = [
    env?.VITE_SERPER_API_KEY,
    env?.SERPER_API_KEY,
    winEnv?.VITE_SERPER_API_KEY,
    winEnv?.SERPER_API_KEY,
  ];

  for (const candidate of candidates) {
    if (candidate) return String(candidate).trim();
  }

  try {
    const fromLocal = localStorage.getItem("serper_api_key");
    if (fromLocal) return String(fromLocal).trim();
  } catch {}

  return "";
}

function mapSerperItem(raw: any, origin: SourceOrigin): RankedNewsSourceItem {
  const normUrl = normalizeNewsUrl(raw?.link || "");
  return {
    title: cleanInlineText(raw?.title || "제목 없음"),
    url: normUrl,
    source: cleanInlineText(raw?.source || ""),
    snippet: cleanInlineText(raw?.snippet || raw?.description || ""),
    ...normalizeDateForDisplay(raw?.date || ""),
    _origin: origin,
  };
}

function buildPreferredOutletQuery(query: string) {
  return `${query} (site:hani.co.kr OR site:khan.co.kr OR site:donga.com OR site:chosun.com OR site:joongang.co.kr OR site:hankookilbo.com OR site:seoul.co.kr OR site:yonhapnews.co.kr OR site:yna.co.kr OR site:ytn.co.kr OR site:kbs.co.kr OR site:imbc.com OR site:mbc.co.kr OR site:sbs.co.kr OR site:newsis.com OR site:reuters.com OR site:apnews.com OR site:bloomberg.com OR site:bbc.com OR site:cnn.com OR site:nytimes.com OR site:theguardian.com OR site:wsj.com OR site:ft.com OR site:economist.com)`;
}

function getSeoulToday() {
  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
}

function buildQueryVariants(query: string) {
  const base = cleanInlineText(query || "");
  if (!base) return [] as string[];

  const variants = new Set<string>([base]);
  const lower = base.toLowerCase();
  const hasKorean = /[가-힣]/.test(base);
  const outletSuffix = `Reuters OR Bloomberg OR BBC OR CNN OR FT OR WSJ OR CNBC OR AP`;

  if (/테슬라/.test(base) || /\btesla\b/.test(lower)) {
    variants.add(`${base} OR Tesla OR "Tesla Inc" OR TSLA OR "Elon Musk"`);
    variants.add(`Tesla OR "Tesla Inc" OR TSLA OR "Elon Musk" ${outletSuffix}`);
    variants.add(`Tesla EV Reuters Bloomberg BBC CNN WSJ FT CNBC AP`);
  } else {
    variants.add(`${base} ${outletSuffix}`);
    if (hasKorean) {
      variants.add(`${base} 해외 뉴스 ${outletSuffix}`);
    } else {
      variants.add(`${base} global news ${outletSuffix}`);
    }
  }

  variants.add(buildPreferredOutletQuery(base));
  return Array.from(variants).filter(Boolean);
}

function ensureDateFallback(item: RankedNewsSourceItem): RankedNewsSourceItem {
  if (item.date && String(item.date).trim()) return item;
  return {
    ...item,
    date: getSeoulToday(),
    ts: item.ts || Date.now(),
  };
}

export async function fetchNewsSourcesSerper(
  query: string,
  minCount = 3
): Promise<NewsSourceItem[]> {
  const apiKey = getSerperKey();
  if (!apiKey) return [];

  const need = Math.max(minCount, 3);
  const queryVariants = buildQueryVariants(query);
  const primaryQuery = queryVariants[0] || cleanInlineText(query || "");
  const globalQuery = queryVariants[1] || `${primaryQuery} global`;
  const globalOutletQuery = queryVariants[2] || buildPreferredOutletQuery(primaryQuery);

  const [newsKR, newsUS, newsGlobal, preferredSearchData, searchData, extraGlobalSearch] = await Promise.all([
    serperPost("news", apiKey, {
      q: primaryQuery,
      gl: "kr",
      hl: "ko",
      num: 20,
    }),
    serperPost("news", apiKey, {
      q: globalQuery,
      gl: "us",
      hl: "en",
      num: 20,
    }),
    serperPost("news", apiKey, {
      q: `${globalQuery} global`,
      gl: "us",
      hl: "en",
      num: 20,
    }),
    serperPost("search", apiKey, {
      q: buildPreferredOutletQuery(primaryQuery),
      gl: "us",
      hl: "en",
      num: 20,
    }),
    serperPost("search", apiKey, {
      q: primaryQuery,
      gl: "kr",
      hl: "ko",
      num: 20,
    }),
    serperPost("search", apiKey, {
      q: globalOutletQuery,
      gl: "us",
      hl: "en",
      num: 20,
    }),
  ]);

  const fromKR: RankedNewsSourceItem[] = (newsKR?.news || []).map((n: any) =>
    ensureDateFallback(mapSerperItem(n, "news"))
  );

  const fromUS: RankedNewsSourceItem[] = (newsUS?.news || []).map((n: any) =>
    ensureDateFallback(mapSerperItem(n, "news"))
  );

  const fromGlobal: RankedNewsSourceItem[] = (newsGlobal?.news || []).map((n: any) =>
    ensureDateFallback(mapSerperItem(n, "news"))
  );

  const fromPreferredSearch: RankedNewsSourceItem[] = (
    preferredSearchData?.organic || []
  ).map((o: any) => ensureDateFallback(mapSerperItem(o, "search")));

  const fromSearch: RankedNewsSourceItem[] = (searchData?.organic || []).map((o: any) =>
    ensureDateFallback(mapSerperItem(o, "search"))
  );

  const fromExtraGlobalSearch: RankedNewsSourceItem[] = (extraGlobalSearch?.organic || []).map((o: any) =>
    ensureDateFallback(mapSerperItem(o, "search"))
  );

  const combined = [
    ...fromKR,
    ...fromUS,
    ...fromGlobal,
    ...fromPreferredSearch,
    ...fromSearch,
    ...fromExtraGlobalSearch,
  ];

  const ranked = filterAndRankNewsSources(combined, 80);
  if (ranked.length >= need) return ranked.slice(0, 10);

  const looser = filterAndRankNewsSources(combined, 30);
  if (looser.length) return looser.slice(0, 10);

  const softFallback = uniqByHostAndTitle(
    uniqByUrl(combined).filter((item) => {
      const url = String(item.url || "");
      const host = getHostFromUrl(url);

      if (!url || !host) return false;
      if (isBlockedDomain(url) || isBlockedByKeyword(url)) return false;
      if (!isAllowedMajorOutletHost(host)) return false;

      return true;
    })
  ).slice(0, 10);

  return softFallback.map(({ _score, _origin, ...rest }) => ensureDateFallback(rest as RankedNewsSourceItem));
}
