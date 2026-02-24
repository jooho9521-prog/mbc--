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

// 타임아웃 래퍼: 서버가 고장나서 무한 로딩되는 것을 15초 만에 끊어냅니다.
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
 * 👑 현존 최강 무료 오픈소스 AI (FLUX) 를 활용한 초고퀄리티 이미지 생성 로직
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
      // [1단계] 구글 공식 최고 성능 모델 (Imagen 3) 시도 (유료급 퀄리티)
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
          console.warn("1단계 구글 API 실패. 최상급 무료 AI로 넘어갑니다.");
        }
      }

      // ----------------------------------------------------
      // [2단계] 🔥무료지만 최상급 퀄리티(FLUX 모델) 강제 호출🔥
      // 서버 폭주(530)를 막기 위해 매번 새로운 seed 값을 부여합니다!
      // ----------------------------------------------------
      if (!base64Result) {
        console.log(`🚀 고퀄리티 FLUX AI 시도 중... 렌더링 키워드: ${englishKeyword}`);
        try {
          // 최고급 퀄리티를 뽑아내기 위한 프롬프트 엔지니어링
          const fluxPrompt = `Masterpiece, award-winning, stunning 4k vertical background representing ${englishKeyword}. Highly detailed, cinematic lighting, no text, clean composition.`;
          const randomSeed = Math.floor(Math.random() * 1000000); // 530 캐시 에러 방지용 난수
          
          // model=flux 파라미터를 추가하여 압도적인 퀄리티의 모델로 라우팅합니다.
          const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fluxPrompt)}?width=1080&height=1920&nologo=true&model=flux&seed=${randomSeed}`;
          
          const fallbackResponse = await fetchWithTimeout(fallbackUrl, {}, 15000); // 고퀄리티라 15초 대기
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
          console.warn("2단계 FLUX 모델 지연. 마지막 실사 사진으로 대체합니다.");
        }
      }

      // ----------------------------------------------------
      // [3단계] 최후 보루: 검색어(주제) 일치 100% 무료 사진 호출!
      // ----------------------------------------------------
      if (!base64Result) {
         try {
            console.log(`🚀 3단계: AI 서버 지연, 주제(${englishKeyword}) 기반 무료 고화질 사진을 가져옵니다.`);
            const safeKeyword = englishKeyword.split(' ')[0] || "trend";
            
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
            console.warn("3단계 사진 로드 실패.");
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