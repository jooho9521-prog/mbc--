import { GoogleGenAI } from "@google/genai";
import { withRetry, handleApiError } from "./geminiService";

// 메모리 캐시: 똑같은 검색어는 서버에 묻지 않고 0.1초 만에 띄웁니다.
const imageCache = new Map<string, string>();

const getApiKey = () => {
  let key = "";
  try { key = localStorage.getItem('gemini_api_key') || ""; } catch (e) {}
  if (!key) { try { key = (window as any).process?.env?.GEMINI_API_KEY || (window as any).process?.env?.API_KEY || ""; } catch (e) {} }
  if (!key) { try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch (e) {} }
  return key.trim();
};

// 타임아웃 래퍼: 서버가 고장나서 무한 로딩되는 것을 10초 만에 끊어냅니다.
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// ⭐️ 한글을 짧고 핵심적인 영어 키워드로 번역 (이미지 정확도 100% 상승)
const translateToEnglishKeyword = async (keyword: string, key: string): Promise<string> => {
  try {
    if(!key) return "global trend";
    const ai = new GoogleGenAI({ apiKey: key });
    const transRes = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract the main visual subject from this text and translate it into a concise 1-2 word English keyword. Text: "${keyword}". Output ONLY the English words.`,
    });
    return transRes.text ? transRes.text.replace(/[^a-zA-Z0-9 ]/g, '').trim() : "global trend";
  } catch (e) {
    return "global trend";
  }
};

/**
 * 👑 주제와 100% 일치하는 고품질 AI 이미지만을 생성하는 로직
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  const cacheKey = `${prompt}_${stylePrompt || 'default'}`;
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  return withRetry(async () => {
    try {
      const key = getApiKey();
      let englishKeyword = prompt;
      if (key) {
         englishKeyword = await translateToEnglishKeyword(prompt, key);
      }

      let base64Result = "";
      // ⭐️ 무조건 검색어에 맞는 깔끔한 세로형 배경이 나오도록 프롬프트 강화
      const finalPrompt = `A high-quality, cinematic, vertical background image representing ${englishKeyword}. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''}`;

      // ----------------------------------------------------
      // [1단계] 구글 공식 최고 성능 모델 (Imagen 3) 시도
      // ----------------------------------------------------
      if (key) {
        try {
          const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: finalPrompt }],
              parameters: { sampleCount: 1, outputOptions: { mimeType: "image/jpeg" } }
            })
          }, 10000);

          if (response.ok) {
            const data = await response.json();
            const bytes = data.predictions?.[0]?.bytesBase64Encoded;
            if (bytes) base64Result = `data:image/jpeg;base64,${bytes}`;
          }
        } catch (e) {
          console.warn("1단계 구글 API 접근 불가 또는 지연. 대체 AI로 넘어갑니다.");
        }
      }

      // ----------------------------------------------------
      // [2단계] 구글 API 실패 시, 무료 대체 AI (Pollinations) 시도
      // 검색어(englishKeyword)를 그대로 전달하여 무조건 관련된 이미지만 뽑아냅니다.
      // ----------------------------------------------------
      if (!base64Result) {
        console.log(`🚀 주제 매칭 AI 시도 중... 렌더링 키워드: ${englishKeyword}`);
        try {
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1080&height=1920&nologo=true`;
          const fallbackResponse = await fetchWithTimeout(fallbackUrl, {}, 10000);
          if (fallbackResponse.ok) {
            const blob = await fallbackResponse.blob();
            base64Result = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch (e) {
          console.warn("2단계 무료 AI 서버 폭주 또는 지연 발생.");
        }
      }

      // ----------------------------------------------------
      // [오류 처리] 두 AI 서버가 모두 뻗었을 경우 엉뚱한 사진 대신 에러 반환
      // ----------------------------------------------------
      if (!base64Result) {
        throw new Error("모든 이미지 AI 서버가 응답하지 않습니다.");
      }

      // 성공한 이미지는 캐시에 저장하여 다음번에 빛의 속도로 불러옵니다.
      imageCache.set(cacheKey, base64Result);
      return base64Result;

    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      // 엉뚱한 이미지를 보여주는 대신 깔끔하게 에러 처리
      throw new Error("AI 이미지 서버에 트래픽이 몰려 생성이 지연되고 있습니다. 잠시 후 다시 시도해주세요.");
    }
  });
};

export const generateVideoFromImage = async (imageBase64: string, prompt: string): Promise<string | null> => {
  return null;
};