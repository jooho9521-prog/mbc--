// services/googleSearchService.ts

const API_KEY = import.meta.env.VITE_GOOGLE_SEARCH_API_KEY || 'AIzaSyDHmNua9YWhBV0SZTa4xgoMNemRcamsLng'; 
const CX_ID = import.meta.env.VITE_GOOGLE_SEARCH_CX || '023f4c7f4a28a4dc8'; 

export interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  pagemap?: {
    cse_image?: { src: string }[];
    metatags?: { [key: string]: string }[];
  };
  displayLink: string;
}

export const fetchRealTimeNews = async (query: string): Promise<GoogleSearchResult[]> => {
  if (!API_KEY || !CX_ID) {
    console.warn("Google Search API Key or CX ID is missing.");
    return [];
  }

  try {
    // 뉴스 위주로 검색하기 위해 q parameter 뒤에 'news' 혹은 특정 키워드 조합 가능
    // dateRestrict: 'd7' (최근 7일), 'm1' (최근 1달) 등으로 최신성 조절 가능
    const url = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${CX_ID}&q=${encodeURIComponent(query)}&sort=date`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.items) {
      return data.items;
    } else {
      return [];
    }
  } catch (error) {
    console.error("Google Search API Error:", error);
    return [];
  }
};