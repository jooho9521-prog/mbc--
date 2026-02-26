import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, X, Send, Bot, User, Sparkles, 
  Trash2, ArrowRight, Copy, Download, RefreshCw, 
  Volume2, StopCircle, ThumbsUp, ThumbsDown,
  Mic, MicOff 
} from 'lucide-react';
import { TrendAnalysis } from './types';
import { generateExpandedContent } from './services/geminiService';

// 동아일보 로고 URL (Base64)
const DONGA_LOGO_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgc3Ryb2tlPSIjMDA3YTczIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiLz4KICA8cGF0aCBkPSJNNTAgMiB2OTYgTTIgNTAgaDk2IiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIvPgogIDxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjMwIiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==";

interface Props {
  analysis: TrendAnalysis | null;
  keyword?: string;
  externalCommand?: { text: string; time: number } | null;
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

const ChatWidget: React.FC<Props> = ({ analysis, keyword, externalCommand }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: '안녕하세요. 동아일보 AI입니다. 분석 결과에 대해 궁금한 점이 있으신가요?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [speakingMsgIndex, setSpeakingMsgIndex] = useState<number | null>(null);
  const [isListening, setIsListening] = useState(false); 

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen, isLoading, suggestions]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (keyword && analysis) {
      setSuggestions([
        `"${keyword}"의 향후 1년 전망은?`,
        `"${keyword}"와 관련된 경쟁사는?`,
        `"${keyword}"의 주요 리스크 요인은?`
      ]);
    }
  }, [keyword, analysis]);

  useEffect(() => {
    if (externalCommand) {
      setIsOpen(true);
      handleSend(externalCommand.text);
    }
  }, [externalCommand]);

  useEffect(() => {
    if (!isOpen) {
      window.speechSynthesis.cancel();
      setSpeakingMsgIndex(null);
      setIsListening(false);
    }
  }, [isOpen]);

  // [수정됨] window.confirm 제거하여 즉시 초기화
  const handleReset = () => {
    window.speechSynthesis.cancel();
    setMessages([{ role: 'assistant', text: '대화가 초기화되었습니다. 새로운 질문을 입력해주세요.' }]);
    setSuggestions([]);
  };

  const handleDownloadChat = () => {
    if (messages.length <= 1) {
      alert("저장할 대화 내용이 없습니다.");
      return;
    }
    const chatContent = messages.map(m => 
      `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.text}`
    ).join('\n\n');

    const blob = new Blob([chatContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DongA_AI_Briefing_${new Date().toLocaleDateString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerate = () => {
    if (isLoading || messages.length < 2) return;
    
    // Fix: Replacement for findLastIndex which is not available in older targets
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex !== -1) {
      const lastUserText = messages[lastUserMessageIndex].text;
      setMessages(prev => prev.slice(0, lastUserMessageIndex + 1));
      setIsLoading(true);
      requestAI(lastUserText);
    }
  };

  const handleSpeak = (text: string, index: number) => {
    if (speakingMsgIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingMsgIndex(null);
    } else {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/(https?:\/\/[^\s\)]+)/g, '').replace(/\*\*/g, '').replace(/\(출처.*?\)/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'ko-KR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onend = () => setSpeakingMsgIndex(null);
      setSpeakingMsgIndex(index);
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. (Chrome 사용 권장)");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
      
      if (event.error === 'not-allowed') {
        alert("⚠️ 마이크 권한이 차단되었습니다.\n브라우저 주소창 옆의 '자물쇠' 아이콘을 눌러 마이크 권한을 허용해주세요.");
      } else if (event.error === 'no-speech') {
        // 음성이 감지되지 않음 (조용히 종료)
      } else {
        alert("음성 인식 중 오류가 발생했습니다: " + event.error);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error(e);
    }
  };

  const handleFeedback = (type: 'up' | 'down') => {
    // 샌드박스 환경에서는 alert가 차단될 수 있으므로 console.log로 대체하거나 UI 피드백 권장
    console.log(type === 'up' ? "User liked the response" : "User disliked the response");
  };

  const renderContent = (text: string) => {
    if (!text) return "";
    const cleaned = text
      .replace(/(https?:\/\/[^\s\)]+)/g, '')
      .replace(/\(출처.*?\)/g, '')
      .replace(/###/g, '')
      .replace(/\\n/g, '\n')
      .replace(/(?:\r\n|\r|\n)/g, '\n')
      .trim();

    const parts = cleaned.split(/(\*\*.*?\*\*)/g);
    
    return (
      <>
        {parts.map((part, index) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={index} className="font-bold text-inherit">{part.slice(2, -2)}</strong>;
          }
          return <span key={index}>{part}</span>;
        })}
      </>
    );
  };

  const handleCopy = async (text: string) => {
    try {
      const plainText = text.replace(/(https?:\/\/[^\s\)]+)/g, '').replace(/\*\*/g, '').replace(/\\n/g, '\n');
      await navigator.clipboard.writeText(plainText);
      // alert 대신 콘솔이나 토스트 메시지를 사용하는 것이 좋습니다. 여기선 콘솔로 대체
      console.log("복사 완료");
    } catch (err) {
      console.error("복사 실패");
    }
  };

  // ✅ [추가] 모델이 줄글로 답해도 1~5 번호/줄바꿈으로 강제 정리
  const formatAssistantAnswer = (text: string) => {
    if (!text) return text;

    // 기본 정리
    let t = text
      .replace(/\r\n/g, '\n')
      .replace(/\\n/g, '\n')
      .trim();

    // 이미 번호 목록이 있으면: 번호 앞 줄바꿈 보정
    const hasNumbering = /(^|\n)\s*1\.\s/.test(t);
    if (hasNumbering) {
      t = t
        .replace(/\n{3,}/g, '\n\n')
        .replace(/(\n|^)\s*(\d+)\.\s*/g, (m, p1, num) => `${p1}${num}. `);
      // 번호 사이에 빈줄 넣기(가독성)
      t = t.replace(/\n(\d+\.)/g, '\n\n$1').replace(/\n{3,}/g, '\n\n').trim();
      return t;
    }

    // 줄바꿈이 거의 없고 너무 긴 경우: 문장 단위로 잘라 1~5로 재구성
    const tooLongOneParagraph = t.length > 160 && !t.includes('\n');
    if (tooLongOneParagraph) {
      // 한국어/영문 문장 분리(최대한 보수적으로)
      const sentences = t
        .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=니다\.)\s+|(?<=요\.)\s+/)
        .map(s => s.trim())
        .filter(Boolean);

      const picked = sentences.slice(0, 5);
      if (picked.length >= 2) {
        return picked.map((s, i) => `${i + 1}. ${s}`).join('\n\n').trim();
      }

      // 문장 분리가 실패하면 길이 기준으로 5등분
      const chunks: string[] = [];
      const target = Math.ceil(t.length / 5);
      for (let i = 0; i < 5; i++) {
        const start = i * target;
        const end = Math.min((i + 1) * target, t.length);
        const chunk = t.slice(start, end).trim();
        if (chunk) chunks.push(chunk);
      }
      return chunks.slice(0, 5).map((c, i) => `${i + 1}. ${c}`).join('\n\n').trim();
    }

    // 그 외: 적당히 문단만 정리
    return t.replace(/\n{3,}/g, '\n\n').trim();
  };

  const requestAI = async (text: string) => {
    try {
      let prompt = `사용자 질문: "${text}"\n\n`;
      if (analysis) {
        prompt += `[현재 분석 리포트 컨텍스트]\n키워드: ${keyword}\n요약: ${analysis.summary}\n핵심 포인트: ${analysis.keyPoints.join(', ')}\n\n`;
        prompt += `
위 분석 내용을 바탕으로 사용자의 질문에 답변해줘.

[출력 규칙 - 매우 중요]
- 답변은 반드시 "1. ~ 5." 번호 목록 형태로 작성 (총 5개)
- 각 항목은 1~2문장, 간결하게
- 각 번호 항목 사이에 줄바꿈(빈 줄) 포함해서 가독성 좋게
- 출처 링크나 URL을 절대 포함하지 마
- 불필요한 서론/마무리 인사 없이 핵심만
`;
      } else {
        prompt += `
아직 분석 리포트가 생성되지 않았습니다. 일반적인 트렌드 전문가로서 답변해줘.

[출력 규칙 - 매우 중요]
- 답변은 반드시 "1. ~ 5." 번호 목록 형태로 작성 (총 5개)
- 각 항목은 1~2문장, 간결하게
- 각 번호 항목 사이에 줄바꿈(빈 줄) 포함해서 가독성 좋게
- 출처 링크나 URL을 절대 포함하지 마
- 불필요한 서론/마무리 인사 없이 핵심만
`;
      }

      // Fix: Now uses the updated generateExpandedContent which supports 3 arguments
      const response = await generateExpandedContent(prompt, 'sns', '');
      const formatted = formatAssistantAnswer(response);

      setMessages(prev => [...prev, { role: 'assistant', text: formatted }]);
      
      if (keyword) {
        setSuggestions([
          `"${keyword}" 관련 최신 뉴스 요약해줘`,
          `이 트렌드가 내 비즈니스에 미칠 영향은?`,
          `더 자세한 데이터나 통계가 있어?`
        ]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', text: "죄송합니다. 답변을 생성하는 중 오류가 발생했습니다." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim()) return;

    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');
    setSuggestions([]);
    setIsLoading(true);
    
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    await requestAI(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-8 right-8 w-16 h-16 bg-gray-900 text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-black transition-all hover:scale-110 z-50 group"
        >
          <MessageSquare size={28} className="group-hover:animate-pulse" />
          <span className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 rounded-full animate-ping"></span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-8 right-8 w-[400px] h-[600px] bg-white rounded-[32px] shadow-2xl flex flex-col overflow-hidden z-50 animate-in slide-in-from-bottom-10 fade-in duration-300 border border-gray-200">
          
          {/* 챗봇 헤더 */}
          <div className="p-6 bg-gray-900 text-white flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center p-1.5 overflow-hidden">
                <img 
                  src={DONGA_LOGO_URL} 
                  alt="AI 로고" 
                  className="w-full h-full object-contain" 
                />
              </div>
              <div>
                <h3 className="font-bold text-lg">동아일보 AI</h3>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span> Online
                </p>
              </div>
            </div>
            
            <div className="flex gap-1">
              <button onClick={handleDownloadChat} className="p-2 hover:bg-white/20 rounded-full transition-colors" title="대화 내용 저장">
                <Download size={18} className="text-gray-300 hover:text-white" />
              </button>
              <button onClick={handleReset} className="p-2 hover:bg-white/20 rounded-full transition-colors" title="대화 초기화">
                <Trash2 size={18} className="text-gray-300 hover:text-white" />
              </button>
              <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#F5F5F7]">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}>
                <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row items-start'}`}>
                  
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${msg.role === 'user' ? 'bg-gray-200' : 'bg-[#0071e3] text-white'}`}>
                    {msg.role === 'user' ? <User size={16} className="text-gray-600" /> : <Bot size={16} />}
                  </div>

                  <div className="relative group">
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words ${
                      msg.role === 'user' 
                        ? 'bg-white text-gray-800 rounded-tr-none' 
                        : 'bg-[#0071e3] text-white rounded-tl-none'
                    }`}>
                      {renderContent(msg.text)}
                    </div>

                    {msg.role === 'assistant' && (
                      <div className="flex gap-3 absolute -bottom-8 left-0 opacity-0 group-hover:opacity-100 transition-opacity z-10 px-1">
                        <button onClick={(e) => { e.stopPropagation(); handleCopy(msg.text); }} className="text-xs text-gray-400 hover:text-[#0071e3] transition-colors" title="복사"><Copy size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleSpeak(msg.text, idx); }} className={`text-xs ${speakingMsgIndex === idx ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-[#0071e3]'} transition-colors`} title="듣기">{speakingMsgIndex === idx ? <StopCircle size={12} /> : <Volume2 size={12} />}</button>
                        <button onClick={() => handleFeedback('up')} className="text-xs text-gray-400 hover:text-green-500 transition-colors"><ThumbsUp size={12} /></button>
                        <button onClick={() => handleFeedback('down')} className="text-xs text-gray-400 hover:text-red-500 transition-colors"><ThumbsDown size={12} /></button>
                        {idx === messages.length - 1 && !isLoading && (
                          <button onClick={(e) => { e.stopPropagation(); handleRegenerate(); }} className="text-xs text-gray-400 hover:text-[#0071e3] transition-colors" title="다시 생성"><RefreshCw size={12} /></button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-3 max-w-[85%]">
                  <div className="w-8 h-8 rounded-full bg-[#0071e3] text-white flex items-center justify-center shrink-0">
                    <Bot size={16} />
                  </div>
                  <div className="p-4 bg-[#0071e3] rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1">
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            )}

            {!isLoading && suggestions.length > 0 && (
              <div 
                className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 mt-4"
              >
                <p className="text-xs font-bold text-gray-400 ml-1">추천 질문</p>
                {suggestions.map((sug, idx) => (
                  <button 
                    key={idx} 
                    onClick={() => handleSend(sug)}
                    className="text-left px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 hover:border-[#0071e3] hover:text-[#0071e3] transition-all shadow-sm flex items-center justify-between group"
                  >
                    {sug}
                    <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white border-t border-gray-100 shrink-0">
            <div className="flex gap-2 items-end bg-gray-50 rounded-[24px] px-4 py-3 border border-gray-200 focus-within:border-[#0071e3] focus-within:ring-2 focus-within:ring-[#0071e3]/20 transition-all">
              
              {/* 마이크 버튼 */}
              <button 
                onClick={toggleVoiceInput}
                className={`p-2 rounded-full transition-all shrink-0 mb-0.5 ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                title="음성 인식"
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? "듣고 있습니다..." : "무엇이든 물어보세요..."}
                className="flex-1 bg-transparent border-none focus:outline-none text-sm py-1 resize-none max-h-[120px] overflow-y-auto custom-scrollbar"
                rows={1}
                disabled={isLoading}
              />
              <button 
                onClick={() => handleSend()} 
                disabled={isLoading || !input.trim()}
                className="p-2 bg-[#0071e3] text-white rounded-full hover:bg-[#0077ED] disabled:opacity-50 disabled:hover:bg-[#0071e3] transition-all shadow-md shrink-0 mb-0.5"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;