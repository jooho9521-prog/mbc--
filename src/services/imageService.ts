import { GoogleGenAI } from "@google/genai";
import { withRetry, handleApiError } from "./geminiService";

// 메모리 캐시: 똑같은 검색어는 0.1초 만에 바로 띄웁니다.
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

// 한글을 짧은 영어 키워드로 번역 (이미지 정확도 상승)
const translateToEnglishKeyword = async (keyword: string, key: string): Promise<string> => {
  try {
    if(!key) return "trend";
    const ai = new GoogleGenAI({ apiKey: key });
    const transRes = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract the main visual subject from this text and translate it into a concise 1-2 word English keyword. Text: "${keyword}". Output ONLY the English words.`,
    });
    return transRes.text ? transRes.text.replace(/[^a-zA-Z0-9 ]/g, '').trim() : "trend";
  } catch (e) {
    return "trend";
  }
};

/**
 * 👑 3중 철통 방어 이미지 생성 로직
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

      // ----------------------------------------------------
      // [1단계] 구글 Imagen 3 시도 (성공 시 최고 화질)
      // ----------------------------------------------------
      if (key) {
        try {
          const finalPrompt = `A high-quality, cinematic, vertical background image representing ${englishKeyword}. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''}`;
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
          console.warn("1단계 구글 API 권한 없음.");
        }
      }

      // ----------------------------------------------------
      // [2단계] 무료 AI (Pollinations) 시도 (현재 530 에러 발생 구간)
      // ----------------------------------------------------
      if (!base64Result) {
        try {
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishKeyword + " minimal background")}?width=1080&height=1920&nologo=true`;
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
          console.warn("2단계 무료 AI 서버 폭주(530) 에러 발생.");
        }
      }

      // ----------------------------------------------------
      // [3단계] 최후의 보루: 형체를 없앤 고급 블러(Blur) 감성 그라데이션!
      // ----------------------------------------------------
      if (!base64Result) {
        console.log("🚀 3단계: AI 서버 셧다운 대비 - 고급 블러 그라데이션 배경 생성");
        const safeSeed = encodeURIComponent(englishKeyword.replace(/\s/g, ''));
        // blur=10 을 주어 사물의 형태(예: 빅벤)를 완전히 뭉개버리고 예쁜 색감만 남깁니다!
        const picsumUrl = `https://picsum.photos/seed/${safeSeed}/1080/1920?blur=10`;
        const picResponse = await fetchWithTimeout(picsumUrl, {}, 10000);
        const picBlob = await picResponse.blob();
        
        base64Result = await new Promise((resolve, reject) => {
           const reader = new FileReader();
           reader.onloadend = () => resolve(reader.result as string);
           reader.onerror = reject;
           reader.readAsDataURL(picBlob);
        });
      }

      if (!base64Result) throw new Error("모든 이미지 생성 방식이 실패했습니다.");

      imageCache.set(cacheKey, base64Result);
      return base64Result;

    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      throw new Error("이미지 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.");
    }
  });
};

export const generateVideoFromImage = async (imageBase64: string, prompt: string): Promise<string | null> => {
  return null;
};