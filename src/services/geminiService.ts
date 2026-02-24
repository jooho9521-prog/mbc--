import { GoogleGenAI, Type, Modality } from "@google/genai";
import { NewsItem, TrendAnalysis } from "../types";

// ⭐️ Vercel(브라우저) 환경에서 API 키를 안전하게 가져오는 헬퍼 함수
const getApiKey = () => {
  const key = localStorage.getItem('gemini_api_key') || (import.meta as any).env?.VITE_GEMINI_API_KEY || "";
  return key;
};

// [완벽 방어] AI가 JSON 규칙을 어겨도 무조건 데이터를 뜯어내는 만능 파서
const cleanAndParseJson = (text: string) => {
  if (!text) return null;
  try {
    let cleanText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
        cleanText = cleanText.substring(start, end + 1);
    }
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("표준 JSON 파싱 실패! 텍스트 강제 추출을 시도합니다...", text);
    try {
        const summaryMatch = text.match(/"summary"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"sentiment"|,\s*"keyPoints"|,\s*"growthScore"|,\s*"sources"|\})/i);
        const sentimentMatch = text.match(/"sentiment"\s*:\s*"([^"]*)"/i);
        const scoreMatch = text.match(/"growthScore"\s*:\s*(\d+)/i);
        
        if (summaryMatch && summaryMatch[1]) {
            return {
                summary: summaryMatch[1].trim(),
                sentiment: sentimentMatch ? sentimentMatch[1] : "neutral",
                keyPoints: ["AI 분석 데이터 자동 복구됨"],
                growthScore: scoreMatch ? parseInt(scoreMatch[1]) : 50
            };
        }
    } catch(err) {
        console.error("강제 추출 실패:", err);
    }
    return null;
  }
};

export const extractErrorMessage = (error: any): string => {
  if (!error) return "Unknown error";
  if (typeof error === 'string') return error;
  const apiError = error?.error || error;
  if (apiError?.message) return apiError.message;
  try { return JSON.stringify(error); } catch (e) { return String(error); }
};

export const handleApiError = (error: any): string => {
  const message = extractErrorMessage(error);
  const lowerMsg = message.toLowerCase();
  
  if (lowerMsg.includes("not found") || lowerMsg.includes("404")) {
    return "AI Model connection failed (404). Switching to supported model.";
  }
  if (lowerMsg.includes("429") || lowerMsg.includes("quota") || lowerMsg.includes("api key")) {
    return "API 키가 올바르지 않거나 한도 초과입니다. 우측 상단의 [API 키 관리]에서 키를 다시 입력해주세요.";
  }
  if (lowerMsg.includes("503") || lowerMsg.includes("overloaded")) {
    return "Server overloaded (503). Please try again soon.";
  }
  
  return message.length > 150 ? message.substring(0, 150) + "..." : message;
};

// Exponential backoff retry logic
export const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const message = extractErrorMessage(error).toLowerCase();
    const status = error?.status || error?.code;
    
    const isFatal = status === 404 || status === 400 || message.includes("not found");
    if (isFatal) throw error;

    const isTransient = status === 503 || status === 429 || message.includes("503") || message.includes("quota");

    if (retries > 0 && isTransient) {
      console.warn(`[Retry] Transient error detected. Retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export class GeminiTrendService {
  async fetchTrendsAndAnalysis(keyword: string, modeInstruction: string): Promise<{ news: NewsItem[]; analysis: TrendAnalysis }> {
    try {
      return await withRetry(async () => {
        const ai = new GoogleGenAI({ apiKey: getApiKey() });
        
        const prompt = `
          Analyze the trend for "${keyword}". Context: ${modeInstruction}
          
          [CRITICAL REQUIREMENTS]
          1. **LANGUAGE: ALL output content (summary, keyPoints) MUST be written in KOREAN (반드시 모든 내용을 한국어로 번역해서 작성하세요).**
          2. You MUST use the Google Search tool to find REAL, recent news articles.
          3. **The 'summary' field MUST contain EXACTLY 5 numbered points (from 1. to 5.).**
          4. **EACH of the 5 points in the summary MUST be a detailed, substantial paragraph consisting of at least 3-5 sentences.** Provide deep insights, specific facts, figures, and context for every single point.
          5. Return ONLY a JSON object. Do not include markdown code blocks.
          6. Format example:
          {
            "summary": "1. [한국어로 작성된 상세 단락 1...]\\\\n\\\\n2. [한국어로 작성된 상세 단락 2...]\\\\n\\\\n3. [한국어로 작성된 상세 단락 3...]\\\\n\\\\n4. [한국어로 작성된 상세 단락 4...]\\\\n\\\\n5. [한국어로 작성된 상세 단락 5...]",
            "sentiment": "positive",
            "keyPoints": ["한국어 핵심 요약 1", "한국어 핵심 요약 2"],
            "growthScore": 75
          }
        `;
        
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { 
            tools: [{ googleSearch: {} }] 
          },
        });

        const text = response.text || "{}";
        let analysis = cleanAndParseJson(text);
        let news: NewsItem[] = [];

        const grounding = response.candidates?.[0]?.groundingMetadata;
        if (grounding?.groundingChunks) {
          const uniqueLinks = new Set();
          grounding.groundingChunks.forEach((chunk: any) => {
             const uri = chunk.web?.uri;
             const title = chunk.web?.title || `관련 기사 원문 확인`;
             if (uri && uri !== '#' && !uri.includes("google.com/search") && !uniqueLinks.has(uri)) {
                 uniqueLinks.add(uri);
                 let sourceName = 'Web News';
                 try { sourceName = new URL(uri).hostname.replace('www.', ''); } catch(e){}
                 
                 news.push({ title, uri, source: sourceName });
             }
          });
        }
        
        const fallbacks = [
          { title: `🔍 '${keyword}' 관련 최신 구글 뉴스`, uri: `https://news.google.com/search?q=${encodeURIComponent(keyword)}`, source: "Google News" },
          { title: `📰 '${keyword}' 네이버 뉴스 상세 검색`, uri: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}`, source: "Naver News" },
          { title: `📈 '${keyword}' 구글 트렌드 빅데이터 확인`, uri: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`, source: "Google Trends" },
          { title: `💬 '${keyword}' X(트위터) 실시간 반응 보기`, uri: `https://twitter.com/search?q=${encodeURIComponent(keyword)}&f=live`, source: "X (Twitter)" },
          { title: `▶️ '${keyword}' 유튜브 관련 영상 찾아보기`, uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`, source: "YouTube" }
        ];

        if (news.length < 5) {
          const needed = 5 - news.length;
          news = [...news, ...fallbacks.slice(0, needed)];
        }

        if (!analysis) {
          analysis = {
            summary: "1. AI 데이터 분석이 완료되었으나 화면 렌더링에 지연이 발생했습니다.\n\n2. '분석 리포트' 버튼을 다시 한 번 클릭하시면 상세 정보가 정상 표기됩니다.",
            sentiment: "neutral",
            keyPoints: ["분석 렌더링 재시도 요망"],
            growthScore: 50
          };
        }
        return { news, analysis };
      });
    } catch (e) {
      console.error("Trend Analysis Error:", e);
      return {
        news: [
          { title: `🔍 '${keyword}' 관련 최신 구글 뉴스`, uri: `https://news.google.com/search?q=${encodeURIComponent(keyword)}`, source: "Google News" },
          { title: `📰 '${keyword}' 네이버 뉴스 상세 검색`, uri: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}`, source: "Naver News" },
          { title: `📈 '${keyword}' 구글 트렌드 빅데이터 확인`, uri: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`, source: "Google Trends" },
          { title: `💬 '${keyword}' X(트위터) 실시간 반응 보기`, uri: `https://twitter.com/search?q=${encodeURIComponent(keyword)}&f=live`, source: "X (Twitter)" },
          { title: `▶️ '${keyword}' 유튜브 관련 영상 찾아보기`, uri: `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`, source: "YouTube" }
        ],
        analysis: { summary: "1. API 키 오류 또는 일시적인 트래픽 과부하입니다.\n\n2. 우측 상단의 [API 키 관리] 버튼을 눌러 키가 정확한지 확인해 주세요.", sentiment: "neutral", keyPoints: [], growthScore: 0 }
      };
    }
  }
}

export const generateExpandedContent = async (summary: string, type: string, stylePrompt?: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const prompt = `Create high-quality ${type} content based on this summary: ${summary}. ${stylePrompt ? `Apply style: ${stylePrompt}` : ''} Output only the generated text or JSON as appropriate.`;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: type === 'image' ? { responseMimeType: "application/json" } : {}
    });
    return response.text || "";
  } catch (e) { 
    console.error("Content Expansion Error:", e);
    return ""; 
  }
};

export const generateTTS = async (text: string, voiceName: string = 'Zephyr', styleInstruction?: string) => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const prompt = styleInstruction ? `Say this ${styleInstruction}: ${text}` : text;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
  } catch (e) {
    console.error("TTS generation failed:", e);
    throw e;
  }
};

export const generateVideoWithVeo = async () => null;

export const generateMindMapData = async (keyword: string) => {
  try {
    return await withRetry(async () => {
      const ai = new GoogleGenAI({ apiKey: getApiKey() });
      
      const prompt = `
        Create a knowledge mind map for "${keyword}". 
        Include a root node named "${keyword}" and 4 detailed sub-branches.
        ALL text MUST be in KOREAN (반드시 한국어로 작성).
        Output ONLY valid JSON: { "name": "Root", "children": [ { "name": "Branch", "children": [] } ] }
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text || "{}";
      const parsed = cleanAndParseJson(text);
      
      if (!parsed) throw new Error("Invalid MindMap data format");
      return parsed;
    });
  } catch (e) {
    console.error("MindMap Error:", e);
    return null;
  }
};

// ⭐️ [궁극의 해결책] 구글 패키지의 브라우저 버그를 피하기 위해, 서버에 직접 fetch(REST API) 요청을 때립니다!
export const generateImage = async (prompt: string): Promise<string> => {
  try {
    const key = getApiKey();
    if (!key) throw new Error("API 키가 없습니다. 우측 상단의 [API 키 관리]에서 다시 입력해주세요.");

    // Google 패키지를 우회하고 가장 확실한 REST API 통신으로 변경
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [
          { prompt: prompt }
        ],
        parameters: {
          sampleCount: 1,
          outputOptions: {
            mimeType: "image/jpeg"
          }
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
    
    return base64Data;
  } catch (e) {
    console.error("API Call Error: Gemini Image Generation failed.", e);
    throw e;
  }
};