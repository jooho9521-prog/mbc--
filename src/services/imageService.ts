import { GoogleGenAI, Modality } from "@google/genai";

/**
 * ✅ 브라우저에서 API 키를 최대한 찾아내는 함수 (기존 유지)
 */
const getGeminiApiKey = () => {
  let key = "";
  try { key = localStorage.getItem("gemini_api_key") || ""; } catch (e) {}
  if (!key) {
    try {
      key =
        (window as any).process?.env?.GEMINI_API_KEY ||
        (window as any).process?.env?.API_KEY ||
        "";
    } catch (e) {}
  }
  if (!key) {
    try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch (e) {}
  }
  return key.trim();
};

/**
 * ✅ 최후 폴백: "절대 안 비는" 기본 썸네일 (SVG data URL)
 */
const makeDefaultThumbnailDataUrl = (title: string) => {
  const safe = (title || "TREND")
    .slice(0, 24)
    .replace(/[<>&"]/g, "")
    .trim() || "TREND";

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#111827"/>
        <stop offset="1" stop-color="#0f766e"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="22" flood-opacity="0.28"/>
      </filter>
    </defs>

    <rect width="100%" height="100%" fill="url(#g)"/>

    <g filter="url(#shadow)">
      <rect x="70" y="140" rx="30" ry="30" width="940" height="560" fill="rgba(255,255,255,0.10)"/>
    </g>

    <text x="110" y="240" font-size="60" fill="white" font-family="Arial, sans-serif" font-weight="700">
      동아일보 프로젝트 B
    </text>

    <text x="110" y="340" font-size="42" fill="white" font-family="Arial, sans-serif" opacity="0.92">
      이미지 생성 실패 (자동 대체)
    </text>

    <text x="110" y="485" font-size="56" fill="white" font-family="Arial, sans-serif" font-weight="800">
      ${safe}
    </text>

    <text x="110" y="585" font-size="30" fill="white" font-family="Arial, sans-serif" opacity="0.8">
      Gemini/무료 엔진 장애 시 기본 썸네일 표시
    </text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * ✅ (선택) 한국어 → 짧은 영어 키워드 변환 (이미지 생성 안정성 ↑)
 */
const translateToEnglishKeyword = async (keyword: string, key: string): Promise<string> => {
  try {
    if (!key) return keyword;
    const ai = new GoogleGenAI({ apiKey: key });

    const res = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents:
        `Translate to English keywords for image generation: "${keyword}". ` +
        `Return 2-6 English words only. No punctuation. No quotes.`,
    });

    const cleaned = (res.text || "")
      .replace(/[^a-zA-Z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleaned || keyword;
  } catch {
    return keyword;
  }
};

/**
 * ✅ 핵심: Imagen 대신 "Gemini 자체 이미지 생성 모델"로 생성
 * - AI Studio 키로 동작하는 케이스가 많고,
 * - 응답에 inlineData(image base64)가 포함됨
 */
const generateWithGeminiNativeImage = async (prompt: string, apiKey: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });

  // ✅ 모델 후보 (하나가 막혀도 다음으로)
  const models = [
    "gemini-2.5-flash-image",
    "gemini-3-pro-image-preview",
  ];

  let lastErr: any = null;

  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          // ✅ 이미지 응답 필수
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        },
      });

      const parts = res.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p: any) => p?.inlineData?.data);
      const b64 = imgPart?.inlineData?.data;
      const mime = imgPart?.inlineData?.mimeType || "image/png";

      if (!b64) throw new Error("NO_IMAGE_INLINE_DATA");

      return `data:${mime};base64,${b64}`;
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️ Gemini image model failed: ${model}`, e);
    }
  }

  throw lastErr || new Error("GEMINI_IMAGE_ALL_MODELS_FAILED");
};

/**
 * ✅ 무료 엔진: Pollinations (불안정하지만 무료 AI)
 */
const makePollinationsUrl = (prompt: string, seed: number) => {
  const finalPrompt =
    `Photorealistic vertical background image only. ` +
    `Subject: ${prompt}. ` +
    `Cinematic editorial look, natural lighting, high detail, sharp focus. ` +
    `NO text, NO logo, NO watermark, NO letters, NO banner, NO frame.`;

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1080&height=1920&nologo=true&seed=${seed}`;
};

const fetchImageAsDataUrl = async (url: string, timeoutMs = 20000): Promise<string> => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal, mode: "cors" });
    if (!resp.ok) throw new Error(`HTTP_${resp.status}`);

    const blob = await resp.blob();
    if (!blob || blob.size < 20000) throw new Error("BLOB_TOO_SMALL");

    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("FILE_READER_ERROR"));
      reader.readAsDataURL(blob);
    });

    return dataUrl;
  } finally {
    clearTimeout(t);
  }
};

const generateWithPollinationsHardRetry = async (prompt: string, maxAttempts = 12): Promise<string> => {
  let delay = 1200;

  for (let i = 1; i <= maxAttempts; i++) {
    const seed = Math.floor(Math.random() * 1_000_000);
    const url = makePollinationsUrl(prompt, seed);

    try {
      console.log(`🟡 Pollinations attempt ${i}/${maxAttempts}`);
      const dataUrl = await fetchImageAsDataUrl(url, 20000);
      console.log("🟢 Pollinations success");
      return dataUrl;
    } catch (e: any) {
      console.warn(`🔴 Pollinations failed (${i}/${maxAttempts}):`, String(e?.message || e));
      await sleep(delay);
      delay = Math.min(delay * 1.8, 12000);
    }
  }

  throw new Error("POLLINATIONS_ALL_ATTEMPTS_FAILED");
};

/**
 * ✅ 최종 함수
 * 1) Gemini(이미지 가능한 모델)로 생성 → 성공하면 dataURL 반환
 * 2) 실패하면 Pollinations(무료) 재시도 → dataURL 반환
 * 3) 그래도 실패하면 기본 썸네일 dataURL
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string> => {
  const geminiKey = getGeminiApiKey();
  if (!prompt || !prompt.trim()) return makeDefaultThumbnailDataUrl("EMPTY");

  const englishKeyword = geminiKey ? await translateToEnglishKeyword(prompt, geminiKey) : prompt;

  // ✅ 프롬프트를 "배경 이미지용"으로 정리
  const finalPrompt =
    `${englishKeyword}. ${stylePrompt || ""} `.trim() +
    ` Clean composition, background only, no text, no logo, no watermark, no banner, no frame.`;

  // 1) ✅ Gemini native image generation (가장 우선)
  if (geminiKey) {
    try {
      const dataUrl = await generateWithGeminiNativeImage(finalPrompt, geminiKey);
      console.log("✅ Gemini native image success");
      return dataUrl;
    } catch (e: any) {
      console.warn("⚠️ Gemini native image failed → Pollinations fallback", e?.message || e);
    }
  }

  // 2) Pollinations hard retry
  try {
    const dataUrl = await generateWithPollinationsHardRetry(finalPrompt, 12);
    return dataUrl;
  } catch (e) {
    console.warn("⚠️ Pollinations failed → default thumbnail", e);
    return makeDefaultThumbnailDataUrl(prompt);
  }
};

export const generateVideoFromImage = async () => null;