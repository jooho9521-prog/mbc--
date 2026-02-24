import { withRetry, handleApiError } from "./geminiService";

// ⭐️ [완벽 방어] 사용자가 입력한 API 키를 무조건 찾아오는 헬퍼 함수
const getApiKey = () => {
  let key = "";
  try { key = localStorage.getItem('gemini_api_key') || ""; } catch (e) {}
  if (!key) { try { key = (window as any).process?.env?.GEMINI_API_KEY || (window as any).process?.env?.API_KEY || ""; } catch (e) {} }
  if (!key) { try { key = (import.meta as any).env?.VITE_GEMINI_API_KEY || ""; } catch (e) {} }
  return key.trim();
};

/**
 * 최신 Imagen 3 모델을 사용하여 고품질 세로형 이미지를 생성합니다.
 * 패키지 버그 우회를 위해 다이렉트 REST API 통신(fetch)을 사용합니다.
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  return withRetry(async () => {
    try {
      const key = getApiKey();
      if (!key) {
        alert("🚨 API 키가 설정되지 않았습니다! 우측 상단의 [API 키 관리]에서 다시 한 번 저장해주세요.");
        throw new Error("API_KEY_MISSING");
      }

      // 카드뉴스용 맞춤 프롬프트 생성
      const finalPrompt = `A professional, cinematic, high-quality vertical business background for a trend report. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''} Topic: ${prompt}`;

      // ⭐️ 가장 안정적이고 확실한 구글 서버 직접 통신 방식
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [{ prompt: finalPrompt }],
          parameters: {
            sampleCount: 1,
            outputOptions: { mimeType: "image/jpeg" }
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "이미지 생성 서버 오류");
      }

      const data = await response.json();
      const base64Data = data.predictions?.[0]?.bytesBase64Encoded;
      
      if (!base64Data) throw new Error("이미지 데이터가 없습니다.");
      
      // 캔버스에 그릴 수 있도록 포맷 맞춰서 반환
      return `data:image/jpeg;base64,${base64Data}`;
    } catch (error: any) {
      console.error("API Call Error: Gemini Image Generation failed.", error);
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