// src/services/gmailService.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Front-only Gmail News Collector (Enterprise Upgrade++)
 * - Label exact-match + fallback (Google Alerts sender search)
 * - Robust HTML parsing: extract real article links + 주변 문맥(snippet) 추출
 * - URL 정규화(utm 제거 등) + 중복 제거 + 제목 품질 필터 강화
 * - 중요도/신뢰도 스코어링 + (NEW) 최근성(recency) 가중 정렬, hybrid 정렬 지원
 * - 최근 본(생성/클릭) 링크는 localStorage 기반으로 자동 제외
 * - (NEW) publishedAt 추정(메일 Date 헤더 + 본문 날짜 패턴) + ISO 통일
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

  /**
   * publishedAt:
   * - 원칙: Gmail 메일 Date 헤더(=수신 시점) 기반
   * - 보조: 본문/스니펫 내 날짜 패턴이 있으면 추정
   * - ISO string (e.g. 2026-02-27T10:11:12.000Z)
   */
  publishedAt?: string;
  gmailReceivedAt?: string;
  articlePublishedAt?: string;

  /** 내부 계산용 (ms) */
  _ts?: number;
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
  "accounts.youtube.com",
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
  maxMessagesToRead: 25,
  maxItemsToReturn: 30,
  seenTtlDays: 7,
  minTitleLength: 12,
  snippetMaxLen: 320,

  /** NEW: hybrid 정렬 시 recency 가중 */
  recencyWeight: 0.55, // 0~1 (최근성 비중)
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
  sortBy?: "hybrid" | "score" | "recent";
  daysBack?: number;
  keywordHint?: string;
  targetDate?: string;
  targetDates?: string[];
  balanceMode?: "off" | "ideology-mix";
}): Promise<GmailNewsItem[]> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient)
      return reject(new Error("구글 인증 시스템이 아직 준비되지 않았습니다."));

    const gapi = (window as any).gapi;
    const config = loadConfig();

    const labelName = (opts?.labelName ?? config.preferredLabelName).trim();
    const excludeSeen = opts?.excludeSeen !== false;

    const maxMessagesToRead = Math.max(
      1,
      Math.min(opts?.maxMessagesToRead ?? config.maxMessagesToRead, 30)
    );
    const maxItemsToReturn = Math.max(
      1,
      Math.min(opts?.maxItemsToReturn ?? config.maxItemsToReturn, 100)
    );

    const daysBack = Math.max(1, Math.min(opts?.daysBack ?? 14, 60));

    // fallbackQuery는 override가 없으면 daysBack 기반으로 생성
    const fallbackQuery = (
      opts?.queryOverride ??
      `newer_than:${daysBack}d (from:googlealerts-noreply@google.com OR from:googlealerts-noreply OR subject:"Google 알림" OR subject:"Google Alerts")`
    ).trim();

    const sortBy = opts?.sortBy ?? "hybrid";
    const keywordHint = (opts?.keywordHint ?? keywordHintFromContext(labelName)).trim();
    const requestedDates = normalizeTargetDates(opts?.targetDate, opts?.targetDates);
    const balanceMode = opts?.balanceMode ?? "ideology-mix";

    tokenClient.callback = async (resp: any) => {
      if (resp?.error !== undefined) {
        return reject(new Error("구글 로그인이 취소되었거나 실패했습니다."));
      }

      try {
        const messageIds = await listMessageIds(
          gapi,
          labelName,
          fallbackQuery,
          maxMessagesToRead,
          requestedDates
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

          const { decodedHtml, decodedText, subject, messageDateIso } =
            extractEmailBodies(payload);

          const extracted = extractArticlesFromEmail({
            decodedHtml,
            decodedText,
            subject,
            minTitleLength: config.minTitleLength,
            snippetMaxLen: config.snippetMaxLen,
            messageDateIso,
          });

          items.push(...extracted);
        }

        // ✅ 링크 정제 + 중복 제거 강화(요청사항)
        const normalized = items
          .map((it) => normalizeItem(it))
          .filter((it) => !!it.link)
          .filter((it) => !isBlockedDomain(it.link))
          .filter((it) => !isBlockedByKeyword(it.link));

        const articleDateEnriched = await enrichArticlePublishedDates(normalized);
        const deduped = dedupeByNormalizedUrl(articleDateEnriched);

        const filteredSeen = excludeSeen
          ? filterSeen(deduped, config.seenTtlDays)
          : deduped;

        // ✅ score + timestamp 계산
        const enriched = filteredSeen.map((it) => {
          const ts = toTimestamp(it.articlePublishedAt || it.publishedAt);
          return {
            ...it,
            _ts: ts,
            score: scoreItem(it, keywordHint),
          };
        });

        // ✅ 정렬 업그레이드
        const sorted = sortItems(enriched, sortBy, config.recencyWeight);
        const balanced =
          balanceMode === "ideology-mix"
            ? rebalanceNewsItems(sorted, maxItemsToReturn)
            : sorted.slice(0, maxItemsToReturn);

        const result = balanced.slice(0, maxItemsToReturn);

        if (excludeSeen) markSeen(result, config.seenTtlDays);

        // 내부값 제거(원하면 유지해도 됨)
        resolve(result.map(stripInternal));
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
  maxMessagesToRead: number,
  requestedDates: string[] = []
): Promise<string[]> {
  const labelId = await findLabelId(gapi, labelName);

  if (!requestedDates.length) {
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

  const perDateLimit = Math.max(20, Math.min(maxMessagesToRead * 4, 100));
  const collected = new Map<string, true>();

  for (const date of requestedDates) {
    const normalized = normalizeDateInput(date);
    if (!normalized) continue;

    const params: Record<string, any> = {
      userId: "me",
      q: buildSingleDayQuery(fallbackQuery, normalized),
      maxResults: perDateLimit,
    };

    if (labelId) {
      params.labelIds = [labelId];
    }

    try {
      const res = await gapi.client.gmail.users.messages.list(params);
      const messages = res?.result?.messages || [];
      for (const m of messages) {
        const id = String(m?.id || "").trim();
        if (id) collected.set(id, true);
      }
    } catch {
      // ignore per-date query failure and fall through to metadata filtering below
    }
  }

  const ids = Array.from(collected.keys());
  if (ids.length) {
    return await filterMessageIdsByRequestedDates(gapi, ids, requestedDates, maxMessagesToRead);
  }

  const fallbackLimit = Math.max(20, Math.min(maxMessagesToRead * Math.max(3, requestedDates.length * 4), 100));
  const params: Record<string, any> = {
    userId: "me",
    q: fallbackQuery,
    maxResults: fallbackLimit,
  };

  if (labelId) {
    params.labelIds = [labelId];
  }

  const res = await gapi.client.gmail.users.messages.list(params);
  const messages = res?.result?.messages || [];
  const broadIds = messages.map((m: any) => m?.id).filter(Boolean);
  return await filterMessageIdsByRequestedDates(gapi, broadIds, requestedDates, maxMessagesToRead);
}

/**
 * ✅ 여러 날짜 입력 정규화
 */
function normalizeTargetDates(targetDate?: string, targetDates?: string[]) {
  const raw = [
    ...(targetDate ? [targetDate] : []),
    ...((targetDates || []).filter(Boolean) as string[]),
  ];

  const unique = new Set<string>();

  for (const value of raw) {
    const normalized = normalizeDateInput(value);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique).sort();
}

function normalizeDateInput(input?: string) {
  const value = (input || "").trim();
  if (!value) return "";

  const normalized = value.replace(/\./g, "-").replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    return "";
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(
    2,
    "0"
  )}-${String(day).padStart(2, "0")}`;
}


function toSeoulDateKey(input?: string) {
  const iso = toIsoSafe(String(input || ""));
  if (!iso) return "";
  try {
    const formatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

async function filterMessageIdsByRequestedDates(
  gapi: any,
  messageIds: string[],
  requestedDates: string[],
  maxMessagesToRead: number
): Promise<string[]> {
  if (!requestedDates.length) return messageIds.slice(0, maxMessagesToRead);

  const wanted = new Set(requestedDates.map((d) => normalizeDateInput(d)).filter(Boolean));
  if (!wanted.size) return messageIds.slice(0, maxMessagesToRead);

  const filtered: string[] = [];
  for (const id of messageIds) {
    try {
      const meta = await gapi.client.gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["Date"],
      });
      const payload = meta?.result?.payload;
      const headers = payload?.headers || [];
      const rawDate = headers.find((h: any) => h?.name === "Date")?.value || "";
      const internalDate = meta?.result?.internalDate
        ? new Date(Number(meta.result.internalDate)).toISOString()
        : "";
      const dateKey = toSeoulDateKey(rawDate) || toSeoulDateKey(internalDate);
      if (dateKey && wanted.has(dateKey)) {
        filtered.push(id);
        if (filtered.length >= maxMessagesToRead * Math.max(1, wanted.size)) break;
      }
    } catch {
      // ignore per-message metadata failures
    }
  }

  return filtered;
}

/**
 * ✅ 특정 하루 검색 쿼리 생성
 * Gmail after/before는 epoch seconds 사용
 */
function buildSingleDayQuery(baseQuery: string, normalizedDate: string) {
  const [year, month, day] = normalizedDate.split("-").map(Number);

  const localStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const localEnd = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  const afterEpoch = Math.floor(localStart.getTime() / 1000);
  const beforeEpoch = Math.floor(localEnd.getTime() / 1000);

  const dateQuery = `after:${afterEpoch} before:${beforeEpoch}`;
  return `${baseQuery} ${dateQuery}`.trim();
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
  messageDateIso: string;
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

  // ✅ NEW: Date 헤더로 publishedAt 기본값(메일 수신시간) 확보
  const rawDate = headers.find((h: any) => h?.name === "Date")?.value || "";
  const messageDateIso = toIsoSafe(rawDate) || new Date().toISOString();

  const decodedHtml = decodeBase64Url(htmlBody);
  const decodedText = decodeBase64Url(textBody);

  return { decodedHtml, decodedText, subject, messageDateIso };
}

function decodeBase64Url(data: string) {
  if (!data) return "";
  try {
    let base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    // 일부 환경에서 escape/decodeURIComponent 조합이 깨질 수 있어 방어
    const decoded = atob(base64);
    return safeDecodeUtf8(decoded);
  } catch {
    try {
      return atob(data);
    } catch {
      return "";
    }
  }
}

function safeDecodeUtf8(str: string) {
  try {
    // percent-encoding 방식으로 UTF-8 복원
    const esc = Array.from(str)
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
    return decodeURIComponent(esc);
  } catch {
    // 최후 fallback
    return str;
  }
}

function extractArticlesFromEmail(args: {
  decodedHtml: string;
  decodedText: string;
  subject: string;
  minTitleLength: number;
  snippetMaxLen: number;
  messageDateIso: string; // ✅ NEW
}): GmailNewsItem[] {
  const { decodedHtml, decodedText, subject, minTitleLength, snippetMaxLen, messageDateIso } =
    args;

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

        // ✅ NEW: 문맥 추출 개선(부모/형제 텍스트를 더 적극 활용)
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

        // ✅ Gmail 소스피드 날짜는 수신일 기준으로 유지, 기사 날짜는 별도 보관
        const publishedAt = messageDateIso;
        const articlePublishedAt = inferPublishedAt(snippet, decodedText, messageDateIso);

        out.push({
          title: titleCandidate,
          link: url,
          source,
          body: buildBodyForAI(snippet, decodedText, snippetMaxLen),
          publishedAt,
          gmailReceivedAt: messageDateIso,
          articlePublishedAt,
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
        publishedAt: messageDateIso,
        gmailReceivedAt: messageDateIso,
        articlePublishedAt: inferPublishedAt("", decodedText, messageDateIso),
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
      publishedAt: messageDateIso,
      gmailReceivedAt: messageDateIso,
    });
  }

  return out;
}

function extractSnippetAroundAnchor(anchor: Element, maxLen: number) {
  // 기존: anchor/parent/grand만 사용 -> 개선: sibling/next 텍스트도 활용
  const parent = anchor.parentElement;
  const grand = parent?.parentElement;

  const siblingText = (() => {
    const p = parent;
    if (!p) return "";
    const sibs = Array.from(p.children || []);
    const idx = sibs.indexOf(anchor as any);
    const around = [
      sibs[idx - 1]?.textContent || "",
      sibs[idx + 1]?.textContent || "",
    ]
      .join(" ")
      .trim();
    return cleanInlineText(around);
  })();

  const candidates = [
    cleanInlineText(anchor.textContent || ""),
    siblingText,
    parent ? cleanInlineText(parent.textContent || "") : "",
    grand ? cleanInlineText(grand.textContent || "") : "",
  ].filter(Boolean);

  // 가장 길다고 무조건 좋은 게 아니라, 너무 길면 노이즈
  const best =
    candidates
      .map((t) => t.trim())
      .filter((t) => t.length >= 20)
      .sort((a, b) => {
        // “기사형 문장” 우선: 길이 적당(40~260)
        const score = (s: string) => {
          const len = s.length;
          const mid = len >= 40 && len <= 260 ? 50 : 0;
          const bonus = /[.?!。]|다\.$|니다\.$/.test(s) ? 10 : 0;
          return mid + bonus + Math.min(len, 260) / 10;
        };
        return score(b) - score(a);
      })[0] || candidates.sort((a, b) => b.length - a.length)[0] || "";

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

  // 1) google.com/url?q=
  if (url.includes("google.com/url?q=")) {
    try {
      return decodeURIComponent(url.split("url?q=")[1].split("&")[0]);
    } catch {
      return url;
    }
  }

  // 2) google.com/url?url= / q=
  if (url.includes("google.com/url?")) {
    try {
      const u = new URL(url);
      const p = u.searchParams.get("url") || u.searchParams.get("q");
      if (p) return decodeURIComponent(p);
    } catch {
      return url;
    }
  }

  // 3) Google Alerts common redirect: https://www.google.com/url?sa=t&url=...
  try {
    const u = new URL(url);
    const sa = u.searchParams.get("sa");
    const target = u.searchParams.get("url") || u.searchParams.get("q");
    if (sa && target) return decodeURIComponent(target);
  } catch {
    // ignore
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

    // 너무 짧은 path는 기사일 확률 낮음
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 1) return false;

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

  // publishedAt / articlePublishedAt 도 ISO로 정규화
  const publishedAt = item.publishedAt ? toIsoSafe(item.publishedAt) : undefined;
  const gmailReceivedAt = item.gmailReceivedAt ? toIsoSafe(item.gmailReceivedAt) : undefined;
  const articlePublishedAt = item.articlePublishedAt
    ? toIsoSafe(item.articlePublishedAt)
    : undefined;

  return {
    ...item,
    link: normalizedLink,
    source,
    title: cleanInlineText(item.title || ""),
    body: cleanInlineText(item.body || ""),
    publishedAt: publishedAt || item.publishedAt,
    gmailReceivedAt: gmailReceivedAt || publishedAt || item.gmailReceivedAt || item.publishedAt,
    articlePublishedAt: articlePublishedAt || item.articlePublishedAt,
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

  const aHasDate = !!(a.articlePublishedAt || a.publishedAt);
  const bHasDate = !!(b.articlePublishedAt || b.publishedAt);

  const aScore = aTitle * 2 + aBody + (aHasDate ? 10 : 0);
  const bScore = bTitle * 2 + bBody + (bHasDate ? 10 : 0);

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


async function enrichArticlePublishedDates(items: GmailNewsItem[]) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return list;

  // Gmail 브리핑은 메일 수신 날짜 기준으로 동작하므로,
  // 기사 날짜 API 실패가 전체 결과를 흔들지 않도록 여기서는 외부 API를 호출하지 않습니다.
  return list;
}

const ARTICLE_DATE_API_PATH = "/api/article-date";

function shouldUseArticleDateApi() {
  try {
    const host = window.location.hostname || "";
    if (host.includes("run.app")) return false;
  } catch {}
  return true;
}

async function fetchArticlePublishedAt(url: string): Promise<string> {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return "";

  try {
    if (!shouldUseArticleDateApi()) return "";

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);

    const apiUrl = `${ARTICLE_DATE_API_PATH}?url=${encodeURIComponent(normalizedUrl)}`;
    const res = await fetch(apiUrl, {
      method: "GET",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    window.clearTimeout(timer);

    if (!res.ok) return "";

    const data = await res.json().catch(() => null);
    const extracted =
      toIsoSafe(String(data?.publishedAt || "")) ||
      toIsoSafe(String(data?.articlePublishedAt || "")) ||
      toIsoSafe(String(data?.date || "")) ||
      toIsoSafe(String(data?.resolvedDate || "")) ||
      toIsoSafe(String(data?.value || ""));

    return extracted || "";
  } catch {
    return "";
  }
}

function extractPublishedDateFromHtml(html: string): string {
  const text = String(html || "");
  if (!text) return "";

  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']pubdate["'][^>]*>/i,
    /<meta[^>]+name=["']publishdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']publishdate["'][^>]*>/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']datePublished["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    const iso = toIsoSafe(m?.[1] || "");
    if (iso) return iso;
  }

  const jsonLdMatches = text.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of jsonLdMatches) {
    const dateMatch = block.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    const iso = toIsoSafe(dateMatch?.[1] || "");
    if (iso) return iso;
  }

  const loosePatterns = [
    /(입력|등록|기사입력|기사등록|작성|수정|업데이트|최종수정)\s*[:]?\s*(20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}\s*\d{1,2}:\d{2})/i,
    /(입력|등록|기사입력|기사등록|작성|수정|업데이트|최종수정)\s*[:]?\s*(20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2})/i,
  ];

  for (const re of loosePatterns) {
    const m = text.match(re);
    const iso = normalizeLooseDateToIso(m?.[2] || "");
    if (iso) return iso;
  }

  return "";
}

function normalizeLooseDateToIso(value: string) {
  const v = String(value || "").trim();
  if (!v) return "";

  const cleaned = v
    .replace(/년/g, "-")
    .replace(/월/g, "-")
    .replace(/일/g, " ")
    .replace(/[.]/g, "-")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const withTime = cleaned.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (withTime) {
    const [, y, mo, d, h, mi] = withTime;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0);
    const iso = dt.toISOString();
    return Number.isNaN(dt.getTime()) ? "" : iso;
  }

  const dateOnly = cleaned.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
    const iso = dt.toISOString();
    return Number.isNaN(dt.getTime()) ? "" : iso;
  }

  return "";
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

  // NEW: 날짜가 있으면 약간 가산 (최근성은 sort에서 더 크게 반영)
  if (item.publishedAt) score += 4;

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
 *  Sorting (NEW)
 * ------------------------------ */
function sortItems(
  items: GmailNewsItem[],
  sortBy: "hybrid" | "score" | "recent",
  recencyWeight: number
) {
  const now = Date.now();

  // recencyScore: 0~1 (최근일수록 1)
  const recencyScore = (ts?: number) => {
    const t = ts && ts > 0 ? ts : 0;
    if (!t) return 0;
    // 14일을 기준으로 최근성 점수 계산(그 이상은 급감)
    const days = Math.max(0, (now - t) / (1000 * 60 * 60 * 24));
    const score = 1 / (1 + days / 2.5); // 0~1
    return clamp(score, 0, 1);
  };

  const maxScore = Math.max(...items.map((i) => i.score || 0), 1);

  const hybridValue = (it: GmailNewsItem) => {
    const sNorm = (it.score || 0) / maxScore; // 0~1
    const r = recencyScore(it._ts);
    const w = clamp(recencyWeight, 0, 1);
    return w * r + (1 - w) * sNorm;
  };

  const list = [...items];

  if (sortBy === "recent") {
    return list.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  }
  if (sortBy === "score") {
    return list.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  // hybrid
  return list.sort((a, b) => hybridValue(b) - hybridValue(a));
}

function stripInternal(it: GmailNewsItem): GmailNewsItem {
  const { _ts, ...rest } = it as any;
  return rest as GmailNewsItem;
}

type OutletBucket =
  | "global"
  | "kr-progressive"
  | "kr-conservative"
  | "kr-neutral"
  | "other";

function classifyOutlet(hostOrSource: string): { bucket: OutletBucket; publisher: string } {
  const host = String(hostOrSource || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .trim();

  const match = (domains: string[]) =>
    domains.find((d) => host === d || host.endsWith(`.${d}`));

  const globalDomains = [
    "reuters.com",
    "apnews.com",
    "bloomberg.com",
    "bbc.com",
    "bbc.co.uk",
    "cnn.com",
    "nytimes.com",
    "theguardian.com",
    "wsj.com",
    "ft.com",
    "economist.com",
  ];
  const krProgressiveDomains = ["hani.co.kr", "khan.co.kr", "ohmynews.com"];
  const krConservativeDomains = ["chosun.com", "joongang.co.kr", "donga.com"];
  const krNeutralDomains = [
    "hankookilbo.com",
    "hankookilbo.co.kr",
    "seoul.co.kr",
    "yna.co.kr",
    "yonhapnews.co.kr",
    "ytn.co.kr",
    "kbs.co.kr",
    "kbsnews.co.kr",
    "imbc.com",
    "mbc.co.kr",
    "sbs.co.kr",
    "news1.kr",
  ];

  const globalMatch = match(globalDomains);
  if (globalMatch) return { bucket: "global", publisher: publisherAlias(globalMatch) };

  const progMatch = match(krProgressiveDomains);
  if (progMatch) return { bucket: "kr-progressive", publisher: publisherAlias(progMatch) };

  const consMatch = match(krConservativeDomains);
  if (consMatch) return { bucket: "kr-conservative", publisher: publisherAlias(consMatch) };

  const neutralMatch = match(krNeutralDomains);
  if (neutralMatch) return { bucket: "kr-neutral", publisher: publisherAlias(neutralMatch) };

  return { bucket: "other", publisher: publisherAlias(host || "unknown") };
}

function publisherAlias(domain: string) {
  const map: Record<string, string> = {
    "reuters.com": "Reuters",
    "apnews.com": "AP",
    "bloomberg.com": "Bloomberg",
    "bbc.com": "BBC",
    "bbc.co.uk": "BBC",
    "cnn.com": "CNN",
    "nytimes.com": "NYTimes",
    "theguardian.com": "Guardian",
    "wsj.com": "WSJ",
    "ft.com": "FT",
    "economist.com": "Economist",
    "hani.co.kr": "한겨레",
    "khan.co.kr": "경향신문",
    "ohmynews.com": "오마이뉴스",
    "chosun.com": "조선일보",
    "joongang.co.kr": "중앙일보",
    "donga.com": "동아일보",
    "hankookilbo.com": "한국일보",
    "hankookilbo.co.kr": "한국일보",
    "seoul.co.kr": "서울신문",
    "yna.co.kr": "연합뉴스",
    "yonhapnews.co.kr": "연합뉴스",
    "ytn.co.kr": "YTN",
    "kbs.co.kr": "KBS",
    "kbsnews.co.kr": "KBS",
    "imbc.com": "MBC",
    "mbc.co.kr": "MBC",
    "sbs.co.kr": "SBS",
    "news1.kr": "뉴스1",
  };
  return map[domain] || domain.replace(/^www\./, "");
}

function rebalanceNewsItems(items: GmailNewsItem[], maxItems: number) {
  const list = Array.isArray(items) ? [...items] : [];
  if (!list.length) return list;

  const byBucket: Record<OutletBucket, GmailNewsItem[]> = {
    global: [],
    "kr-progressive": [],
    "kr-conservative": [],
    "kr-neutral": [],
    other: [],
  };

  for (const item of list) {
    const host = safeHostname(item.link) || item.source || "";
    const { bucket } = classifyOutlet(host);
    byBucket[bucket].push(item);
  }

  const selected: GmailNewsItem[] = [];
  const selectedKeys = new Set<string>();
  const publisherCounts = new Map<string, number>();

  const tryPickFromBucket = (bucket: OutletBucket) => {
    const queue = byBucket[bucket] || [];
    if (!queue.length) return null;

    const pick = (allowRepeatPublisher: boolean) => {
      for (const item of queue) {
        const key = String(item.link || item.title || "").trim();
        if (!key || selectedKeys.has(key)) continue;

        const host = safeHostname(item.link) || item.source || "";
        const { publisher } = classifyOutlet(host);
        const publisherCount = publisherCounts.get(publisher) || 0;

        if (publisherCount >= 2) continue;
        if (!allowRepeatPublisher && publisherCount >= 1) continue;

        return item;
      }
      return null;
    };

    return pick(false) || pick(true);
  };

  const commit = (item: GmailNewsItem | null) => {
    if (!item) return false;

    const key = String(item.link || item.title || "").trim();
    if (!key || selectedKeys.has(key)) return false;

    const host = safeHostname(item.link) || item.source || "";
    const { publisher } = classifyOutlet(host);
    const publisherCount = publisherCounts.get(publisher) || 0;

    if (publisherCount >= 2) return false;

    publisherCounts.set(publisher, publisherCount + 1);
    selectedKeys.add(key);
    selected.push(item);
    return true;
  };

  const primarySequence: OutletBucket[] = [
    "global",
    "kr-progressive",
    "kr-progressive",
    "kr-conservative",
    "kr-conservative",
  ];

  for (const bucket of primarySequence) {
    if (selected.length >= maxItems) break;
    commit(tryPickFromBucket(bucket));
  }

  const fillSequence: OutletBucket[] = [
    "kr-neutral",
    "global",
    "kr-progressive",
    "kr-conservative",
    "other",
  ];

  while (selected.length < maxItems) {
    let added = false;

    for (const bucket of fillSequence) {
      if (selected.length >= maxItems) break;
      const picked = tryPickFromBucket(bucket);
      if (commit(picked)) added = true;
    }

    if (!added) break;
  }

  if (selected.length < maxItems) {
    for (const item of list) {
      if (selected.length >= maxItems) break;

      const key = String(item.link || item.title || "").trim();
      if (!key || selectedKeys.has(key)) continue;

      const host = safeHostname(item.link) || item.source || "";
      const { publisher } = classifyOutlet(host);
      const publisherCount = publisherCounts.get(publisher) || 0;
      if (publisherCount >= 2) continue;

      publisherCounts.set(publisher, publisherCount + 1);
      selectedKeys.add(key);
      selected.push(item);
    }
  }

  return selected;
}

/** -----------------------------
 *  PublishedAt inference (NEW)
 * ------------------------------ */
function toTimestamp(iso?: string) {
  if (!iso) return 0;
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

function toIsoSafe(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const t = d.getTime();
  if (!Number.isNaN(t)) return d.toISOString();
  return "";
}

/**
 * snippet/decodedText에서 날짜 추정
 * - ISO/RFC 형태는 Date()로 파싱
 * - "2026. 2. 27", "2026-02-27" 패턴도 지원
 * 없으면 messageDateIso 사용
 */
function inferPublishedAt(snippet: string, decodedText: string, messageDateIso: string) {
  // 1) 표준 파싱 가능한 문자열 먼저
  const direct = toIsoSafe(extractFirstDateLike(snippet) || extractFirstDateLike(decodedText));
  if (direct) return direct;

  // 2) yyyy.mm.dd / yyyy-mm-dd
  const ymd = extractYmd(snippet) || extractYmd(decodedText);
  if (ymd) return ymd;

  // fallback: Gmail Date
  return messageDateIso || new Date().toISOString();
}

function extractFirstDateLike(text: string) {
  const t = (text || "").slice(0, 800);
  // RFC style / English month style / etc - 너무 넓게 잡지 않도록 제한
  const re =
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{4}[^<\n]*\b/i;
  const m = t.match(re);
  return m?.[0] || "";
}

function extractYmd(text: string) {
  const t = (text || "").slice(0, 800);

  // 2026-02-27
  const m1 = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    const iso = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString();
    return iso;
  }

  // 2026. 2. 27 / 2026.2.27
  const m2 = t.match(/\b(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\b/);
  if (m2) {
    const y = Number(m2[1]);
    const mo = Number(m2[2]);
    const d = Number(m2[3]);
    const iso = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString();
    return iso;
  }

  return "";
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
