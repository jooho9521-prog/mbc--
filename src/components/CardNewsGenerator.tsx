import React, { useRef, useEffect, useState } from "react";
import { Download, Edit3, Loader2, Palette, Database } from "lucide-react";

interface Props {
  imageUrl: string;
  summary: string;
  headline: string;
  onHeadlineChange: (val: string) => void;
  onSummaryChange: (val: string) => void;
  isRegeneratingImage?: boolean;
  onShowToast?: (msg: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  selectedStyleId: number;
  setSelectedStyleId: (id: number) => void;

  /**
   * ✅ (호환용)
   * - 기존 버전에서 CardNewsGenerator 내부에서 “스타일링 적용하기(이미지 재생성)”를 제공했을 수 있어 남겨둡니다.
   * - 현재 권장 UX에서는 상위(ContentExpander)에서만 재생성 버튼을 노출하고,
   *   이 컴포넌트는 편집(텍스트/폰트/워터마크) 중심으로 유지합니다.
   */
  onRegenerate?: () => void;
}

const FONT_OPTIONS = [
  { name: "프리텐다드", family: "'Pretendard', sans-serif" },

  { name: "시스템 기본", family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { name: "Arial", family: "Arial, Helvetica, sans-serif" },
  { name: "Helvetica", family: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { name: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { name: "Tahoma", family: "Tahoma, Geneva, sans-serif" },
  { name: "Trebuchet MS", family: "'Trebuchet MS', sans-serif" },
  { name: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { name: "Times New Roman", family: "'Times New Roman', Times, serif" },
  { name: "Courier New", family: "'Courier New', Courier, monospace" },

  { name: "노토산스 KR", family: "'Noto Sans KR', sans-serif" },
  { name: "나눔고딕", family: "'Nanum Gothic', sans-serif" },
  { name: "G마켓 산스", family: "'GmarketSansMedium', sans-serif" },
  { name: "에스코어 드림", family: "'S-CoreDream-4Regular', sans-serif" },
  { name: "검은고딕", family: "'Black Han Sans', sans-serif" },
  { name: "IBM Plex Sans KR", family: "'IBM Plex Sans KR', sans-serif" },
  { name: "나눔명조", family: "'Nanum Myeongjo', serif" },
  { name: "본명조", family: "'Noto Serif KR', serif" },
  { name: "바탕체", family: "'Batang', serif" },
  { name: "송명", family: "'Song Myung', serif" },
  { name: "나눔손글씨 펜", family: "'Nanum Pen Script', cursive" },
  { name: "나눔손글씨 붓", family: "'Nanum Brush Script', cursive" },
  { name: "가비아 온해", family: "'Gaegu', cursive" },
  { name: "동글", family: "'Dongle', sans-serif" },
  { name: "고도체", family: "'Godo', sans-serif" },
];

const DEFAULT_FONT = "'Pretendard', sans-serif";

// ✅ 컴포넌트 내부 "무적" 기본 썸네일(SVG data URL)
const makeDefaultThumbnailDataUrl = (title: string) => {
  const safe = (title || "TREND").slice(0, 24).replace(/[<>&"]/g, "").trim() || "TREND";
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs>
      <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#111827"/>
        <stop offset="1" stop-color="#0f766e"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="10" stdDeviation="22" flood-opacity="0.28"/>
      </filter>
    </defs>

    <rect width="100%" height="100%" fill="url(#g)"/>

    <g filter="url(#shadow)">
      <rect x="70" y="140" rx="30" ry="30" width="940" height="560" fill="rgba(255,255,255,0.10)"/>
    </g>

    <text x="110" y="240" font-size="60" fill="white" font-family="Arial, sans-serif" font-weight="700">
      동아일보 프로젝트 B
    </text>

    <text x="110" y="340" font-size="42" fill="white" font-family="Arial, sans-serif" opacity="0.92">
      이미지 생성 실패 (자동 대체)
    </text>

    <text x="110" y="485" font-size="56" fill="white" font-family="Arial, sans-serif" font-weight="800">
      ${safe}
    </text>

    <text x="110" y="585" font-size="30" fill="white" font-family="Arial, sans-serif" opacity="0.8">
      네트워크/권한 오류 시 기본 썸네일 표시
    </text>

    <g opacity="0.22">
      <circle cx="960" cy="1680" r="260" fill="white"/>
      <circle cx="860" cy="1600" r="140" fill="white"/>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

// ✅ 외부 URL 이미지를 dataURL로 바꿔서 캔버스 taint(저장/다운로드 실패)를 줄임
const tryResolveToDataUrl = async (url: string, timeoutMs = 12000): Promise<string | null> => {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("blob:")) return url;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { signal: controller.signal, mode: "cors" });
    if (!resp.ok) return null;

    const blob = await resp.blob();
    if (!blob || blob.size < 1000) return null;

    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("FILE_READER_ERROR"));
      reader.readAsDataURL(blob);
    });

    return dataUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

const CardNewsGenerator: React.FC<Props> = ({
  imageUrl,
  summary,
  headline,
  onHeadlineChange,
  onSummaryChange,
  isRegeneratingImage,
  onShowToast,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [localWatermark, setLocalWatermark] = useState("");
  const [headlineSize, setHeadlineSize] = useState(80);
  const [bodySize, setBodySize] = useState(35);
  const [selectedFont, setSelectedFont] = useState(DEFAULT_FONT);
  const [backgroundBlur, setBackgroundBlur] = useState(14);
  const [overlayOpacity, setOverlayOpacity] = useState(0.56);
  const [textShadowBlur, setTextShadowBlur] = useState(18);

  const [bodyText, setBodyText] = useState("");
  const [headlineText, setHeadlineText] = useState("");
  const [resolvedImageSrc, setResolvedImageSrc] = useState<string>("");

  useEffect(() => {
    setHeadlineText(headline || "");
  }, [headline]);

  useEffect(() => {
    if (summary) {
      const formattedText = summary
        .replace(/\r\n/g, "\n")
        .replace(/(\d+\.\s)/g, "\n\n$1")
        .replace(/\(출처.*?\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      setBodyText(formattedText);
    } else {
      setBodyText("");
    }
  }, [summary]);

  useEffect(() => {
    let alive = true;

    const doResolve = async () => {
      const fallback = makeDefaultThumbnailDataUrl(headlineText || "TREND");

      if (!imageUrl || !imageUrl.trim()) {
        if (alive) setResolvedImageSrc(fallback);
        return;
      }

      const maybeDataUrl = await tryResolveToDataUrl(imageUrl, 12000);
      if (!alive) return;

      if (maybeDataUrl) {
        setResolvedImageSrc(maybeDataUrl);
        return;
      }

      setResolvedImageSrc(imageUrl);
    };

    doResolve();
    return () => {
      alive = false;
    };
  }, [imageUrl, headlineText]);

  const drawTextWithWrap = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    options?: { maxLines?: number; breakLongWords?: boolean; measureOnly?: boolean }
  ) => {
    if (!text) return { y, lines: 0, truncated: false };

    const paragraphs = text.split(/\r?\n/);
    let currentY = y;
    let linesUsed = 0;
    const maxLines = options?.maxLines ?? Number.MAX_SAFE_INTEGER;
    const breakLongWords = options?.breakLongWords ?? true;
    const measureOnly = options?.measureOnly ?? false;

    const pushLine = (line: string) => {
      if (linesUsed >= maxLines) return false;
      if (!measureOnly) ctx.fillText(line, x, currentY);
      currentY += lineHeight;
      linesUsed += 1;
      return true;
    };

    const splitToken = (token: string) => {
      if (!breakLongWords) return [token];
      const chunks: string[] = [];
      let buf = "";
      for (const ch of Array.from(token)) {
        const test = buf + ch;
        if (ctx.measureText(test).width > maxWidth && buf) {
          chunks.push(buf);
          buf = ch;
        } else {
          buf = test;
        }
      }
      if (buf) chunks.push(buf);
      return chunks;
    };

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) {
        currentY += lineHeight * 0.4;
        continue;
      }

      const tokens = trimmed.includes(" ")
        ? trimmed.split(/(\s+)/).filter(Boolean)
        : Array.from(trimmed);

      let line = "";

      for (const token of tokens) {
        for (const seg of splitToken(token)) {
          const testLine = line + seg;
          if (ctx.measureText(testLine).width > maxWidth && line) {
            if (!pushLine(line.trimEnd())) return { y: currentY, lines: linesUsed, truncated: true };
            line = seg.trimStart();
          } else {
            line = testLine;
          }
        }
      }

      if (line) {
        if (!pushLine(line.trimEnd())) return { y: currentY, lines: linesUsed, truncated: true };
      }
    }

    return { y: currentY, lines: linesUsed, truncated: false };
  };

  const drawBlurredBackground = (
    ctx: CanvasRenderingContext2D,
    image: HTMLImageElement,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    blur: number
  ) => {
    const safeBlur = Math.max(0, Math.min(40, blur));
    if (safeBlur <= 0.5) {
      ctx.drawImage(image, dx, dy, dw, dh);
      return;
    }

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = 1080;
    tempCanvas.height = 1920;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) {
      ctx.drawImage(image, dx, dy, dw, dh);
      return;
    }

    tempCtx.filter = `blur(${safeBlur}px)`;
    tempCtx.drawImage(image, dx, dy, dw, dh);
    tempCtx.filter = "none";

    ctx.drawImage(tempCanvas, 0, 0);
  };

  const drawCardNewsOnCanvas = (srcToDraw: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();

    if (srcToDraw && srcToDraw.startsWith("data:image/")) {
      img.crossOrigin = "anonymous";
    }

    img.decoding = "async";
    img.src = srcToDraw || makeDefaultThumbnailDataUrl(headlineText || "TREND");

    const render = (image: HTMLImageElement) => {
      canvas.width = 1080;
      canvas.height = 1920;

      const cw = canvas.width;
      const ch = canvas.height;

      ctx.clearRect(0, 0, cw, ch);

      // 이미지 1장만 전체 배경으로 사용
      const scale = Math.max(cw / image.width, ch / image.height);
      const dw = image.width * scale;
      const dh = image.height * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      drawBlurredBackground(ctx, image, dx, dy, dw, dh, backgroundBlur);

      const overlayStrength = Math.max(0, Math.min(0.85, overlayOpacity));
      const topOverlay = ctx.createLinearGradient(0, 0, 0, 860);
      topOverlay.addColorStop(0, `rgba(4,12,28,${Math.min(0.92, overlayStrength + 0.42)})`);
      topOverlay.addColorStop(0.55, `rgba(4,12,28,${Math.max(0.12, overlayStrength)})`);
      topOverlay.addColorStop(1, "rgba(4,12,28,0)");
      ctx.fillStyle = topOverlay;
      ctx.fillRect(0, 0, cw, 860);

      const bottomOverlay = ctx.createLinearGradient(0, ch - 620, 0, ch);
      bottomOverlay.addColorStop(0, "rgba(4,12,28,0)");
      bottomOverlay.addColorStop(0.35, `rgba(4,12,28,${Math.min(0.7, overlayStrength + 0.16)})`);
      bottomOverlay.addColorStop(1, `rgba(4,12,28,${Math.min(0.96, overlayStrength + 0.34)})`);
      ctx.fillStyle = bottomOverlay;
      ctx.fillRect(0, ch - 620, cw, 620);

      const midOverlay = ctx.createRadialGradient(cw * 0.5, ch * 0.42, 80, cw * 0.5, ch * 0.42, cw * 0.52);
      midOverlay.addColorStop(0, `rgba(4,12,28,${Math.min(0.12, overlayStrength * 0.2)})`);
      midOverlay.addColorStop(0.55, `rgba(4,12,28,${Math.min(0.26, overlayStrength * 0.34)})`);
      midOverlay.addColorStop(1, `rgba(4,12,28,${Math.min(0.44, overlayStrength * 0.56)})`);
      ctx.fillStyle = midOverlay;
      ctx.fillRect(0, 0, cw, ch);

      const textMask = ctx.createLinearGradient(0, ch * 0.68, 0, ch);
      textMask.addColorStop(0, "rgba(4,12,28,0)");
      textMask.addColorStop(0.45, `rgba(4,12,28,${Math.min(0.48, overlayStrength * 0.72)})`);
      textMask.addColorStop(1, `rgba(4,12,28,${Math.min(0.82, overlayStrength + 0.18)})`);
      ctx.fillStyle = textMask;
      ctx.fillRect(0, ch * 0.68, cw, ch * 0.32);

      ctx.fillStyle = "white";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.95, 0.45 + overlayStrength * 0.5)})`;
      ctx.shadowBlur = textShadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      const maxWidth = 880;
      const startX = 92;

      const displayHeadline = (headlineText || "제목 없음").replace(/[\*\#\[\]]/g, "").trim();
      const displayBody = bodyText || "내용이 없습니다.";

      const headlineTop = 118;
      const headlineMaxBottom = 470;
      const headlineMaxLines = 4;
      let fittedHeadlineSize = headlineSize;
      let headlineResult = { y: headlineTop, lines: 0, truncated: false };

      while (fittedHeadlineSize >= 48) {
        ctx.font = `bold ${fittedHeadlineSize}px ${selectedFont}`;
        const attempt = drawTextWithWrap(ctx, displayHeadline, startX, headlineTop, maxWidth, fittedHeadlineSize * 1.24, { maxLines: headlineMaxLines, measureOnly: true });
        if (!attempt.truncated && attempt.y <= headlineMaxBottom) {
          headlineResult = attempt;
          break;
        }
        fittedHeadlineSize -= 4;
      }

      ctx.clearRect(0, 0, cw, ch);
      drawBlurredBackground(ctx, image, dx, dy, dw, dh, backgroundBlur);
      ctx.fillStyle = topOverlay;
      ctx.fillRect(0, 0, cw, 860);
      ctx.fillStyle = bottomOverlay;
      ctx.fillRect(0, ch - 560, cw, 560);
      ctx.fillStyle = "white";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.95, 0.45 + overlayStrength * 0.5)})`;
      ctx.shadowBlur = textShadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      ctx.font = `bold ${fittedHeadlineSize}px ${selectedFont}`;
      headlineResult = drawTextWithWrap(ctx, displayHeadline, startX, headlineTop, maxWidth, fittedHeadlineSize * 1.24, { maxLines: headlineMaxLines });

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = "#0A84FF";
      ctx.fillRect(startX, headlineResult.y + 18, 180, 8);

      ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.95, 0.45 + overlayStrength * 0.5)})`;
      ctx.shadowBlur = textShadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      const bodyTop = headlineResult.y + 48;
      const bodyMaxBottom = 1560;
      const bodyMaxLines = 22;
      let fittedBodySize = bodySize;

      while (fittedBodySize >= 24) {
        ctx.font = `500 ${fittedBodySize}px ${selectedFont}`;
        const attempt = drawTextWithWrap(ctx, displayBody, startX, bodyTop, maxWidth, fittedBodySize * 1.32, { maxLines: bodyMaxLines, measureOnly: true });
        if (!attempt.truncated && attempt.y <= bodyMaxBottom) break;
        fittedBodySize -= 2;
      }

      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.font = `500 ${fittedBodySize}px ${selectedFont}`;
      drawTextWithWrap(ctx, displayBody, startX, bodyTop, maxWidth, fittedBodySize * 1.32, { maxLines: bodyMaxLines });

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      if ((localWatermark || "").trim()) {
        ctx.font = `bold 28px ${selectedFont}`;
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.fillText(localWatermark.trim(), startX, 1840);
      }
    };

    img.onload = () => render(img);

    img.onerror = () => {
      const fallbackImg = new Image();
      fallbackImg.crossOrigin = "anonymous";
      fallbackImg.src = makeDefaultThumbnailDataUrl(headlineText || "TREND");
      fallbackImg.onload = () => render(fallbackImg);
    };
  };

  useEffect(() => {
    const src = resolvedImageSrc || makeDefaultThumbnailDataUrl(headlineText || "TREND");
    const timer = setTimeout(() => {
      drawCardNewsOnCanvas(src);
    }, 50);

    return () => clearTimeout(timer);
  }, [resolvedImageSrc, headlineText, bodyText, localWatermark, headlineSize, bodySize, selectedFont, backgroundBlur, overlayOpacity, textShadowBlur]);

  const handleDownload = () => {
    if (!canvasRef.current) return;
    try {
      const link = document.createElement("a");
      link.download = `TrendPulse_Card_${Date.now()}.png`;
      link.href = canvasRef.current.toDataURL("image/png", 1.0);
      link.click();
    } catch (e) {
      console.error(e);
      alert(
        "이미지 소스(CORS) 문제로 PNG 저장이 제한되었습니다. 잠시 후 다시 시도하거나 이미지를 재생성해주세요."
      );
    }
  };

  const handleSaveToLibrary = () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      const savedCards = JSON.parse(localStorage.getItem("saved_cards") || "[]");
      const newCard = {
        id: Date.now(),
        imageUrl: dataUrl,
        title: headlineText || "무제",
        date: new Date().toLocaleDateString("ko-KR"),
        summary: bodyText,
      };
      localStorage.setItem("saved_cards", JSON.stringify([newCard, ...savedCards]));
      window.dispatchEvent(new Event("storage"));
      alert("✅ 카드뉴스가 보관함에 안전하게 저장되었습니다.");
      onShowToast?.("보관함 저장 완료");
    } catch (e) {
      console.error(e);
      alert(
        "브라우저 저장소 용량이 부족하거나, 이미지 소스(CORS) 문제로 저장이 제한되었습니다.\n다시 시도하거나 이미지를 재생성해주세요."
      );
    }
  };

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-10 gap-10 items-start">
      <div className="w-full lg:col-span-6 space-y-8">
        <div className="relative aspect-[9/16] rounded-[40px] overflow-hidden shadow-2xl border border-gray-100 bg-white apple-transition group">
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
          {isRegeneratingImage && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 z-20">
              <Loader2 className="animate-spin text-[#0071e3]" size={48} />
              <p className="text-gray-900 font-bold text-sm">이미지 스타일링 중...</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleDownload}
            className="py-4 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <Download size={18} /> PNG 저장
          </button>
          <button
            onClick={handleSaveToLibrary}
            className="py-4 bg-[#0071e3] hover:bg-[#0077ed] text-white rounded-full font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <Database size={18} /> 보관함 저장
          </button>
        </div>
      </div>

      <div className="w-full lg:col-span-4 space-y-12">
        <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm space-y-8">
          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Edit3 size={14} /> 헤드라인 텍스트
              </label>
              <span className="text-[10px] font-bold text-[#0071e3]">SIZE: {headlineSize}px</span>
            </div>
            <input
              type="text"
              value={headlineText}
              onChange={(e) => {
                setHeadlineText(e.target.value);
                onHeadlineChange(e.target.value);
              }}
              className="w-full bg-gray-50 p-4 rounded-2xl border-none text-gray-900 font-bold text-lg focus:ring-2 focus:ring-[#0071e3]/20 outline-none"
              placeholder="헤드라인을 입력하세요"
            />
            <input
              type="range"
              min="20"
              max="150"
              value={headlineSize}
              onChange={(e) => setHeadlineSize(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
            />
          </div>

          <div className="space-y-5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <Edit3 size={14} /> 본문 요약 내용
              </label>
              <span className="text-[10px] font-bold text-[#0071e3]">SIZE: {bodySize}px</span>
            </div>
            <textarea
              value={bodyText}
              onChange={(e) => {
                const val = e.target.value;
                setBodyText(val);
                onSummaryChange(val);
              }}
              className="w-full h-40 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-[#0071e3]/20 whitespace-pre-wrap outline-none resize-none bg-gray-50 text-gray-700 text-sm leading-relaxed"
              placeholder="본문 내용을 입력하세요..."
            />
            <input
              type="range"
              min="10"
              max="80"
              value={bodySize}
              onChange={(e) => setBodySize(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
            />
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-8 border border-gray-100 shadow-sm space-y-8">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Palette size={18} className="text-[#0071e3]" /> 배경 가독성 조절
          </h4>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="block text-[12px] font-black text-gray-700 tracking-tight leading-snug">
                  배경 블러
                </label>
                <span className="text-[10px] font-bold text-[#0071e3]">{backgroundBlur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={backgroundBlur}
                onChange={(e) => setBackgroundBlur(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="block text-[12px] font-black text-gray-700 tracking-tight leading-snug">
                  배경 어둡기
                </label>
                <span className="text-[10px] font-bold text-[#0071e3]">{Math.round(overlayOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                value={Math.round(overlayOpacity * 100)}
                onChange={(e) => setOverlayOpacity(parseInt(e.target.value) / 100)}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="block text-[12px] font-black text-gray-700 tracking-tight leading-snug">
                  글자 그림자
                </label>
                <span className="text-[10px] font-bold text-[#0071e3]">{textShadowBlur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                value={textShadowBlur}
                onChange={(e) => setTextShadowBlur(parseInt(e.target.value))}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#0071e3]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setBackgroundBlur(10);
                  setOverlayOpacity(0.4);
                  setTextShadowBlur(18);
                }}
                className="py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              >
                자동 보정
              </button>
              <button
                type="button"
                onClick={() => {
                  setBackgroundBlur(8);
                  setOverlayOpacity(0.38);
                  setTextShadowBlur(18);
                }}
                className="py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-900 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              >
                기본값 복원
              </button>
            </div>
          </div>
        </div>

        {/* ✅ 상세 스타일링: “폰트 페이스 → 워터마크 텍스트” (구분선 제거) */}
        <div className="bg-gray-50 rounded-[32px] p-8 space-y-8">
          <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Palette size={18} className="text-[#0071e3]" /> 상세 스타일링
          </h4>

          <div className="space-y-6">
            <div className="space-y-3">
              <label className="block text-[12px] font-black text-gray-700 tracking-tight leading-snug">
                <span className="block">폰트 페이스</span>
              </label>

              <select
                value={selectedFont}
                onChange={(e) => setSelectedFont(e.target.value)}
                className="w-full bg-white rounded-2xl px-4 py-4 text-base focus:ring-2 focus:ring-[#0071e3]/20 border border-gray-200/70 outline-none shadow-sm font-semibold"
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <label className="block text-[12px] font-black text-gray-700 tracking-tight leading-snug">
                <span className="block">워터마크 텍스트</span>
              </label>

              <input
                type="text"
                placeholder="입력 시 하단에 표시됩니다"
                value={localWatermark}
                onChange={(e) => setLocalWatermark(e.target.value)}
                className="w-full bg-white px-4 py-4 rounded-2xl border border-gray-200/70 text-gray-700 text-base outline-none shadow-sm"
              />
            </div>
          </div>

          {/*
            ✅ 배경 이미지 프롬프트 편집/재생성 UI는 제거했습니다.
          */}
        </div>
      </div>
    </div>
  );
};

export default CardNewsGenerator;
