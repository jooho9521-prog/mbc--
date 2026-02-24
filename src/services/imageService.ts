import { withRetry, handleApiError } from "./geminiService";

// ⭐️ API 키를 찾아내는 헬퍼 함수
const getApiKey = () => {
  let key = "";
  try { key = localStorage.getItem('gemini_api_key') || ""; } catch (e) {}
  if (!key) { try { key = (window as any).process?.env?.GEMINI_API_KEY || (window as any).process?.env?.API_KEY || ""; } catch (e) {} }
  if (!key) { try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch (e) {} }
  return key.trim();
};

/**
 * ⭐️ [3중 철통 방어] 구글 API -> 대체 AI -> 최후의 기본 고화질 배경 순으로 
 * 무슨 일이 있어도 무조건 이미지를 화면에 띄웁니다!
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  return withRetry(async () => {
    try {
      const key = getApiKey();
      const finalPrompt = `A professional, cinematic, high-quality vertical business background for a trend report. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''} Topic: ${prompt}`;

      // ----------------------------------------------------
      // [1단계] 구글 Imagen 3에 먼저 요청 시도 (성공하면 최고 퀄리티)
      // ----------------------------------------------------
      if (key) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: finalPrompt }],
              parameters: { sampleCount: 1, outputOptions: { mimeType: "image/jpeg" } }
            })
          });

          if (response.ok) {
            const data = await response.json();
            const base64Data = data.predictions?.[0]?.bytesBase64Encoded;
            if (base64Data) return `data:image/jpeg;base64,${base64Data}`;
          }
        } catch (e) {
          console.warn("구글 API 1단계 실패, 대체 AI로 넘어갑니다...");
        }
      }

      // ----------------------------------------------------
      // [2단계] 구글이 막혔을 경우: 무료 대체 AI (Pollinations) 시도
      // ----------------------------------------------------
      try {
        console.log("🚀 2단계: 대체 AI(Pollinations)를 사용하여 생성을 시도합니다.");
        // 서버 에러를 줄이기 위해 프롬프트를 짧고 안전하게 인코딩
        const safeTopic = encodeURIComponent(prompt.substring(0, 30));
        const fallbackUrl = `https://image.pollinations.ai/prompt/abstract%20professional%20background%20${safeTopic}?width=1080&height=1920&nologo=true`;
        
        const fallbackResponse = await fetch(fallbackUrl);
        if (fallbackResponse.ok) {
          const blob = await fallbackResponse.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      } catch (e) {
        console.warn("대체 AI 2단계 실패 (530 에러 등 서버 폭주), 최후의 수단으로 넘어갑니다...");
      }

      // ----------------------------------------------------
      // [3단계] AI 서버들이 모두 뻗었을 경우: 절대 실패 없는 고화질 랜덤 배경 (최후의 보루)
      // ----------------------------------------------------
      console.log("🚀 3단계: AI 서버 지연으로 인해 고품질 기본 감성 배경으로 안전하게 대체합니다.");
      const picsumUrl = `https://picsum.photos/1080/1920/?blur=2&random=${Math.random()}`; // 고급스러운 블러 처리된 고화질 이미지
      const picResponse = await fetch(picsumUrl);
      const picBlob = await picResponse.blob();
      
      return new Promise((resolve, reject) => {
         const reader = new FileReader();
         reader.onloadend = () => resolve(reader.result as string);
         reader.onerror = reject;
         reader.readAsDataURL(picBlob);
      });
      
    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      throw new Error("이미지 서버에 일시적인 문제가 발생했습니다. 다시 시도해주세요.");
    }
  });
};

/**
 * 이미지에서 비디오를 생성하는 AI API 호출을 위한 기본 구조
 */
export const generateVideoFromImage = async (imageBase64: string, prompt: string): Promise<string | null> => {
  console.log("Generating video from image with prompt:", prompt);
  return null;
};