// src/services/imageService.ts
// ✅ AI 이미지 생성 "강제" 버전 (fallback 없음)
// - Imagen 4만 사용합니다.
// - 실패 시에도 다른 엔진(Pollinations 등)으로 대체하지 않고 에러를 그대로(친절한 메시지로) 반환합니다.

import { GoogleGenAI, Modality } from "@google/genai";

/** 브라우저에서 API 키 탐색 (프로젝트 규칙 유지) */
const getGeminiApiKey = () => {
  let key = "";
  try { key = localStorage.getItem("gemini_api_key") || ""; } catch {}
  if (!key) {
    try {
      key =
        (window as any).process?.env?.GEMINI_API_KEY ||
        (window as any).process?.env?.API_KEY ||
        "";
    } catch {}
  }
  if (!key) {
    try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch {}
  }
  return String(key || "").trim();
};

const extractErrorMessage = (error: any): string => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  const apiError = error?.error || error;
  if (apiError?.message) return apiError.message;
  try { return JSON.stringify(error); } catch { return String(error); }
};


const IMAGE_QUALITY_GUARDRAIL = `
[QUALITY GUARDRAIL]
- Produce a premium, high-clarity, highly polished editorial image.
- Use a single coherent hero scene instead of a collage.
- Keep a strong focal point and clean negative space.
- Preserve strict 9:16 vertical cover composition with a headline-safe area.
- Avoid busy layouts, split panels, infographic feel, newspaper feel, or screenshot feel.
- Absolutely no readable text: no Hangul, no Korean letters, no English letters, no words, no numbers, no logo, no watermark, no UI, no labels, no signage.
`.trim();

const mergeImagePrompts = (prompt: string, stylePrompt?: string) => {
  return [prompt, stylePrompt || "", IMAGE_QUALITY_GUARDRAIL]
    .filter(Boolean)
    .join("\n\n");
};

const humanizeImageError = (error: any): string => {
  const msg = extractErrorMessage(error);
  const lower = msg.toLowerCase();
  const status = error?.status || error?.code;

  // 권한/키/플랜
  if (
    lower.includes("api key") ||
    lower.includes("api_key_missing") ||
    lower.includes("permission") ||
    lower.includes("permission_denied") ||
    lower.includes("forbidden") ||
    status === 401 ||
    status === 403
  ) {
    return "이미지 생성 권한이 없습니다. (401/403)\n- 프로젝트에 Gemini API 키가 필요합니다. 우측 상단 [API 키 관리]에서 키를 저장해주세요.\n- 또는 해당 키/프로젝트에 Imagen 사용 권한/과금(Billing)이 활성화되어야 합니다.";
  }

  // 쿼터/레이트리밋
  if (
    status === 429 ||
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("rate") ||
    lower.includes("too many") ||
    lower.includes("resource_exhausted")
  ) {
    return "이미지 생성 요청이 너무 많아 제한(429/Quota)에 걸렸습니다.\n- 버튼 연타/자동재시도를 줄이세요.\n- 1~2분 후 다시 시도하거나, 다른 키/플랜(과금)으로 진행해야 합니다.";
  }

  // 서버 혼잡
  if (
    status === 503 ||
    lower.includes("503") ||
    lower.includes("overloaded") ||
    lower.includes("unavailable")
  ) {
    return "현재 Google 이미지 생성 서버가 혼잡(503)합니다. 잠시 후 다시 시도해주세요.";
  }

  // 기타
  return msg.length > 220 ? msg.slice(0, 220) + "..." : msg;
};

/** 간단 재시도: 503만 2회 재시도 (429는 악화되므로 재시도 금지) */
const withRetry503 = async <T,>(fn: () => Promise<T>, retries = 2, delayMs = 1200): Promise<T> => {
  try {
    return await fn();
  } catch (e: any) {
    const msg = extractErrorMessage(e).toLowerCase();
    const status = e?.status || e?.code;

    const is429 =
      status === 429 ||
      msg.includes("429") ||
      msg.includes("quota") ||
      msg.includes("rate") ||
      msg.includes("too many") ||
      msg.includes("resource_exhausted");

    // ✅ 429는 절대 재시도 금지
    if (is429) throw e;

    const is503 =
      status === 503 ||
      msg.includes("503") ||
      msg.includes("overloaded") ||
      msg.includes("unavailable");

    if (retries > 0 && is503) {
      await new Promise((r) => setTimeout(r, delayMs));
      return withRetry503(fn, retries - 1, Math.min(Math.floor(delayMs * 1.7), 7000));
    }

    throw e;
  }
};

/**
 * ✅ 최종: "AI 이미지"만 사용 (외부 무료엔진/대체썸네일 없음)
 * - 1) Gemini 이미지 모델(권장: AI Studio/브라우저에서 권한이 열려있는 경우가 많음)
 * - 2) Imagen 4 (권한/과금/프로젝트 설정 필요할 수 있음)
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string> => {
  const key = getGeminiApiKey();
  if (!key) {
    // 사용자가 "무조건 생성"을 원하면: fallback 없이 즉시 실패 처리
    throw new Error(
      "API 키가 없어 Imagen(구글 AI 이미지)을 호출할 수 없습니다.\n" +
      "우측 상단 [API 키 관리]에서 Gemini API 키를 저장한 뒤 다시 시도해주세요."
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const p = String(prompt || "").trim();
    if (!p) throw new Error("EMPTY_PROMPT");

    const ratioPrompt = `
[IMAGE FORMAT REQUIREMENT]
- Create the image in a strict 9:16 vertical composition for YouTube Shorts.
- The intended final canvas is 1080x1920.
- Keep the main subject, headline-safe area, and important visual elements inside the center safe area.
- Do not place critical objects near the extreme top/bottom/left/right edges.
- Full-length vertical poster composition, smartphone-friendly.
`.trim();

    const mergedPrompt = [p, stylePrompt || "", ratioPrompt].filter(Boolean).join("\n\n");

    // 1) ✅ Gemini 이미지 모델 (AI-only)
    // - SDK/권한 정책에 따라 동작 모델명이 바뀔 수 있어 2개 후보로 시도
    const geminiImageModels = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"];

    for (const model of geminiImageModels) {
      try {
        const res = await withRetry503(async () => {
          return ai.models.generateContent({
            model,
            contents: [{ parts: [{ text: mergedPrompt }] }],
            config: {
              responseModalities: [Modality.IMAGE],
            },
          });
        }, 1, 900);

        const parts = res.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find((x: any) => x?.inlineData?.data);
        const b64 = imgPart?.inlineData?.data;
        const mime = imgPart?.inlineData?.mimeType || "image/png";
        if (!b64) throw new Error("NO_IMAGE_INLINE_DATA");
        return `data:${mime};base64,${b64}`;
      } catch (e) {
        console.warn(`[imageService] Gemini image model failed: ${model}`, e);
      }
    }

    // 2) ✅ Imagen 4 (AI-only)
    return await withRetry503(async () => {
      const res = await ai.models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt: mergedPrompt,
        config: { numberOfImages: 1 },
      });

      const b64 = res.generatedImages?.[0]?.image?.imageBytes;
      if (!b64) throw new Error("NO_IMAGE_BYTES_FROM_IMAGEN4");
      return `data:image/png;base64,${b64}`;
    }, 2, 1200);
  } catch (e: any) {
    console.error("[imageService] AI-only image generation failed:", e);
    throw new Error(humanizeImageError(e));
  }
};

export const generateVideoFromImage = async () => null;
