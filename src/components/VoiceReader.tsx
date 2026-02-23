import React, { useState, useEffect, useRef } from 'react';
import { Mic, Play, Square, Download, Wand2, Volume2, Check, User, Activity } from 'lucide-react';
// [수정됨] 상위 폴더로 빠져나가는 경로(../)로 변경
import { generateTTS } from '../services/geminiService'; 

interface Props {
  text: string;
  keyword: string;
}

// [1] 목소리 스타일 30종 (유지)
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

// [2] 성우 리스트 통합 (사용자 요청 리스트 + 구글 클라우드 리스트)
const VOICES = [
  // --- 사용자 요청 Gemini 전용 성우 ---
  { id: 'Zephyr', name: 'Zephyr (표준 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Achemar', name: 'Achemar (차분한 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Algenib', name: 'Algenib (부드러운 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Algieba', name: 'Algieba (신뢰감 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Alnilam', name: 'Alnilam (깊은 저음 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Aonde', name: 'Aonde (밝은 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Autonoe', name: 'Autonoe (지적인 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Callirrhoe', name: 'Callirrhoe (우아한 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Charon', name: 'Charon (중후한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Despina', name: 'Despina (친근한 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Enceladus', name: 'Enceladus (강인한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Erinome', name: 'Erinome (나긋나긋 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Fenrir', name: 'Fenrir (무게감 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Gacrux', name: 'Gacrux (차분한 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Iapetus', name: 'Iapetus (섬세한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Kore', name: 'Kore (활기찬 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Laomedeia', name: 'Laomedeia (정중한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Leda', name: 'Leda (감성적인 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Orus', name: 'Orus (활달한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Puck', name: 'Puck (경쾌한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Pulcherrima', name: 'Pulcherrima (성숙한 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Rasalgethi', name: 'Rasalgethi (안정적 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Sadachbia', name: 'Sadachbia (따뜻한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Sadaltager', name: 'Sadaltager (울림있는 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Schedar', name: 'Schedar (명료한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Sulafat', name: 'Sulafat (부드러운 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Umbriel', name: 'Umbriel (차분한 남성)', gender: 'Male', type: 'Gemini' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix (매끄러운 여성)', gender: 'Female', type: 'Gemini' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi (진중한 남성)', gender: 'Male', type: 'Gemini' },

  // --- Google Cloud Standard / Neural2 ---
  { id: 'ko-KR-Neural2-A', name: 'Google Neural A (여성/자연)', gender: 'Female', type: 'Google' },
  { id: 'ko-KR-Neural2-B', name: 'Google Neural B (여성/차분)', gender: 'Female', type: 'Google' },
  { id: 'ko-KR-Neural2-C', name: 'Google Neural C (남성/중저)', gender: 'Male', type: 'Google' },
  { id: 'ko-KR-Wavenet-A', name: 'Google Wave A (여성/또렷)', gender: 'Female', type: 'Google' },
  { id: 'ko-KR-Wavenet-B', name: 'Google Wave B (여성/부드)', gender: 'Female', type: 'Google' },
  { id: 'ko-KR-Wavenet-C', name: 'Google Wave C (남성/신뢰)', gender: 'Male', type: 'Google' },
  { id: 'ko-KR-Wavenet-D', name: 'Google Wave D (남성/뉴스)', gender: 'Male', type: 'Google' },
];

const VoiceReader: React.FC<Props> = ({ text, keyword }) => {
  const [script, setScript] = useState(text);
  const [selectedVoice, setSelectedVoice] = useState(VOICES[0].id);
  const [selectedStyle, setSelectedStyle] = useState(VOICE_STYLES[0].id);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (text) setScript(text);
  }, [text]);

  const handleGenerate = async () => {
    if (!script.trim()) return;
    setIsLoading(true);
    setAudioUrl(null);
    try {
      const stylePrompt = VOICE_STYLES.find(s => s.id === selectedStyle)?.prompt;
      const audioBase64 = await generateTTS(script, selectedVoice, stylePrompt);
      
      const blob = await (await fetch(`data:audio/mp3;base64,${audioBase64}`)).blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (error) {
      console.error(error);
      alert('음성 생성 중 오류가 발생했습니다. 구글 API 설정을 확인해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 h-full">
      {/* 왼쪽: 컨트롤 패널 */}
      <div className="w-full lg:w-[400px] space-y-6 shrink-0 bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
        
        {/* 성우 선택 (스크롤 가능) */}
        <div className="space-y-4">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <User size={14} /> 성우 선택 ({VOICES.length}명)
          </label>
          <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  selectedVoice === voice.id
                    ? 'bg-[#0071e3] border-[#0071e3] text-white shadow-md transform scale-[1.02]'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-bold flex items-center gap-2">
                    {voice.name}
                    {voice.type === 'Google' && <span className="text-[9px] bg-green-100 text-green-700 px-1.5 rounded-full font-black">G</span>}
                  </span>
                  <span className={`text-[10px] ${selectedVoice === voice.id ? 'text-blue-100' : 'text-gray-400'}`}>
                    {voice.gender} • {voice.type === 'Gemini' ? 'AI Voice' : 'Cloud TTS'}
                  </span>
                </div>
                {selectedVoice === voice.id && <Check size={16} />}
              </button>
            ))}
          </div>
        </div>

        {/* 스타일 선택 (30종) */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Activity size={14} /> 낭독 스타일 (30종)
          </label>
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
            {VOICE_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => setSelectedStyle(style.id)}
                className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-left truncate ${
                  selectedStyle === style.id
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'
                }`}
              >
                {style.name}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-4"
        >
          {isLoading ? (
            <>
              <Wand2 className="animate-spin" size={18} />
              AI 음성 생성 중...
            </>
          ) : (
            <>
              <Mic size={18} />
              AI 낭독 시작
            </>
          )}
        </button>

        {audioUrl && (
          <div className="p-4 bg-[#F5F5F7] rounded-2xl border border-gray-200 space-y-3 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <button
                onClick={togglePlay}
                className="w-12 h-12 flex items-center justify-center bg-[#0071e3] text-white rounded-full hover:bg-[#0077ed] transition-colors shadow-sm"
              >
                {isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
              </button>
              <div className="flex-1 mx-3">
                <div className="h-1 bg-gray-300 rounded-full overflow-hidden">
                  <div className={`h-full bg-[#0071e3] ${isPlaying ? 'animate-pulse' : ''}`} style={{ width: '100%' }}></div>
                </div>
              </div>
              <a
                href={audioUrl}
                download={`TrendPulse_Audio_${Date.now()}.mp3`}
                className="p-3 text-gray-500 hover:text-[#0071e3] hover:bg-white rounded-full transition-all"
              >
                <Download size={18} />
              </a>
            </div>
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
            <p className="text-[10px] text-center text-gray-400 font-medium truncate px-2">
              {VOICES.find(v => v.id === selectedVoice)?.name.split('(')[0]} • {VOICE_STYLES.find(s => s.id === selectedStyle)?.name}
            </p>
          </div>
        )}
      </div>

      {/* 오른쪽: 스크립트 편집 */}
      <div className="flex-1 bg-white rounded-[2rem] p-8 border border-gray-100 flex flex-col h-full min-h-[500px] shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
            <Volume2 size={14} /> 스크립트 편집
          </label>
          <span className="text-[10px] text-gray-400 font-medium bg-gray-100 px-2 py-1 rounded-full">{script.length}자</span>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          className="flex-1 w-full bg-gray-50 p-6 rounded-2xl border-none resize-none focus:ring-2 focus:ring-[#0071e3]/20 outline-none text-gray-700 leading-loose shadow-inner text-base font-medium"
          placeholder="여기에 낭독할 내용을 입력하거나 수정하세요..."
        />
        <div className="mt-4 flex justify-end">
           <p className="text-[10px] text-gray-400 flex items-center gap-1">
             <Check size={10} /> 카드뉴스 내용이 자동으로 로드되었습니다.
           </p>
        </div>
      </div>
    </div>
  );
};

export default VoiceReader;