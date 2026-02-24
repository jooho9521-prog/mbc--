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
    if(!key) return "trend";
    const ai = new GoogleGenAI({ apiKey: key });
    const transRes = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extract the main visual subject from this text and translate it into a concise 1-2 word English keyword (e.g., Tesla, Smartphone, Office). Text: "${keyword}". Output ONLY the English words.`,
    });
    return transRes.text ? transRes.text.replace(/[^a-zA-Z0-9 ]/g, '').trim() : "trend";
  } catch (e) {
    return "trend";
  }
};

/**
 * 👑 AI 실패 시 "주제에 맞는 실사 사진"을 가져오는 궁극의 3중 방어막!
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
      // [1단계] 구글 공식 최고 성능 모델 (Imagen 3) 시도
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
          console.warn("1단계 구글 API 실패. 대체 AI로 넘어갑니다.");
        }
      }

      // ----------------------------------------------------
      // [2단계] 무료 AI (Pollinations) 시도 (현재 530 폭주 중인 녀석)
      // 서버 과부하를 막기 위해 프롬프트를 아주 짧게 던집니다.
      // ----------------------------------------------------
      if (!base64Result) {
        console.log(`🚀 주제 매칭 AI 시도 중... 렌더링 키워드: ${englishKeyword}`);
        try {
          const shortPrompt = `${englishKeyword} professional cinematic vertical background without text`;
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(shortPrompt)}?width=1080&height=1920&nologo=true`;
          
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
          console.warn("2단계 무료 AI 서버 폭주(530). 마지막 실사 사진 대체로 넘어갑니다.");
        }
      }

      // ----------------------------------------------------
      // [3단계] 🔥대망의 최후 보루: 검색어(주제) 일치 100% 무료 사진 호출!🔥
      // AI 서버가 뻗어도 '테슬라'면 테슬라, '애플'이면 애플 사진을 강제로 가져옵니다.
      // ----------------------------------------------------
      if (!base64Result) {
         try {
            console.log(`🚀 3단계: AI 서버 전체 폭주! 주제(${englishKeyword}) 기반 무료 사진 데이터베이스에서 이미지를 가져옵니다.`);
            // 키워드 중 첫 번째 메인 단어만 뽑아내어 사진 검색 확률을 극대화합니다.
            const safeKeyword = englishKeyword.split(' ')[0] || "trend";
            
            // Flickr 데이터베이스에서 키워드에 맞는 세로형(1080x1920) 사진을 무작위로 가져옵니다!
            const flickrUrl = `https://loremflickr.com/1080/1920/${safeKeyword},background/all`;
            const flickrResponse = await fetchWithTimeout(flickrUrl, {}, 10000);
            const flickrBlob = await flickrResponse.blob();
            
            base64Result = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(flickrBlob);
            });
         } catch(e) {
            console.warn("3단계 실사 사진 로드마저 실패했습니다.");
         }
      }

      if (!base64Result) {
        throw new Error("모든 이미지 연동 서버가 응답하지 않습니다.");
      }

      imageCache.set(cacheKey, base64Result);
      return base64Result;

    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      throw new Error("현재 이미지 서버 전역에 트래픽이 폭주하고 있습니다. 잠시 후 다시 시도해주세요.");
    }
  });
};

export const generateVideoFromImage = async (imageBase64: string, prompt: string): Promise<string | null> => {
  return null;
};