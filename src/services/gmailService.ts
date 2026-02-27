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
  body: string;
  link: string;
  source: string;
  score?: number;
  publishedAt?: string;
}

/** -----------------------------
 *  Blocklist (요청사항)
 *  ✅ 유튜브/틱톡/소셜 도메인 차단
 * ------------------------------ */
const BLOCKED_DOMAINS = [
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "reddit.com",
  "discord.com",
  "discord.gg",
  "t.me",
];

const BLOCKED_URL_KEYWORDS = [
  "google.com/alerts",
  "unsubscribe",
  "preferences",
  "accounts.google",
  "support.google",
  "policies.google",
  "myaccount.google",
  "mail.google.com",
];

function isBlockedDomain(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function isBlockedByKeyword(url: string) {
  const lower = (url || "").toLowerCase();
  return BLOCKED_URL_KEYWORDS.some((k) => lower.includes(k));
}

/** -----------------------------
 *  Settings (front-only)
 * ------------------------------ */
const DEFAULT_CONFIG = {
  preferredLabelName: "뉴스요약",
  fallbackQuery:
    'newer_than:14d (from:googlealerts-noreply@google.com OR from:googlealerts-noreply OR subject:"Google 알림" OR subject:"Google Alerts")',
  maxMessagesToRead: 8,
  maxItemsToReturn: 30,
  seenTtlDays: 7,
  minTitleLength: 12,
  snippetMaxLen: 320,
};

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
    const excludeSeen = opts?.excludeSeen !== false;
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
        const messageIds = await listMessageIds(
          gapi,
          labelName,
          queryOverride,
          maxMessagesToRead
        );

        if (messageIds.length === 0) {
          throw new Error("조건에 맞는 메일이 없습니다. (라벨/검색 조건을 확인해주세요)");
        }

        const detailsList = await Promise.all(
          messageIds.map((id) =>
            gapi.client.gmail.users.messages.get({
              userId: "me",
              id,
              format: "full",
            })
          )
        );

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

        // ✅ 링크 정제 + 중복 제거 강화(요청사항)
        const normalized = items
          .map((it) => normalizeItem(it))
          .filter((it) => !!it.link)
          .filter((it) => !isBlockedDomain(it.link))
          .filter((it) => !isBlockedByKeyword(it.link));

        const deduped = dedupeByNormalizedUrl(normalized);

        const filteredSeen = excludeSeen ? filterSeen(deduped, config.seenTtlDays) : deduped;

        const scored = filteredSeen
          .map((it) => ({ ...it, score: scoreItem(it, keywordHintFromContext(labelName)) }))
          .sort((a, b) => (b.score || 0) - (a.score || 0));

        const result = scored.slice(0, maxItemsToReturn);

        if (excludeSeen) markSeen(result, config.seenTtlDays);

        resolve(result);
      } catch (err: any) {
        reject(new Error(err?.message || "오류가 발생했습니다."));
      }
    };

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
  const labelId = await findLabelId(gapi, labelName);

  if (labelId) {
    const res = await gapi.client.gmail.users.messages.list({
      userId: "me",
      labelIds: [labelId],
      maxResults: maxMessagesToRead,
    });
    const messages = res?.result?.messages || [];
    return messages.map((m: any) => m.id).filter(Boolean);
  }

  const res = await gapi.client.gmail.users.messages.list({
    userId: "me",
    q: fallbackQuery,
    maxResults: maxMessagesToRead,
  });
  const messages = res?.result?.messages || [];
  return messages.map((m: any) => m.id).filter(Boolean);
}

/**
 * ✅ “뉴스요약” 라벨 탐색을 더 안전하게 (요청사항)
 * - 1) 공백/대소문자 무시한 정확 일치
 * - 2) startsWith
 * - 3) contains (최후, 오탐 가능성 있으니 마지막에만)
 */
async function findLabelId(gapi: any, labelName: string): Promise<string | null> {
  try {
    const labelsRes = await gapi.client.gmail.users.labels.list({ userId: "me" });
    const labels = labelsRes?.result?.labels || [];

    const norm = (s: string) => (s || "").replace(/\s+/g, "").toLowerCase();
    const target = norm(labelName);

    const exact = labels.find((l: any) => norm(l?.name) === target);
    if (exact?.id) return exact.id;

    const starts = labels.find((l: any) => norm(l?.name).startsWith(target));
    if (starts?.id) return starts.id;

    const contains = labels.find((l: any) => norm(l?.name).includes(target));
    if (contains?.id) return contains.id;

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
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    try {
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

  if (decodedHtml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(decodedHtml, "text/html");
      const links = Array.from(doc.querySelectorAll("a"));

      for (const a of links) {
        const rawHref = (a as HTMLAnchorElement).href || "";
        let url = unwrapGoogleRedirect(rawHref);
        url = url.trim();

        // ✅ 소셜/동영상 도메인 즉시 차단
        if (!url || isBlockedDomain(url) || isBlockedByKeyword(url)) continue;

        const rawTitle =
          cleanInlineText(
            (a.textContent || "") +
              " " +
              ((a as any).getAttribute?.("aria-label") || "") +
              " " +
              ((a as any).getAttribute?.("title") || "")
          ) || "";

        const snippet = extractSnippetAroundAnchor(a, snippetMaxLen);

        // ✅ 링크 필터: 기사형 URL인지 + 차단 대상인지
        if (!isLikelyArticleUrl(url)) continue;

        // ✅ 제목 너무 짧거나 버튼류 제거 (요청사항)
        const titleCandidate = bestTitle(rawTitle, snippet, subject);
        if (titleCandidate.length < minTitleLength) continue;
        if (looksLikeButtonText(titleCandidate)) continue;

        // 시스템 링크 제외
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

  if (!found && decodedText) {
    const urls = extractUrlsFromText(decodedText)
      .map(unwrapGoogleRedirect)
      .map((u) => u.trim())
      .filter(Boolean)
      .filter((u) => !isBlockedDomain(u))
      .filter((u) => !isBlockedByKeyword(u))
      .filter(isLikelyArticleUrl)
      .filter((u) => !isNonArticleSystemLink(u));

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

  if (!found && decodedText.length > 10) {
    out.push({
      title: cleanInlineText(subject) || "제목 없음",
      link: "",
      source: "Gmail 원문",
      body: decodedText.substring(0, snippetMaxLen),
    });
  }

  return out;
}

function extractSnippetAroundAnchor(anchor: Element, maxLen: number) {
  const parent = anchor.parentElement;
  const grand = parent?.parentElement;

  const candidates = [
    cleanInlineText(anchor.textContent || ""),
    parent ? cleanInlineText(parent.textContent || "") : "",
    grand ? cleanInlineText(grand.textContent || "") : "",
  ].filter(Boolean);

  const best = candidates.sort((a, b) => b.length - a.length)[0] || "";
  return best.length > maxLen ? best.slice(0, maxLen) : best;
}

function buildBodyForAI(snippet: string, decodedText: string, maxLen: number) {
  const s = cleanInlineText(snippet || "");
  if (s && s.length >= 40) return s.slice(0, maxLen);

  const t = cleanInlineText(decodedText || "");
  return t.slice(0, maxLen);
}

function bestTitle(rawTitle: string, snippet: string, subject: string) {
  const t = cleanInlineText(rawTitle);
  if (t && !looksLikeButtonText(t)) return t;

  const s = cleanInlineText(snippet);
  if (s && s.length >= 12) return s.length > 80 ? s.slice(0, 80) : s;

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
    "구독",
    "수신거부",
    "unsubscribe",
  ];
  return bad.includes(s);
}

function cleanInlineText(text: string) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

/** -----------------------------
 *  URL normalization / filtering
 * ------------------------------ */
function unwrapGoogleRedirect(url: string) {
  if (!url) return "";

  if (url.includes("google.com/url?q=")) {
    try {
      return decodeURIComponent(url.split("url?q=")[1].split("&")[0]);
    } catch {
      return url;
    }
  }

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

/**
 * ✅ 기사 URL 판정 + 차단 도메인 반영 (요청사항)
 */
function isLikelyArticleUrl(url: string) {
  if (!url) return false;
  if (isBlockedDomain(url)) return false;
  if (isBlockedByKeyword(url)) return false;

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
    if (!u.pathname || u.pathname === "/" || u.pathname.length < 2) return false;
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
  // ✅ google redirect 복원 -> utm 제거 -> www 제거 -> hash 제거 (요청사항)
  const unwrapped = unwrapGoogleRedirect(item.link);
  const normalizedLink = normalizeNewsUrl(unwrapped);

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

function dedupeByNormalizedUrl(items: GmailNewsItem[]) {
  const map = new Map<string, GmailNewsItem>();

  for (const it of items) {
    const key = (it.link || "").trim();
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, it);
      continue;
    }

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
 *  Seen storage
 * ------------------------------ */
type SeenMap = Record<string, number>;

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
  } catch {}
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
 *  Scoring
 * ------------------------------ */
function keywordHintFromContext(labelName: string) {
  return (labelName || "").trim();
}

function scoreItem(item: GmailNewsItem, keywordHint: string) {
  let score = 0;

  const titleLen = (item.title || "").length;
  score += clamp(titleLen, 0, 120) * 0.4;

  const bodyLen = (item.body || "").length;
  score += clamp(bodyLen, 0, 300) * 0.2;

  const host = (item.source || "").toLowerCase();
  score += domainTrustScore(host);

  const hint = (keywordHint || "").toLowerCase();
  if (hint && (item.title || "").toLowerCase().includes(hint)) score += 8;

  score += urlShapeScore(item.link);

  return score;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function domainTrustScore(host: string) {
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
  const medium = ["naver.com", "daum.net", "medium.com", "substack.com", "brunch.co.kr"];

  if (strong.some((d) => host.endsWith(d))) return 18;
  if (medium.some((d) => host.endsWith(d))) return 8;
  return 0;
}

function urlShapeScore(url: string) {
  try {
    const u = new URL(url);
    const p = u.pathname || "";
    let s = 0;
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

export function saveGmailNewsConfig(partial: Partial<typeof DEFAULT_CONFIG>) {
  const curr = loadConfig();
  const next = { ...curr, ...partial };
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}