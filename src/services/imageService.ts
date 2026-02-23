
import { GoogleGenAI } from "@google/genai";
import { withRetry, handleApiError } from "./geminiService";

/**
 * Gemini 2.5 Flash Image 모델을 사용하여 고품질 세로형 이미지를 생성합니다.
 * 503 Overloaded 에러 발생 시 자동 재시도 로직이 포함되어 있습니다.
 */
export const generateImage = async (prompt: string, stylePrompt?: string): Promise<string | null> => {
  return withRetry(async () => {
    try {
      // Using API_KEY directly from environment variable
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: `A professional, cinematic, high-quality vertical business background for a trend report. No text, no grids, 4k resolution. ${stylePrompt ? `Style: ${stylePrompt}.` : ''} Topic: ${prompt}`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "9:16",
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      
      return null;
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
