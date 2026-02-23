import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateExpandedContent, generateTTS } from '../services/geminiService';
import { generateImage } from '../services/imageService';
import CardNewsGenerator from './CardNewsGenerator';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Share2, 
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
  Video,
  Instagram,
  Wand2,
  Activity // [추가] 스타일 아이콘
} from 'lucide-react';

interface Props {
  keyword?: string;
  summary: string;
  expandedData: {
    image: { img: string; cardData: { title: string; body: string } } | null;
    video: string | null;
    sns: string | null;
  };
  setExpandedData: React.Dispatch<React.SetStateAction<{
    image: { img: string; cardData: { title: string; body: string } } | null;
    video: string | null;
    sns: string | null;
  }>>;
  onShowToast: (msg: string) => void;
  onOpenReport: () => void;
}

// [Improved] Text cleaning function
const cleanAndFormatText = (text: string) => {
  if (!text) return "";
  return text
    .replace(/\[.*?\]/g, '') 
    .replace(/\(.*?\)/g, '') 
    .replace(/(https?:\/\/[^\s]+)/g, '') 
    .replace(/\*\*/g, '') 
    .replace(/###/g, '') 
    .trim();
};

// [강력 수정] 제목 정제 로직 강화
const cleanHeadline = (text: string) => {
  if (!text) return "";
  let cleaned = text
    .replace(/\[HEADLINE\]/gi, '')    
    .replace(/^(HEADLINE|TITLE|제목|주제)\s*[:\-]?\s*/i, '') 
    .replace(/^[\d]+\.\s*/, '')       
    .replace(/^\d+\s+/, '')           
    .replace(/^[\-\*#]\s*/, '')       
    .replace(/["']/g, '')             
    .replace(/\[.*?\]/g, '')          
    .trim();
    
  return cleaned;
};

const GOOGLE_AI_VOICES = [
  { id: 'Achemar', label: 'Achemar', desc: '차분한 여성' },
  { id: 'Zephyr', label: 'Zephyr', desc: '표준적인 남성' },
  { id: 'Algenib', label: 'Algenib', desc: '부드러운 남성' },
  { id: 'Algieba', label: 'Algieba', desc: '신뢰감 있는 남성' },
  { id: 'Alnilam', label: 'Alnilam', desc: '깊은 저음의 남성' },
  { id: 'Aonde', label: 'Aonde', desc: '밝은 여성' },
  { id: 'Autonoe', label: 'Autonoe', desc: '지적인 여성' },
  { id: 'Callirrhoe', label: 'Callirrhoe', desc: '우아한 여성' },
  { id: 'Charon', label: 'Charon', desc: '중후한 남성' },
  { id: 'Despina', label: 'Despina', desc: '친근한 여성' },
  { id: 'Enceladus', label: 'Enceladus', desc: '강인한 남성' },
  { id: 'Erinome', label: 'Erinome', desc: '나긋나긋한 여성' },
  { id: 'Fenrir', label: 'Fenrir', desc: '무게감 있는 남성' },
  { id: 'Gacrux', label: 'Gacrux', desc: '차분한 여성' },
  { id: 'Iapetus', label: 'Iapetus', desc: '섬세한 남성' },
  { id: 'Kore', label: 'Kore', desc: '활기찬 여성' },
  { id: 'Laomedeia', label: 'Laomedeia', desc: '정중한 남성' },
  { id: 'Leda', label: 'Leda', desc: '감성적인 여성' },
  { id: 'Orus', label: 'Orus', desc: '활달한 남성' },
  { id: 'Puck', label: 'Puck', desc: '경쾌한 남성' },
  { id: 'Pulcherrima', label: 'Pulcherrima', desc: '성숙한 여성' },
  { id: 'Rasalgethi', label: 'Rasalgethi', desc: '안정적인 남성' },
  { id: 'Sadachbia', label: 'Sadachbia', desc: '따뜻한 남성' },
  { id: 'Sadaltager', label: 'Sadaltager', desc: '울림 있는 남성' },
  { id: 'Schedar', label: 'Schedar', desc: '명료한 남성' },
  { id: 'Sulafat', label: 'Sulafat', desc: '부드러운 여성' },
  { id: 'Umbriel', label: 'Umbriel', desc: '차분한 남성' },
  { id: 'Vindemiatrix', label: 'Vindemiatrix', desc: '매끄러운 여성' },
  { id: 'Zubenelgenubi', label: 'Zubenelgenubi', desc: '진중한 남성' }
];

const IMAGE_STYLE_CATEGORIES_LOCAL = [
    { id: 'photorealistic', name: '초현실주의 실사', range: [1, 10] },
    { id: '3d_art', name: '3D & 아트', range: [11, 20] },
    { id: 'logo_branding', name: '로고 & 브랜딩', range: [21, 30] }
];

const IMAGE_STYLES = [
  { id: 1, label: '시네마틱 인물', prompt: 'Cinematic portrait of a cyberpunk hacker in neon-lit Tokyo streets, rain reflection on visor, highly detailed skin texture, depth of field, 8k resolution, shot on Sony A7R IV, 85mm lens, f/1.8 --v 5' },
  { id: 2, label: '자연광 제품', prompt: 'Minimalist product photography of a luxury glass perfume bottle on a textured white stone surface, soft morning sunlight, shadows of palm leaves, high key lighting, photorealistic, 4k' },
  { id: 3, label: '빈티지 필름', prompt: '1980s street photography style, grainy film texture, candid shot of people in a cozy coffee shop, warm Kodak Portra 400 color grading, slightly blurred motion, nostalgic atmosphere' },
  { id: 4, label: '야생 접사', prompt: 'Macro photography of a blue morpho butterfly resting on a fern, dewdrops on wings, hyper-realistic, sharp focus, bokeh background of a rainforest, natural lighting' },
  { id: 5, label: '건축 인테리어', prompt: 'Modern Scandinavian living room interior, floor-to-ceiling windows, sunset light pouring in, beige and wood color palette, hyper-realistic rendering, architectural photography, wide angle' },
  { id: 6, label: '고급 시계', prompt: 'Ultra detailed product shot of a luxury stainless steel wristwatch on a dark wooden surface, dramatic side lighting, soft shadows, reflection highlights on glass, photorealistic, 8k' },
  { id: 7, label: '푸드 (디저트)', prompt: 'Close-up food photography of a freshly baked croissant with powdered sugar, placed on a rustic wooden table, shallow depth of field, warm morning light, crumbs visible, ultra realistic' },
  { id: 8, label: '패션 룩북', prompt: 'Full body street fashion photo of a young woman wearing a minimalist beige trench coat, walking in a European city street, overcast daylight, film-like tones, 50mm lens, photorealistic' },
  { id: 9, label: '자동차 광고', prompt: 'Dynamic action shot of a black sports car speeding on a wet highway at night, light trails in the background, water splashes, motion blur, ultra realistic, 8k, cinematic grading' },
  { id: 10, label: '드론 풍경', prompt: 'Aerial drone photography of a winding mountain road surrounded by autumn forest, golden and red leaves, soft fog, sunrise light, ultra high resolution, realistic' },
  { id: 11, label: '픽사 3D', prompt: 'Cute 3D rendered character of a baby robot holding a flower, Pixar style, soft pastel colors, volumetric lighting, octane render, clay material, high fidelity, 4k' },
  { id: 12, label: '사이버펑크', prompt: 'Futuristic sci-fi city skyline at night, flying cars, holograms, neon blue and pink color scheme, isometric view, highly detailed, digital art, trending on ArtStation' },
  { id: 13, label: '수채화 풍경', prompt: 'Watercolor painting of a peaceful lakeside cottage, soft brush strokes, bleeding colors, misty mountains in the background, dreamy atmosphere, paper texture overlay' },
  { id: 14, label: '판타지 RPG', prompt: 'Concept art of a legendary dragon slayer armor, intricate gold engravings, glowing magical gems, dark fantasy style, detailed digital painting, heavy shadows' },
  { id: 15, label: '로우 폴리', prompt: 'Low poly illustration of a camping site in a forest at night, bonfire, starry sky, geometric shapes, vibrant colors, minimalist 3D style' },
  { id: 16, label: '카툰 캐릭터', prompt: 'Colorful cartoon illustration of a cheerful barista character holding a cup of coffee, bold outlines, flat shading, modern vector style, character turnaround sheet' },
  { id: 17, label: '다크 판타지', prompt: 'Dark fantasy landscape of a ruined castle on a cliff, stormy sky, lightning in the background, flocks of crows, highly detailed digital painting, moody atmosphere' },
  { id: 18, label: '애니메이션', prompt: 'Anime illustration of high school students on a rooftop at sunset, windy sky, soft lighting, detailed school uniforms, cinematic composition, anime key visual style' },
  { id: 19, label: '아이소메트릭', prompt: 'Isometric illustration of a modern open-plan office, tiny characters working at desks, plants, computers, meeting rooms, clean flat colors, vector art' },
  { id: 20, label: '3D 이모티콘', prompt: 'Set of 3D rendered emoji icons with glossy material, happy, sad, angry, surprised expressions, soft studio lighting, high resolution, pack shot on white background' },
  { id: 21, label: '미니멀 로고', prompt: 'Minimalist vector logo for a tech startup named "Nebula", simple geometric shape representing a cloud and circuit, flat design, white background, blue gradient, professional' },
  { id: 22, label: '엠블럼 로고', prompt: 'Vintage emblem logo for a coffee roaster, line art illustration of a coffee bean and mountain, typography "Summit Coffee", brown and cream colors, vector style' },
  { id: 23, label: '3D 앱 아이콘', prompt: 'Glossy 3D app icon for a meditation app, lotus flower shape, soft gradients of purple and teal, rounded corners, clean UI design, high quality' },
  { id: 24, label: '마스코트 로고', prompt: 'Esports team logo featuring a fierce tiger, bold thick lines, aggressive expression, vibrant orange and black vector art, white background' },
  { id: 25, label: '패키지 패턴', prompt: 'Packaging design pattern, seamless botanical leaves, eco-friendly green tones, modern and clean, vector illustration style for organic food brand' },
  { id: 26, label: '브랜드 워드마크', prompt: 'Elegant wordmark logo for a luxury skincare brand named "Lunara", thin serif font, subtle ligatures, black on white, minimal and high-end, vector' },
  { id: 27, label: '핀테크 로고', prompt: 'Flat vector logo for a fintech app, abstract shape combining a shield and bar chart, gradient green and blue, modern and trustworthy, simple shapes, app icon ready' },
  { id: 28, label: '키즈 캐릭터', prompt: 'Playful mascot logo for a kids clothing brand, smiling dinosaur character in pastel colors, thick outline, rounded shapes, friendly and cute, vector illustration' },
  { id: 29, label: '모노그램', prompt: 'Monogram logo combining the letters "N" and "B" for a premium brand, intertwined lettering, golden foil effect, black background, minimal and luxurious, vector' },
  { id: 30, label: '유튜브 배너', prompt: 'YouTube channel banner design for a tech review channel, clean layout, bold typography, abstract geometric shapes in blue and purple, space for profile picture, vector style' }
];

// [추가됨] 낭독 스타일 30종 리스트
const VOICE_STYLES = [
  { id: 'neutral', name: '😐 기본 (뉴스톤)', prompt: 'Calm, professional, clear pronunciation, like a news anchor' },
  { id: 'homeshopping', name: '🛍️ 홈쇼핑 (쇼호스트)', prompt: 'High energy, persuasive, excited, fast-paced, sales pitch tone' },
  { id: 'storytelling', name: '📖 동화 구연', prompt: 'Warm, slow, emotional, expressive, like reading to a child' },
  { id: 'documentary', name: '📽️ 다큐멘터리', prompt: 'Serious, deep, slow, cinematic narration' },
  { id: 'friendly', name: '😊 친근한 친구', prompt: 'Casual, conversational, upbeat, friendly tone' },
  { id: 'movie_trailer', name: '🎬 영화 예고편', prompt: 'Epic, deep, dramatic, intense, blockbuster trailer voice' },
  { id: 'asmr', name: '🌙 ASMR (속삭임)', prompt: 'Whispering, very quiet, soft, slow, relaxing' },
  { id: 'angry', name: '😡 분노/화남', prompt: 'Angry, shouting, aggressive, intense emotion' },
  { id: 'sad', name: '😭 슬픔/우울', prompt: 'Sad, crying voice, shaky breath, slow, depressed' },
  { id: 'horror', name: '👻 공포/미스터리', prompt: 'Scary, creepy, slow, low pitch, suspenseful' },
  { id: 'historical', name: '🏯 사극 톤', prompt: 'Traditional Korean historical drama tone, serious, commanding' },
  { id: 'sports', name: '⚽ 스포츠 중계', prompt: 'Very fast, shouting, excited, high pitch, like a soccer commentator' },
  { id: 'announcement', name: '📢 안내방송', prompt: 'Polite, clear, echoing, airport or subway announcement style' },
  { id: 'lecture', name: '🎓 강의/교수님', prompt: 'Educational, informative, slow, clear, explaining tone' },
  { id: 'meditation', name: '🧘 명상/요가', prompt: 'Very slow, calm, soft, breathing, spiritual' },
  { id: 'child', name: '👶 어린아이', prompt: 'High pitch, childish, cute, energetic' },
  { id: 'old_man', name: '👴 노인', prompt: 'Shaky, slow, old, wise voice' },
  { id: 'robot', name: '🤖 로봇/AI', prompt: 'Monotone, robotic, metallic, no emotion' },
  { id: 'customer_service', name: '📞 상담원', prompt: 'Extremely polite, high pitch, service industry tone' },
  { id: 'speech', name: '🗣️ 웅변/연설', prompt: 'Powerful, loud, persuasive, public speaking tone' },
  { id: 'detective', name: '🕵️ 탐정/추리', prompt: 'Suspicious, low voice, analytical, noir style' },
  { id: 'anime', name: '✨ 애니메이션', prompt: 'Exaggerated, high energy, cartoon character style' },
  { id: 'poet', name: '📜 시 낭송', prompt: 'Emotional, rhythmic, slow, artistic, deep' },
  { id: 'drunk', name: '🍺 취한 목소리', prompt: 'Slurred speech, uneven tempo, emotional, drunk' },
  { id: 'military', name: '🎖️ 군대 조교', prompt: 'Loud, short, commanding, military drill sergeant' },
  { id: 'morning_call', name: '⏰ 모닝콜', prompt: 'Loud, energetic, waking up, annoying but effective' },
  { id: 'radio_dj', name: '📻 심야 라디오 DJ', prompt: 'Soft, buttery, low pitch, romantic, late night vibe' },
  { id: 'urgent', name: '🚨 긴급 상황', prompt: 'Fast, panicked, urgent, emergency alert' },
  { id: 'lazy', name: '😪 귀찮음/나른함', prompt: 'Slow, yawning, uninterested, lazy tone' },
  { id: 'confession', name: '💌 고백/로맨틱', prompt: 'Shy, soft, loving, romantic, whispering' }
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5];

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function pcmToWav(pcmData: Uint8Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);
  return new Blob([header, pcmData], { type: 'audio/wav' });
}

const ContentExpander: React.FC<Props> = ({ 
  keyword,
  summary, 
  expandedData, 
  setExpandedData, 
  onShowToast,
  onOpenReport 
}) => {
  const [activeTab, setActiveTab] = useState<'card' | 'video' | 'sns'>('card');
  const [loading, setLoading] = useState(false);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  
  const [cardHeadline, setCardHeadline] = useState("");
  const [cardSummary, setCardSummary] = useState(summary || "분석된 내용이 없습니다.");
  const [cardImage, setCardImage] = useState("https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=1080&auto=format&fit=crop");
  
  const [selectedCategory, setSelectedCategory] = useState('photorealistic');
  const [selectedStyleId, setSelectedStyleId] = useState(1);

  const [selectedGoogleVoice, setSelectedGoogleVoice] = useState('Zephyr');
  
  // [추가됨] 스타일 선택용 state
  const [selectedStylePresetId, setSelectedStylePresetId] = useState<string>('neutral'); 

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // [수정됨] 1. 나노바나나 프로 초고화질 강제 적용 프롬프트 상수
  const qualitySuffix = ", masterpiece, best quality, ultra high res, photorealistic, 8k uhd, highly detailed, sharp focus, intricate details, detailed skin texture, cinematic lighting, HDR, professional photograph";

  useEffect(() => {
    if (summary && summary !== cardSummary) {
      setCardSummary(summary);
      if (!expandedData.image) {
        handleGenerateTitleOnly(); 
      }
    }
  }, [summary]); 

  // 제목 정제 및 생성 로직
  const handleGenerateTitleOnly = async () => {
    if (isGeneratingTitle || !summary) return;
    setIsGeneratingTitle(true);
    
    try {
        const stylePrompt = `
          Analyze the text and provide a Professional Analysis Report in KOREAN.
          
          Format:
          [HEADLINE]
          (Write a PROVOCATIVE, INSIGHTFUL headline. No length limit. Strictly NO NUMBERS at start.)
          
          [BODY]
          (Write exactly 5 numbered bullet points (1. to 5.).
           KEY INSTRUCTION: Use "Noun-ending style" (개조식) like "~함", "~임", "~것" to keep it PROFESSIONAL and SHORT.
           Maximize information density within 40-50 characters per line. NO wrapping lines.)
        `; 
        const rawResponse = await generateExpandedContent(summary, 'card', stylePrompt);
        
        let newTitle = "";
        let newBody = "";

        const parts = rawResponse.split('[BODY]');
        
        if (parts.length >= 2) {
            newTitle = parts[0].replace('[HEADLINE]', '').trim();
            newBody = parts[1].trim();
        } else {
            const lines = rawResponse.split('\n').filter(l => l.trim() !== '');
            if (lines.length > 0) {
                newTitle = lines[0];
                const bodyStartIndex = lines.findIndex(l => /^\d+\./.test(l));
                if (bodyStartIndex !== -1 && bodyStartIndex > 0) {
                      newBody = lines.slice(bodyStartIndex).join('\n');
                } else if (lines.length > 1) {
                      newBody = lines.slice(1).join('\n');
                } else {
                      newBody = summary;
                }
            }
        }

        newTitle = cleanHeadline(newTitle);
        newBody = cleanAndFormatText(newBody);

        if (!newTitle || newTitle.length < 2) {
             const firstLine = summary.split(/[.!?\n]/)[0];
             newTitle = cleanHeadline(firstLine);
        }
        
        if (!newBody || newBody.length < 10) {
            newBody = summary;
        }

        setCardHeadline(newTitle);
        setCardSummary(newBody);

    } catch (error) {
        console.error("Title Gen Error:", error);
        const fallbackTitle = cleanHeadline(summary.split(/[.!?\n]/)[0]);
        setCardHeadline(fallbackTitle);
        setCardSummary(summary); 
    } finally {
        setIsGeneratingTitle(false);
    }
  };

  const formatScriptForReader = (text: string) => {
    if (!text) return "";
    let cleaned = text.replace(/\[제목\]/g, '').replace(/\\n/g, '\n').trim();
    cleaned = cleaned.replace(/([.!?])\s+(\d+\.)/g, '$1\n\n$2');
    return cleaned;
  };

  // [수정된 부분] 낭독기 탭 활성화 시 카드뉴스 내용을 동기화
  useEffect(() => {
    if (activeTab === 'video') {
      let formattedText = "";
      
      // 1. 카드뉴스가 생성되어 있다면(이미지 생성 완료), 그 제목과 본문을 가져옴
      if (expandedData.image && expandedData.image.cardData) {
        formattedText = `[제목] ${expandedData.image.cardData.title}\n\n${expandedData.image.cardData.body}`;
      } 
      // 2. 카드뉴스가 아직 없다면 현재 대시보드의 헤드라인/요약 사용
      else {
        formattedText = `[제목] ${cardHeadline || "제목 없음"}\n\n${cardSummary || summary}`;
      }

      // 스크립트가 비어있거나, 초기 상태(10자 미만)일 경우에만 업데이트 (사용자가 수정한 내용 보존)
      if (!expandedData.video || expandedData.video.length < 10) {
         setExpandedData(prev => ({ ...prev, video: formattedText }));
      }
    }
  }, [activeTab, expandedData.image, cardHeadline, cardSummary, summary]);

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsSpeaking(false);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const handleDownloadAudio = () => {
    if (!audioUrl) return;
    const link = document.createElement('a');
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
      // [수정됨] 선택된 스타일의 프롬프트를 함께 전달
      const stylePrompt = VOICE_STYLES.find(s => s.id === selectedStylePresetId)?.prompt;
      const base64Audio = await generateTTS(textToRead, selectedGoogleVoice, stylePrompt);
      const audioBytes = decodeBase64(base64Audio);
      const wavBlob = pcmToWav(audioBytes, 24000);
      const url = URL.createObjectURL(wavBlob);
      setAudioUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.onloadedmetadata = () => {
          audioRef.current?.play().catch(e => console.error("Playback failed:", e));
          setIsSpeaking(true);
        };
      }
    } catch (err) {
      console.error("TTS Error:", err);
      onShowToast("음성 생성 오류");
    } finally {
      setLoading(false);
    }
  }, [expandedData.video, isSpeaking, selectedGoogleVoice, selectedStylePresetId, playbackRate, onShowToast]);

  const handleExpand = async () => {
    if (activeTab === 'video') {
      handleTTS();
      return;
    }
    setLoading(true);
    
    try {
      const textPrompt = `
          Task: Create a card news summary in KOREAN.
          
          Format:
          [HEADLINE]
          (Write a PROVOCATIVE, SHOCKING headline. No length limit. Strictly NO NUMBERS at start.)
          
          [BODY]
          (Write exactly 5 numbered bullet points (1. to 5.). 
           KEY INSTRUCTION: Use "Noun-ending style" (개조식) like "~함", "~임" to keep it PROFESSIONAL and SHORT.
           Maximize information density within 40-50 characters per line. NO wrapping lines.)
      `;
      
      const rawResponse = await generateExpandedContent(summary, activeTab, textPrompt);
      
      if (activeTab === 'card') { 
        try {
          let imgPrompt = summary;
          try {
             const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
             if(jsonMatch) {
               const parsed = JSON.parse(jsonMatch[0]);
               if(parsed.image_prompt) imgPrompt = parsed.image_prompt;
             }
          } catch(e) {}

          let newTitle = cardHeadline;
          let newBody = cardSummary;

          const parts = rawResponse.split('[BODY]');
          if (parts.length >= 2) {
               newTitle = parts[0].replace('[HEADLINE]', '').trim();
               newBody = parts[1].trim();
          } else {
               const lines = rawResponse.split('\n').filter(l => l.trim() !== '');
               if (lines.length > 0) {
                    newTitle = lines[0];
                    const bodyStartIndex = lines.findIndex(l => /^\d+\./.test(l));
                    if (bodyStartIndex !== -1 && bodyStartIndex > 0) {
                        newBody = lines.slice(bodyStartIndex).join('\n');
                    } else if(lines.length > 1) {
                        newBody = lines.slice(1).join('\n');
                    } else {
                        newBody = summary;
                    }
               }
          }

          newTitle = cleanHeadline(newTitle);
          newBody = cleanAndFormatText(newBody);
          
          if (!newTitle || newTitle.length < 2) {
               const fallbackTitle = cleanHeadline(summary.split(/[.!?\n]/)[0]);
               newTitle = fallbackTitle;
          }
          if (!newBody || newBody.length < 10) newBody = summary;

          // [수정됨] 2. 최초 카드뉴스 이미지 생성 시 나노바나나 프로 화질 강제 결합
          const stylePrompt = IMAGE_STYLES.find(s => s.id === selectedStyleId)?.prompt || "";
          const enhancedStylePrompt = `${stylePrompt}${qualitySuffix}`;
          
          const imgContext = `News about: ${newTitle}. ${summary.substring(0, 100)}`;
          const imgData = await generateImage(imgContext, enhancedStylePrompt);
          
          setCardHeadline(newTitle);
          setCardSummary(newBody);
          if (imgData) setCardImage(imgData);

          setExpandedData(prev => ({ 
            ...prev, 
            image: { 
              img: imgData || '', 
              cardData: { title: newTitle, body: newBody } 
            } 
          }));
          onShowToast("카드뉴스 제작 완료");
        } catch (e) {
          console.error("Expand Error:", e);
           // [수정됨] 3. 에러 발생 시 진행되는 기본 이미지 생성에도 나노바나나 프로 화질 강제 결합
           const stylePrompt = IMAGE_STYLES.find(s => s.id === selectedStyleId)?.prompt || "";
           const enhancedStylePrompt = `${stylePrompt}${qualitySuffix}`;
           const imgData = await generateImage(summary, enhancedStylePrompt);
           
           const fallbackTitle = cleanHeadline(summary.split(/[.!?\n]/)[0]);
           setCardHeadline(fallbackTitle); 
           setCardSummary(summary);
           if (imgData) setCardImage(imgData);
           
           setExpandedData(prev => ({
             ...prev,
             image: { 
               img: imgData || '', 
               cardData: { title: fallbackTitle, body: summary } 
             }
           }));
           onShowToast("기본 포맷으로 생성되었습니다.");
        }
      } else if (activeTab === 'sns') {
        setExpandedData(prev => ({ ...prev, sns: rawResponse }));
      }
    } catch (error: any) {
      onShowToast("콘텐츠 생성 오류");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateImageOnly = async (manualPrompt?: string) => {
    if (isRegeneratingImage) return;
    setIsRegeneratingImage(true);
    onShowToast("🔄 이미지 재생성 중...");
    try {
      // [수정됨] 4. 이미지 재생성(스타일 변경) 시에도 나노바나나 프로 화질 강제 결합
      const stylePrompt = IMAGE_STYLES.find(s => s.id === selectedStyleId)?.prompt || "";
      const enhancedStylePrompt = `${stylePrompt}${qualitySuffix}`;
      
      const variationPrompt = manualPrompt || `Professional background for: ${cardHeadline}. ${cardSummary.substring(0, 100)}`;
      const newImgUrl = await generateImage(variationPrompt, enhancedStylePrompt);
      
      if (newImgUrl) {
        setCardImage(newImgUrl);
        setExpandedData(prev => ({ 
            ...prev, 
            image: { 
                img: newImgUrl, 
                cardData: { title: cardHeadline, body: cardSummary } 
            } 
        }));
        onShowToast("✅ 이미지 교체 완료");
      }
    } catch (err) {
      onShowToast("❌ 재생성 실패");
    } finally {
      setIsRegeneratingImage(false);
    }
  };

  return (
    <div className="bg-white rounded-[32px] p-2 border border-gray-100 shadow-sm">
      <div className="flex p-2 gap-2 bg-gray-50 rounded-3xl mb-6">
        <button 
          onClick={() => setActiveTab('card')}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'card' ? 'bg-white shadow-sm text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <LayoutTemplate size={16} /> 카드뉴스
        </button>
        <button 
          onClick={() => setActiveTab('video')}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'video' ? 'bg-white shadow-sm text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Mic2 size={16} /> 낭독기
        </button>
        <button 
          onClick={() => setActiveTab('sns')}
          className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'sns' ? 'bg-white shadow-sm text-[#0071e3]' : 'text-gray-400 hover:text-gray-600'}`}
        >
          <Instagram size={16} /> SNS 포스팅
        </button>
      </div>

      <div className="p-4">
        <audio ref={audioRef} hidden />

        {activeTab === 'card' && (
          <div className="space-y-10 animate-in fade-in duration-300">
            {expandedData.image ? (
                <div className="bg-gray-50 rounded-[32px] p-10 border border-gray-100 relative">
                    
                    <div className="absolute top-6 right-6 z-10">
                        <button 
                            onClick={handleGenerateTitleOnly} 
                            disabled={isGeneratingTitle}
                            className="bg-white hover:bg-gray-50 text-[#0071e3] px-4 py-2 rounded-full text-xs font-bold shadow-md border border-gray-100 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                        >
                            <Wand2 size={14} className={isGeneratingTitle ? 'animate-spin' : ''} />
                            {isGeneratingTitle ? '제목 작성 중...' : 'AI 제목 추천'}
                        </button>
                    </div>

                    <CardNewsGenerator 
                    imageUrl={expandedData.image.img} 
                    summary={expandedData.image.cardData.body} 
                    headline={expandedData.image.cardData.title} 
                    isRegeneratingImage={isRegeneratingImage}
                    onShowToast={onShowToast}
                    onHeadlineChange={(val) => {
                        setCardHeadline(val);
                        if (expandedData.image) {
                            setExpandedData(prev => ({...prev, image: prev.image ? { ...prev.image, cardData: { ...prev.image.cardData, title: val } } : null }));
                        }
                    }}
                    onSummaryChange={(val) => {
                        setCardSummary(val);
                        if (expandedData.image) {
                            setExpandedData(prev => ({...prev, image: prev.image ? { ...prev.image, cardData: { ...prev.image.cardData, body: val } } : null }));
                        }
                    }}
                    selectedCategory={selectedCategory}
                    setSelectedCategory={setSelectedCategory}
                    selectedStyleId={selectedStyleId}
                    setSelectedStyleId={setSelectedStyleId}
                    onRegenerate={handleRegenerateImageOnly}
                    />
                </div>
            ) : (
                <div className="bg-white rounded-[32px] p-12 border border-gray-100 shadow-sm text-center space-y-8">
                    <div className="w-20 h-20 bg-[#F5F5F7] rounded-[24px] flex items-center justify-center mx-auto">
                        <Palette size={36} className="text-[#0071e3]" />
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-2xl font-black text-gray-900">콘텐츠 시각화 디자인</h4>
                        <p className="text-gray-500 text-sm font-medium">원하는 테마를 선택하면 AI가 최적의 이미지를 매칭합니다.</p>
                    </div>
                    
                    <div className="space-y-6 max-w-2xl mx-auto">
                        <div className="flex flex-wrap gap-2 justify-center">
                            {IMAGE_STYLE_CATEGORIES_LOCAL.map(cat => (
                            <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`px-4 py-2 rounded-full text-[11px] font-bold transition-all border ${selectedCategory === cat.id ? 'bg-gray-900 border-gray-900 text-white' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>{cat.name}</button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-2 justify-center max-h-40 overflow-y-auto p-4 bg-gray-50 rounded-[20px] border border-gray-100 custom-scrollbar-report">
                            {IMAGE_STYLES.filter(style => {
                            const cat = IMAGE_STYLE_CATEGORIES_LOCAL.find(c => c.id === selectedCategory);
                            return cat && style.id >= cat.range[0] && style.id <= cat.range[1];
                            }).map(style => (
                            <button key={style.id} onClick={() => setSelectedStyleId(style.id)} className={`px-4 py-2.5 rounded-xl text-[12px] font-semibold transition-all border ${selectedStyleId === style.id ? 'bg-[#0071e3] border-[#0071e3] text-white shadow-sm' : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300'}`}>{style.label}</button>
                            ))}
                        </div>
                    </div>

                    <button 
                        onClick={handleExpand} 
                        disabled={loading}
                        className="w-full max-sm mx-auto py-5 bg-gray-900 hover:bg-black text-white rounded-full font-bold text-base shadow-xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <><Sparkles size={20} /> 카드뉴스 제작 시작</>}
                    </button>
                </div>
            )}
          </div>
        )}

        {/* 낭독기 기능 */}
        {activeTab === 'video' && (
          <div className="bg-white rounded-[32px] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-300 space-y-10">
            <header className="flex items-center gap-4">
              <div className="p-4 bg-[#5856d6]/10 rounded-2xl text-[#5856d6]">
                <AudioLines size={32} />
              </div>
              <div>
                <h3 className="text-xl font-black text-gray-900">AI 보이스 낭독 스테이션</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Natural Sounding AI Reader</p>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-8">
                <div className="space-y-4">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">성우 선택 (Google Voice)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto p-3 bg-gray-50 rounded-2xl custom-scrollbar-report">
                    {GOOGLE_AI_VOICES.map((v) => (
                      <button 
                        key={v.id} 
                        onClick={() => setSelectedGoogleVoice(v.id)} 
                        className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${selectedGoogleVoice === v.id ? 'bg-[#5856d6] border-[#5856d6] text-white shadow-md' : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300'}`}
                      >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${selectedGoogleVoice === v.id ? 'bg-white/20' : 'bg-gray-100'}`}>
                          <User size={24} />
                        </div>
                        <div className="text-left min-w-0 overflow-hidden">
                          <p className={`font-bold text-base truncate ${selectedGoogleVoice === v.id ? 'text-white' : 'text-gray-900'}`}>{v.label}</p>
                          <p className={`text-sm truncate ${selectedGoogleVoice === v.id ? 'text-white/80' : 'text-gray-500'}`}>{v.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-gray-100">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Activity size={14} /> 낭독 스타일 (30종)
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar-report">
                    {VOICE_STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStylePresetId(style.id)}
                        className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-left truncate ${
                          selectedStylePresetId === style.id
                            ? 'bg-[#5856d6] border-[#5856d6] text-white shadow-md'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'
                        }`}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button onClick={handleTTS} disabled={loading} className={`flex-1 py-5 rounded-full font-bold text-base transition-all flex items-center justify-center gap-3 shadow-lg active:scale-95 ${isSpeaking ? 'bg-red-500 text-white' : 'bg-[#5856d6] text-white'}`}>
                    {loading ? <Loader2 className="animate-spin" /> : isSpeaking ? <><Square size={18} /> 중단</> : <><Play size={18} /> AI 낭독 시작</>}
                  </button>
                  <button onClick={handleDownloadAudio} disabled={!audioUrl} className="w-16 h-16 flex items-center justify-center bg-gray-100 text-gray-900 rounded-full hover:bg-gray-200 transition-all">
                    <Download size={24} />
                  </button>
                </div>

                <div className="space-y-4 pt-4 border-t border-gray-100">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><Gauge size={14} /> 재생 속도</label>
                    <div className="flex gap-2">
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <button key={speed} onClick={() => handleSpeedChange(speed)} className={`flex-1 py-2 rounded-full text-[10px] font-bold border transition-all ${playbackRate === speed ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-400 border-gray-100'}`}>{speed}x</button>
                      ))}
                    </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">스크립트 편집</label>
                <textarea 
                  value={formatScriptForReader(expandedData.video || "")} 
                  onChange={(e) => setExpandedData(prev => ({ ...prev, video: e.target.value }))} 
                  className="w-full h-full min-h-[400px] bg-gray-50 p-6 rounded-[24px] border border-gray-100 text-gray-800 text-sm leading-relaxed focus:ring-2 focus:ring-[#5856d6]/10 outline-none resize-none" 
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sns' && (
          <div className="text-center py-20 animate-in fade-in slide-in-from-bottom-4">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Instagram className="text-gray-300" size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">SNS 마케팅 문구 생성</h3>
            <p className="text-gray-500 text-sm mb-8">인스타그램, 블로그에 최적화된 홍보 문구를 작성합니다.</p>
            
            {expandedData.sns ? (
                <div className="bg-gray-50 p-6 rounded-2xl text-left text-sm text-gray-700 whitespace-pre-line">
                    {expandedData.sns}
                    <button onClick={() => { navigator.clipboard.writeText(expandedData.sns || ''); onShowToast('복사 완료!'); }} className="mt-8 w-full py-4 bg-gray-50 hover:bg-gray-100 text-gray-900 rounded-2xl text-[11px] font-bold uppercase tracking-widest transition-all">클립보드 복사</button>
                </div>
            ) : (
                <button 
                    onClick={handleExpand}
                    disabled={loading}
                    className="px-8 py-4 bg-[#0071e3] text-white rounded-full font-bold shadow-lg hover:bg-[#0077ed] transition-all disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin" /> : "문구 생성 시작"}
                </button>
            )}
          </div>
        )}
      </div>

      {/* 최종 리포트 발행 버튼 */}
      {(expandedData.image || expandedData.video || expandedData.sns) && (
        <div className="mt-16 flex justify-center pb-12 no-print">
          <button onClick={onOpenReport} className="px-12 py-5 bg-gray-900 hover:bg-black text-white rounded-full text-lg font-bold shadow-2xl transition-all flex items-center gap-3 active:scale-95">
            <ClipboardList size={20} /> 최종 리포트 발행
          </button>
        </div>
      )}
    </div>
  );
};

export default ContentExpander;