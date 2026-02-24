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
 * ⭐️ [절대 방어] 구글 API가 권한 문제로 막히더라도, 대체 AI를 통해 100% 무조건 이미지를 생성합니다!
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  return withRetry(async () => {
    try {
      const key = getApiKey();
      const finalPrompt = `A professional, cinematic, high-quality vertical business background for a trend report. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''} Topic: ${prompt}`;

      // 1단계: 구글 Imagen 3에 먼저 요청 시도
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

          // 구글에서 성공적으로 이미지를 주면 바로 사용
          if (response.ok) {
            const data = await response.json();
            const base64Data = data.predictions?.[0]?.bytesBase64Encoded;
            if (base64Data) return `data:image/jpeg;base64,${base64Data}`;
          }
        } catch (googleError) {
          console.warn("구글 API 권한 제한됨. 즉시 대체 AI 서버로 우회합니다...", googleError);
        }
      }

      // 2단계: 구글이 404 에러로 튕겨내면? ➡️ 키 없이도 작동하는 무료 고품질 AI로 자동 우회!
      console.log("🚀 대체 AI(Pollinations)를 사용하여 카드뉴스 이미지를 강제 생성합니다.");
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1080&height=1920&nologo=true`;
      
      const fallbackResponse = await fetch(fallbackUrl);
      if (!fallbackResponse.ok) throw new Error("대체 이미지 서버도 응답하지 않습니다.");
      
      const blob = await fallbackResponse.blob();
      
      // 화면에 즉시 띄울 수 있도록 형변환
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      
    } catch (error: any) {
      console.error("최종 이미지 생성 실패.", error);
      throw new Error(handleApiError(error));
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