// src/services/gmailService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Front-only Gmail News Collector (Enterprise Upgrade)
 * - Label exact-match + fallback (Google Alerts sender search)
 * - Robust HTML parsing: extract real article links + 주변 문맥(snippet) 추출
 * - URL 정규화(utm 제거 등) + 중복 제거 + 제목 품질 필터 강화
 * - 중요도/신뢰도 스코어링 후 정렬, Top N 반환
 * - 최근 본(생성/클릭) 링크는 localStorage 기반으로 자동 제외
 *
 * NOTE: Front-only 환경 특성상 "기사 원문 크롤링"은 CORS 이슈로 제외.
 */

const CLIENT_ID =
  "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const DISCOVERY_DOC =
  "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";

export interface GmailNewsItem {
  title: string;
  body: string; // 기사별 snippet(가능하면) + fallback 메일 텍스트 일부
  link: string;
  source: string;
  // [추가] 내부 정렬/디버깅용(필요하면 UI에서도 활용 가능)
  score?: number;
  publishedAt?: string; // 메일/본문에서 추정한 날짜(선택)
}

/** -----------------------------
 *  Settings (front-only)
 *  - 필요하면 UI에서 주입 가능하게 확장하세요.
 * ------------------------------ */
const DEFAULT_CONFIG = {
  // 라벨 이름(정확히 일치 권장). 공백 무시 비교는 하되, contains는 지양.
  preferredLabelName: "뉴스요약",

  // Gmail 검색 쿼리: 라벨 못 찾거나 라벨 미사용 시 fallback에 사용
  // Google Alerts 발신자(환경에 따라 다를 수 있어 OR로 넓게)
  fallbackQuery:
    'newer_than:14d (from:googlealerts-noreply@google.com OR from:googlealerts-noreply OR subject:"Google 알림" OR subject:"Google Alerts")',

  // 라벨 사용 시에도 최근 N일만 보고 싶으면 newer_than를 활용할 수 있음(라벨 list에는 q가 없음)
  // -> 여기서는 메시지 get 시점을 고려해 localStorage 기반 "최근 본 제외"로 해결.
  maxMessagesToRead: 8, // 메시지 상세를 가져올 최대 개수(프론트 성능 고려)
  maxItemsToReturn: 30, // 최종 기사 결과 최대 개수

  // 최근 본 링크를 며칠 동안 제외할지(중복 반복 방지)
  seenTtlDays: 7,

  // 제목 최소 길이 (너무 짧은 "Read more" 방지)
  minTitleLength: 12,

  // snippet 최대 길이
  snippetMaxLen: 320,
};

// 원하시면 UI에서 설정 저장 시 이 키를 쓰세요.
const CONFIG_STORAGE_KEY = "dongA_gmail_news_config_v1";
const SEEN_STORAGE_KEY = "dongA_seen_article_urls_v1";

let tokenClient: any;

/** -----------------------------
 *  Auth Init
 * ------------------------------ */
export const initGoogleAuth = () => {
  return new Promise<boolean>((resolve) => {
    const loadGapi = new Promise((res) => {
      if ((window as any).gapi) return res(true);
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.onload = () => res(true);
      document.body.appendChild(script);
    });

    const loadGis = new Promise((res) => {
      if ((window as any).google?.accounts?.oauth2) return res(true);
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.onload = () => res(true);
      document.body.appendChild(script);
    });

    Promise.all([loadGapi, loadGis]).then(() => {
      const gapi = (window as any).gapi;
      const google = (window as any).google;

      gapi.load("client", async () => {
        try {
          await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: "",
          });
          resolve(true);
        } catch (err) {
          console.error("Google API Init Error:", err);
          resolve(false);
        }
      });
    });
  });
};

/** -----------------------------
 *  Public API
 * ------------------------------ */

/**
 * 옵션:
 * - labelName: 라벨명을 바꿔서 사용하고 싶을 때
 * - queryOverride: fallback 검색쿼리를 바꿔서 사용하고 싶을 때
 * - excludeSeen: 최근 본 링크 제외 여부
 */
export const getNewsEmails = (opts?: {
  labelName?: string;
  queryOverride?: string;
  excludeSeen?: boolean;
  maxMessagesToRead?: number;
  maxItemsToReturn?: number;
}): Promise<GmailNewsItem[]> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient)
      return reject(new Error("구글 인증 시스템이 아직 준비되지 않았습니다."));

    const gapi = (window as any).gapi;
    const config = loadConfig();

    const labelName = (opts?.labelName ?? config.preferredLabelName).trim();
    const queryOverride = (opts?.queryOverride ?? config.fallbackQuery).trim();
    const excludeSeen = opts?.excludeSeen !== false; // 기본 true
    const maxMessagesToRead = Math.max(
      1,
      Math.min(opts?.maxMessagesToRead ?? config.maxMessagesToRead, 30)
    );
    const maxItemsToReturn = Math.max(
      1,
      Math.min(opts?.maxItemsToReturn ?? config.maxItemsToReturn, 100)
    );

    tokenClient.callback = async (resp: any) => {
      if (resp?.error !== undefined) {
        return reject(new Error("구글 로그인이 취소되었거나 실패했습니다."));
      }

      try {
        // 1) 메시지 목록 가져오기: 라벨 우선, 실패 시 fallback 쿼리로 검색
        const messageIds = await listMessageIds(gapi, labelName, queryOverride, maxMessagesToRead);

        if (messageIds.length === 0) {
          throw new Error("조건에 맞는 메일이 없습니다. (라벨/검색 조건을 확인해주세요)");
        }

        // 2) 메시지 상세 병렬 로드
        const detailsList = await Promise.all(
          messageIds.map((id) =>
            gapi.client.gmail.users.messages.get({
              userId: "me",
              id,
              format: "full",
            })
          )
        );

        // 3) 각 메일에서 기사 링크 추출(+snippet), URL 정규화/중복 제거/스코어링
        const items: GmailNewsItem[] = [];

        for (const details of detailsList) {
          const payload = details?.result?.payload;
          if (!payload) continue;

          const { decodedHtml, decodedText, subject } = extractEmailBodies(payload);

          const extracted = extractArticlesFromEmail({
            decodedHtml,
            decodedText,
            subject,
            minTitleLength: config.minTitleLength,
            snippetMaxLen: config.snippetMaxLen,
          });

          items.push(...extracted);
        }

        // 4) URL 정규화 + 중복 제거 + 최근 본 제외
        const normalized = items
          .map((it) => normalizeItem(it))
          .filter((it) => !!it.link);

        const deduped = dedupeByNormalizedUrl(normalized);

        const filteredSeen = excludeSeen ? filterSeen(deduped, config.seenTtlDays) : deduped;

        // 5) 스코어링 + 정렬
        const scored = filteredSeen
          .map((it) => ({ ...it, score: scoreItem(it, keywordHintFromContext(labelName)) }))
          .sort((a, b) => (b.score || 0) - (a.score || 0));

        // 6) 최종 반환(상위 N)
        const result = scored.slice(0, maxItemsToReturn);

        // 7) “이번에 뽑힌” 링크는 seen에 기록(다음 실행 때 중복 방지)
        //    원치 않으면 excludeSeen 옵션으로 끄세요.
        if (excludeSeen) markSeen(result, config.seenTtlDays);

        resolve(result);
      } catch (err: any) {
        reject(new Error(err?.message || "오류가 발생했습니다."));
      }
    };

    // 토큰 요청
    if (gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: "consent" });
    } else {
      tokenClient.requestAccessToken({ prompt: "" });
    }
  });
};

/** -----------------------------
 *  Gmail message listing
 * ------------------------------ */

async function listMessageIds(
  gapi: any,
  labelName: string,
  fallbackQuery: string,
  maxMessagesToRead: number
): Promise<string[]> {
  // 1) 라벨 찾기(정확히 일치에 가깝게)
  const labelId = await findLabelId(gapi, labelName);

  // 2) 라벨이 있으면 라벨로 list
  if (labelId) {
    const res = await gapi.client.gmail.users.messages.list({
      userId: "me",
      labelIds: [labelId],
      maxResults: maxMessagesToRead,
    });
    const messages = res?.result?.messages || [];
    return messages.map((m: any) => m.id).filter(Boolean);
  }

  // 3) 라벨이 없으면 fallback query로 list
  const res = await gapi.client.gmail.users.messages.list({
    userId: "me",
    q: fallbackQuery,
    maxResults: maxMessagesToRead,
  });
  const messages = res?.result?.messages || [];
  return messages.map((m: any) => m.id).filter(Boolean);
}

async function findLabelId(gapi: any, labelName: string): Promise<string | null> {
  try {
    const labelsRes = await gapi.client.gmail.users.labels.list({ userId: "me" });
    const labels = labelsRes?.result?.labels || [];

    const norm = (s: string) => (s || "").replace(/\s+/g, "").toLowerCase();
    const target = norm(labelName);

    // 1) 공백 무시 + 대소문자 무시 "정확히 일치"
    const exact = labels.find((l: any) => norm(l?.name) === target);
    if (exact?.id) return exact.id;

    // 2) fallback: 시작 일치 (contains는 오탐 많아서 지양)
    const starts = labels.find((l: any) => norm(l?.name).startsWith(target));
    if (starts?.id) return starts.id;

    return null;
  } catch (e) {
    console.error("Label list error:", e);
    return null;
  }
}

/** -----------------------------
 *  Email decoding + extraction
 * ------------------------------ */

function extractEmailBodies(payload: any): {
  decodedHtml: string;
  decodedText: string;
  subject: string;
} {
  let htmlBody = "";
  let textBody = "";

  const walkParts = (parts: any[]) => {
    parts.forEach((p) => {
      if (p?.mimeType === "text/html" && p?.body?.data) htmlBody = p.body.data;
      if (p?.mimeType === "text/plain" && p?.body?.data) textBody = p.body.data;
      if (p?.parts) walkParts(p.parts);
    });
  };

  if (payload?.parts) walkParts(payload.parts);
  else {
    if (payload?.mimeType === "text/html") htmlBody = payload?.body?.data || "";
    else textBody = payload?.body?.data || "";
  }

  const headers = payload?.headers || [];
  const subject = headers.find((h: any) => h?.name === "Subject")?.value || "제목 없음";

  const decodedHtml = decodeBase64Url(htmlBody);
  const decodedText = decodeBase64Url(textBody);

  return { decodedHtml, decodedText, subject };
}

function decodeBase64Url(data: string) {
  if (!data) return "";
  try {
    let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    // UTF-8 decode
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    try {
      // fallback
      return atob(data);
    } catch {
      return "";
    }
  }
}

function extractArticlesFromEmail(args: {
  decodedHtml: string;
  decodedText: string;
  subject: string;
  minTitleLength: number;
  snippetMaxLen: number;
}): GmailNewsItem[] {
  const { decodedHtml, decodedText, subject, minTitleLength, snippetMaxLen } = args;

  const out: GmailNewsItem[] = [];
  let found = false;

  // 1) HTML 우선: DOM 파싱 후 anchor를 기사 후보로 수집
  if (decodedHtml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(decodedHtml, "text/html");
      const links = Array.from(doc.querySelectorAll("a"));

      for (const a of links) {
        const rawHref = (a as HTMLAnchorElement).href || "";
        let url = unwrapGoogleRedirect(rawHref);
        url = url.trim();

        // 앵커 텍스트가 비어있을 수 있어, aria-label/title도 보조로 사용
        const rawTitle =
          cleanInlineText(
            (a.textContent || "") +
              " " +
              ((a as any).getAttribute?.("aria-label") || "") +
              " " +
              ((a as any).getAttribute?.("title") || "")
          ) || "";

        // 링크 주변 텍스트(snippet)
        const snippet = extractSnippetAroundAnchor(a, snippetMaxLen);

        // 링크 필터
        if (!isLikelyArticleUrl(url)) continue;

        // 제목 필터 (너무 짧은 버튼류 제거)
        const titleCandidate = bestTitle(rawTitle, snippet, subject);
        if (titleCandidate.length < minTitleLength) continue;

        // 구글알림/구독해지/설정 등 제외
        if (isNonArticleSystemLink(url)) continue;

        const source = safeHostname(url) || "웹 뉴스";
        out.push({
          title: titleCandidate,
          link: url,
          source,
          body: buildBodyForAI(snippet, decodedText, snippetMaxLen),
        });
        found = true;
      }
    } catch (e) {
      console.error("HTML parse failed:", e);
    }
  }

  // 2) fallback: 텍스트에서 URL 패턴 추출 (HTML 파싱 실패/없는 경우)
  if (!found && decodedText) {
    const urls = extractUrlsFromText(decodedText)
      .map(unwrapGoogleRedirect)
      .map((u) => u.trim())
      .filter(Boolean)
      .filter(isLikelyArticleUrl)
      .filter((u) => !isNonArticleSystemLink(u));

    // 텍스트에서는 제목 추정이 어렵기 때문에 subject 기반 + 도메인 보조
    for (const u of urls.slice(0, 10)) {
      out.push({
        title: cleanInlineText(subject) || "제목 없음",
        link: u,
        source: safeHostname(u) || "웹 뉴스",
        body: decodedText.substring(0, snippetMaxLen),
      });
    }
    found = out.length > 0;
  }

  // 3) 최후: 그래도 없으면 메일 원문 링크만
  if (!found && decodedText.length > 10) {
    out.push({
      title: cleanInlineText(subject) || "제목 없음",
      link: "", // 링크가 없으면 normalize에서 떨어질 수 있음
      source: "Gmail 원문",
      body: decodedText.substring(0, snippetMaxLen),
    });
  }

  return out;
}

function extractSnippetAroundAnchor(anchor: Element, maxLen: number) {
  // anchor의 부모/조부모 텍스트를 가져오되 너무 길면 잘라냄
  const parent = anchor.parentElement;
  const grand = parent?.parentElement;

  const candidates = [
    cleanInlineText(anchor.textContent || ""),
    parent ? cleanInlineText(parent.textContent || "") : "",
    grand ? cleanInlineText(grand.textContent || "") : "",
  ].filter(Boolean);

  // 가장 정보량 있는(길고) 텍스트 선택
  const best = candidates.sort((a, b) => b.length - a.length)[0] || "";
  return best.length > maxLen ? best.slice(0, maxLen) : best;
}

function buildBodyForAI(snippet: string, decodedText: string, maxLen: number) {
  // snippet이 있으면 snippet 우선, 없으면 텍스트 앞부분
  const s = cleanInlineText(snippet || "");
  if (s && s.length >= 40) return s.slice(0, maxLen);

  const t = cleanInlineText(decodedText || "");
  return t.slice(0, maxLen);
}

function bestTitle(rawTitle: string, snippet: string, subject: string) {
  const t = cleanInlineText(rawTitle);
  if (t && !looksLikeButtonText(t)) return t;

  // snippet에서 첫 문장/앞부분을 제목 후보로
  const s = cleanInlineText(snippet);
  if (s && s.length >= 12) {
    // 너무 길면 앞부분만
    return s.length > 80 ? s.slice(0, 80) : s;
  }

  return cleanInlineText(subject) || "제목 없음";
}

function looksLikeButtonText(t: string) {
  const s = (t || "").trim().toLowerCase();
  const bad = [
    "read more",
    "learn more",
    "more",
    "보기",
    "자세히",
    "더보기",
    "확인",
    "open",
    "click",
    "go",
    "view",
    "continue",
    "신청",
  ];
  return bad.includes(s);
}

function cleanInlineText(text: string) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width 제거
    .trim();
}

/** -----------------------------
 *  URL normalization / filtering
 * ------------------------------ */

function unwrapGoogleRedirect(url: string) {
  if (!url) return "";

  // google.com/url?q=...
  if (url.includes("google.com/url?q=")) {
    try {
      return decodeURIComponent(url.split("url?q=")[1].split("&")[0]);
    } catch {
      return url;
    }
  }

  // google.com/url?url=...
  if (url.includes("google.com/url?")) {
    try {
      const u = new URL(url);
      const p = u.searchParams.get("url") || u.searchParams.get("q");
      if (p) return decodeURIComponent(p);
    } catch {
      return url;
    }
  }

  return url;
}

function isNonArticleSystemLink(url: string) {
  const u = url.toLowerCase();
  const bad = [
    "google.com/alerts",
    "unsubscribe",
    "preferences",
    "accounts.google",
    "support.google",
    "policies.google",
    "myaccount.google",
    "mail.google.com",
  ];
  return bad.some((b) => u.includes(b));
}

function isLikelyArticleUrl(url: string) {
  if (!url) return false;

  // 검색/프록시/홈 등 제외
  const bad = [
    "google.com/search",
    "news.google.com/search",
    "search.naver.com",
    "m.search.naver.com",
    "media.naver.com/press",
    "vertexaisearch.cloud.google.com",
  ];
  if (bad.some((b) => url.includes(b))) return false;

  try {
    const u = new URL(url);
    if (!u.hostname.includes(".")) return false;

    // 루트(/)만 있는 링크는 기사일 확률 낮음
    if (!u.pathname || u.pathname === "/" || u.pathname.length < 2) return false;

    // mailto, tel 등 제외
    if (!/^https?:$/i.test(u.protocol)) return false;

    return true;
  } catch {
    return false;
  }
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeItem(item: GmailNewsItem): GmailNewsItem {
  const normalizedLink = normalizeNewsUrl(item.link);
  const source = safeHostname(normalizedLink) || item.source || "웹 뉴스";

  return {
    ...item,
    link: normalizedLink,
    source,
    title: cleanInlineText(item.title || ""),
    body: cleanInlineText(item.body || ""),
  };
}

function normalizeNewsUrl(url: string) {
  if (!url) return "";
  try {
    const u = new URL(url);

    // tracking params 제거
    const dropPrefixes = ["utm_", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid"];
    [...u.searchParams.keys()].forEach((k) => {
      const lk = k.toLowerCase();
      if (dropPrefixes.some((p) => lk.startsWith(p)) || dropPrefixes.includes(lk)) {
        u.searchParams.delete(k);
      }
    });

    // hash 제거(추적/앵커 방지)
    u.hash = "";

    // www 정규화(선호에 따라 바꿀 수 있음)
    // 여기서는 www를 제거해 중복 감소
    u.hostname = u.hostname.replace(/^www\./, "");

    // trailing slash 정리
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}

function dedupeByNormalizedUrl(items: GmailNewsItem[]) {
  const map = new Map<string, GmailNewsItem>();

  for (const it of items) {
    const key = (it.link || "").trim();
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, it);
      continue;
    }

    // 같은 URL이면 "더 좋은" 제목/본문을 가진 것을 선택
    const prev = map.get(key)!;
    const better = pickBetterItem(prev, it);
    map.set(key, better);
  }

  return [...map.values()];
}

function pickBetterItem(a: GmailNewsItem, b: GmailNewsItem) {
  const aTitle = (a.title || "").length;
  const bTitle = (b.title || "").length;
  const aBody = (a.body || "").length;
  const bBody = (b.body || "").length;

  // 제목이 더 길고(정보량) 본문도 길면 우선
  const aScore = aTitle * 2 + aBody;
  const bScore = bTitle * 2 + bBody;

  return bScore > aScore ? b : a;
}

function extractUrlsFromText(text: string) {
  const re = /(https?:\/\/[^\s<>"'()]+)|(www\.[^\s<>"'()]+)/g;
  const out: string[] = [];
  const matches = text.match(re) || [];
  for (const m of matches) {
    if (m.startsWith("www.")) out.push("https://" + m);
    else out.push(m);
  }
  return out;
}

/** -----------------------------
 *  Seen storage (repeat removal)
 * ------------------------------ */

type SeenMap = Record<string, number>; // url -> expireAt(ms)

function nowMs() {
  return Date.now();
}

function daysToMs(days: number) {
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function loadSeen(): SeenMap {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    // cleanup expired
    const t = nowMs();
    for (const k of Object.keys(parsed)) {
      if (!parsed[k] || parsed[k] < t) delete parsed[k];
    }
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return {};
  }
}

function saveSeen(map: SeenMap) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function filterSeen(items: GmailNewsItem[], ttlDays: number) {
  const seen = loadSeen();
  const t = nowMs();
  return items.filter((it) => {
    const key = (it.link || "").trim();
    if (!key) return false;
    const exp = seen[key];
    return !(exp && exp > t);
  });
}

function markSeen(items: GmailNewsItem[], ttlDays: number) {
  const seen = loadSeen();
  const exp = nowMs() + daysToMs(ttlDays);
  for (const it of items) {
    const key = (it.link || "").trim();
    if (!key) continue;
    seen[key] = exp;
  }
  saveSeen(seen);
}

/** -----------------------------
 *  Scoring (enterprise ranking)
 * ------------------------------ */

function keywordHintFromContext(labelName: string) {
  // 라벨/환경에 따라 힌트. 필요하면 UI에서 키워드 넣어 확장 가능.
  return (labelName || "").trim();
}

function scoreItem(item: GmailNewsItem, keywordHint: string) {
  let score = 0;

  // 1) 제목 품질
  const titleLen = (item.title || "").length;
  score += clamp(titleLen, 0, 120) * 0.4;

  // 2) 본문/snippet 정보량
  const bodyLen = (item.body || "").length;
  score += clamp(bodyLen, 0, 300) * 0.2;

  // 3) 도메인 신뢰도(가벼운 휴리스틱; 필요하면 실제 화이트리스트로 교체)
  const host = (item.source || "").toLowerCase();
  score += domainTrustScore(host);

  // 4) 키워드 힌트 포함(라벨명/키워드 등)
  const hint = (keywordHint || "").toLowerCase();
  if (hint && (item.title || "").toLowerCase().includes(hint)) score += 8;

  // 5) URL 형태(기사형 path 선호)
  score += urlShapeScore(item.link);

  return score;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function domainTrustScore(host: string) {
  // “프론트만”에서 쓸 수 있는 현실적 방식: 대형/공식 도메인 약간 가산
  // 조직에서 필요하면 여기 리스트를 “내부 whitelist”로 바꾸면 기업용으로 훨씬 좋아집니다.
  const strong = [
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "economist.com",
    "nytimes.com",
    "bbc.co.uk",
    "bbc.com",
    "cnn.com",
    "apnews.com",
    "khan.co.kr",
    "chosun.com",
    "joongang.co.kr",
    "donga.com",
    "hani.co.kr",
    "mk.co.kr",
    "hankyung.com",
    "yonhapnews.co.kr",
  ];
  const medium = [
    "naver.com",
    "daum.net",
    "medium.com",
    "substack.com",
    "brunch.co.kr",
  ];

  if (strong.some((d) => host.endsWith(d))) return 18;
  if (medium.some((d) => host.endsWith(d))) return 8;
  return 0;
}

function urlShapeScore(url: string) {
  try {
    const u = new URL(url);
    const p = u.pathname || "";
    let s = 0;

    // 기사형 path 특징: /news/ /article/ /2026/ 등
    if (/(news|article|story|stories|press|post)/i.test(p)) s += 6;
    if (/(20\d{2})/i.test(p)) s += 4;
    if (p.split("/").filter(Boolean).length >= 3) s += 3;
    return s;
  } catch {
    return 0;
  }
}

/** -----------------------------
 *  Config storage
 * ------------------------------ */

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_CONFIG>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * 필요 시 UI에서 호출해 설정 저장하세요.
 * (요청하시면 설정 UI까지 같이 붙여드릴게요)
 */
export function saveGmailNewsConfig(partial: Partial<typeof DEFAULT_CONFIG>) {
  const curr = loadConfig();
  const next = { ...curr, ...partial };
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}