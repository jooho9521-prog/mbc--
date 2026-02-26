// src/services/sourceService.ts
export type NewsSourceItem = {
  title: string;
  url: string;
  source?: string;
  date?: string;
};

// ✅ 중복 제거
const uniqByUrl = (items: NewsSourceItem[]) => {
  const seen = new Set<string>();
  return items.filter(it => {
    const key = (it.url || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ✅ 1차(엄격) 기사 URL 판별
const isLikelyArticleUrlStrict = (url: string) => {
  if (!url) return false;

  // 검색/홈/프록시 도메인 등 제외
  const badIncludes = [
    "google.com/search",
    "news.google.com/search",
    "search.naver.com",
    "m.search.naver.com",
    "media.naver.com/press",
  ];

  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();

    // ✅ 스샷에 보인 프록시/중계 도메인 차단 (여기서 핵심)
    const badHosts = [
      "vertexaisearch.cloud.google.com",
      "vertexaisearch.googleapis.com",
      "cloud.google.com",
    ];
    if (badHosts.some(b => host === b || host.endsWith("." + b))) return false;

    if (badIncludes.some(b => url.includes(b))) return false;

    // 루트(/)만 있는 링크는 기사일 확률 낮음
    const path = u.pathname || "";
    if (path === "/" || path.length < 2) return false;

    return true;
  } catch {
    return false;
  }
};

// ✅ 2차(완화) 기사 URL 판별: “최소 3개” 강제 채우기용
// - strict에서 너무 많이 탈락할 때, 그래도 그나마 기사일 가능성 있는 링크를 살림
const isLikelyArticleUrlSoft = (url: string) => {
  if (!url) return false;

  try {
    const u = new URL(url);
    const host = (u.hostname || "").toLowerCase();

    // 프록시/중계 도메인은 여전히 차단
    const badHosts = [
      "vertexaisearch.cloud.google.com",
      "vertexaisearch.googleapis.com",
      "cloud.google.com",
    ];
    if (badHosts.some(b => host === b || host.endsWith("." + b))) return false;

    // 검색 페이지는 제외
    const badIncludes = [
      "google.com/search",
      "news.google.com/search",
      "search.naver.com",
      "m.search.naver.com",
      "media.naver.com/press",
    ];
    if (badIncludes.some(b => url.includes(b))) return false;

    // 완화 조건: path가 루트('/')만 아니면 일단 통과
    const path = u.pathname || "";
    if (!path || path === "/") return false;

    return true;
  } catch {
    return false;
  }
};

async function serperPost(endpoint: "news" | "search", apiKey: string, body: any) {
  const resp = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return null;
  return resp.json();
}

// ✅ Serper.dev News 검색 (실제 기사 URL 3개 이상 “최대한” 보장)
export async function fetchNewsSourcesSerper(
  query: string,
  minCount = 3
): Promise<NewsSourceItem[]> {
  // ✅ (중요) Vite 환경변수는 import.meta.env 로 읽는 게 정석
  const apiKey = import.meta.env.VITE_SERPER_API_KEY;

  if (!apiKey) {
    return [];
  }

  const need = Math.max(minCount, 3);

  // 1) /news (더 많이)
  const newsData = await serperPost("news", apiKey, {
    q: query,
    gl: "kr",
    hl: "ko",
    num: 20,
  });

  const fromNews: NewsSourceItem[] = (newsData?.news || []).map((n: any) => ({
    title: n?.title || "제목 없음",
    url: n?.link || "",
    source: n?.source || "",
    date: n?.date || "",
  }));

  // 2) /search로 보충 (더 많이)
  const searchData = await serperPost("search", apiKey, {
    q: query,
    gl: "kr",
    hl: "ko",
    num: 20,
  });

  const fromSearch: NewsSourceItem[] = (searchData?.organic || []).map((o: any) => ({
    title: o?.title || "제목 없음",
    url: o?.link || "",
    source: o?.source || "",
    date: "",
  }));

  // 3) 합치고 1차(엄격) 필터
  const combined = uniqByUrl([...fromNews, ...fromSearch]);
  const strict = combined.filter(it => isLikelyArticleUrlStrict(it.url));

  if (strict.length >= need) {
    return strict.slice(0, 10);
  }

  // 4) 부족하면 2차(완화) 필터로 “기사일 가능성” 있는 것까지 살려 최소 개수 채움
  const soft = combined.filter(it => isLikelyArticleUrlSoft(it.url));
  const merged = uniqByUrl([...strict, ...soft]);

  if (merged.length >= need) {
    return merged.slice(0, 10);
  }

  // 5) 최후 보루: 그래도 부족하면 “더보기 링크”로 최소 3개는 채움
  const lastResort: NewsSourceItem[] = [
    {
      title: `구글뉴스에서 "${query}" 기사 더 보기`,
      url: `https://news.google.com/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`,
      source: "Google News",
    },
    {
      title: `네이버 뉴스에서 "${query}" 기사 더 보기`,
      url: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(query)}`,
      source: "Naver News",
    },
    {
      title: `다음 뉴스에서 "${query}" 기사 더 보기`,
      url: `https://search.daum.net/search?w=news&q=${encodeURIComponent(query)}`,
      source: "Daum News",
    },
  ];

  return uniqByUrl([...merged, ...lastResort]).slice(0, need);
}