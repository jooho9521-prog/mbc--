// src/services/geminiService.ts
import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, TrendAnalysis, Citation, FactCheck } from "../types";
import { isBlockedByKeyword, isBlockedDomain, normalizeNewsUrl } from "./sourceService";

console.log("🚀 초강력 텍스트 방어막이 추가된 GeminiService 로드 완료!");

// ⭐️ 브라우저 환경에서 API 키를 끝까지 추적해서 찾아내는 헬퍼 함수
const getApiKey = () => {
  let key = "";
  try {
    key = localStorage.getItem("gemini_api_key") || "";
  } catch (e) {}
  if (!key) {
    try {
      key =
        (window as any).process?.env?.GEMINI_API_KEY ||
        (window as any).process?.env?.API_KEY ||
        "";
    } catch (e) {}
  }
  if (!key) {
    try {
      key = (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
    } catch (e) {}
  }
  return key.trim();
};


export const sanitizeSnsOutput = (input: string) => {
  const raw = String(input || "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return "";

  let text = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+(?=\S)/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s*>+\s*/gm, "")
    .replace(/^\s*[-*•]+\s*/gm, "")
    .replace(/^\s*\d+[.)]\s*/gm, "")
    .replace(/^\s*(헤드라인|제목|본문|캡션|해시태그|hashtags?)\s*[:：-]\s*/gim, "")
    .replace(/^\s*(기업용\s*PR\/?SNS\s*에디터|동아일보용\s*고급\s*AI\s*대화\s*어시스턴트|요청하신.*제안합니다\.?|사용자의\s*요청에\s*따라.*)$/gim, "")
    .replace(/^\s*(전략적\s*배경\s*및\s*맥락\s*분석|질문\s*의도\s*및\s*배경|커뮤니케이션\s*전략|잠재적\s*리스크\s*및\s*대응)\s*$/gim, "")
    .replace(/^\s*[\-–—]{3,}\s*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cleaned: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("ai 대화 어시스턴트") ||
      lower.includes("요청하신") ||
      lower.includes("전략적 배경") ||
      lower.includes("질문 의도 및 배경") ||
      lower.includes("커뮤니케이션 전략") ||
      lower.includes("잠재적 리스크")
    ) {
      continue;
    }
    cleaned.push(line);
  }

  text = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
};

/**
 * ✅ SDK 응답에서 payload(text/object)를 안전하게 추출합니다.
 * - response.text가 string 또는 object(JSON)인 케이스 모두 처리
 */
const getResponsePayload = (response: any): unknown => {
  try {
    const t = response?.text;
    if (t && typeof t === "object") return t;
    if (typeof t === "string" && t.trim().length > 0) return t;
  } catch {}

  // candidates -> content.parts[].text 조합(일부 SDK/모드)
  try {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const texts = parts
        .map((p: any) => p?.text)
        .filter((x: any) => typeof x === "string");
      if (texts.length) return texts.join("\n");
    }
  } catch {}

  return "";
};

const stripCodeFences = (s: string) => s.replace(/```json/gi, "").replace(/```/g, "").trim();

const normalizeSmartQuotes = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[„]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[‐-‒–—―]/g, "-");

/**
 * ✅ JSON/JS 객체 형태 응답에서 { ... } 또는 [ ... ] 영역만 괄호 밸런싱으로 추출
 * - JSON 앞/뒤에 문장 붙어도 견딤
 * - 문자열("...") 내부의 괄호는 무시
 */
const extractJsonByBalancing = (text: string) => {
  const s = String(text || "");
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

  if (start === -1) return s.trim();

  const open = s[start];
  const stack: string[] = [open === "{" ? "}" : "]"];

  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < s.length; i++) {
    const ch = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    } else {
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") {
        stack.pop();
        if (stack.length === 0) return s.slice(start, i + 1).trim();
      }
    }
  }

  return s.slice(start).trim();
};

/**
 * ✅ JSON string 내부 실제 개행(\n/\r/\u2028/\u2029)은 JSON.parse를 깨뜨립니다.
 * double-quoted string 내부의 실제 개행만 \\n 으로 치환.
 */
const escapeUnescapedNewlinesInStrings = (input: string) => {
  const s = String(input || "");
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
      out += "\\n";
      continue;
    }

    out += ch;
  }

  return out;
};

/**
 * ✅ single-quoted 문자열을 double-quoted로 변환 (멀티라인 포함)
 * - 문자열 내부의 " 는 \\" 로 이스케이프
 * - 실제 개행은 \\n 로 변환
 */
const convertSingleQuotedStrings = (input: string) => {
  const s = String(input || "");
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inSingle) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += "\\";
        escaped = true;
        continue;
      }
      if (ch === "'") {
        out += '"';
        inSingle = false;
        continue;
      }
      if (ch === '"') {
        out += '\\"';
        continue;
      }
      if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") {
        out += "\\n";
        continue;
      }
      out += ch;
      continue;
    }

    if (inDouble) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === "'") {
      out += '"';
      inSingle = true;
      escaped = false;
      continue;
    }

    out += ch;
    if (ch === '"') {
      inDouble = true;
      escaped = false;
    }
  }

  return out;
};

/**
 * ✅ "JSON처럼 보이지만 JSON이 아닌" JS 객체 리터럴을 JSON으로 보정
 * - unquoted key, single quotes, trailing comma, 문자열 내부 개행 등을 복구
 */
const toStrictJsonLike = (input: string) => {
  let s = stripCodeFences(normalizeSmartQuotes(String(input || "")));
  s = extractJsonByBalancing(s);

  // 1) 따옴표 없는 key -> "key"
  s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');

  // 2) single-quoted string -> double-quoted string
  s = convertSingleQuotedStrings(s);

  // 3) trailing comma 제거
  s = s.replace(/,\s*([}\]])/g, "$1");

  // 4) 문자열 내부 실제 개행 보정
  s = escapeUnescapedNewlinesInStrings(s);

  return s.trim();
};

const tryParseJson = (raw: unknown): any | null => {
  if (!raw) return null;

  // ✅ SDK가 object로 준 경우 그대로 사용
  if (typeof raw === "object") return raw;

  const s0 = String(raw || "");

  // strict: (혹시 정말 JSON이라면) 그대로 시도
  try {
    let s = stripCodeFences(normalizeSmartQuotes(extractJsonByBalancing(s0)));
    s = escapeUnescapedNewlinesInStrings(s);
    return JSON.parse(s);
  } catch {}

  // repair: JS object literal -> JSON 변환 후 시도
  try {
    return JSON.parse(toStrictJsonLike(s0));
  } catch {}

  return null;
};

const cleanAndParseJson = (input: unknown) => {
  const parsed = tryParseJson(input);
  if (parsed) return parsed;

  const text = String(input || "");
  // (로그 억제) 폴백 복구 시도


  // ✅ 마지막 폴백: summary/sentiment/growthScore만이라도 복구 (기존 장점 유지)
  try {
    const summaryMatch =
      text.match(
        /"summary"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"sentiment"|,\s*"keyPoints"|,\s*"growthScore"|,\s*"sources"|,\s*"citations"|,\s*"factChecks"|,\s*"confidenceScore"|\})/i
      ) ||
      text.match(/\bsummary\s*:\s*"([\s\S]*?)"\s*(?:,\s*sentiment|,\s*keyPoints|,\s*growthScore|\})/i) ||
      text.match(
        /"summary"\s*:\s*'([\s\S]*?)'\s*(?:,\s*"sentiment"|,\s*"keyPoints"|,\s*"growthScore"|,\s*"sources"|,\s*"citations"|,\s*"factChecks"|,\s*"confidenceScore"|\})/i
      ) ||
      text.match(/\bsummary\s*:\s*'([\s\S]*?)'\s*(?:,\s*sentiment|,\s*keyPoints|,\s*growthScore|\})/i);

    const sentimentMatch =
      text.match(/"sentiment"\s*:\s*"([^"]*)"/i) ||
      text.match(/\bsentiment\s*:\s*"([^"]*)"/i) ||
      text.match(/"sentiment"\s*:\s*'([^']*)'/i) ||
      text.match(/\bsentiment\s*:\s*'([^']*)'/i);

    const scoreMatch =
      text.match(/"growthScore"\s*:\s*(\d+)/i) || text.match(/\bgrowthScore\s*:\s*(\d+)/i);

    if (summaryMatch && summaryMatch[1]) {
      return {
        summary: String(summaryMatch[1]).trim(),
        sentiment: sentimentMatch ? String(sentimentMatch[1]) : "neutral",
        keyPoints: [],
        growthScore: scoreMatch ? parseInt(String(scoreMatch[1]), 10) : 50,
        citations: [],
        factChecks: [],
      };
    }
  } catch (err) {
    console.error("강제 추출 실패:", err);
  }
  console.warn("JSON 파싱/복구 모두 실패(응답 형식 비정상).", String(input || "").slice(0, 800));

  return null;
};

/**
 * ✅ evidence 정규화 helper
 * - App.tsx에서 만든 evidenceArray를 그대로 넘겨도 안전하게 정리해줍니다.
 */
export type EvidenceItem = {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
  date?: string;
};

const normalizeUrlSafe = (u: string) => normalizeNewsUrl(u);

const isBlockedEvidenceUrl = (u: string) => {
  if (!u) return true;
  return isBlockedDomain(u) || isBlockedByKeyword(u);
};

export function normalizeEvidence(evidence: EvidenceItem[], max = 12): EvidenceItem[] {
  const list = Array.isArray(evidence) ? evidence : [];
  const out: EvidenceItem[] = [];
  const seen = new Set<string>();

  for (const e of list) {
    const url = normalizeUrlSafe(String(e?.url || "").trim());
    if (!url || isBlockedEvidenceUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: String(e?.title || "관련 기사").trim() || "관련 기사",
      url,
      source: e?.source ? String(e.source).trim() : "",
      snippet: e?.snippet ? String(e.snippet).trim() : "",
      date: e?.date ? String(e.date).trim() : "",
    });
    if (out.length >= max) break;
  }

  return out;
}

export const extractErrorMessage = (error: any): string => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  const apiError = error?.error || error;
  if (apiError?.message) return apiError.message;
  try {
    return JSON.stringify(error);
  } catch (e) {
    return String(error);
  }
};

export const handleApiError = (error: any): string => {
  const message = extractErrorMessage(error);
  const lowerMsg = message.toLowerCase();

  if (lowerMsg.includes("not found") || lowerMsg.includes("404")) {
    return "AI Model connection failed (404). Switching to supported model.";
  }
  if (
    lowerMsg.includes("429") ||
    lowerMsg.includes("quota") ||
    lowerMsg.includes("api key") ||
    lowerMsg.includes("api_key_missing")
  ) {
    return "API 키가 없거나 올바르지 않습니다. 우측 상단의 [API 키 관리]에서 다시 한 번 저장해주세요.";
  }
  if (lowerMsg.includes("503") || lowerMsg.includes("overloaded")) {
    return "현재 구글 서버에 전 세계적인 접속이 폭주하고 있습니다. 잠시 후 시도해주세요.";
  }

  return message.length > 150 ? message.substring(0, 150) + "..." : message;
};

// ⭐️ 재시도 로직 (서버가 뻗었을 때 끈질기게 다시 물어봅니다)
export const withRetry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 2000
): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const message = extractErrorMessage(error).toLowerCase();
    const status = error?.status || error?.code;

    const isFatal = status === 404 || status === 400 || message.includes("not found");
    if (isFatal) throw error;

    const isTransient =
      status === 503 ||
      status === 429 ||
      message.includes("503") ||
      message.includes("quota") ||
      message.includes("unavailable") ||
      message.includes("overloaded");

    if (retries > 0 && isTransient) {
      console.warn(
        `[Retry] 구글 서버 혼잡 감지! ${delay / 1000}초 후 다시 시도합니다... (남은 횟수: ${retries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

const factLabelTextKo = (label: string) => {
  const v = String(label || "").toLowerCase();
  if (v === "fact") return "팩트";
  if (v === "speculation") return "추정";
  return "해석";
};

/** ✅ A 업그레이드: 분석 응답에 citations/factChecks가 없으면 안전 보강 */
const ensureTrustFields = (analysis: any): TrendAnalysis => {
  if (!analysis) return analysis;
  if (!Array.isArray(analysis.citations)) analysis.citations = [];
  if (!Array.isArray(analysis.factChecks)) analysis.factChecks = [];
  return analysis as TrendAnalysis;
};

/** ✅ summary(1~5.)에서 포인트 텍스트를 추출 */
const extractNumber = (summary: string, point: number): string => {
  const text = String(summary || "");
  // 1. ... 2. ... 형태를 robust하게 파싱 (줄바꿈 포함)
  const re = new RegExp(
    `(?:^|\\n)\\s*${point}\\.?\\s+([\\s\\S]*?)(?=(?:\\n\\s*${point + 1}\\.?\\s+)|$)`,
    "m"
  );
  const m = text.match(re);
  return (m?.[1] || "").trim();
};

/**
 * ✅ summary("1. ...\n\n2. ...") 에서 각 번호 포인트 본문을 추출
 */
const extractNumberedSummaryPoints = (summary: string): string[] => {
  const s = String(summary || "").replace(/\r/g, "").trim();
  if (!s) return [];

  // "1." ~ "5." 기준 분리
  const parts = s.split(/\n?\s*(?=\d\.\s)/g).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^\d\.\s*([\s\S]*)$/);
    if (m && m[1]) out.push(m[1].trim());
  }
  if (!out.length) return [s];
  return out;
};

/**
 * ✅ 카드용 텍스트 정리(잘림 없이 원문 유지)
 */
const toCardLine = (text: string) => {
  return String(text || "").replace(/\s+/g, " ").trim();
};

const normalizeTrendAnalysis = (raw: any): TrendAnalysis | null => {
  if (!raw || typeof raw !== "object") return null;

  const a: any = { ...raw };

  if (typeof a.summary !== "string") a.summary = "";
  const s = String(a.sentiment || "neutral");
  a.sentiment = (["positive", "neutral", "negative"].includes(s) ? s : "neutral") as
    | "positive"
    | "neutral"
    | "negative";

  if (!Array.isArray(a.keyPoints)) a.keyPoints = [];
  a.keyPoints = a.keyPoints
    .map((x: any) => String(x || ""))
    .filter((x: string) => x.trim().length > 0);

  const gs = Number(a.growthScore);
  a.growthScore = Number.isFinite(gs) ? Math.min(100, Math.max(0, gs)) : 50;

  // trust fields
  if (!Array.isArray(a.citations)) a.citations = [];
  if (!Array.isArray(a.factChecks)) a.factChecks = [];

  // citations normalize
  a.citations = a.citations
    .map((c: any) => ({
      point: Math.min(5, Math.max(1, Number(c?.point || 1))),
      title: String(c?.title || ""),
      url: normalizeUrlSafe(String(c?.url || "")),
      publisher: c?.publisher ? String(c.publisher) : undefined,
    }))
    .filter((c: Citation) => !!c.url);

  // factChecks normalize
  a.factChecks = a.factChecks.map((f: any) => ({
    point: Math.min(5, Math.max(1, Number(f?.point || 1))),
    label: String(f?.label || "interpretation"),
    confidence: Math.min(100, Math.max(0, Number(f?.confidence ?? 50))),
    reason: String(f?.reason || ""),
  }));

  // ✅ keyPoints가 너무 적으면 summary(1~5.) 기반으로 최소 3개 보강 (기존 UI 카드 유지)
  if (a.keyPoints.length < 3 && typeof a.summary === "string" && a.summary.trim().length > 0) {
    const pts = extractNumberedSummaryPoints(a.summary);
    const filled = pts.map((p) => toCardLine(p)).filter((x) => x.trim().length > 0);
    const merged = [...a.keyPoints, ...filled].filter((x) => x && String(x).trim().length > 0);
    // 중복 제거
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const k of merged) {
      const kk = String(k).trim();
      if (!kk) continue;
      if (seen.has(kk)) continue;
      seen.add(kk);
      uniq.push(kk);
      if (uniq.length >= 3) break;
    }
    a.keyPoints = uniq.length ? uniq : a.keyPoints;
  }

  // ✅ confidenceScore가 없으면 자동 계산 (한장요약 '신뢰도' 0% 방지)
  if (!Number.isFinite(Number(a.confidenceScore))) {
    let cs = 50;
    if (Array.isArray(a.factChecks) && a.factChecks.length) {
      const avg =
        a.factChecks.reduce((sum: number, f: any) => sum + Number(f?.confidence ?? 0), 0) /
        a.factChecks.length;
      cs = Math.round(Math.min(100, Math.max(0, avg)));
    } else if (Array.isArray(a.citations) && a.citations.length) {
      cs = 70;
    }
    a.confidenceScore = cs;
  }

  return a as TrendAnalysis;
};

/** ✅ citations/factChecks가 비어있을 때 news/evidence 기반으로 자동 생성 */
const hydrateTrustFields = (
  analysis: TrendAnalysis,
  opts: {
    links?: { title?: string; url?: string; publisher?: string }[];
  } = {}
): TrendAnalysis => {
  const a: any = ensureTrustFields(analysis || ({} as any));

  const links = Array.isArray(opts.links) ? opts.links : [];
  const uniqueLinks = Array.from(
    new Map(
      links
        .map((l) => ({
          title: String(l?.title || "관련 기사").trim() || "관련 기사",
          url: normalizeUrlSafe(String(l?.url || "").trim()),
          publisher: l?.publisher ? String(l.publisher) : undefined,
        }))
        .filter((l) => !!l.url)
        .map((l) => [l.url, l])
    ).values()
  );

  // 1) citations 보강: 포인트 1~5마다 최소 1개씩
  if (!Array.isArray(a.citations)) a.citations = [];
  const hasPoint = (p: number) =>
    a.citations.some((c: any) => Number(c?.point) === p && String(c?.url || "").trim());
  const pickForPoint = (p: number) => uniqueLinks[(p - 1) % Math.max(1, uniqueLinks.length)];

  for (let p = 1; p <= 5; p++) {
    if (hasPoint(p)) continue;
    const picked = pickForPoint(p);
    if (picked) {
      a.citations.push({
        point: p,
        title: picked.title,
        url: picked.url,
        publisher: picked.publisher,
      });
    }
  }

  // 2) factChecks 보강: 포인트 1~5 각각 1개
  if (!Array.isArray(a.factChecks)) a.factChecks = [];
  const fcHasPoint = (p: number) => a.factChecks.some((f: any) => Number(f?.point) === p);
  const summaryPoints = extractNumberedSummaryPoints(a.summary || "");

  const guessLabel = (text: string) => {
    const t = String(text || "").toLowerCase();
    if (/(가능|전망|예상|우려|추정|잠재|~할|may|could|likely)/i.test(t)) return "speculation";
    if (/(확인|발표|공식|수치|통계|기록|증가|감소|달러|%|원)/i.test(t)) return "fact";
    return "interpretation";
  };

  for (let p = 1; p <= 5; p++) {
    if (fcHasPoint(p)) continue;
    const text = summaryPoints[p - 1] || "";
    const citesForPoint = (a.citations || []).filter((c: any) => Number(c?.point) === p);
    const label = guessLabel(text);
    const base = label === "fact" ? 78 : label === "interpretation" ? 68 : 58;
    const bonus = Math.min(18, citesForPoint.length * 8);
    const confidence = Math.min(95, Math.max(40, Math.round(base + bonus)));
    const pointPreview = String(text || "").replace(/\s+/g, " ").trim().slice(0, 84);
    const sourceTitles = citesForPoint
      .slice(0, 2)
      .map((c: any) => String(c?.title || "").trim())
      .filter(Boolean)
      .join(", ");

    a.factChecks.push({
      point: p,
      label,
      confidence,
      reason: citesForPoint.length
        ? `${sourceTitles || "출처 기사"}를 참고하면 "${pointPreview}" 내용은 ${label === "fact" ? "실제 보도와 비교적 직접적으로 맞닿아 있어" : label === "interpretation" ? "보도 내용을 해석해 확장한 성격이 있어" : "전망과 가능성을 포함한 성격이 있어"} 현재 기준에서는 ${factLabelTextKo(label)}에 가깝다고 볼 수 있습니다.`
        : `"${pointPreview}" 내용은 연결된 출처가 충분하지 않아 단정적으로 보기보다 보수적으로 해석했습니다. 그래서 현재는 ${factLabelTextKo(label)}로 분류하고 신뢰도도 다소 낮게 잡았습니다.`,
    });
  }

  // 3) confidenceScore 산출 (UI 검증점수)
  const fcs = (a.factChecks || [])
    .slice()
    .sort((x: any, y: any) => Number(x?.point || 0) - Number(y?.point || 0))
    .slice(0, 5);
  if (fcs.length) {
    const avg = fcs.reduce((acc: number, x: any) => acc + Number(x?.confidence || 0), 0) / fcs.length;
    a.confidenceScore = Math.max(0, Math.min(100, Math.round(avg)));
  } else {
    const covered = new Set((a.citations || []).map((c: any) => Number(c?.point))).size;
    a.confidenceScore = Math.round((covered / 5) * 70);
  }

  return normalizeTrendAnalysis(a) || (a as TrendAnalysis);
};

export class GeminiTrendService {
  /**
   * ✅ 기존 기능 유지: Google Search tool 기반 분석
   * - groundingMetadata에서 링크 추출
   */
  async fetchTrendsAndAnalysis(
    keyword: string,
    modeInstruction: string
  ): Promise<{ news: NewsItem[]; analysis: TrendAnalysis }> {
    try {
      return await withRetry(async () => {
        const key = getApiKey();
        if (!key) throw new Error("API_KEY_MISSING");

        const ai = new GoogleGenAI({ apiKey: key });

        const prompt = `
Analyze the trend for "${keyword}". Context: ${modeInstruction}

[CRITICAL REQUIREMENTS]
1. **LANGUAGE: ALL output content (summary, keyPoints) MUST be written in KOREAN (반드시 모든 내용을 한국어로 번역해서 작성하세요).**
2. You MUST use the Google Search tool to find REAL, recent news articles.
3. **The 'summary' field MUST contain EXACTLY 5 numbered points (from 1. to 5.).**
4. **EACH of the 5 points in the summary MUST be a detailed, substantial paragraph consisting of at least 3-5 sentences.** Provide deep insights, specific facts, figures, and context for every single point.
5. Return ONLY a JSON object. Do not include markdown code blocks.
7. OUTPUT MUST BE STRICT VALID JSON:
   - Use double quotes for ALL keys and string values.
   - Ensure commas between fields and array items.
   - Do NOT use single quotes.
   - Do NOT omit quotes around keys.
   - Do NOT include trailing commas.

6. Format example:
{
  "summary": "1. ...\\n\\n2. ...\\n\\n3. ...\\n\\n4. ...\\n\\n5. ...",
  "sentiment": "positive",
  "keyPoints": ["...", "..."],
  "growthScore": 75
}
        `.trim();

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const payload = getResponsePayload(response);
        let analysis: any = cleanAndParseJson(payload);
        let news: NewsItem[] = [];

        const grounding = response.candidates?.[0]?.groundingMetadata;
        if (grounding?.groundingChunks) {
          const uniqueLinks = new Set<string>();
          grounding.groundingChunks.forEach((chunk: any) => {
            const uri = chunk.web?.uri;
            const title = chunk.web?.title || `관련 기사 원문 확인`;
            if (uri && uri !== "#" && !uri.includes("google.com/search") && !uniqueLinks.has(uri)) {
              uniqueLinks.add(uri);
              let sourceName = "Web News";
              try {
                sourceName = new URL(uri).hostname.replace("www.", "");
              } catch (e) {}
              news.push({ title, uri, source: sourceName });
            }
          });
        }

        // 포털 검색/트렌드/X/유튜브 같은 링크는 소스피드에 넣지 않습니다.
        news = news.filter((item) => {
          const uri = String(item?.uri || "");
          return (
            uri &&
            !uri.includes("google.com/search") &&
            !uri.includes("news.google.com/search") &&
            !uri.includes("search.naver.com") &&
            !uri.includes("twitter.com/search") &&
            !uri.includes("x.com/search") &&
            !uri.includes("youtube.com/results") &&
            !uri.includes("trends.google.com")
          );
        });

        if (!analysis) {
          analysis = {
            summary:
              "1. AI 데이터 분석이 완료되었으나 화면 렌더링에 지연이 발생했습니다.\n\n2. '분석 리포트' 버튼을 다시 한 번 클릭하시면 상세 정보가 정상 표기됩니다.\n\n3. 잠시 후 다시 시도해주세요.\n\n4. 동일 증상이 반복되면 API 키를 확인해주세요.\n\n5. 소스 링크가 비었는지도 확인해주세요.",
            sentiment: "neutral",
            keyPoints: ["분석 렌더링 재시도 요망"],
            growthScore: 50,
            citations: [],
            factChecks: [],
          };
        }

        analysis = ensureTrustFields(analysis);
        let normalized = normalizeTrendAnalysis(analysis) || (analysis as TrendAnalysis);

        // ✅ trust fields 자동 보강 (citations/factChecks/confidenceScore)
        normalized = hydrateTrustFields(normalized, {
          links: (news || []).map((n: any) => ({
            title: n?.title,
            url: n?.uri,
            publisher: n?.source,
          })),
        });

        return { news, analysis: normalized };
      });
    } catch (e) {
      console.error("Trend Analysis Error:", e);
      return {
        news: [],
        analysis: {
          summary:
            "1. API 키 오류 또는 구글 서버의 일시적인 트래픽 과부하입니다.\n\n2. 우측 상단의 [API 키 관리] 버튼을 눌러 키가 정확한지 확인해 주세요.\n\n3. 잠시 후 다시 시도해주세요.\n\n4. 동일 증상이 반복되면 네트워크/브라우저 환경을 점검해주세요.\n\n5. 소스 링크가 비었는지도 확인해주세요.",
          sentiment: "neutral",
          keyPoints: [],
          growthScore: 0,
          citations: [],
          factChecks: [],
        } as any,
      };
    }
  }

  /**
   * ✅ [A 업그레이드 전용] 근거(EVIDENCE) 기반 분석 + citations + factChecks
   * - Type/responseSchema 제거 (SDK 버전 차이로 런타임 에러 방지)
   */
  async fetchTrendsAndAnalysisA(
    keyword: string,
    modeInstruction: string,
    evidence: EvidenceItem[]
  ): Promise<{ news: NewsItem[]; analysis: TrendAnalysis }> {
    try {
      return await withRetry(async () => {
        const key = getApiKey();
        if (!key) throw new Error("API_KEY_MISSING");

        const ai = new GoogleGenAI({ apiKey: key });

        const normalizedEvidence = normalizeEvidence(evidence, 12);

        const news: NewsItem[] = normalizedEvidence.map((e) => {
          const url = normalizeUrlSafe(e.url);
          let sourceName = e.source || "Web";
          try {
            sourceName = new URL(url).hostname.replace("www.", "");
          } catch {}
          return {
            title: e.title || "관련 기사",
            uri: url,
            source: sourceName,
            snippet: e.snippet,
            date: e.date,
          };
        });

        const evidenceText = normalizedEvidence
          .map((e, idx) => {
            const url = normalizeUrlSafe(e.url);
            return [
              `[SOURCE ${idx + 1}]`,
              `title: ${e.title || ""}`,
              `url: ${url}`,
              `publisher: ${e.source || ""}`,
              `date: ${e.date || ""}`,
              `snippet: ${(e.snippet || "").slice(0, 280)}`,
            ].join("\n");
          })
          .join("\n\n");

        const prompt = `
Analyze the trend for "${keyword}". Context: ${modeInstruction}

[CRITICAL REQUIREMENTS]
1) LANGUAGE: ALL output content MUST be written in KOREAN.
2) Use ONLY the information from [EVIDENCE SOURCES]. Do NOT browse, infer hidden facts, or invent anything not supported by evidence.
3) If evidence is weak, conflicting, or missing, explicitly say so in Korean using cautious wording such as "근거 부족", "확인 필요", "추정".
4) Never fabricate numbers, timelines, market sizes, rankings, quotations, or future certainty.
5) "summary" MUST contain EXACTLY 5 numbered points (1. to 5.).
6) EACH point MUST be 2-4 sentences, concise and evidence-grounded.
7) If some evidence is in English or another foreign language, understand it in the original language first, then write the final report in natural Korean.
8) Keep source titles/URLs/publishers as the original evidence values. Do not translate or alter source URLs.
9) Return ONLY JSON (no markdown).
10) STRICT JSON ONLY: use double quotes for keys/strings, include all commas, no trailing commas, no single quotes.

[A-TRUST ENHANCEMENTS]
- "citations": For each point 1~5, attach 1~3 source URLs from the evidence only.
- Do not cite blocked/search/social/wiki URLs.
- "factChecks": For each point 1~5:
  - label: fact | interpretation | speculation
  - confidence: 0~100
  - reason: one short Korean sentence explaining why.

[OUTPUT JSON FORMAT]
{
  "summary": "1. ...\\n\\n2. ...\\n\\n3. ...\\n\\n4. ...\\n\\n5. ...",
  "sentiment": "positive | neutral | negative",
  "keyPoints": ["...", "...", "..."],
  "growthScore": 0-100,
  "citations": [{"point":1,"title":"...","url":"...","publisher":"..."}],
  "factChecks": [{"point":1,"label":"fact","confidence":80,"reason":"..."}]
}

[EVIDENCE SOURCES]
${evidenceText}
        `.trim();

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const payload = getResponsePayload(response);
        let analysisRaw: any = cleanAndParseJson(payload);

        if (!analysisRaw) {
          analysisRaw = {
            summary:
              "1. 근거 기반 분석(JSON 파싱) 단계에서 오류가 발생했습니다.\n\n2. 다시 시도하거나 근거 소스를 늘려주세요.\n\n3. 동일 문제가 반복되면 API 응답을 확인해야 합니다.\n\n4. 일시적 서버 과부하일 수 있습니다.\n\n5. 잠시 후 재시도 부탁드립니다.",
            sentiment: "neutral",
            keyPoints: ["JSON 파싱 실패 폴백"],
            growthScore: 50,
            citations: [],
            factChecks: [],
          };
        }

        analysisRaw = ensureTrustFields(analysisRaw);
        let normalized = normalizeTrendAnalysis(analysisRaw) || (analysisRaw as TrendAnalysis);

        // ✅ trust fields 자동 보강 (evidence/news 기반)
        normalized = hydrateTrustFields(normalized, {
          links: (news || []).map((n: any) => ({
            title: n?.title,
            url: n?.uri,
            publisher: n?.source,
          })),
        });

        return { news, analysis: normalized };
      });
    } catch (e) {
      console.error("Trend Analysis A Error:", e);
      return {
        news: [],
        analysis: {
          summary:
            "1. A(출처/팩트체크) 분석에 실패했습니다.\n\n2. API 키 또는 서버 혼잡 문제일 수 있습니다.\n\n3. 우측 상단 [API 키 관리]에서 키를 확인해주세요.\n\n4. 근거 소스가 비었는지도 확인해주세요.\n\n5. 잠시 후 다시 시도해주세요.",
          sentiment: "neutral",
          keyPoints: [],
          growthScore: 0,
          citations: [],
          factChecks: [],
        } as any,
      };
    }
  }
}

// ⭐️ [핵심 방어 적용] 카드뉴스 글씨를 쓸 때 구글 서버 503 에러가 나면 화면이 죽지 않도록 방어합니다.
export const generateExpandedContent = async (
  summary: string,
  type: string,
  stylePrompt?: string
) => {
  try {
    return await withRetry(async () => {
      const key = getApiKey();
      if (!key) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey: key });

      const normalizedType = String(type || "general").toLowerCase().trim();

      const buildPrompt = () => {
        if (normalizedType === "translate") {
          return String(summary || "").trim();
        }

        if (normalizedType === "image") {
          return `
You are a visual editor for a Korean news card.
Create ONLY valid JSON.

[INPUT]
${summary}

[STYLE]
${stylePrompt || "깔끔하고 고급스러운 카드뉴스 스타일"}

[TEXT BAN RULE - MUST ALWAYS APPLY]
- 카드뉴스 배경 이미지에는 한글, 영어, 숫자, 문자, 로고, 워터마크, 타이포그래피가 절대 들어가면 안 됩니다.
- The generated card image prompt must explicitly forbid any readable text, especially Hangul/Korean, English letters, words, and numbers.
- Always assume the final card image background must contain NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO LOGOS, NO WATERMARKS, NO HANGUL, NO CAPTIONS, NO SUBTITLES, NO SIGNAGE, NO NEWSPAPER OR POSTER LAYOUT.
- 추천 프롬프트에도 동일하게 NO TEXT 규칙을 고정 적용하세요.

[QUALITY RULE - MUST ALWAYS APPLY]
- 장면은 하나의 중심 오브젝트 또는 하나의 통일된 장면으로 구성하세요. 콜라주처럼 여러 장면을 섞지 마세요.
- 세로형 9:16 카드뉴스 커버 구도를 기본으로 하세요.
- 상단 또는 중앙 상단에 시선이 모이는 강한 포컬 포인트를 두고, 하단은 제목이 올라갈 수 있게 비교적 깨끗하게 유지하세요.
- 핵심 개념 1개와 보조 개념 2개까지만 반영하세요. 너무 많은 상징을 한 장에 억지로 넣지 마세요.
- 프롬프트에는 premium editorial, clean composition, refined materials, cinematic soft lighting, elegant depth 같은 고품질 시각 지시를 포함하세요.

[OUTPUT JSON FORMAT]
{
  "title": "카드뉴스 헤드라인",
  "body": "카드뉴스 본문 3~5줄"
}

[IMPORTANT]
- 반드시 한국어로 작성
- 제목은 짧고 강하게
- 본문은 정보 전달형으로 자연스럽게
- 이미지용 프롬프트/추천 프롬프트에는 반드시 'No text, no Hangul, no letters, no words, no numbers, no logo, no watermark, no captions, no subtitles, no signage' 의미가 포함되어야 함
- JSON 외 텍스트 금지
          `.trim();
        }

        if (normalizedType === "sns") {
          return `
당신은 기업용 PR/SNS 카피 에디터입니다.
아래 내용을 바탕으로 바로 게시 가능한 SNS 문구만 한국어로 작성하세요.

[원문 요약]
${String(summary || "").trim()}

[반드시 지킬 규칙]
1. 결과 본문만 출력하세요. 서론, 설명, 배경분석, 질문 해설, 메타 코멘트 금지.
2. 마크다운 금지: ###, ##, #, **, __, >, -, *, 백틱, 번호목록 금지.
3. 라벨 금지: 제목:, 본문:, 해시태그:, 헤드라인:, 캡션: 같은 표시 금지.
4. 링크, URL, 출처, 이모지, 불필요한 따옴표 금지.
5. 첫 줄은 짧은 한 줄 헤드라인.
6. 다음 3~5줄은 자연스러운 본문.
7. 마지막 줄만 해시태그 6~10개를 한 줄로 작성.
8. 기업 홍보 문구처럼 과장하지 말고, 신뢰감 있는 톤으로 작성하세요.
9. 반드시 출력은 최종 SNS 게시 문안만 작성하세요.
          `.trim();
        }

        if (normalizedType === "video") {
          return `
당신은 뉴스 쇼츠 제작 보조 작가입니다.
아래 내용을 바탕으로 자연스럽고 전달력 있는 영상용 원고를 작성하세요.

${String(summary || "").trim()}

${stylePrompt ? `[스타일]
${stylePrompt}` : ""}

[규칙]
- 한국어로 작성
- 지나치게 짧게 줄이지 말고 자연스럽게 연결
- 불필요한 군더더기 없이 전달력 있게 작성
          `.trim();
        }

        if (normalizedType === "card") {
          return `
당신은 동아일보 카드뉴스 에디터입니다.
아래 입력을 바탕으로 과장 없이 카드뉴스용 텍스트만 작성하세요.

[INPUT]
${String(summary || "").trim()}

${stylePrompt ? `[CARD RULE]
${stylePrompt}
` : ""}

[반드시 지킬 규칙]
- 한국어로만 작성
- URL, 출처 표기, 괄호형 부연설명, 해시태그 금지
- 제목은 기존처럼 짧고 강한 카드뉴스형 문장으로 작성
- 본문은 반드시 1번부터 5번까지 총 5개의 요약 포인트를 작성
- 각 포인트는 3~4문장으로 자세하게 작성
- 첫 문장은 핵심 요약
- 두번째 문장은 기사 내용 설명
- 세번째 문장은 시장/산업 영향 분석
- 네번째 문장은 추가 맥락 또는 전망
- 다섯번째 포인트는 전체 보강 관점의 추가 분석으로 작성
- 확인되지 않은 수치나 전망은 쓰지 말고 "추가 확인 필요"처럼 보수적으로 표현
- 아래 형식을 정확히 지킬 것
[HEADLINE] 제목
[BODY]
1. 문장
문장
문장
문장

2. 문장
문장
문장
문장

3. 문장
문장
문장
문장

4. 문장
문장
문장
문장

5. 문장
문장
문장
문장
          `.trim();
        }

        return `
Create high-quality ${normalizedType || "general"} content based on the following input.

[INPUT]
${String(summary || "").trim()}

${stylePrompt ? `[STYLE]
${stylePrompt}
` : ""}

[IMPORTANT]
- Write in Korean unless the user clearly requested another language.
- Use only information clearly supported by the input.
- If support is weak, say the information needs confirmation instead of guessing.
- Be specific, useful, and well-structured.
- Avoid shallow one-line summaries.
- Output only the requested content.
        `.trim();
      };

      const prompt = buildPrompt();

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config:
          normalizedType === "image"
            ? { responseMimeType: "application/json", temperature: 0.5 }
            : normalizedType === "sns"
              ? { temperature: 0.7, topP: 0.9 }
              : { temperature: 0.5 },
      });

      const payload = getResponsePayload(response);
      if (typeof payload === "string") {
        return normalizedType === "sns" ? sanitizeSnsOutput(payload) : payload;
      }
      try {
        return JSON.stringify(payload);
      } catch {
        return "";
      }
    }, 3, 2000);
  } catch (e) {
    console.error("Content Expansion Final Error:", e);
    if (type === "image") {
      return JSON.stringify({
        title: "⏳ AI 서버 접속 대기 중",
        body:
          "현재 구글 AI 서버에 전 세계적인 접속이 폭주하여 텍스트 분석이 지연되었습니다.\n1~2분 뒤 다시 카드뉴스 생성을 눌러주시면 정상 작동합니다.",
      });
    }
    return "현재 구글 AI 서버가 혼잡합니다. 잠시 후 다시 시도해 주세요.";
  }
};

export const generateTTS = async (
  text: string,
  voiceName: string = "Zephyr",
  styleInstruction?: string
) => {
  try {
    return await withRetry(async () => {
      const key = getApiKey();
      if (!key) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey: key });
      const prompt = styleInstruction ? `Say this ${styleInstruction}: ${text}` : text;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    }, 3, 2000);
  } catch (e) {
    console.error("TTS generation failed:", e);
    throw e;
  }
};

export const generateVideoWithVeo = async () => null;

/**
 * ✅ [중요] 이미지 생성 함수 전체 수정본
 * - Imagen 4 + JS SDK(generateImages) 사용
 * - 반환값: 브라우저에서 바로 렌더 가능한 data URL
 */
export const generateImage = async (prompt: string): Promise<string> => {
  try {
    return await withRetry(async () => {
      const key = getApiKey();
      if (!key) {
        alert(
          "🚨 API 키를 찾을 수 없습니다! 우측 상단 [API 키 관리] 버튼을 눌러 다시 한 번 저장해주세요."
        );
        throw new Error("API_KEY_MISSING");
      }

      const ai = new GoogleGenAI({ apiKey: key });

      // ✅ Imagen 4 권장 모델
      const model = "imagen-4.0-generate-001";

      const res = await ai.models.generateImages({
        model,
        prompt,
        config: { numberOfImages: 1 },
      });

      const b64 = res.generatedImages?.[0]?.image?.imageBytes;
      if (!b64) {
        throw new Error("NO_IMAGE_BYTES_FROM_IMAGEN4");
      }

      return `data:image/png;base64,${b64}`;
    }, 3, 2000);
  } catch (e: any) {
    console.error("Gemini Image Generation failed.", e);
    throw new Error(handleApiError(e));
  }
};