import React, { useState, useCallback, useEffect } from 'react';
import { 
  Search, BrainCircuit, Loader2, LayoutDashboard, Zap, Globe, Key, 
  Database, X, Sparkles, MessageSquare, ShieldAlert, Target, TrendingUp, 
  Activity, Share2, Lightbulb, Link2Off, AlertTriangle, Copy, UserCog,
  ArrowUpDown, Clock, Moon, Sun, Mail 
} from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { GeminiTrendService, handleApiError, generateExpandedContent } from './services/geminiService';
import { initGoogleAuth, getNewsEmails } from './services/gmailService';
import { AppState, NewsItem } from './types';
import { NewsCard } from './components/NewsCard';
import ContentExpander from './components/ContentExpander';
import SavedCards from './components/SavedCards';
import ChatWidget from './ChatWidget';
import ChartVisualizer from './components/ChartVisualizer';
import SentimentChart from './components/SentimentChart';

const DONGA_LOGO_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgc3Ryb2tlPSIjMDA3YTczIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiLz4KICA8cGF0aCBkPSJNNTAgMiB2OTYgTTIgNTAgaDk2IiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIvPgogIDxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjMwIiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==";

const ANALYSIS_MODES = [
  { id: 'general', name: '📋 일반 분석', prompt: '종합적인 관점에서 사실 위주로 핵심 트렌드를 정리하세요.' },
  { id: 'swot', name: '🛡️ SWOT 분석', prompt: '대상을 SWOT 기법으로 분석하세요. 반드시 다음 순서와 번호를 지켜 줄바꿈으로 구분해 답변하세요: "1. 강점", "2. 약점", "3. 기회", "4. 위협", "5. 전략 제언".' },
  { id: 'market', name: '📈 시장 전망', prompt: '향후 시장 규모, 주요 플레이어의 경쟁 동향, 경제적 파급효과 및 성패 요인 위주로 분석하세요.' },
  { id: 'fact', name: '✅ 팩트체크', prompt: '데이터의 진위 여부, 통계의 정확성 및 정보 출처의 신뢰성 검증 위주로 팩트체크를 수행하세요.' },
  { id: 'sentiment', name: '💖 여론 분석', prompt: '대중의 반응과 감성(긍정/부정)을 중심으로 분석하세요.' }
];

const PERSONAS = [
  { id: 'analyst', name: '냉철한 애널리스트', prompt: '당신은 월스트리트의 수석 애널리스트입니다. 수치와 데이터에 기반하여 냉철하고 객관적으로 분석하세요.' },
  { id: 'marketer', name: 'MZ세대 마케터', prompt: '당신은 트렌드에 민감한 MZ세대 마케터입니다. 최신 유행어와 감각적인 표현을 사용하여 창의적인 인사이트를 제공하세요.' },
  { id: 'teacher', name: '친절한 선생님', prompt: '당신은 어려운 개념을 쉽게 설명해주는 초등학교 선생님입니다. 비유를 활용하여 누구나 이해하기 쉽게 설명하세요.' },
  { id: 'journalist', name: '비판적 저널리스트', prompt: '당신은 날카로운 시각을 가진 탐사 보도 기자입니다. 이면의 진실과 잠재적 리스크를 파헤치는 데 집중하세요.' }
];

const DEFAULT_OSMU = `1. 숏폼 영상 기획: 핵심 요약 (1분)\n2. 블로그 아티클: 심층 분석 데이터를 활용한 전문 포스팅\n3. 카드뉴스 제작: 주요 통계를 시각화한 인포그래픽`;

const renderText = (text: string) => {
  if (!text) return "";
  let clean = text
    .replace(/(https?:\/\/[^\s\)]+)/g, '')
    .replace(/\(참조[^)]*\)/gi, '')
    .replace(/\(Source[^)]*\)/gi, '')
    .replace(/\[참조[^\]]*\]/gi, '')
    .replace(/\[Source[^\]]*\]/gi, '')
    .replace(/\(출처[^)]*\)/gi, '')
    .replace(/(참조|Source|출처)\s*:[^\n]*$/gmi, '')
    .replace(/\*\*/g, '')
    .replace(/###/g, '')
    .replace(/\+\+\+/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\\n/g, '\n')
    .replace(/(\n|^)(\d+\.)/g, '\n\n$2') 
    .replace(/([.?!])\s+(\d+\.)/g, '$1\n\n$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean;
};

const App: React.FC = () => {
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'insights'>('dashboard');
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  
  const [selectedMode, setSelectedMode] = useState(ANALYSIS_MODES[0]);
  const [selectedPersona, setSelectedPersona] = useState(PERSONAS[0]);
  const [newsSources, setNewsSources] = useState<NewsItem[]>([]);
  const [newsSort, setNewsSort] = useState<'relevance' | 'latest'>('relevance');
  
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [state, setState] = useState<AppState>({
    keyword: '', 
    isLoading: false,
    results: [], 
    analysis: null,
    error: null,
  });

  const [osmuText, setOsmuText] = useState(DEFAULT_OSMU);
  const [currentLangName, setCurrentLangName] = useState('Korean');

  const [expandedContent, setExpandedContent] = useState({
    image: null as { img: string; cardData: { title: string; body: string } } | null,
    video: null as string | null,
    sns: null as string | null,
  });

  const [isTranslating, setIsTranslating] = useState(false);
  const [isGoogleAuthReady, setIsGoogleAuthReady] = useState(false);

  const LANGUAGES = [
    { code: 'KO', label: '🇰🇷', name: 'Korean', prompt: '한국 시장 관점' },
    { code: 'US', label: '🇺🇸', name: 'English', prompt: 'US Market Perspective' },
    { code: 'JP', label: '🇯🇵', name: 'Japanese', prompt: 'Japanese Market Perspective' },
    { code: 'CN', label: '🇨🇳', name: 'Chinese', prompt: 'Chinese Market Perspective' }
  ];

  const [toast, setToast] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const [chatCommand, setChatCommand] = useState<{ text: string; time: number } | null>(null);

  const showToast = (message: string) => {
    setToast({ visible: true, message });
    setTimeout(() => setToast({ visible: false, message: '' }), 2500);
  };

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey && typeof window !== 'undefined') {
      const win = window as any;
      win.process = win.process || { env: {} };
      win.process.env = win.process.env || {};
      win.process.env.API_KEY = savedKey;
      win.process.env.GEMINI_API_KEY = savedKey;
      win.process.env.VITE_GEMINI_API_KEY = savedKey;
    }
  }, []);

  useEffect(() => {
    initGoogleAuth().then((success) => {
      setIsGoogleAuthReady(success as boolean);
    });
  }, []);

  const handleSaveApiKey = () => {
    const trimmedKey = tempApiKey.trim();
    if (!trimmedKey) {
      showToast("API 키를 입력해주세요.");
      return;
    }
    localStorage.setItem('gemini_api_key', trimmedKey);
    if (typeof window !== 'undefined') {
      const win = window as any;
      win.process = win.process || { env: {} };
      win.process.env = win.process.env || {};
      win.process.env.API_KEY = trimmedKey;
      win.process.env.GEMINI_API_KEY = trimmedKey;
      win.process.env.VITE_GEMINI_API_KEY = trimmedKey;
    }
    showToast("API 키가 저장되었습니다.");
    setIsKeyModalOpen(false);
    setState(prev => ({ ...prev, error: null }));
  };

  const performSearch = async (searchKeyword: string, modePrompt: string) => {
    if (!searchKeyword.trim()) return;

    const apiKey = localStorage.getItem('gemini_api_key') || (window as any).process?.env?.API_KEY;
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null, results: [], analysis: null }));
    setNewsSources([]); 
    setExpandedContent({ image: null, video: null, sns: null }); 
    setOsmuText(DEFAULT_OSMU); 
    setCurrentLangName('Korean'); 
    setActiveTab('dashboard');
    setNewsSort('relevance');
    
    try {
      const service = new GeminiTrendService();
      const finalPrompt = `${selectedPersona.prompt}\n\n${modePrompt}`;
      const { news, analysis } = await service.fetchTrendsAndAnalysis(searchKeyword, finalPrompt);
      setState(prev => ({ ...prev, results: news, analysis, isLoading: false }));
      setNewsSources(news);
    } catch (err: any) {
      const apiErrorMessage = handleApiError(err);
      setState(prev => ({ ...prev, isLoading: false, error: apiErrorMessage }));
      showToast(apiErrorMessage.includes("503") ? "서버가 혼잡합니다. 잠시 후 시도해주세요." : "분석 중 오류가 발생했습니다.");
    }
  };

  const handleSearch = useCallback(async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    performSearch(state.keyword, selectedMode.prompt);
  }, [state.keyword, selectedMode, selectedPersona]);

  // ⭐️ [수정됨] G메일 데이터를 배열로 받아와 우측 소스 피드에 매핑합니다.
  const handleGmailSummary = async () => {
    let currentAuthStatus = isGoogleAuthReady;

    if (!currentAuthStatus) {
      showToast("구글 연동을 준비하는 중입니다...");
      currentAuthStatus = await initGoogleAuth() as boolean;
      setIsGoogleAuthReady(currentAuthStatus);
    }

    if (!currentAuthStatus) {
      showToast("구글 스크립트 연결 실패! 브라우저의 팝업/광고 차단을 잠시 꺼주세요.");
      return;
    }

    const apiKey = localStorage.getItem('gemini_api_key') || (window as any).process?.env?.API_KEY;
    if (!apiKey) {
      setIsKeyModalOpen(true);
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null, results: [], analysis: null, keyword: "G메일 '뉴스요약' 브리핑" }));
    setNewsSources([]); 
    setExpandedContent({ image: null, video: null, sns: null }); 
    setOsmuText(DEFAULT_OSMU); 
    setCurrentLangName('Korean'); 
    setActiveTab('dashboard');
    setNewsSort('relevance');

    try {
      showToast("G메일에서 뉴스를 가져오는 중...");
      const emailData = await getNewsEmails() as any[];
      
      showToast("가져온 뉴스를 분석하는 중...");
      const service = new GeminiTrendService();
      
      const combinedEmailText = emailData.map((e: any, index: number) => 
        `[기사 ${index + 1}]\n제목: ${e.title}\n출처: ${e.source}\n내용: ${e.body}`
      ).join('\n\n');

      const finalPrompt = `
        ${selectedPersona.prompt}
        다음은 사용자의 구글 알림(뉴스레터)에서 추출한 실제 최신 뉴스 기사 모음입니다.
        이 기사들을 종합적으로 분석하여 핵심 트렌드 보고서를 작성해주세요.
        **중요: 분석 결과에 어떤 언론사(출처)의 기사인지 반드시 언급해주세요.**
        
        [뉴스 기사 본문]
        ${combinedEmailText}
      `;
      
      const { analysis } = await service.fetchTrendsAndAnalysis("G메일 뉴스 요약", finalPrompt);
      
      // ⭐️ 추출한 기사들을 소스 피드 카드로 변환
      const mappedSources = emailData.map((e: any) => ({
          title: `📰 ${e.title.length > 40 ? e.title.substring(0, 40) + '...' : e.title}`,
          uri: e.link || "https://mail.google.com/",
          source: e.source || "웹 뉴스"
      }));

      // 중복된 링크 제거
      const uniqueSources = Array.from(new Map(mappedSources.map(item => [item.uri, item])).values());

      setState(prev => ({ ...prev, results: uniqueSources, analysis, isLoading: false }));
      setNewsSources(uniqueSources);

    } catch (err: any) {
      setState(prev => ({ ...prev, isLoading: false, error: err.message || "G메일 연동 또는 분석 중 오류가 발생했습니다." }));
      showToast("G메일 요약 실패: " + (err.message || "오류"));
    }
  };

  const handleModeChange = (mode: typeof ANALYSIS_MODES[0]) => {
    setSelectedMode(mode);
    if (state.keyword && !state.isLoading && state.keyword !== "G메일 '뉴스요약' 브리핑") {
      performSearch(state.keyword, mode.prompt);
      showToast(`${mode.name} 모드로 분석을 시작합니다.`);
    }
  };

  const handleDiscussWithAI = () => {
    if (!state.analysis) return;
    setChatCommand({
      text: `"${state.keyword}"에 대해 선택한 [${selectedMode.name}] 관점으로 분석 결과를 더 자세히 설명해줘.`,
      time: Date.now()
    });
  };

  const handleTranslate = async (targetLang: typeof LANGUAGES[0]) => {
    if (!state.analysis || isTranslating) return;
    
    setIsTranslating(true);
    showToast(`${targetLang.label} ${targetLang.name} 버전으로 분석 중...`);
    setCurrentLangName(targetLang.name);

    try {
      const currentContent = `
        Summary: ${state.analysis.summary}
        KeyPoints: ${state.analysis.keyPoints.join('\n')}
        OSMU_Strategy: ${osmuText} 
      `;

      const prompt = `
        You are a global market analyst.
        Please translate the following analysis report into **${targetLang.name}**.
        
        [IMPORTANT INSTRUCTION]
        1. Translate 'Summary', 'KeyPoints', and 'OSMU_Strategy' naturally.
        2. STRICTLY PRESERVE the numbered list format (1., 2., 3...) and line breaks.
        3. CRITICAL: Add one specific 'Local Market Insight' for the **${targetLang.name} market** at the end of the summary.
        4. Do NOT include any references, URLs, or citations.
        5. Output MUST be valid JSON only.
        
        [INPUT DATA]
        ${currentContent}

        [OUTPUT FORMAT]
        {
          "summary": "1. Translated point 1\n\n2. Translated point 2\n\n... + Local Insight",
          "keyPoints": ["Translated point 1", "Translated point 2"...],
          "osmu": "Translated OSMU Strategy text..."
        }
      `;

      const response = await generateExpandedContent(prompt, 'sns', ''); 
      
      let jsonString = response.replace(/```json/g, '').replace(/```/g, '').trim();
      const firstBrace = jsonString.indexOf('{');
      const lastBrace = jsonString.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonString = jsonString.substring(firstBrace, lastBrace + 1);
      }

      const result = JSON.parse(jsonString);

      setState(prev => ({
        ...prev,
        analysis: prev.analysis ? {
          ...prev.analysis,
          summary: result.summary,
          keyPoints: result.keyPoints
        } : null
      }));
      
      if (result.osmu) setOsmuText(result.osmu);

      showToast(`✅ ${targetLang.name} 분석 완료`);

    } catch (error) {
      console.error("Translation Error:", error);
      showToast("번역 데이터 처리 중 오류가 발생했습니다.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownloadPDF = async () => {
    const element = document.getElementById('print-section');
    if (!element) return;

    const btn = document.activeElement as HTMLButtonElement;
    const originalText = btn.innerText;
    btn.innerText = "⏳ 저장 중...";

    try {
      const clone = element.cloneNode(true) as HTMLElement;
      clone.style.width = '210mm';
      clone.style.height = 'auto';
      clone.style.overflow = 'visible';
      clone.style.position = 'fixed';
      clone.style.top = '-10000px';
      clone.style.left = '0';
      clone.style.background = 'white';
      clone.style.zIndex = '-1';
      document.body.appendChild(clone);

      const canvas = await html2canvas(clone, { scale: 2, useCORS: true, windowWidth: document.documentElement.offsetWidth });
      document.body.removeChild(clone);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const pageHeight = 295;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`TrendPulse_Report_${Date.now()}.pdf`);
      showToast("✅ PDF 저장이 완료되었습니다.");
    } catch (error) {
      showToast("PDF 저장 실패");
    } finally {
      btn.innerText = originalText;
    }
  };

  const handleShare = () => {
    setIsShareModalOpen(true);
  };

  const getSwotContent = (index: number, label: string) => {
    if (state.analysis?.keyPoints && state.analysis.keyPoints[index]) {
        if(state.analysis.keyPoints[index].length > 10) {
            return renderText(state.analysis.keyPoints[index]);
        }
    }
    
    if (state.analysis?.summary) {
      const targetNum = index + 1;
      const nextNum = index + 2;
      
      const regex = new RegExp(`${targetNum}\\.\\s*([\\s\\S]*?)(?:\\n${nextNum}\\.|$)`);
      const match = state.analysis.summary.match(regex);
      
      if (match && match[1]) {
          let content = match[1].trim();
          content = content.replace(new RegExp(`^${label}\\s*[:\\-]?\\s*`, 'i'), '');
          return renderText(content);
      }
      
      const simpleRegex = new RegExp(`${targetNum}\\.\\s*(.*?)(?:\\n|$)`);
      const simpleMatch = state.analysis.summary.match(simpleRegex);
      if (simpleMatch && simpleMatch[1]) return renderText(simpleMatch[1]);
    }
    return `${label} 데이터를 분석하지 못했습니다.`;
  };

  const getSortedNews = () => {
    if (newsSort === 'latest') {
      return [...newsSources].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    return newsSources;
  };

  return (
    <div className={`flex flex-col h-screen overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-gray-950 text-gray-100' : 'bg-[#F5F5F7] text-[#1d1d1f]'}`}>
      
      <nav className={`w-full border-b px-8 py-4 flex justify-between items-center z-50 no-print shadow-sm backdrop-blur-xl transition-colors duration-300 ${isDarkMode ? 'bg-gray-900/80 border-gray-800' : 'bg-white/80 border-gray-200'}`}>
        <div className="flex items-center gap-12">
          <div className="flex items-center gap-3">
            <img src={DONGA_LOGO_URL} alt="동아일보" className="h-10 w-10 object-contain" />
            <h1 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>동아일보</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('dashboard')} className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-[#0071e3] text-white shadow-sm' : (isDarkMode ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900')}`}>
              <LayoutDashboard size={18} /> 대시보드
            </button>
            <button onClick={() => setActiveTab('insights')} className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${activeTab === 'insights' ? 'bg-[#0071e3] text-white shadow-sm' : (isDarkMode ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900')}`}>
              <Database size={18} /> DB 보관함
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)} 
            className={`p-2.5 rounded-full transition-all ${isDarkMode ? 'bg-gray-800 text-yellow-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            title={isDarkMode ? "라이트 모드로 변경" : "다크 모드로 변경"}
          >
            {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {state.analysis && (
            <div className={`flex items-center gap-1 p-1 rounded-full ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleTranslate(lang)}
                  disabled={isTranslating}
                  className={`w-8 h-8 flex items-center justify-center rounded-full transition-all text-base disabled:opacity-50 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-white hover:shadow-sm'}`}
                  title={`${lang.name} 관점으로 분석`}
                >
                  {isTranslating ? <Loader2 size={12} className="animate-spin" /> : lang.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setIsKeyModalOpen(true)} className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all text-xs ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
            <Key size={16} /> API 키 관리
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto relative z-10 apple-transition">
        <header className={`sticky top-0 z-40 px-12 py-8 no-print backdrop-blur-xl transition-colors duration-300 ${isDarkMode ? 'bg-gray-950/80' : 'bg-[#F5F5F7]/80'}`}>
          <div className="max-w-6xl mx-auto space-y-6">
            
            <div className="flex gap-4">
              <form onSubmit={handleSearch} className="relative group flex-1">
                <button type="button" onClick={handleSearch} className="absolute left-6 top-1/2 -translate-y-1/2 z-50 text-gray-400 hover:text-[#0071e3] transition-colors cursor-pointer p-2">
                  <Search size={24} />
                </button>
                <input 
                  type="text" 
                  placeholder="트렌드 키워드 입력..." 
                  className={`w-full rounded-full py-5 pl-24 pr-16 focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 transition-all font-semibold text-xl shadow-sm border ${isDarkMode ? 'bg-gray-900 border-gray-800 text-white placeholder-gray-600' : 'bg-white border-gray-200 text-gray-900'}`}
                  value={state.keyword}
                  onChange={(e) => setState(prev => ({ ...prev, keyword: e.target.value }))}
                  disabled={state.isLoading}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(e); }}
                />
                {state.isLoading && (
                  <div className="absolute right-6 top-1/2 -translate-y-1/2 z-10">
                    <Loader2 className="animate-spin text-[#0071e3]" size={24} />
                  </div>
                )}
              </form>

              <div className="relative group min-w-[200px]">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 z-10">
                  <UserCog size={20} />
                </div>
                <select
                  value={selectedPersona.id}
                  onChange={(e) => setSelectedPersona(PERSONAS.find(p => p.id === e.target.value) || PERSONAS[0])}
                  className={`h-full w-full appearance-none border py-3 pl-12 pr-10 rounded-full leading-tight focus:outline-none focus:ring-2 focus:ring-[#0071e3]/20 font-bold text-sm shadow-sm cursor-pointer transition-colors ${isDarkMode ? 'bg-gray-900 border-gray-800 text-white hover:bg-gray-800' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {PERSONAS.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center px-4">
              {ANALYSIS_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => handleModeChange(mode)}
                  disabled={state.isLoading}
                  className={`px-4 py-1.5 text-[11px] font-bold rounded-full transition-all border ${
                    selectedMode.id === mode.id
                      ? (isDarkMode ? 'bg-white text-gray-900 border-white' : 'bg-gray-900 border-gray-900 text-white')
                      : (isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900')
                  }`}
                >
                  {mode.name}
                </button>
              ))}
              
              <button
                onClick={handleGmailSummary}
                disabled={state.isLoading}
                className={`ml-auto px-5 py-2 text-[12px] font-bold rounded-full transition-all border shadow-sm flex items-center gap-2 ${
                  isDarkMode 
                    ? 'bg-red-900/30 border-red-800 text-red-300 hover:bg-red-900/50' 
                    : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300'
                }`}
                title="G메일의 '뉴스요약' 라벨에 있는 메일들을 분석합니다"
              >
                {state.isLoading && state.keyword === "G메일 '뉴스요약' 브리핑" ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                G메일 뉴스 요약
              </button>
            </div>
          </div>
        </header>

        <div className="px-12 pb-24 max-w-[1500px] mx-auto">
          <div className="grid grid-cols-12 gap-10">
            <section className="col-span-12 xl:col-span-8 space-y-10">
              {activeTab === 'dashboard' ? (
                <>
                  {state.error && (
                    <div className="bg-rose-50 border border-rose-100 p-6 rounded-[2rem] flex items-center gap-4 text-rose-600 animate-in fade-in slide-in-from-top-4 no-print">
                      <ShieldAlert size={24} />
                      <div className="flex-1">
                        <p className="font-bold text-sm">분석 오류 발생</p>
                        <p className="text-xs opacity-80 whitespace-pre-wrap">{state.error}</p>
                      </div>
                      <button onClick={() => handleSearch()} className="px-4 py-2 bg-rose-600 text-white rounded-full text-[11px] font-bold">재시도</button>
                    </div>
                  )}
                  {state.analysis ? (
                    <div className={`rounded-[32px] p-12 space-y-12 shadow-sm border animate-in fade-in slide-in-from-bottom-8 duration-500 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
                      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                        <div className="space-y-2">
                          <h2 className={`text-3xl font-black flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            <BrainCircuit size={32} className="text-[#0071e3]" /> 분석 리포트
                          </h2>
                          <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold ${isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{selectedMode.name}</span>
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 ${isDarkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-[#e1f0ff] text-[#0071e3]'}`}>
                              <UserCog size={10} /> {selectedPersona.name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 no-print">
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">임팩트 지수</p>
                            <div className="flex items-center gap-3">
                              <span className="text-2xl font-black text-[#0071e3]">{state.analysis.growthScore}%</span>
                              <div className={`w-20 h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                <div className="h-full bg-[#0071e3]" style={{ width: `${state.analysis.growthScore}%` }}></div>
                              </div>
                            </div>
                          </div>
                          <button onClick={handleDiscussWithAI} className="px-6 py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-full font-bold text-sm transition-all shadow-md active:scale-95 flex items-center gap-2">
                            <MessageSquare size={16} /> AI 심층 질문
                          </button>
                        </div>
                      </div>

                      {selectedMode.id === 'sentiment' && (
                        <div className="mb-8">
                          <SentimentChart 
                            keyword={state.keyword} 
                            context={state.analysis.summary} 
                            isDarkMode={isDarkMode}
                          />
                        </div>
                      )}

                      {selectedMode.id === 'market' && state.analysis.summary && (
                        <div className="mb-10">
                          <ChartVisualizer 
                            analysisText={state.analysis.summary} 
                            keyword={state.keyword} 
                            language={currentLangName} 
                          />
                        </div>
                      )}

                      {selectedMode.id === 'swot' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                          <div className={`p-8 rounded-[24px] border ${isDarkMode ? 'bg-red-950/20 border-red-900/50' : 'bg-[#FFF5F5] border-red-100'}`}>
                            <div className="flex items-center gap-3 mb-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-red-500 shadow-sm ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}><Zap size={24} /></div>
                              <h3 className="text-2xl font-black text-red-500">Strengths</h3>
                            </div>
                            <p className={`text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getSwotContent(0, "강점")}</p>
                          </div>
                          <div className={`p-8 rounded-[24px] border ${isDarkMode ? 'bg-blue-950/20 border-blue-900/50' : 'bg-[#F0F7FF] border-blue-100'}`}>
                            <div className="flex items-center gap-3 mb-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-blue-500 shadow-sm ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}><Link2Off size={24} /></div>
                              <h3 className="text-2xl font-black text-blue-500">Weaknesses</h3>
                            </div>
                            <p className={`text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getSwotContent(1, "약점")}</p>
                          </div>
                          <div className={`p-8 rounded-[24px] border ${isDarkMode ? 'bg-green-950/20 border-green-900/50' : 'bg-[#F0FFF4] border-green-100'}`}>
                            <div className="flex items-center gap-3 mb-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-green-500 shadow-sm ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}><Lightbulb size={24} /></div>
                              <h3 className="text-2xl font-black text-green-500">Opportunities</h3>
                            </div>
                            <p className={`text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getSwotContent(2, "기회")}</p>
                          </div>
                          <div className={`p-8 rounded-[24px] border ${isDarkMode ? 'bg-yellow-950/20 border-yellow-900/50' : 'bg-[#FFFBEB] border-yellow-100'}`}>
                            <div className="flex items-center gap-3 mb-4">
                              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-yellow-500 shadow-sm ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}><AlertTriangle size={24} /></div>
                              <h3 className="text-2xl font-black text-yellow-500">Threats</h3>
                            </div>
                            <p className={`text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getSwotContent(3, "위협")}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                          {state.analysis.keyPoints.map((point, index) => (
                            <div key={index} className={`p-6 rounded-2xl shadow-sm border transition-all hover:shadow-md ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-100'}`}>
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-indigo-600 ${isDarkMode ? 'bg-gray-700' : 'bg-indigo-50'}`}>
                                {index === 0 && <TrendingUp className="w-6 h-6" />}
                                {index === 1 && <Target className="w-6 h-6" />}
                                {index === 2 && <Activity className="w-6 h-6" />}
                                {index > 2 && <Lightbulb className="w-6 h-6" />}
                              </div>
                              <p className={`text-sm leading-relaxed whitespace-pre-line break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                {renderText(point)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      <div className={`text-xl font-medium leading-relaxed p-12 rounded-[32px] border shadow-sm hover:shadow-md transition-shadow whitespace-pre-line break-words ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-100' : 'bg-white border-gray-100 text-gray-900'}`}>
                        {renderText(state.analysis.summary)}
                      </div>

                      <div className="no-print">
                        <ContentExpander 
                          keyword={state.keyword} 
                          summary={state.analysis.summary} 
                          expandedData={expandedContent}
                          setExpandedData={setExpandedContent}
                          onShowToast={showToast}
                          onOpenReport={() => setIsReportModalOpen(true)}
                        />
                      </div>
                    </div>
                  ) : (
                    !state.isLoading && (
                      <div className="py-40 text-center flex flex-col items-center no-print">
                        <div className={`w-24 h-24 rounded-3xl flex items-center justify-center shadow-sm mb-8 p-5 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                          <img src={DONGA_LOGO_URL} alt="로고" className="w-full h-full object-contain animate-pulse" />
                        </div>
                        <p className={`text-lg font-medium max-w-lg mx-auto leading-relaxed whitespace-pre-wrap ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>키워드를 입력하고 분석 모드를 선택하여<br/>나만의 미니멀 AI 리포트를 생성해보세요.</p>
                      </div>
                    )
                  )}
                </>
              ) : (
                <div className="space-y-8 animate-in fade-in duration-500 no-print">
                  <h2 className={`text-4xl font-black tracking-tight flex items-center gap-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}><Database className="text-[#0071e3]" size={36} /> 보관함</h2>
                  <SavedCards />
                </div>
              )}
            </section>

            <aside className="col-span-12 xl:col-span-4 space-y-10 no-print">
              <div className={`rounded-[32px] p-10 shadow-sm border sticky top-40 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-100'}`}>
                <div className="flex items-center justify-between mb-8">
                  <h3 className={`text-xl font-black flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}><Globe className="text-[#0071e3]" size={24} /> 소스 피드</h3>
                  <div className={`flex gap-1 p-1 rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                    <button 
                      onClick={() => setNewsSort('latest')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 ${newsSort === 'latest' ? (isDarkMode ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-[#0071e3] shadow-sm') : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <Clock size={12} /> 최신순
                    </button>
                    <button 
                      onClick={() => setNewsSort('relevance')}
                      className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all flex items-center gap-1 ${newsSort === 'relevance' ? (isDarkMode ? 'bg-gray-700 text-white shadow-sm' : 'bg-white text-[#0071e3] shadow-sm') : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      <ArrowUpDown size={12} /> 관련도순
                    </button>
                  </div>
                </div>
                
                <div className="space-y-5 max-h-[700px] overflow-y-auto pr-2">
                  {newsSources.length > 0 ? getSortedNews().map((item, idx) => (
                    <NewsCard key={idx} item={item} keyword={state.keyword} />
                  )) : state.isLoading ? (
                    <div className="py-20 text-center text-gray-400 font-medium"><Loader2 className="animate-spin mx-auto mb-4" /> 리서치 진행 중...</div>
                  ) : (
                    <div className={`py-24 text-center border-2 border-dashed rounded-3xl ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                      <Search size={32} className={`mx-auto mb-3 ${isDarkMode ? 'text-gray-700' : 'text-gray-200'}`} />
                      <p className="text-xs font-bold text-gray-400">분석 대기 중</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* API Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-6 no-print">
          <div className={`border rounded-[32px] p-12 w-full max-w-xl shadow-2xl relative animate-in zoom-in-95 ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
            <button onClick={() => setIsKeyModalOpen(false)} className={`absolute right-8 top-8 hover:text-gray-500 ${isDarkMode ? 'text-gray-400' : 'text-gray-400'}`}><X size={28} /></button>
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#0071e3]/10 rounded-2xl flex items-center justify-center mx-auto mb-6"><Key size={32} className="text-[#0071e3]" /></div>
              <h2 className={`text-2xl font-black mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>API 키 관리</h2>
              <p className="text-gray-500 text-sm font-medium">서비스 이용을 위해 Gemini API 키가 필요합니다.</p>
            </div>
            <div className={`p-5 rounded-2xl mb-8 text-left border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-100'}`}>
              <h4 className={`text-xs font-bold mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>📢 API 키가 없으신가요?</h4>
              <p className="text-xs text-gray-500 leading-relaxed mb-3">Google AI Studio에서 무료로 빠르고 간편하게 발급받을 수 있습니다.<br/>발급받은 키를 복사하여 아래 입력창에 붙여넣기 해주세요.</p>
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-[#0071e3] hover:underline flex items-center gap-1">👉 구글 API 키 무료로 발급받기</a>
            </div>
            <div className="space-y-4">
              <input type="password" placeholder="Gemini API Key 입력 (AIza...)" value={tempApiKey} onChange={(e) => setTempApiKey(e.target.value)} className={`w-full border rounded-2xl py-4 px-6 font-mono text-sm focus:ring-4 focus:ring-[#0071e3]/10 outline-none transition-all ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200 text-gray-900'}`} />
              <button onClick={handleSaveApiKey} className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all">저장 및 적용</button>
            </div>
          </div>
        </div>
      )}

      {/* 공유 모달 */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 animate-in fade-in">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 shadow-2xl space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2"><Share2 size={24} className="text-[#0071e3]" /> 공유하기</h3>
              <button onClick={() => setIsShareModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-500 font-medium">아래 링크를 복사하여 공유하세요.</p>
            <div className="flex gap-2">
              <input type="text" readOnly value={window.location.href} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-600 focus:outline-none" />
              <button onClick={() => { navigator.clipboard.writeText(window.location.href); alert("복사되었습니다!"); setIsShareModalOpen(false); }} className="bg-[#0071e3] text-white px-4 rounded-xl font-bold flex items-center justify-center hover:bg-[#005bb5]"><Copy size={20} /></button>
            </div>
          </div>
        </div>
      )}

      {toast.visible && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-gray-900 text-white rounded-full font-bold shadow-xl animate-in fade-in slide-in-from-bottom-6 no-print">
          {toast.message}
        </div>
      )}

      {/* 리포트 모달창 */}
      {isReportModalOpen && state.analysis && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <div>
                <h2 className="text-2xl font-black text-[#1d1d1f] flex items-center gap-2"><Sparkles className="text-[#0071e3]" /> 최종 리포트</h2>
                <div className="flex items-center gap-3 mt-2"><p className="text-xs text-gray-400 font-bold">GENERATED BY TrendPulse AI • {new Date().toLocaleDateString()}</p></div>
              </div>
              <button onClick={() => setIsReportModalOpen(false)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"><X size={24} className="text-gray-600" /></button>
            </div>

            <div id="print-section" className="p-8 overflow-y-auto space-y-8 bg-white">
              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#0071e3]"></span> 1단계: 데이터 수집 및 정제</h3>
                <p className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">{state.analysis.summary ? renderText(state.analysis.summary) : "수집된 데이터가 없습니다."}</p>
              </div>

              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#0071e3]"></span> 2단계: AI 심층 분석</h3>
                <div className="space-y-4">
                  {state.analysis.keyPoints.map((point, idx) => (
                    <p key={idx} className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">{renderText(point)}</p>
                  ))}
                </div>
              </div>

              <div className="bg-[#F5F5F7] p-8 rounded-3xl h-auto w-full border border-gray-100/50">
                <h3 className="text-[#0071e3] font-black mb-4 text-sm uppercase tracking-widest flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#0071e3]"></span> 3단계: OSMU 전략</h3>
                <p className="text-[#1d1d1f] text-base leading-relaxed whitespace-pre-line break-words font-medium">{renderText(osmuText)}</p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-white flex gap-3 print:hidden">
              <button onClick={handleDownloadPDF} className="flex-1 py-4 bg-[#0071e3] text-white rounded-xl font-bold hover:bg-[#0077ED] transition-all shadow-lg flex items-center justify-center gap-2"><LayoutDashboard size={20} /> 리포트 PDF 다운로드</button>
              <button onClick={handleShare} className="w-32 py-4 bg-gray-100 text-[#1d1d1f] rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"><Share2 size={20} /> 공유</button>
            </div>
          </div>
        </div>
      )}

      <ChatWidget analysis={state.analysis} externalCommand={chatCommand} keyword={state.keyword} />
    </div>
  );
};

export default App;