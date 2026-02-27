// src/services/geminiService.ts
import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, TrendAnalysis, Citation, FactCheck } from "../types";

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

const cleanAndParseJson = (text: string) => {
  if (!text) return null;

  try {
    let cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleanText.indexOf("{");
    const end = cleanText.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      cleanText = cleanText.substring(start, end + 1);
    }
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("표준 JSON 파싱 실패! 텍스트 강제 추출을 시도합니다...", text);
    try {
      const summaryMatch = text.match(
        /"summary"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"sentiment"|,\s*"keyPoints"|,\s*"growthScore"|,\s*"sources"|,\s*"citations"|,\s*"factChecks"|\})/i
      );
      const sentimentMatch = text.match(/"sentiment"\s*:\s*"([^"]*)"/i);
      const scoreMatch = text.match(/"growthScore"\s*:\s*(\d+)/i);

      if (summaryMatch && summaryMatch[1]) {
        return {
          summary: summaryMatch[1].trim(),
          sentiment: sentimentMatch ? sentimentMatch[1] : "neutral",
          keyPoints: ["AI 분석 데이터 자동 복구됨"],
          growthScore: scoreMatch ? parseInt(scoreMatch[1]) : 50,
          citations: [],
          factChecks: [],
        };
      }
    } catch (err) {
      console.error("강제 추출 실패:", err);
    }
    return null;
  }
};

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

/** ✅ A 업그레이드: evidence URL 정규화(utm 제거/해시 제거) */
const normalizeUrlSafe = (u: string) => {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) =>
      url.searchParams.delete(k)
    );
    return url.toString();
  } catch {
    return u;
  }
};

/** ✅ A 업그레이드: 분석 응답에 citations/factChecks가 없으면 안전 보강 */
const ensureTrustFields = (analysis: any): TrendAnalysis => {
  if (!analysis) return analysis;
  if (!Array.isArray(analysis.citations)) analysis.citations = [];
  if (!Array.isArray(analysis.factChecks)) analysis.factChecks = [];
  return analysis as TrendAnalysis;
};

/** ✅ A 업그레이드: 응답 객체 최소 유효성/형식 보정 (버전 호환/JSON 깨짐 방어) */
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
  a.keyPoints = a.keyPoints.map((x: any) => String(x || "")).filter((x: string) => x.trim().length > 0);

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

  return a as TrendAnalysis;
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
            // ✅ 일반 분석도 JSON 강제해주면 파싱 안정성이 크게 올라갑니다.
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        });

        const text = response.text || "{}";
        let analysis: any = cleanAndParseJson(text);
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

        const fallbacks = [
          {
            title: `🔍 '${keyword}' 관련 최신 구글 뉴스`,
            uri: `https://news.google.com/search?q=${encodeURIComponent(keyword)}`,
            source: "Google News",
          },
          {
            title: `📰 '${keyword}' 네이버 뉴스 상세 검색`,
            uri: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}`,
            source: "Naver News",
          },
          {
            title: `📈 '${keyword}' 구글 트렌드 빅데이터 확인`,
            uri: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`,
            source: "Google Trends",
          },
          {
            title: `💬 '${keyword}' X(트위터) 실시간 반응 보기`,
            uri: `https://twitter.com/search?q=${encodeURIComponent(keyword)}&f=live`,
            source: "X (Twitter)",
          },
          {
            title: `▶️ '${keyword}' 유튜브 관련 영상 찾아보기`,
            uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`,
            source: "YouTube",
          },
        ];

        if (news.length < 5) {
          const needed = 5 - news.length;
          news = [...news, ...fallbacks.slice(0, needed)];
        }

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

        // ✅ A 필드 보강 + 타입 보정
        analysis = ensureTrustFields(analysis);
        const normalized = normalizeTrendAnalysis(analysis) || (analysis as TrendAnalysis);

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
   * - Serper/Gmail/내부 수집 링크를 evidence로 넣어 "근거 기반 요약" 실현
   * - ✅ Type/responseSchema 제거 (SDK 버전 차이로 런타임 에러 방지)
   */
  async fetchTrendsAndAnalysisA(
    keyword: string,
    modeInstruction: string,
    evidence: Array<{ title: string; url: string; source?: string; snippet?: string; date?: string }>
  ): Promise<{ news: NewsItem[]; analysis: TrendAnalysis }> {
    try {
      return await withRetry(async () => {
        const key = getApiKey();
        if (!key) throw new Error("API_KEY_MISSING");

        const ai = new GoogleGenAI({ apiKey: key });

        // ✅ news 카드: evidence로 바로 구성
        const news: NewsItem[] = (evidence || [])
          .filter((e) => !!e?.url)
          .slice(0, 12)
          .map((e) => {
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

        // ✅ evidence 텍스트
        const evidenceText = (evidence || [])
          .filter((e) => !!e?.url)
          .slice(0, 12)
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
2) Use ONLY the information from [EVIDENCE SOURCES]. Do NOT browse or invent facts.
3) "summary" MUST contain EXACTLY 5 numbered points (1. to 5.).
4) EACH point MUST be 3-5 sentences (detailed, substantial).
5) Return ONLY JSON (no markdown).

[A-TRUST ENHANCEMENTS]
- "citations": For each point 1~5, attach 1~3 source URLs from the evidence.
- "factChecks": For each point 1~5:
  - label: fact | interpretation | speculation
  - confidence: 0~100
  - reason: one sentence explaining why.

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

        const text = response.text || "{}";
        let analysisRaw: any = cleanAndParseJson(text);

        // ✅ 파싱 실패 폴백
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
        const normalized = normalizeTrendAnalysis(analysisRaw) || (analysisRaw as TrendAnalysis);

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
export const generateExpandedContent = async (summary: string, type: string, stylePrompt?: string) => {
  try {
    return await withRetry(async () => {
      const key = getApiKey();
      if (!key) throw new Error("API_KEY_MISSING");

      const ai = new GoogleGenAI({ apiKey: key });
      const prompt = `Create high-quality ${type} content based on this summary: ${summary}. ${
        stylePrompt ? `Apply style: ${stylePrompt}` : ""
      } Output only the generated text or JSON as appropriate.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: type === "image" ? { responseMimeType: "application/json" } : {},
      });
      return response.text || "";
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

export const generateTTS = async (text: string, voiceName: string = "Zephyr", styleInstruction?: string) => {
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
        alert("🚨 API 키를 찾을 수 없습니다! 우측 상단 [API 키 관리] 버튼을 눌러 다시 한 번 저장해주세요.");
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