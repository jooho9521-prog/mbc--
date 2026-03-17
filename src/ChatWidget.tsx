import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  X,
  Send,
  Bot,
  User,
  Sparkles,
  Trash2,
  Copy,
  Download,
  RefreshCw,
  Volume2,
  StopCircle,
  ThumbsUp,
  ThumbsDown,
  Mic,
  MicOff,
  ChevronDown,
  Wand2,
  Brain,
  BarChart3,
  Search,
} from "lucide-react";
import { TrendAnalysis } from "./types";
import { generateExpandedContent } from "./services/geminiService";

const DONGA_LOGO_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj4KICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0OCIgc3Ryb2tlPSIjMDA3YTczIiBzdHJva2Utd2lkdGg9IjUiIGZpbGw9Im5vbmUiLz4KICA8cGF0aCBkPSJNNTAgMiB2OTYgTTIgNTAgaDk2IiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIvPgogIDxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjMwIiBzdHJva2U9IiMwMDdhNzMiIHN0cm9rZS13aWR0aD0iNSIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==";

interface Props {
  analysis: TrendAnalysis | null;
  keyword?: string;
  externalCommand?: { text: string; time: number } | null;
}

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
}

type AnswerMode = "balanced" | "deep" | "strategy" | "critical";
type AnswerLength = "short" | "medium" | "long";

const STORAGE_KEY = "trendpulse_chatwidget_state_v2";

const MODE_META: Record<
  AnswerMode,
  { label: string; desc: string; icon: React.ReactNode }
> = {
  balanced: {
    label: "균형형",
    desc: "핵심과 맥락을 함께 설명",
    icon: <Sparkles size={14} />,
  },
  deep: {
    label: "심층형",
    desc: "배경·의미·전망까지 자세히",
    icon: <Brain size={14} />,
  },
  strategy: {
    label: "전략형",
    desc: "실행 방안 중심",
    icon: <BarChart3 size={14} />,
  },
  critical: {
    label: "비판형",
    desc: "리스크와 반론 중심",
    icon: <Search size={14} />,
  },
};

const INITIAL_ASSISTANT_MESSAGE =
  "안녕하세요. 동아일보 AI 도우미입니다.";

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanForSpeech(text: string) {
  return String(text || "")
    .replace(/(https?:\/\/[^\s\)]+)/g, "")
    .replace(/\*\*/g, "")
    .replace(/\(출처.*?\)/g, "")
    .replace(/\[출처.*?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanForRender(text: string) {
  return String(text || "")
    .replace(/(https?:\/\/[^\s\)]+)/g, "")
    .replace(/\(출처.*?\)/g, "")
    .replace(/\[출처.*?\]/g, "")
    .replace(/###/g, "")
    .replace(/\\n/g, "\n")
    .replace(/(?:\r\n|\r|\n)/g, "\n")
    .trim();
}

function formatAssistantAnswer(text: string) {
  if (!text) return text;

  let t = cleanForRender(text).replace(/\n{3,}/g, "\n\n").trim();

  const hasNumbering = /(^|\n)\s*1\.\s/.test(t);
  if (hasNumbering) {
    t = t.replace(/(\n|^)\s*(\d+)\.\s*/g, (_, p1, num) => `${p1}${num}. `);
    t = t.replace(/\n(\d+\.)/g, "\n\n$1").replace(/\n{3,}/g, "\n\n").trim();
    return enforceFivePointAnswer(t);
  }

  const sentences = t
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=니다\.)\s+|(?<=요\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length >= 3) {
    return sentences
      .slice(0, 5)
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n\n");
  }

  return enforceFivePointAnswer(t);
}


function enforceFivePointAnswer(text: string) {
  const normalized = cleanForRender(text)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return normalized;

  const blockMatches = Array.from(
    normalized.matchAll(/(?:^|\n)\s*(\d)\.\s*([\s\S]*?)(?=(?:\n\s*\d\.\s)|$)/g)
  );

  const blocks = blockMatches
    .map((m) => `${m[1]}. ${String(m[2] || "").trim()}`)
    .filter((v) => /\S/.test(v));

  const sentences = normalized
    .replace(/(?:^|\n)\s*\d\.\s*/g, " ")
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|(?<=니다\.)\s+|(?<=요\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seeded = blocks.length ? blocks : sentences.map((s, i) => `${i + 1}. ${s}`);

  const result: string[] = [];
  for (const item of seeded) {
    if (result.length >= 5) break;
    const content = String(item).replace(/^\s*\d\.\s*/, "").trim();
    if (content) result.push(content);
  }

  let cursor = 0;
  while (result.length < 5 && cursor < sentences.length) {
    const candidate = sentences[cursor++].trim();
    if (!candidate) continue;
    if (result.some((existing) => existing === candidate)) continue;
    result.push(candidate);
  }

  while (result.length < 5) {
    result.push("추가 확인이 필요한 부분까지 포함해 핵심 쟁점을 정리했습니다.");
  }

  return result
    .slice(0, 5)
    .map((content, index) => `${index + 1}. ${content}`)
    .join("\n\n");
}

function buildAnalysisContext(analysis: TrendAnalysis | null, keyword?: string) {
  if (!analysis) {
    return `현재 분석 리포트가 아직 생성되지 않았습니다. 일반적인 산업·시장 관점에서 답변하세요.`;
  }

  const points = Array.isArray(analysis.keyPoints) ? analysis.keyPoints.join("\n- ") : "";
  const citations = Array.isArray((analysis as any).citations)
    ? (analysis as any).citations
        .slice(0, 5)
        .map((c: any, idx: number) => `${idx + 1}. ${c?.title || ""}`)
        .join("\n")
    : "";

  return `
[현재 분석 리포트 컨텍스트]
키워드: ${keyword || ""}
요약:
${analysis.summary || ""}

핵심 포인트:
- ${points || "없음"}

감성: ${analysis.sentiment || "neutral"}
성장 점수: ${analysis.growthScore ?? 0}
참고 기사 제목:
${citations || "없음"}
`.trim();
}

function buildConversationContext(messages: Message[]) {
  const recent = messages.slice(-8);
  return recent
    .map((m) => `[${m.role === "user" ? "사용자" : "AI"}] ${m.text}`)
    .join("\n\n");
}

function buildPrompt(params: {
  userText: string;
  analysis: TrendAnalysis | null;
  keyword?: string;
  mode: AnswerMode;
  length: AnswerLength;
  includeAnalysis: boolean;
  messages: Message[];
}) {
  const { userText, analysis, keyword, mode, length, includeAnalysis, messages } = params;

  const lengthRule =
    length === "short"
      ? "각 번호 항목은 1~2문장으로 답하세요."
      : length === "medium"
        ? "각 번호 항목은 2~3문장으로 답하세요."
        : "각 번호 항목은 3~5문장으로 답하고, 배경과 시사점까지 포함하세요.";

  const modeRule =
    mode === "deep"
      ? "표면적 요약보다 배경, 구조적 원인, 시사점, 향후 변화를 자세히 설명하세요."
      : mode === "strategy"
        ? "사용자에게 실질적으로 도움이 되는 실행 전략, 우선순위, 대응 방안을 중심으로 답하세요."
        : mode === "critical"
          ? "반론, 리스크, 불확실성, 과장 가능성을 적극적으로 검토하며 답하세요."
          : "균형 잡힌 관점으로 장점과 리스크를 함께 설명하세요.";

  const analysisContext = includeAnalysis ? buildAnalysisContext(analysis, keyword) : "";
  const conversationContext = buildConversationContext(messages);

  return `
당신은 동아일보용 고급 AI 분석 어시스턴트입니다.
질문 의도 파악, 대화 맥락 유지, 산업·시장·전략 관점의 설명에 능숙해야 합니다.

[대화 히스토리]
${conversationContext || "없음"}

${analysisContext ? `${analysisContext}\n` : ""}

[사용자 질문]
"${userText}"

[응답 규칙]
1. 반드시 한국어로 답변하세요.
2. 무엇보다도 "마지막 사용자 질문"에 직접적으로 답하세요. 추천 질문 예시를 반복하거나 다른 질문으로 바꾸지 마세요.
3. 사용자가 자유롭게 입력한 질문도 추천 질문과 동일한 수준으로 충실하게 답하세요.
4. 답변은 "1. ~ 5." 번호 목록 형식으로 작성하세요.
5. 각 항목 사이에는 빈 줄을 넣어 가독성을 높이세요.
6. ${lengthRule}
7. ${modeRule}
8. 가능하면 "무엇이 중요한지 / 왜 중요한지 / 어떻게 활용할지"가 드러나게 쓰세요.
9. 질문이 구체적이면 그 구체적 포인트부터 바로 답하세요.
10. 링크, URL, 마크다운 코드블록은 쓰지 마세요.
11. 마지막에 군더더기 인사말은 넣지 마세요.
`.trim();
}

function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(cleanForSpeech(text));
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderContent(text: string) {
  const cleaned = cleanForRender(text);
  const parts = cleaned.split(/(\*\*.*?\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={index} className="font-bold text-inherit">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}


function normalizeSuggestion(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function shortenPoint(text: string, max = 46) {
  const t = normalizeSuggestion(String(text || "").replace(/^\d+\.\s*/, ""));
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1).trim() + "…" : t;
}

function buildSuggestionPool(analysis: TrendAnalysis | null, keyword?: string) {
  const pool: string[] = [];
  const add = (value: string) => {
    const v = normalizeSuggestion(value);
    if (!v) return;
    if (pool.includes(v)) return;
    pool.push(v);
  };

  if (keyword) {
    add(`"${keyword}"의 핵심 흐름을 한 번 더 쉽게 설명해줘`);
    add(`"${keyword}"의 가장 큰 리스크 3가지는 뭐야?`);
    add(`"${keyword}"를 사업 관점에서 해석해줘`);
    add(`"${keyword}"의 향후 6개월 시나리오를 알려줘`);
    add(`"${keyword}" 관련해서 지금 가장 중요한 변수는 뭐야?`);
    add(`"${keyword}"가 투자 심리에 어떤 영향을 줄 수 있어?`);
  }

  if (analysis?.summary) {
    add(`현재 분석 결과를 5줄로 다시 정리해줘`);
    add(`이 분석에서 가장 중요한 한 줄 결론은 뭐야?`);
  }

  if (Array.isArray(analysis?.keyPoints)) {
    analysis.keyPoints.slice(0, 4).forEach((point, idx) => {
      const short = shortenPoint(point);
      if (!short) return;
      add(`"${short}" 이 부분을 더 자세히 설명해줘`);
      add(`"${short}" 이 내용이 왜 중요한지 설명해줘`);
      if (idx === 0) add(`첫 번째 핵심 포인트를 쉽게 풀어서 설명해줘`);
    });
  }

  if (analysis?.sentiment) {
    add(`이번 이슈를 ${analysis.sentiment === "positive" ? "낙관적" : analysis.sentiment === "negative" ? "보수적" : "중립적"} 관점에서 다시 설명해줘`);
  }

  add("핵심 리스크를 정리해줘");
  add("실행 전략을 제안해줘");
  add("반대 관점도 같이 설명해줘");
  add("향후 시장 영향을 예측해줘");

  return pool;
}

const ChatWidget: React.FC<Props> = ({ analysis, keyword, externalCommand }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: uid(), role: "assistant", text: INITIAL_ASSISTANT_MESSAGE, createdAt: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode>("balanced");
  const [answerLength, setAnswerLength] = useState<AnswerLength>("medium");
  const [includeAnalysis, setIncludeAnalysis] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [usedSuggestions, setUsedSuggestions] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const suggestionPool = useMemo(() => buildSuggestionPool(analysis, keyword), [analysis, keyword]);

  const quickSuggestions = useMemo(() => {
    const asked = new Set(
      messages
        .filter((m) => m.role === "user")
        .map((m) => normalizeSuggestion(m.text))
        .filter(Boolean)
    );
    const used = new Set(usedSuggestions.map(normalizeSuggestion));
    return suggestionPool
      .filter((s) => {
        const key = normalizeSuggestion(s);
        return key && !asked.has(key) && !used.has(key);
      })
      .slice(0, 4);
  }, [suggestionPool, messages, usedSuggestions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isOpen]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 130)}px`;
    }
  }, [input]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved?.messages) && saved.messages.length) {
        setMessages(saved.messages);
      }
      if (typeof saved?.answerMode === "string") setAnswerMode(saved.answerMode);
      if (typeof saved?.answerLength === "string") setAnswerLength(saved.answerLength);
      if (typeof saved?.includeAnalysis === "boolean") setIncludeAnalysis(saved.includeAnalysis);
    } catch {}
  }, []);

  useEffect(() => {
    setUsedSuggestions([]);
  }, [keyword, analysis?.summary, JSON.stringify(analysis?.keyPoints || [])]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ messages, answerMode, answerLength, includeAnalysis })
      );
    } catch {}
  }, [messages, answerMode, answerLength, includeAnalysis]);

  useEffect(() => {
    if (externalCommand?.text) {
      setIsOpen(true);
      handleSend(externalCommand.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCommand]);

  useEffect(() => {
    if (!isOpen) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
    }
  }, [isOpen]);

  const handleReset = () => {
    window.speechSynthesis.cancel();
    setSpeakingMsgId(null);
    setMessages([
      {
        id: uid(),
        role: "assistant",
        text: "대화를 초기화했습니다. 새로운 질문을 입력해 주세요.",
        createdAt: Date.now(),
      },
    ]);
    setUsedSuggestions([]);
  };

  const handleDownloadChat = () => {
    const chatContent = messages
      .map((m) => `[${m.role === "user" ? "사용자" : "AI"}] ${cleanForSpeech(m.text)}`)
      .join("\n\n");
    downloadTextFile(`TrendPulse_AI_Chat_${new Date().toLocaleDateString("ko-KR")}.txt`, chatContent);
  };

  const handleCopy = async (text: string) => {
    try {
      await copyToClipboard(text);
      console.log("복사 완료");
    } catch {
      console.error("복사 실패");
    }
  };

  const handleSpeak = (text: string, id: string) => {
    if (speakingMsgId === id) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text));
    utterance.lang = "ko-KR";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setSpeakingMsgId(null);
    setSpeakingMsgId(id);
    window.speechSynthesis.speak(utterance);
  };

  const toggleVoiceInput = () => {
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 사용을 권장합니다.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "ko-KR";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript.trim());
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") {
        alert("마이크 권한이 차단되었습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.");
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error(e);
    }
  };

  const handleFeedback = (type: "up" | "down") => {
    console.log(type === "up" ? "User liked response" : "User disliked response");
  };

  const requestAI = async (userText: string, historyBase?: Message[]) => {
    const history = historyBase || messages;

    try {
      const prompt = buildPrompt({
        userText,
        analysis,
        keyword,
        mode: answerMode,
        length: answerLength,
        includeAnalysis,
        messages: history,
      });

      const response = await generateExpandedContent(`다음 마지막 사용자 질문에 직접 답하세요. 질문을 다른 형태로 바꾸지 말고, 질문에서 요구한 포인트를 먼저 설명하세요.\n\n${prompt}`, "sns", "");
      const formatted = formatAssistantAnswer(String(response || ""));

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: formatted || "응답을 생성하지 못했습니다.",
          createdAt: Date.now(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: "죄송합니다. 답변을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };


  const handleSuggestionClick = async (suggestion: string) => {
    const normalized = normalizeSuggestion(suggestion);
    setUsedSuggestions((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    await handleSend(suggestion);
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: uid(),
      role: "user",
      text,
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    await requestAI(text, [...messages, userMessage]);
  };

  const handleRegenerate = async () => {
    if (isLoading) return;

    let lastUser: Message | null = null;
    const trimmed: Message[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      if (!lastUser && messages[i].role === "user") {
        lastUser = messages[i];
        trimmed.unshift(...messages.slice(0, i + 1));
        break;
      }
    }

    if (!lastUser) return;

    setMessages(trimmed);
    setIsLoading(true);
    await requestAI(lastUser.text, trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentModeMeta = MODE_META[answerMode];

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-8 right-8 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-gray-900 text-white shadow-2xl transition-all hover:scale-110 hover:bg-black"
        >
          <MessageSquare size={28} />
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0071e3] px-1 text-[10px] font-black text-white">
            AI
          </span>
        </button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[720px] w-[460px] flex-col overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-2xl">
          {/* Header */}
          <div className="shrink-0 bg-gray-900 px-5 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white p-1.5">
                  <img src={DONGA_LOGO_URL} alt="AI 로고" className="h-full w-full object-contain" />
                </div>
                <div>
                  <h3 className="text-lg font-black">동아일보 AI 비서</h3>
                  <p className="mt-0.5 text-xs text-white/70">
                    {keyword ? `현재 주제: ${keyword}` : "리포트 기반 대화 지원"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full bg-white/10 p-2 transition hover:bg-white/20"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
              {(Object.keys(MODE_META) as AnswerMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAnswerMode(mode)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    answerMode === mode
                      ? "bg-white text-gray-900"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {MODE_META[mode].icon}
                  {MODE_META[mode].label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold text-white/75">
                {currentModeMeta.desc}
              </div>
              <button
                onClick={() => setShowSettings((v) => !v)}
                className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/20"
              >
                설정 <ChevronDown size={14} className={`transition ${showSettings ? "rotate-180" : ""}`} />
              </button>
            </div>

            {showSettings && (
              <div className="mt-4 rounded-2xl bg-white/8 p-3">
                <div className="mb-2 text-[11px] font-bold text-white/80">답변 길이</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["short", "medium", "long"] as AnswerLength[]).map((len) => (
                    <button
                      key={len}
                      onClick={() => setAnswerLength(len)}
                      className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                        answerLength === len
                          ? "bg-white text-gray-900"
                          : "bg-white/10 text-white"
                      }`}
                    >
                      {len === "short" ? "짧게" : len === "medium" ? "보통" : "길게"}
                    </button>
                  ))}
                </div>

                <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-white/80">
                  <input
                    type="checkbox"
                    checked={includeAnalysis}
                    onChange={(e) => setIncludeAnalysis(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  현재 분석 리포트 문맥 포함
                </label>
              </div>
            )}
          </div>

          {/* Suggestions */}
          <div className="shrink-0 border-b border-gray-100 bg-gray-50 px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400">
              <Wand2 size={12} />
              추천 질문
            </div>
            <div className="flex flex-wrap gap-2">
              {quickSuggestions.length === 0 ? (
                <div className="text-xs font-semibold text-gray-400">새 질문을 몇 개 더 하거나 새 검색을 하면 추천 질문이 새로 생성됩니다.</div>
              ) : quickSuggestions.map((s, idx) => (
                <button
                  key={`${s}_${idx}`}
                  onClick={() => handleSuggestionClick(s)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto bg-[#fafafa] px-4 py-4">
            <div className="space-y-4">
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`flex max-w-[88%] gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                      <div
                        className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                          isUser ? "bg-gray-900 text-white" : "bg-[#0071e3] text-white"
                        }`}
                      >
                        {isUser ? <User size={16} /> : <Bot size={16} />}
                      </div>

                      <div>
                        <div
                          className={`rounded-2xl px-4 py-3 shadow-sm ${
                            isUser
                              ? "bg-gray-900 text-white"
                              : "border border-gray-100 bg-white text-gray-900"
                          }`}
                        >
                          <div className="whitespace-pre-line break-words text-[14px] leading-7">
                            {renderContent(msg.text)}
                          </div>
                        </div>

                        {!isUser && (
                          <div className="mt-2 flex items-center gap-1 text-gray-400">
                            <button
                              onClick={() => handleCopy(msg.text)}
                              className="rounded-lg p-1.5 transition hover:bg-gray-200"
                              title="복사"
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              onClick={() => handleSpeak(msg.text, msg.id)}
                              className="rounded-lg p-1.5 transition hover:bg-gray-200"
                              title="읽기"
                            >
                              {speakingMsgId === msg.id ? <StopCircle size={14} /> : <Volume2 size={14} />}
                            </button>
                            <button
                              onClick={() => handleFeedback("up")}
                              className="rounded-lg p-1.5 transition hover:bg-gray-200"
                              title="좋아요"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback("down")}
                              className="rounded-lg p-1.5 transition hover:bg-gray-200"
                              title="별로예요"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex max-w-[88%] gap-2">
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white">
                      <Bot size={16} />
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-500">
                        <RefreshCw size={14} className="animate-spin" />
                        분석 중...
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Footer actions */}
          <div className="shrink-0 border-t border-gray-100 bg-white px-4 pb-4 pt-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={isLoading || messages.length < 2}
                  className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-2 text-[11px] font-bold text-gray-700 transition hover:bg-gray-200 disabled:opacity-50"
                >
                  <RefreshCw size={12} />
                  다시 생성
                </button>

                <button
                  onClick={handleDownloadChat}
                  className="flex items-center gap-1 rounded-full bg-gray-100 px-3 py-2 text-[11px] font-bold text-gray-700 transition hover:bg-gray-200"
                >
                  <Download size={12} />
                  TXT 저장
                </button>
              </div>

              <button
                onClick={handleReset}
                className="flex items-center gap-1 rounded-full bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600 transition hover:bg-red-100"
              >
                <Trash2 size={12} />
                초기화
              </button>
            </div>

            <div className="rounded-[24px] border border-gray-200 bg-gray-50 p-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="질문을 입력하세요. 예: 이 이슈가 투자 관점에서 왜 중요한가요?"
                  className="max-h-[130px] min-h-[48px] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400"
                />

                <button
                  onClick={toggleVoiceInput}
                  className={`flex h-11 w-11 items-center justify-center rounded-full transition ${
                    isListening
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                  title="음성 입력"
                >
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                </button>

                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-black disabled:opacity-40"
                  title="전송"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
