// src/services/sourceService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Serper 기반 근거 소스 수집기
 * - URL 정규화(utm/hash/www 제거) + 정규화 기준 중복 제거
 * - 날짜 파싱(상대 시간/국문/영문) → timestamp(ms)로 통일
 * - snippet 필드 포함 (App.tsx의 evidenceArray/snippet 유지)
 * - 소셜/동영상 도메인, 검색/프록시 링크 차단
 * - 프론트 전용: AbortController로 타임아웃 적용
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

/** -----------------------------
 *  Blocklist
 * ------------------------------ */
export const BLOCKED_DOMAINS = [
  "google.com",
  "google.co.kr",
  "m.google.com",
  "news.google.co.kr",
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
  "news.google.com",
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

  // 1) Date.parse 가능한 경우
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;

  const s = raw.toLowerCase();

  // 2) English relative
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

  // 3) Korean relative
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

const MAJOR_OUTLET_BOOSTS: Record<string, number> = {
  "hani.co.kr": 170,
  "donga.com": 170,
  "ytn.co.kr": 165,
  "bbc.com": 165,
  "reuters.com": 165,
  "bloomberg.com": 165,
  "yonhapnews.co.kr": 162,
  "joongang.co.kr": 156,
  "chosun.com": 156,
  "khan.co.kr": 154,
  "mk.co.kr": 152,
  "hankyung.com": 152,
  "kbs.co.kr": 150,
  "imbc.com": 150,
  "sbs.co.kr": 150,
  "newsis.com": 138,
  "munhwa.com": 136,
  "segye.com": 134,
  "edaily.co.kr": 116,
};

const PREFERRED_MAJOR_HOSTS = [
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
  "newsis.com",
  "munhwa.com",
  "segye.com",
];

const LOW_PRIORITY_HOST_PENALTIES: Record<string, number> = {
  "g-enews.com": 95,
  "g-enews.co.kr": 95,
  "marketin.edaily.co.kr": 85,
  "edaily.co.kr": 20,
  "jnilbo.com": 90,
  "theguru.co.kr": 85,
  "newstomato.com": 75,
  "newsway.co.kr": 70,
  "newsprime.co.kr": 70,
  "etoday.co.kr": 65,
  "investing.com": 200,
  "cleantechnica.com": 200,
  "teslarati.com": 200,
  "teslaaccessories.com": 200,
  "swotpal.com": 300,
  "youtube.com": 400,
  "x.com": 400,
  "twitter.com": 400,
  "news.mt.co.kr": 55,
};

const ALLOWED_MAJOR_HOSTS = [
  "hani.co.kr",
  "khan.co.kr",
  "donga.com",
  "chosun.com",
  "joongang.co.kr",
  "munhwa.com",
  "mk.co.kr",
  "hankyung.com",
  "yonhapnews.co.kr",
  "ytn.co.kr",
  "kbs.co.kr",
  "imbc.com",
  "sbs.co.kr",
  "newsis.com",
  "bbc.com",
  "reuters.com",
  "bloomberg.com",
  "cnn.com",
  "nytimes.com",
  "wsj.com",
  "ft.com",
];

const EXCLUDED_REPEATED_HOSTS = [
  "news.nate.com",
  "digitaltoday.co.kr",
  "marketin.edaily.co.kr",
  "g-enews.com",
  "inilbo.com",
  "munhwa.com",
];

const HOST_CAP_OVERRIDES: Record<string, number> = {
  "hani.co.kr": 2,
  "donga.com": 2,
  "ytn.co.kr": 2,
  "bbc.com": 2,
  "reuters.com": 2,
  "bloomberg.com": 2,
  "yonhapnews.co.kr": 2,
};

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
function isAllowedMajorOutletHost(host: string) {
  return ALLOWED_MAJOR_HOSTS.some((domain) => matchHost(host, domain));
}

function isExcludedRepeatedHost(host: string) {
  return EXCLUDED_REPEATED_HOSTS.some((domain) => matchHost(host, domain));
}


function getMajorOutletBoost(host: string) {
  for (const [domain, boost] of Object.entries(MAJOR_OUTLET_BOOSTS)) {
    if (matchHost(host, domain)) return boost;
  }
  return 0;
}

function isPreferredMajorOutlet(host: string) {
  return PREFERRED_MAJOR_HOSTS.some((domain) => matchHost(host, domain));
}

function getLowPriorityPenalty(host: string) {
  for (const [domain, penalty] of Object.entries(LOW_PRIORITY_HOST_PENALTIES)) {
    if (matchHost(host, domain)) return penalty;
  }
  return 0;
}

function getPerspectiveBucket(host: string) {
  if (["hani.co.kr", "khan.co.kr", "ohmynews.com"].some((d) => matchHost(host, d))) return "progressive";
  if (["donga.com", "chosun.com", "joongang.co.kr", "munhwa.com", "mk.co.kr", "hankyung.com"].some((d) => matchHost(host, d))) return "conservative";
  if (["ytn.co.kr", "yonhapnews.co.kr", "kbs.co.kr", "imbc.com", "sbs.co.kr", "newsis.com"].some((d) => matchHost(host, d))) return "broadcast";
  if (["bbc.com", "reuters.com", "bloomberg.com", "cnn.com", "nytimes.com", "wsj.com", "ft.com"].some((d) => matchHost(host, d))) return "global";
  return "general";
}

function diversifyRankedNewsSources(items: Array<NewsSourceItem & { _origin?: "news" | "search"; _score?: number }>, limit = 10) {
  const hostCounts = new Map<string, number>();
  const bucketCounts = new Map<string, number>();
  const selected: Array<NewsSourceItem & { _origin?: "news" | "search"; _score?: number }> = [];
  const remaining = [...items];

  const canPick = (item: NewsSourceItem & { _origin?: "news" | "search"; _score?: number }, relaxed = false) => {
    const host = getHostFromUrl(String(item.url || ""));
    const bucket = getPerspectiveBucket(host);
    const hostCap = HOST_CAP_OVERRIDES[host] ?? 1;
    const bucketCap = bucket === "general" ? 4 : 3;
    if ((hostCounts.get(host) || 0) >= hostCap) return false;
    if (!relaxed && (bucketCounts.get(bucket) || 0) >= bucketCap) return false;
    return true;
  };

  const pickOne = (predicate: (item: NewsSourceItem & { _origin?: "news" | "search"; _score?: number }) => boolean, relaxed = false) => {
    const idx = remaining.findIndex((item) => predicate(item) && canPick(item, relaxed));
    if (idx === -1) return false;
    const [chosen] = remaining.splice(idx, 1);
    const host = getHostFromUrl(String(chosen.url || ""));
    const bucket = getPerspectiveBucket(host);
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    selected.push(chosen);
    return true;
  };

  for (const bucket of ["progressive", "conservative", "broadcast", "global"]) {
    if (selected.length >= limit) break;
    pickOne((item) => {
      const host = getHostFromUrl(String(item.url || ""));
      return getPerspectiveBucket(host) === bucket && isPreferredMajorOutlet(host);
    });
  }

  for (const bucket of ["progressive", "conservative", "broadcast", "global"]) {
    if (selected.length >= limit) break;
    pickOne((item) => getPerspectiveBucket(getHostFromUrl(String(item.url || ""))) === bucket);
  }

  while (selected.length < limit && remaining.length) {
    if (!pickOne(() => true)) {
      if (!pickOne(() => true, true)) break;
    }
  }

  return selected;
}

export function isNewsLikeUrl(url: string) {
  if (!isLikelyArticleUrlSoft(url)) return false;
  try {
    const u = new URL(url);
    const path = (u.pathname || "").toLowerCase();
    if (!path || path === "/") return false;
    if (NON_ARTICLE_PATTERNS.some((bad) => path.includes(bad))) return false;
    return ARTICLE_PATH_HINTS.some((hint) => path.includes(hint)) || ARTICLE_SLUG_RE.test(path);
  } catch {
    return false;
  }
}

function scoreNewsSource(item: NewsSourceItem & { _origin?: "news" | "search" }, origin: "news" | "search") {
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
    const u = new URL(url);
    const host = (u.hostname || "").replace(/^www\./, "").toLowerCase();
    const path = (u.pathname || "").toLowerCase();
    if (NON_ARTICLE_PATTERNS.some((bad) => path.includes(bad))) score -= 120;
    if (u.searchParams.toString().length > 120) score -= 15;
    score += getMajorOutletBoost(host);
    score -= getLowPriorityPenalty(host);
    if (isPreferredMajorOutlet(host)) score += 55;

    const bucket = getPerspectiveBucket(host);
    if (bucket === "progressive" || bucket === "conservative" || bucket === "broadcast" || bucket === "global") {
      score += 8;
    }
  } catch {}

  return score;
}

export function filterAndRankNewsSources(items: Array<NewsSourceItem & { _origin?: "news" | "search" }>, minScore = 80) {
  const ranked = uniqByUrl(items)
    .filter((item) => {
      const url = String(item.url || "");
      const host = getHostFromUrl(url);
      if (!host) return false;
      if (isBlockedDomain(url) || isBlockedByKeyword(url)) return false;
      if (BAD_HOSTS.some((b) => host === b || host.endsWith("." + b))) return false;
      if (isExcludedRepeatedHost(host)) return false;
      return isAllowedMajorOutletHost(host);
    })
    .map((item) => ({
      ...item,
      _score: scoreNewsSource(item, item._origin || "search"),
    }))
    .filter((item) => item._score >= minScore)
    .sort((a, b) => {
      const hostA = getHostFromUrl(String(a.url || ""));
      const hostB = getHostFromUrl(String(b.url || ""));
      const majorDiff = getMajorOutletBoost(hostB) - getMajorOutletBoost(hostA);
      if (majorDiff !== 0) return majorDiff;
      if (b._score !== a._score) return b._score - a._score;
      return (b.ts || 0) - (a.ts || 0);
    });

  return diversifyRankedNewsSources(ranked, 10).map(({ _score, _origin, ...rest }) => rest);
}

const BAD_HOSTS = [
  "vertexaisearch.cloud.google.com",
  "vertexaisearch.googleapis.com",
  "cloud.google.com",
];

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
  const fromEnv = (import.meta as any).env?.VITE_SERPER_API_KEY;
  if (fromEnv) return String(fromEnv).trim();

  // (옵션) 프론트에서 직접 입력/저장해서 쓰는 경우
  try {
    const fromLocal = localStorage.getItem("serper_api_key");
    if (fromLocal) return String(fromLocal).trim();
  } catch {}

  return "";
}

/**
 * ✅ Serper.dev News 검색
 * - 실제 기사 URL을 "최소 minCount"개 이상 최대한 보장
 * - 반환 최대 10개(기사 링크), 부족하면 '더보기' 링크로 채움
 */
export async function fetchNewsSourcesSerper(query: string, minCount = 3): Promise<NewsSourceItem[]> {
  const apiKey = getSerperKey();
  if (!apiKey) return [];

  const need = Math.max(minCount, 3);

  // 1) /news
  const newsData = await serperPost("news", apiKey, {
    q: query,
    gl: "kr",
    hl: "ko",
    num: 20,
  });

  const fromNews = (newsData?.news || []).map((n: any) => {
    const normUrl = normalizeNewsUrl(n?.link || "");
    return {
      title: cleanInlineText(n?.title || "제목 없음"),
      url: normUrl,
      source: cleanInlineText(n?.source || ""),
      snippet: cleanInlineText(n?.snippet || n?.description || ""),
      ...normalizeDateForDisplay(n?.date || ""),
      _origin: "news" as const,
    };
  });

  // 2) /search로 보충
  const searchData = await serperPost("search", apiKey, {
    q: query,
    gl: "kr",
    hl: "ko",
    num: 20,
  });

  // 2-1) 대형 언론사 보강 검색
  const preferredSearchData = await serperPost("search", apiKey, {
    q: `${query} (site:hani.co.kr OR site:donga.com OR site:ytn.co.kr OR site:bbc.com OR site:reuters.com OR site:bloomberg.com OR site:yonhapnews.co.kr OR site:joongang.co.kr OR site:chosun.com OR site:khan.co.kr OR site:mk.co.kr OR site:hankyung.com OR site:kbs.co.kr OR site:imbc.com OR site:sbs.co.kr)`,
    gl: "kr",
    hl: "ko",
    num: 20,
  });

  const fromSearch = (searchData?.organic || []).map((o: any) => {
    const normUrl = normalizeNewsUrl(o?.link || "");
    return {
      title: cleanInlineText(o?.title || "제목 없음"),
      url: normUrl,
      source: cleanInlineText(o?.source || ""),
      snippet: cleanInlineText(o?.snippet || o?.description || ""),
      ...normalizeDateForDisplay(o?.date || ""),
      _origin: "search" as const,
    };
  });

  const fromPreferredSearch = (preferredSearchData?.organic || []).map((o: any) => {
    const normUrl = normalizeNewsUrl(o?.link || "");
    return {
      title: cleanInlineText(o?.title || "제목 없음"),
      url: normUrl,
      source: cleanInlineText(o?.source || ""),
      snippet: cleanInlineText(o?.snippet || o?.description || ""),
      ...normalizeDateForDisplay(o?.date || ""),
      _origin: "search" as const,
    };
  });

  // 3) 합치고 필터/랭킹
  const combined = [...fromNews, ...fromSearch, ...fromPreferredSearch];
  const ranked = filterAndRankNewsSources(combined, 80);
  if (ranked.length >= need) return ranked.slice(0, 10);

  const looser = filterAndRankNewsSources(combined, 30);
  if (looser.length) return looser.slice(0, Math.min(10, Math.max(need, looser.length)));

  return [];
}
