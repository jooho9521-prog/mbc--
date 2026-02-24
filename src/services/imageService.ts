import { GoogleGenAI } from "@google/genai";
import { withRetry, handleApiError } from "./geminiService";

// ⭐️ [고급 기술 1] 메모리 캐시: 이미 생성한 이미지를 기억해두어 0.1초 만에 재로딩합니다.
const imageCache = new Map<string, string>();

const getApiKey = () => {
  let key = "";
  try { key = localStorage.getItem('gemini_api_key') || ""; } catch (e) {}
  if (!key) { try { key = (window as any).process?.env?.GEMINI_API_KEY || (window as any).process?.env?.API_KEY || ""; } catch (e) {} }
  if (!key) { try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch (e) {} }
  return key.trim();
};

// ⭐️ [고급 기술 2] 타임아웃 래퍼: 서버가 15초 이상 응답이 없으면 무한 로딩을 강제 차단합니다.
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 15000) => {
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

// ⭐️ [고급 기술 3-1] 모듈화: 번역 기능 독립
const translateToEnglishKeyword = async (keyword: string, key: string): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const transRes = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract the main visual subject from this text and translate it into a concise 2-3 word English keyword for image generation. Text: "${keyword}". Output ONLY the English words.`,
    });
    return transRes.text ? transRes.text.replace(/[^a-zA-Z0-9 ]/g, '').trim() : keyword;
  } catch (e) {
    console.warn("영어 변환 모듈 지연, 원본 키워드를 사용합니다.");
    return keyword;
  }
};

/**
 * 👑 최종 이미지 생성 메인 로직
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  // 1. 캐시 체크: 똑같은 프롬프트면 서버에 묻지 않고 즉시 반환
  const cacheKey = `${prompt}_${stylePrompt || 'default'}`;
  if (imageCache.has(cacheKey)) {
    console.log("⚡ 캐시된 이미지를 0.1초 만에 불러옵니다!");
    return imageCache.get(cacheKey)!;
  }

  return withRetry(async () => {
    try {
      const key = getApiKey();
      if (!key) throw new Error("API_KEY_MISSING");

      // 2. 키워드 정제 및 프롬프트 빌드
      const englishKeyword = await translateToEnglishKeyword(prompt, key);
      const finalPrompt = `A high-quality, cinematic, vertical background image representing ${englishKeyword}. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''}`;

      let base64Result = "";

      // 3. 구글 최신 Imagen 3 서버 호출 (타임아웃 적용)
      try {
        const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt: finalPrompt }],
            parameters: { sampleCount: 1, outputOptions: { mimeType: "image/jpeg" } }
          })
        }, 15000); // 15초 제한

        if (response.ok) {
          const data = await response.json();
          const bytes = data.predictions?.[0]?.bytesBase64Encoded;
          if (bytes) base64Result = `data:image/jpeg;base64,${bytes}`;
        }
      } catch (e) {
        console.warn("구글 API 응답 없음 또는 시간 초과. 대체 AI로 전환합니다.");
      }

      // 4. 구글 실패 시 Pollinations 대체 서버 호출 (타임아웃 적용)
      if (!base64Result) {
        console.log(`🚀 주제 매칭 AI 시도 중... 렌더링 키워드: ${englishKeyword}`);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1080&height=1920&nologo=true`;
        
        const fallbackResponse = await fetchWithTimeout(fallbackUrl, {}, 15000); // 15초 제한
        if (fallbackResponse.ok) {
          const blob = await fallbackResponse.blob();
          base64Result = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } else {
          throw new Error("모든 이미지 서버 응답 실패");
        }
      }

      // 5. 성공적으로 가져온 이미지를 캐시에 저장 후 반환
      imageCache.set(cacheKey, base64Result);
      return base64Result;

    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      throw new Error("이미지 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.");
    }
  });
};

export const generateVideoFromImage = async (imageBase64: string, prompt: string): Promise<string | null> => {
  console.log("Generating video from image with prompt:", prompt);
  return null;
};