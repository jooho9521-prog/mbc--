import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { generateExpandedContent, generateTTS } from "../services/geminiService";
import { generateImage } from "../services/imageService";
import CardNewsGenerator from "./CardNewsGenerator";
import {
  Sparkles,
  Loader2,
  ClipboardList,
  Palette,
  Mic2,
  User,
  Play,
  Square,
  AudioLines,
  Download,
  Gauge,
  LayoutTemplate,
  Instagram,
  Wand2,
  Activity,
  Wand,
} from "lucide-react";

interface Props {
  keyword?: string;
  summary: string;
  expandedData: {
    image: { img: string; cardData: { title: string; body: string } } | null;
    video: string | null;
    sns: string | null;
  };
  setExpandedData: React.Dispatch<
    React.SetStateAction<{
      image: { img: string; cardData: { title: string; body: string } } | null;
      video: string | null;
      sns: string | null;
    }>
  >;
  onShowToast: (msg: string) => void;
  onOpenReport: () => void;
}

/** ---------- Utils ---------- **/

const cleanAndFormatText = (text: string) => {
  if (!text) return "";
  return text
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/(https?:\/\/[^\s]+)/g, "")
    .replace(/\*\*/g, "")
    .replace(/###/g, "")
    .trim();
};

const cleanHeadline = (text: string) => {
  if (!text) return "";
  let cleaned = text
    .replace(/\[HEADLINE\]/gi, "")
    .replace(/^(HEADLINE|TITLE|제목|주제)\s*[:\-]?\s*/i, "")
    .replace(/^[\d]+\.\s*/, "")
    .replace(/^\d+\s+/, "")
    .replace(/^[\-\*#]\s*/, "")
    .replace(/["']/g, "")
    .replace(/\[.*?\]/g, "")
    .trim();
  return cleaned;
};

const STOPWORDS = new Set([
  // KR
  "관련",
  "속보",
  "단독",
  "분석",
  "전망",
  "가능",
  "논란",
  "사실",
  "이유",
  "결과",
  "기자",
  "뉴스",
  "기사",
  "내용",
  "이번",
  "오늘",
  "최근",
  "지난",
  "대한",
  "에서",
  "으로",
  "그리고",
  "있다",
  "했다",
  "한다",
  "된다",
  "하는",
  "하며",
  "부터",
  "까지",
  "등",
  "및",
  // EN
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "from",
  "as",
  "at",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
]);

const normalizeForKeywords = (t: string) =>
  (t || "")
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractTopKeywords = (headline: string, body: string, max = 6) => {
  const text = normalizeForKeywords(`${headline} ${body}`);
  const tokens = text
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 2)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));

  const freq = new Map<string, number>();

  const headText = normalizeForKeywords(headline);
  const headSet = new Set(headText.split(" ").filter(Boolean));

  for (const w of tokens) {
    const key = w.toLowerCase();
    const weight = headSet.has(w) ? 3 : 1;
    freq.set(key, (freq.get(key) || 0) + weight);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, max);
};

const pickOne = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** ---------- Enterprise prompt (Apple minimal brief tone) ---------- **/

// ✅ placeholder (고정값 X) : keyword + summary 기반, 기업용 브리프 말투
const buildAppleMinimalPlaceholder = (keyword?: string, summary?: string) => {
  const k = (keyword || "").trim();
  const s = cleanAndFormatText(summary || "");

  // seed가 없으면 “애플 미니멀 브리프 스타일” 기본 예시
  if (!k && !s) {
    return `예) “애플 미니멀 브리프 스타일”`;
  }

  const seed = k || "핵심 이슈";
  const kws = extractTopKeywords(seed, s || seed, 6).filter((x) => x && x !== "news");
  const uniq = Array.from(new Set(kws)).slice(0, 4);

  // 너무 구어체/불필요 단어 제거
  const ban = new Set(["있습니다", "입니다", "합니다", "하세요", "테스트", "뉴스", "기사"]);
  const filtered = uniq.filter((x) => !ban.has(x));

  const a = filtered[0] || "시장 구조";
  const b = filtered[1] || "핵심 변수";
  const c = filtered[2] || "리스크/기회";

  // ✅ 한 줄 예시(브리프 톤)
  return `예) “${seed}: ${a} 변화와 ${b}가 의미하는 전략” / “${seed}: ${c} 시나리오와 우선순위 액션”`;
};

// ✅ 추천 프롬프트(기업용 3종) : 싸구려 말투 금지, 고급 편집/브랜딩 톤
const buildEnterprisePromptSuggestions = (seed: string, context: string) => {
  const s = (seed || "주제").trim();
  const kws = extractTopKeywords(s, context, 8).slice(0, 6);
  const kwLine = kws.length ? kws.join(", ") : "key themes";

  const commonRules =
    "minimal, premium, editorial, clean composition, strong negative space, no text, no watermark, no logo, no letters, no UI, no collage";

  return [
    `Premium editorial key visual for “${s}”. Focus: ${kwLine}. Photorealistic, studio-grade lighting, restrained palette, high clarity, ${commonRules}.`,
    `Minimal product-style hero image for “${s}”. Visual metaphor: ${kwLine}. High-end commercial photography, soft shadows, precise detail, ${commonRules}.`,
    `Documentary-meets-brand visual for “${s}”. Scene: ${kwLine}. Natural light, authentic materials, cinematic framing, premium finish, ${commonRules}.`,
  ];
};

// ✅ 실제 이미지 생성에 들어갈 “강화 프롬프트”
const buildEnhancedImagePrompt = (headline: string, contextBody: string, manualPrompt?: string) => {
  const h = cleanHeadline(headline || "");
  const body = cleanAndFormatText(contextBody || "");

  const kws = extractTopKeywords(h || manualPrompt || "", body, 6);
  const kwLine = kws.length ? kws.join(", ") : "";

  const sceneVariants = [
    "premium editorial photography",
    "high-end commercial key visual",
    "minimal cinematic scene",
    "modern documentary style",
    "clean brand campaign image",
  ];
  const cameraVariants = [
    "shot on 85mm lens, shallow depth of field",
    "35mm documentary lens, natural perspective",
    "50mm lens, crisp details",
    "cinematic framing, balanced composition",
  ];
  const lightingVariants = [
    "soft studio lighting with gentle shadows",
    "natural light, controlled contrast",
    "low-key lighting, premium mood",
    "high-key clean lighting, subtle gradients",
  ];

  const compositionRules =
    "No text, no watermark, no logo, no letters, no UI elements. Clean background. Strong negative space. Single subject or single clear scene. Not a collage.";

  const base =
    manualPrompt && manualPrompt.trim().length > 3
      ? manualPrompt.trim()
      : `Create a ${pickOne(sceneVariants)} for: ${h || "the topic"}.`;

  return `
${base}
Context keywords: ${kwLine || "—"}.
${pickOne(cameraVariants)}.
${pickOne(lightingVariants)}.
${compositionRules}
`.trim();
};

/** ---------- Voice ---------- **/

const GOOGLE_AI_VOICES = [
  { id: "Achemar", label: "Achemar", desc: "차분한 여성" },
  { id: "Zephyr", label: "Zephyr", desc: "표준적인 남성" },
  { id: "Algenib", label: "Algenib", desc: "부드러운 남성" },
  { id: "Algieba", label: "Algieba", desc: "신뢰감 있는 남성" },
  { id: "Alnilam", label: "Alnilam", desc: "깊은 저음의 남성" },
  { id: "Aonde", label: "Aonde", desc: "밝은 여성" },
  { id: "Autonoe", label: "Autonoe", desc: "지적인 여성" },
  { id: "Callirrhoe", label: "Callirrhoe", desc: "우아한 여성" },
  { id: "Charon", label: "Charon", desc: "중후한 남성" },
  { id: "Despina", label: "Despina", desc: "친근한 여성" },
  { id: "Enceladus", label: "Enceladus", desc: "강인한 남성" },
  { id: "Erinome", label: "Erinome", desc: "나긋나긋한 여성" },
  { id: "Fenrir", label: "Fenrir", desc: "무게감 있는 남성" },
  { id: "Gacrux", label: "Gacrux", desc: "차분한 여성" },
  { id: "Iapetus", label: "Iapetus", desc: "섬세한 남성" },
  { id: "Kore", label: "Kore", desc: "활기찬 여성" },
  { id: "Laomedeia", label: "Laomedeia", desc: "정중한 남성" },
  { id: "Leda", label: "Leda", desc: "감성적인 여성" },
  { id: "Orus", label: "Orus", desc: "활달한 남성" },
  { id: "Puck", label: "Puck", desc: "경쾌한 남성" },
  { id: "Pulcherrima", label: "Pulcherrima", desc: "성숙한 여성" },
  { id: "Rasalgethi", label: "Rasalgethi", desc: "안정적인 남성" },
  { id: "Sadachbia", label: "Sadachbia", desc: "따뜻한 남성" },
  { id: "Sadaltager", label: "Sadaltager", desc: "울림 있는 남성" },
  { id: "Schedar", label: "Schedar", desc: "명료한 남성" },
  { id: "Sulafat", label: "Sulafat", desc: "부드러운 여성" },
  { id: "Umbriel", label: "Umbriel", desc: "차분한 남성" },
  { id: "Vindemiatrix", label: "Vindemiatrix", desc: "매끄러운 여성" },
  { id: "Zubenelgenubi", label: "Zubenelgenubi", desc: "진중한 남성" },
];

const VOICE_STYLES = [
  { id: "neutral", name: "😐 기본 (뉴스톤)", prompt: "Calm, professional, clear pronunciation, like a news anchor" },
  { id: "documentary", name: "📽️ 다큐멘터리", prompt: "Serious, deep, slow, cinematic narration" },
  { id: "lecture", name: "🎓 강의/교수님", prompt: "Educational, informative, slow, clear, explaining tone" },
  { id: "radio_dj", name: "📻 심야 라디오 DJ", prompt: "Soft, buttery, low pitch, romantic, late night vibe" },
  { id: "announcement", name: "📢 안내방송", prompt: "Polite, clear, echoing, airport or subway announcement style" },
  { id: "speech", name: "🗣️ 웅변/연설", prompt: "Powerful, loud, persuasive, public speaking tone" },
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5];

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
}
function pcmToWav(pcmData: Uint8Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcmData.length, true);
  return new Blob([header, pcmData], { type: "audio/wav" });
}

/** ---------- Styles ---------- **/

const IMAGE_STYLE_CATEGORIES_LOCAL = [
  { id: "auto", name: "자동", range: [1, 30] },
  { id: "photorealistic", name: "초현실주의 실사", range: [1, 10] },
  { id: "3d_art", name: "3D & 아트", range: [11, 20] },
  { id: "logo_branding", name: "로고 & 브랜딩", range: [21, 30] },
];

const IMAGE_STYLES = [
  { id: 1, label: "시네마틱 인물", prompt: "Cinematic portrait, premium editorial, shallow depth of field" },
  { id: 2, label: "자연광 제품", prompt: "Minimal product photography, soft natural light, clean background" },
  { id: 3, label: "빈티지 필름", prompt: "Film look, subtle grain, restrained tones, authentic" },
  { id: 4, label: "야생 접사", prompt: "Macro photography, high detail, natural texture, bokeh" },
  { id: 5, label: "건축 인테리어", prompt: "Architectural photography, modern interior, clean lines" },
  { id: 6, label: "고급 시계", prompt: "Luxury product shot, dramatic side light, crisp detail" },
  { id: 7, label: "푸드 (디저트)", prompt: "Food photography, warm light, close-up, appetizing texture" },
  { id: 8, label: "패션 룩북", prompt: "Fashion lookbook, minimal styling, editorial framing" },
  { id: 9, label: "자동차 광고", prompt: "Automotive commercial, cinematic motion, premium reflections" },
  { id: 10, label: "드론 풍경", prompt: "Aerial landscape, cinematic scale, high clarity" },
  { id: 11, label: "픽사 3D", prompt: "High-quality 3D render, soft lighting, clean materials" },
  { id: 12, label: "사이버펑크", prompt: "Sci-fi city, neon accents, cinematic mood, detailed" },
  { id: 13, label: "수채화 풍경", prompt: "Watercolor, soft brush, paper texture, calm scene" },
  { id: 14, label: "판타지 RPG", prompt: "Fantasy concept art, detailed, dramatic lighting" },
  { id: 15, label: "로우 폴리", prompt: "Low-poly 3D, geometric, clean shapes, modern palette" },
  { id: 16, label: "카툰 캐릭터", prompt: "Modern cartoon, clean lines, flat shading" },
  { id: 17, label: "다크 판타지", prompt: "Dark fantasy, moody atmosphere, high detail" },
  { id: 18, label: "애니메이션", prompt: "Anime key visual, cinematic composition, soft light" },
  { id: 19, label: "아이소메트릭", prompt: "Isometric illustration, clean vector, minimal color" },
  { id: 20, label: "3D 이모티콘", prompt: "3D emoji set, glossy material, studio lighting" },
  { id: 21, label: "미니멀 로고", prompt: "Minimal logo, geometric, flat design, professional" },
  { id: 22, label: "엠블럼 로고", prompt: "Vintage emblem logo, line art, classic" },
  { id: 23, label: "3D 앱 아이콘", prompt: "3D app icon, glossy, rounded, premium" },
  { id: 24, label: "마스코트 로고", prompt: "Mascot logo, bold lines, esports vibe" },
  { id: 25, label: "패키지 패턴", prompt: "Packaging pattern, seamless, clean vector" },
  { id: 26, label: "브랜드 워드마크", prompt: "Elegant wordmark, luxury, minimal" },
  { id: 27, label: "핀테크 로고", prompt: "Fintech logo, modern, trustworthy, flat" },
  { id: 28, label: "키즈 캐릭터", prompt: "Kids mascot, friendly, rounded shapes" },
  { id: 29, label: "모노그램", prompt: "Monogram, premium, minimal, foil feel" },
  { id: 30, label: "유튜브 배너", prompt: "YouTube banner, clean layout, tech style" },
];

/** ---------- Component ---------- **/

const ContentExpander: React.FC<Props> = ({
  keyword,
  summary,
  expandedData,
  setExpandedData,
  onShowToast,
  onOpenReport,
}) => {
  const [activeTab, setActiveTab] = useState<"card" | "video" | "sns">("card");
  const [loading, setLoading] = useState(false);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);

  const [cardHeadline, setCardHeadline] = useState("");
  const [cardSummary, setCardSummary] = useState(summary || "분석된 내용이 없습니다.");
  const [cardImage, setCardImage] = useState(
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1080&auto=format&fit=crop"
  );

  // ✅ 통합 프롬프트: 기본값 주입 금지(테스트 문구 금지)
  const [unifiedPrompt, setUnifiedPrompt] = useState<string>("");

  // ✅ 스타일 선택
  const [selectedCategory, setSelectedCategory] = useState("auto"); // 기본: 자동
  const [selectedStyleId, setSelectedStyleId] = useState<number>(0); // 0 = 자동(스타일 강제 없음)
  const isAutoMode = selectedCategory === "auto";

  // ✅ TTS
  const [selectedGoogleVoice, setSelectedGoogleVoice] = useState("Zephyr");
  const [selectedStylePresetId, setSelectedStylePresetId] = useState<string>("neutral");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ✅ 초고화질 suffix (프롬프트 기반, UI에 ‘고퀄’ 문구 노출 X)
  const qualitySuffix =
    ", ultra high resolution, premium, photorealistic, high clarity, sharp focus, clean details, cinematic lighting, HDR, professional photography, minimal composition";

  // ✅ 컨텍스트
  const enterpriseContext = useMemo(() => {
    const k = (keyword || "").trim();
    const h = (cardHeadline || "").trim();
    const s = (summary || "").trim();
    const cs = (cardSummary || "").trim();
    return [k, h, s, cs].filter(Boolean).join(" ");
  }, [keyword, cardHeadline, summary, cardSummary]);

  // ✅ 기업용 placeholder (고정값 X)
  const dynamicPlaceholder = useMemo(() => {
    return buildAppleMinimalPlaceholder(keyword, summary);
  }, [keyword, summary]);

  // ✅ 추천 프롬프트(기업용 3개)
  const promptSuggestions = useMemo(() => {
    const seed = (keyword || cardHeadline || unifiedPrompt || "애플 미니멀 브리프 스타일").trim();
    return buildEnterprisePromptSuggestions(seed, enterpriseContext);
  }, [keyword, cardHeadline, unifiedPrompt, enterpriseContext]);

  // ✅ 카드뉴스 텍스트 생성 프롬프트(기업용 톤)
  const cardTextPrompt = useMemo(() => {
    return `
Task: Create a card news summary in KOREAN for enterprise usage.

Rules:
- Professional newsroom tone. Avoid casual expressions (e.g., "~있습니다", "~해요").
- Use concise, factual style. No slang. No emoticons.
- NO URLs.

Format:
[HEADLINE]
(Provocative but professional headline. Strictly NO NUMBERS at start.)

[BODY]
(Write exactly 5 numbered bullet points (1. to 5.).
Use "Noun-ending style" (개조식) like "~함", "~임", "~것" to keep it PROFESSIONAL and SHORT.
Max 40-55 characters per line. Keep each bullet in a single line. No wrapping.)
`.trim();
  }, []);

  useEffect(() => {
    if (summary && summary !== cardSummary) {
      setCardSummary(summary);
      if (!expandedData.image) {
        handleGenerateTitleOnly();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  const handleGenerateTitleOnly = async () => {
    if (isGeneratingTitle || !summary) return;
    setIsGeneratingTitle(true);
    try {
      const rawResponse = await generateExpandedContent(summary, "card", cardTextPrompt);

      let newTitle = "";
      let newBody = "";

      const parts = rawResponse.split("[BODY]");
      if (parts.length >= 2) {
        newTitle = parts[0].replace("[HEADLINE]", "").trim();
        newBody = parts[1].trim();
      } else {
        const lines = rawResponse.split("\n").filter((l) => l.trim() !== "");
        if (lines.length > 0) {
          newTitle = lines[0];
          const bodyStartIndex = lines.findIndex((l) => /^\d+\./.test(l));
          if (bodyStartIndex !== -1) newBody = lines.slice(bodyStartIndex).join("\n");
          else if (lines.length > 1) newBody = lines.slice(1).join("\n");
          else newBody = summary;
        }
      }

      newTitle = cleanHeadline(newTitle);
      newBody = cleanAndFormatText(newBody);

      if (!newTitle || newTitle.length < 2) {
        const firstLine = summary.split(/[.!?\n]/)[0];
        newTitle = cleanHeadline(firstLine);
      }
      if (!newBody || newBody.length < 10) newBody = summary;

      setCardHeadline(newTitle);
      setCardSummary(newBody);
    } catch (e) {
      console.error("Title Gen Error:", e);
      const fallbackTitle = cleanHeadline(summary.split(/[.!?\n]/)[0]);
      setCardHeadline(fallbackTitle);
      setCardSummary(summary);
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const formatScriptForReader = (text: string) => {
    if (!text) return "";
    let cleaned = text.replace(/\[제목\]/g, "").replace(/\\n/g, "\n").trim();
    cleaned = cleaned.replace(/([.!?])\s+(\d+\.)/g, "$1\n\n$2");
    return cleaned;
  };

  useEffect(() => {
    if (activeTab === "video") {
      let formattedText = "";
      if (expandedData.image && expandedData.image.cardData) {
        formattedText = `[제목] ${expandedData.image.cardData.title}\n\n${expandedData.image.cardData.body}`;
      } else {
        formattedText = `[제목] ${cardHeadline || "제목 없음"}\n\n${cardSummary || summary}`;
      }
      if (!expandedData.video || expandedData.video.length < 10) {
        setExpandedData((prev) => ({ ...prev, video: formattedText }));
      }
    }
  }, [activeTab, expandedData.image, cardHeadline, cardSummary, summary, expandedData.video, setExpandedData]);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const link = document.createElement("a");
    link.href = audioUrl;
    link.download = `voice_${Date.now()}.wav`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast("오디오 저장 완료");
  };

  const handleTTS = useCallback(async () => {
    if (isSpeaking) {
      stopSpeaking();
      return;
    }
    const textToRead = formatScriptForReader(expandedData.video || "");
    if (!textToRead.trim()) {
      onShowToast("낭독할 텍스트가 없습니다.");
      return;
    }
    setLoading(true);
    try {
      const stylePrompt = VOICE_STYLES.find((s) => s.id === selectedStylePresetId)?.prompt;
      const base64Audio = await generateTTS(textToRead, selectedGoogleVoice, stylePrompt);
      const audioBytes = decodeBase64(base64Audio);
      const wavBlob = pcmToWav(audioBytes, 24000);
      const url = URL.createObjectURL(wavBlob);

      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.onloadedmetadata = () => {
          audioRef.current?.play().catch((e) => console.error("Playback failed:", e));
          setIsSpeaking(true);
        };
      }
    } catch (err) {
      console.error("TTS Error:", err);
      onShowToast("음성 생성 오류");
    } finally {
      setLoading(false);
    }
  }, [
    expandedData.video,
    isSpeaking,
    selectedGoogleVoice,
    selectedStylePresetId,
    playbackRate,
    onShowToast,
  ]);

  // ✅ 공통 생성: “프롬프트로 이미지 생성” == “카드뉴스 제작 시작” 동일 파이프라인
  const generateCardFromPrompt = async (toastMsg: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const manual = (unifiedPrompt || "").trim();

      const baseContext = (summary || "").trim()
        ? `키워드: ${keyword || ""}\n요약:\n${summary}\n\n사용자 프롬프트:\n${manual || ""}`
        : `사용자 프롬프트:\n${manual || ""}`;

      // 1) 텍스트 생성
      const rawResponse = await generateExpandedContent(baseContext, "card", cardTextPrompt);

      let newTitle = "";
      let newBody = "";

      const parts = rawResponse.split("[BODY]");
      if (parts.length >= 2) {
        newTitle = parts[0].replace("[HEADLINE]", "").trim();
        newBody = parts[1].trim();
      } else {
        const lines = rawResponse.split("\n").filter((l) => l.trim() !== "");
        if (lines.length > 0) {
          newTitle = lines[0];
          const bodyStartIndex = lines.findIndex((l) => /^\d+\./.test(l));
          if (bodyStartIndex !== -1) newBody = lines.slice(bodyStartIndex).join("\n");
          else if (lines.length > 1) newBody = lines.slice(1).join("\n");
          else newBody = summary || baseContext;
        }
      }

      newTitle = cleanHeadline(newTitle);
      newBody = cleanAndFormatText(newBody);

      if (!newTitle || newTitle.length < 2) {
        const fallbackTitle = cleanHeadline((summary || manual || "주제").split(/[.!?\n]/)[0]);
        newTitle = fallbackTitle;
      }
      if (!newBody || newBody.length < 10) newBody = summary || baseContext;

      // 2) 이미지 생성
      const stylePrompt = isAutoMode
        ? ""
        : (IMAGE_STYLES.find((s) => s.id === selectedStyleId)?.prompt || "");

      const enhancedStylePrompt = `${stylePrompt}${qualitySuffix}`;
      const imgContext = buildEnhancedImagePrompt(newTitle, baseContext, manual);

      const imgData = await generateImage(imgContext, enhancedStylePrompt);

      setCardHeadline(newTitle);
      setCardSummary(newBody);
      if (imgData) setCardImage(imgData);

      setExpandedData((prev) => ({
        ...prev,
        image: {
          img: imgData || "",
          cardData: { title: newTitle, body: newBody },
        },
      }));

      onShowToast(toastMsg);
    } catch (e) {
      console.error(e);
      onShowToast("❌ 생성 오류");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateImageOnly = async () => {
    if (isRegeneratingImage || !expandedData.image) return;
    setIsRegeneratingImage(true);
    onShowToast("🔄 이미지 재생성 중...");
    try {
      const manual = (unifiedPrompt || "").trim();
      const baseContext = (summary || "").trim()
        ? `키워드: ${keyword || ""}\n요약:\n${summary}\n\n사용자 프롬프트:\n${manual || ""}`
        : `사용자 프롬프트:\n${manual || ""}`;

      const stylePrompt = isAutoMode
        ? ""
        : (IMAGE_STYLES.find((s) => s.id === selectedStyleId)?.prompt || "");
      const enhancedStylePrompt = `${stylePrompt}${qualitySuffix}`;

      const variationPrompt = buildEnhancedImagePrompt(
        expandedData.image.cardData.title,
        baseContext,
        manual
      );

      const newImgUrl = await generateImage(variationPrompt, enhancedStylePrompt);

      if (newImgUrl) {
        setCardImage(newImgUrl);
        setExpandedData((prev) => ({
          ...prev,
          image: prev.image ? { ...prev.image, img: newImgUrl } : null,
        }));
        onShowToast("✅ 이미지 교체 완료");
      }
    } catch (e) {
      console.error(e);
      onShowToast("❌ 재생성 실패");
    } finally {
      setIsRegeneratingImage(false);
    }
  };

  const handleGenerateSNS = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const snsPrompt = `
당신은 기업용 PR/SNS 에디터입니다.
아래 내용을 기반으로 인스타그램/블로그용 문구를 한국어로 작성하세요.
- 구어체/과장 표현 금지 (예: "~있습니다", "~해요" 금지)
- 문장 간결, 브랜드 톤(중립/신뢰)
- 1) 한 줄 헤드라인
- 2) 3~5줄 본문(가독성 줄바꿈)
- 3) 해시태그 8~12개
- URL/출처 링크 금지

[콘텐츠]
${summary}
`.trim();

      const rawResponse = await generateExpandedContent(snsPrompt, "sns", "");
      setExpandedData((prev) => ({ ...prev, sns: rawResponse }));
      onShowToast("✅ SNS 문구 생성 완료");
    } catch (e) {
      console.error(e);
      onShowToast("❌ SNS 생성 오류");
    } finally {
      setLoading(false);
    }
  };

  /** ---------- UI ---------- **/

  return (
    <div className="bg-white rounded-[32px] p-2 border border-gray-100 shadow-sm">
      <div className="flex p-2 gap-2 bg-gray-50 rounded-3xl mb-6">
        <button
          onClick={() => setActiveTab("card")}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            activeTab === "card"
              ? "bg-white shadow-sm text-[#0071e3]"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <LayoutTemplate size={16} /> 카드뉴스
        </button>
        <button
          onClick={() => setActiveTab("video")}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            activeTab === "video"
              ? "bg-white shadow-sm text-[#0071e3]"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <Mic2 size={16} /> 낭독기
        </button>
        <button
          onClick={() => setActiveTab("sns")}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
            activeTab === "sns"
              ? "bg-white shadow-sm text-[#0071e3]"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <Instagram size={16} /> SNS 포스팅
        </button>
      </div>

      <div className="p-4">
        <audio ref={audioRef} hidden />

        {/* 카드뉴스 */}
        {activeTab === "card" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            {/* ✅ 생성 후에도 “콘텐츠 시각화 디자인” 유지 */}
            <div className="bg-white rounded-[32px] p-12 border border-gray-100 shadow-sm text-center space-y-8">
              <div className="w-20 h-20 bg-[#F5F5F7] rounded-[24px] flex items-center justify-center mx-auto">
                <Palette size={36} className="text-[#0071e3]" />
              </div>
              <div className="space-y-2">
                <h4 className="text-2xl font-black text-gray-900">
                  콘텐츠 시각화 디자인
                </h4>
                <p className="text-gray-500 text-sm font-medium">
                  테마를 선택하거나 프롬프트를 입력하면, 카드뉴스 제작과 동일한 방식으로 자동 생성합니다.
                </p>
              </div>

              {/* ✅ 통합 프롬프트 */}
              <div className="space-y-3 max-w-3xl mx-auto text-left">
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
                  이미지 프롬프트 (통합 입력)
                </label>
                <textarea
                  value={unifiedPrompt}
                  onChange={(e) => setUnifiedPrompt(e.target.value)}
                  placeholder={dynamicPlaceholder}
                  className="w-full min-h-[88px] bg-gray-50 p-5 rounded-[20px] border border-gray-100 text-gray-800 text-sm leading-relaxed focus:ring-2 focus:ring-[#0071e3]/10 outline-none resize-none"
                />

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setUnifiedPrompt("")}
                    className="px-4 py-2 rounded-full bg-white border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
                  >
                    프롬프트 지우기
                  </button>
                  <button
                    onClick={() => generateCardFromPrompt("✅ 프롬프트 기반 생성 완료")}
                    disabled={loading}
                    className="px-5 py-2 rounded-full bg-[#0071e3] text-white text-xs font-bold shadow-lg hover:bg-[#0077ed] transition-all disabled:opacity-50 flex items-center gap-2"
                    title="카드뉴스 제작과 동일하게 생성"
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" size={14} />
                    ) : (
                      <Wand size={14} />
                    )}
                    프롬프트로 이미지 생성
                  </button>
                </div>
              </div>

              {/* ✅ 카테고리 */}
              <div className="space-y-6 max-w-2xl mx-auto">
                <div className="flex flex-wrap gap-2 justify-center">
                  {IMAGE_STYLE_CATEGORIES_LOCAL.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        if (cat.id === "auto") {
                          // ✅ 자동 선택 시 스타일 강제 해제
                          setSelectedStyleId(0);
                        } else {
                          // 자동이 아닌 카테고리로 바꾸면 기본 스타일 하나 선택
                          if (selectedStyleId === 0) setSelectedStyleId(cat.range[0]);
                        }
                      }}
                      className={`px-4 py-2 rounded-full text-[11px] font-bold transition-all border ${
                        selectedCategory === cat.id
                          ? "bg-gray-900 border-gray-900 text-white"
                          : "bg-gray-50 border-gray-200 text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* ✅ 자동 모드면 스타일 리스트 비활성/숨김 */}
                {!isAutoMode && (
                  <div className="flex flex-wrap gap-2 justify-center max-h-40 overflow-y-auto p-4 bg-gray-50 rounded-[20px] border border-gray-100 custom-scrollbar-report">
                    {IMAGE_STYLES.filter((style) => {
                      const cat = IMAGE_STYLE_CATEGORIES_LOCAL.find(
                        (c) => c.id === selectedCategory
                      );
                      return (
                        cat &&
                        style.id >= cat.range[0] &&
                        style.id <= cat.range[1]
                      );
                    }).map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyleId(style.id)}
                        className={`px-4 py-2.5 rounded-xl text-[12px] font-semibold transition-all border ${
                          selectedStyleId === style.id
                            ? "bg-[#0071e3] border-[#0071e3] text-white shadow-sm"
                            : "bg-white border-gray-100 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                )}

                {isAutoMode && (
                  <div className="text-xs text-gray-400 font-semibold">
                    자동 모드에서는 그림체를 강제하지 않습니다. 프롬프트/요약 기반으로 최적의 결과를 생성합니다.
                  </div>
                )}
              </div>

              <button
                onClick={() => generateCardFromPrompt("✅ 카드뉴스 제작 완료")}
                disabled={loading}
                className="w-full max-sm mx-auto py-5 bg-gray-900 hover:bg-black text-white rounded-full font-bold text-base shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <>
                    <Sparkles size={20} /> 카드뉴스 제작 시작
                  </>
                )}
              </button>

              {/* ✅ 추천 프롬프트 (기업용) */}
              <div className="max-w-3xl mx-auto text-left pt-2">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  추천 프롬프트 (기업용)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {promptSuggestions.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => setUnifiedPrompt(p)}
                      className="px-3 py-3 rounded-2xl text-left text-xs font-semibold border bg-white border-gray-100 text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all"
                      title="클릭하면 프롬프트에 적용"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ✅ 생성 결과(이미지 2개 나오던 문제는 이 파일에서 “1개만 렌더”로 유지) */}
            {expandedData.image && (
              <div className="bg-gray-50 rounded-[32px] p-10 border border-gray-100 relative">
                <div className="absolute top-6 right-6 z-10 flex gap-2">
                  <button
                    onClick={handleGenerateTitleOnly}
                    disabled={isGeneratingTitle}
                    className="bg-white hover:bg-gray-50 text-[#0071e3] px-4 py-2 rounded-full text-xs font-bold shadow-md border border-gray-100 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Wand2 size={14} className={isGeneratingTitle ? "animate-spin" : ""} />
                    {isGeneratingTitle ? "제목 작성 중..." : "AI 제목 추천"}
                  </button>

                  <button
                    onClick={handleRegenerateImageOnly}
                    disabled={isRegeneratingImage}
                    className="bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-full text-xs font-bold shadow-md border border-gray-100 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                    title="현재 카드 내용 유지하고 이미지만 다시 생성"
                  >
                    {isRegeneratingImage ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wand size={14} />
                    )}
                    AI 재생성
                  </button>
                </div>

                <CardNewsGenerator
                  imageUrl={expandedData.image.img || cardImage}
                  summary={expandedData.image.cardData.body}
                  headline={expandedData.image.cardData.title}
                  isRegeneratingImage={isRegeneratingImage}
                  onShowToast={onShowToast}
                  onHeadlineChange={(val) => {
                    setCardHeadline(val);
                    setExpandedData((prev) => ({
                      ...prev,
                      image: prev.image
                        ? {
                            ...prev.image,
                            cardData: { ...prev.image.cardData, title: val },
                          }
                        : null,
                    }));
                  }}
                  onSummaryChange={(val) => {
                    setCardSummary(val);
                    setExpandedData((prev) => ({
                      ...prev,
                      image: prev.image
                        ? {
                            ...prev.image,
                            cardData: { ...prev.image.cardData, body: val },
                          }
                        : null,
                    }));
                  }}
                  selectedCategory={selectedCategory}
                  setSelectedCategory={(cat) => {
                    setSelectedCategory(cat);
                    if (cat === "auto") setSelectedStyleId(0);
                  }}
                  selectedStyleId={selectedStyleId}
                  setSelectedStyleId={setSelectedStyleId}
                  onRegenerate={handleRegenerateImageOnly}
                />
              </div>
            )}
          </div>
        )}

        {/* 낭독기 */}
        {activeTab === "video" && (
          <div className="bg-white rounded-[32px] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-300 space-y-10">
            <header className="flex items-center gap-4">
              <div className="p-4 bg-[#5856d6]/10 rounded-2xl text-[#5856d6]">
                <AudioLines size={32} />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900">AI 보이스 낭독 스테이션</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Natural Sounding AI Reader
                </p>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-8">
                <div className="space-y-4">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    성우 선택 (Google Voice)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto p-3 bg-gray-50 rounded-2xl custom-scrollbar-report">
                    {GOOGLE_AI_VOICES.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setSelectedGoogleVoice(v.id)}
                        className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                          selectedGoogleVoice === v.id
                            ? "bg-[#5856d6] border-[#5856d6] text-white shadow-md"
                            : "bg-white border-gray-100 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                            selectedGoogleVoice === v.id ? "bg-white/20" : "bg-gray-100"
                          }`}
                        >
                          <User size={24} />
                        </div>
                        <div className="text-left min-w-0 overflow-hidden">
                          <p
                            className={`font-bold text-base truncate ${
                              selectedGoogleVoice === v.id ? "text-white" : "text-gray-900"
                            }`}
                          >
                            {v.label}
                          </p>
                          <p
                            className={`text-sm truncate ${
                              selectedGoogleVoice === v.id ? "text-white/80" : "text-gray-500"
                            }`}
                          >
                            {v.desc}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={14} /> 낭독 스타일
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar-report">
                    {VOICE_STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStylePresetId(style.id)}
                        className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-left truncate ${
                          selectedStylePresetId === style.id
                            ? "bg-[#5856d6] border-[#5856d6] text-white shadow-md"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600"
                        }`}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    onClick={handleTTS}
                    disabled={loading}
                    className={`flex-1 py-5 rounded-full font-bold text-base transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95 ${
                      isSpeaking ? "bg-red-500 text-white" : "bg-[#5856d6] text-white"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="animate-spin" />
                    ) : isSpeaking ? (
                      <>
                        <Square size={18} /> 중단
                      </>
                    ) : (
                      <>
                        <Play size={18} /> AI 낭독 시작
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleDownloadAudio}
                    disabled={!audioUrl}
                    className="w-16 h-16 flex items-center justify-center bg-gray-100 text-gray-900 rounded-full hover:bg-gray-200 transition-all disabled:opacity-50"
                  >
                    <Download size={24} />
                  </button>
                </div>

                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Gauge size={14} /> 재생 속도
                  </label>
                  <div className="flex gap-2">
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        onClick={() => handleSpeedChange(speed)}
                        className={`flex-1 py-2 rounded-full text-[10px] font-bold border transition-all ${
                          playbackRate === speed
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-400 border-gray-100"
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  스크립트 편집
                </label>
                <textarea
                  value={formatScriptForReader(expandedData.video || "")}
                  onChange={(e) => setExpandedData((prev) => ({ ...prev, video: e.target.value }))}
                  className="w-full h-full min-h-[400px] bg-gray-50 p-6 rounded-[24px] border border-gray-100 text-gray-800 text-sm leading-relaxed focus:ring-2 focus:ring-[#5856d6]/10 outline-none resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* SNS */}
        {activeTab === "sns" && (
          <div className="text-center py-20 animate-in fade-in slide-in-from-bottom-4">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Instagram className="text-gray-300" size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">SNS 마케팅 문구 생성</h3>
            <p className="text-gray-500 text-sm mb-8">기업용 톤에 맞춘 홍보 문구를 생성합니다.</p>

            {expandedData.sns ? (
              <div className="bg-gray-50 p-6 rounded-2xl text-left text-sm text-gray-700 whitespace-pre-line">
                {expandedData.sns}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(expandedData.sns || "");
                    onShowToast("복사 완료!");
                  }}
                  className="mt-8 w-full py-4 bg-gray-50 hover:bg-gray-100 text-gray-900 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all"
                >
                  클립보드 복사
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerateSNS}
                disabled={loading}
                className="px-8 py-4 bg-[#0071e3] text-white rounded-full font-bold shadow-lg hover:bg-[#0077ed] transition-all disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
              >
                {loading ? <Loader2 className="animate-spin" /> : "문구 생성 시작"}
              </button>
            )}
          </div>
        )}
      </div>

      {(expandedData.image || expandedData.video || expandedData.sns) && (
        <div className="mt-16 flex justify-center pb-12 no-print">
          <button
            onClick={onOpenReport}
            className="px-12 py-5 bg-gray-900 hover:bg-black text-white rounded-full text-lg font-bold shadow-2xl transition-all flex items-center gap-3 active:scale-95"
          >
            <ClipboardList size={20} /> 최종 리포트 발행
          </button>
        </div>
      )}
    </div>
  );
};

export default ContentExpander;