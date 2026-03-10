export type FreeVideoGenerateRequest = {
  /** 사람이 이해하는 프롬프트(예: 'cinematic electric car driving at night...') */
  prompt: string;
  /** 생성 길이(초) */
  seconds?: number;
  /** 출력 가로/세로 (기본 576x1024, 9:16) */
  width?: number;
  height?: number;
  /** 랜덤 시드(선택) */
  seed?: number;
};

export type FreeVideoGenerateResponse = {
  /** 브라우저에서 바로 재생 가능한 Blob URL */
  blobUrl: string;
  /** mime type (기본 video/mp4 또는 video/webm) */
  mime: string;
  /** 권장 파일명 */
  filename: string;
};

/**
 * ✅ 무료(오픈소스) 영상 생성 모델은 브라우저에서 직접 돌리기 어렵습니다.
 * 그래서 "로컬" 또는 "사내"에서 실행 중인 무료 모델 서버(예: SVD/AnimateDiff/ComfyUI)를 호출합니다.
 *
 * 기본 엔드포인트(로컬): http://127.0.0.1:8000/api/free-video
 * - POST JSON: { prompt, seconds, width, height, seed }
 * - 응답(둘 중 하나 지원):
 *   1) { url: "http://.../out.mp4", mime?:"video/mp4", filename?:"..." }
 *   2) { video_base64: "...", mime:"video/mp4", filename:"..." }
 */
export async function generateFreeVideo(req: FreeVideoGenerateRequest): Promise<FreeVideoGenerateResponse> {
  const endpoint = (import.meta as any)?.env?.VITE_FREE_VIDEO_ENDPOINT || "http://127.0.0.1:8000/api/free-video";

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: req.prompt,
      seconds: req.seconds ?? 6,
      width: req.width ?? 576,
      height: req.height ?? 1024,
      seed: typeof req.seed === "number" ? req.seed : undefined,
    }),
  });

  if (!r.ok) {
    const t = await safeText(r);
    throw new Error(`무료 영상 생성 실패: ${r.status} ${r.statusText}${t ? `\n${t}` : ""}`);
  }

  const data = (await r.json()) as any;

  // case 1) url
  if (data?.url && typeof data.url === "string") {
    const mime = typeof data.mime === "string" ? data.mime : guessMimeFromUrl(data.url);
    const filename = (typeof data.filename === "string" && data.filename) || `TrendPulse_free_${Date.now()}.${mime.includes("webm") ? "webm" : "mp4"}`;

    const blob = await fetchAsBlob(data.url);
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, mime, filename };
  }

  // case 2) base64
  if (data?.video_base64 && typeof data.video_base64 === "string") {
    const mime = typeof data.mime === "string" ? data.mime : "video/mp4";
    const filename = (typeof data.filename === "string" && data.filename) || `TrendPulse_free_${Date.now()}.${mime.includes("webm") ? "webm" : "mp4"}`;

    const blob = base64ToBlob(data.video_base64, mime);
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, mime, filename };
  }

  throw new Error("무료 영상 생성 서버 응답 형식이 올바르지 않습니다. (url 또는 video_base64 필요)");
}

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`영상 다운로드 실패: ${res.status} ${res.statusText}`);
  return await res.blob();
}

function base64ToBlob(base64: string, mime: string) {
  // data URL 형태도 허용
  const pure = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  const byteChars = atob(pure);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mime });
}

function guessMimeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes(".webm")) return "video/webm";
  return "video/mp4";
}

async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "";
  }
}
