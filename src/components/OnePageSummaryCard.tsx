import React, { useMemo } from "react";
import { ShieldCheck, ShieldAlert, Sparkles, Link as LinkIcon } from "lucide-react";
import type { TrendAnalysis, Citation, FactCheck } from "../types";

type Props = {
  keyword: string;
  analysis: TrendAnalysis | null;
  activePoint: number | null;
  onSelectPoint: (p: number | null) => void;
  isDarkMode: boolean;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const splitFivePoints = (summary: string) => {
  // 일부 응답은 실제 줄바꿈 대신 "\\n" 문자열이 들어오는 경우가 있어 선처리
  const s = String(summary || "").replace(/\\n/g, "\n").trim();
  if (!s) return [] as { point: number; text: string }[];

  // Robust parsing for "1. ...\n2. ..." or "1) ..." etc.
  // Works with single newlines (not requiring blank lines).
  const re = /(?:^|\n)\s*(\d)\s*[\.)]\s*([\s\S]*?)(?=\n\s*\d\s*[\.)]\s*|$)/g;
  const matches = [...s.matchAll(re)];
  if (matches.length) {
    return matches
      .map((m) => ({ point: Number(m[1]), text: String(m[2] || "").trim() }))
      .filter((x) => x.point >= 1 && x.point <= 5 && x.text);
  }

  // Fallback: split by blank lines and assign 1..5
  const parts = s.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);
  return parts.slice(0, 5).map((text, idx) => ({ point: idx + 1, text }));
};


/**
 * ✅ 라벨 한글 표기 (요청 매핑)
 * - FACT -> 팩트
 * - INTERPRETATION -> 추정
 * - SPECULATION -> 해석
 */
const labelMeta = (label?: string) => {
  const v = String(label || "interpretation").toLowerCase();
  if (v === "fact") return { text: "팩트", tone: "ok" as const };
  if (v === "interpretation") return { text: "추정", tone: "mid" as const };
  if (v === "speculation") return { text: "해석", tone: "warn" as const };
  // unknown label fallback
  return { text: "추정", tone: "mid" as const };
};

export default function OnePageSummaryCard({ keyword, analysis, activePoint, onSelectPoint, isDarkMode }: Props) {
  const points = useMemo(() => splitFivePoints(analysis?.summary || ""), [analysis?.summary]);

  const hasAnyTrust = Boolean(
  (analysis as any)?.confidenceScore != null ||
    (Array.isArray((analysis as any)?.factChecks) && (analysis as any).factChecks.length) ||
    (Array.isArray((analysis as any)?.citations) && (analysis as any).citations.length)
);

const confidence = hasAnyTrust
  ? clamp(
      Number(
        (analysis as any)?.confidenceScore ??
          (() => {
            const fc = Array.isArray((analysis as any)?.factChecks) ? (analysis as any).factChecks : [];
            const ct = Array.isArray((analysis as any)?.citations) ? (analysis as any).citations : [];
            const pointSet = new Set<number>();
            ct.forEach((c: any) => {
              const p = Number(c?.point);
              if (Number.isFinite(p)) pointSet.add(Math.min(5, Math.max(1, p)));
            });
            const coverage = pointSet.size / 5;
            const avgFact =
              fc.length > 0
                ? fc.reduce((a: number, f: any) => a + (Number(f?.confidence) || 0), 0) / fc.length
                : 0;
            const score = 30 + coverage * 45 + Math.min(20, ct.length * 2) + avgFact * 0.25;
            return Math.round(score);
          })()
      ),
      0,
      100
    )
  : null;
  const confidenceTone = confidence == null ? "none" : confidence >= 70 ? "high" : confidence >= 40 ? "mid" : "low";

  const citationsByPoint = useMemo(() => {
    const list = Array.isArray(analysis?.citations) ? (analysis!.citations as Citation[]) : [];
    const map = new Map<number, Citation[]>();
    for (const c of list) {
      const p = clamp(Number((c as any)?.point ?? 0), 1, 5);
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(c);
    }
    return map;
  }, [analysis?.citations]);

  const factByPoint = useMemo(() => {
    const list = Array.isArray(analysis?.factChecks) ? (analysis!.factChecks as FactCheck[]) : [];
    const map = new Map<number, FactCheck>();
    for (const f of list) {
      const p = clamp(Number((f as any)?.point ?? 0), 1, 5);
      if (!map.has(p)) map.set(p, f);
    }
    return map;
  }, [analysis?.factChecks]);

  const badge = useMemo(() => {
    if (confidenceTone === "none") {
  return {
    icon: <ShieldAlert className="w-4 h-4" />,
    title: `신뢰도 —`,
    sub: "근거 부족",
    cls: isDarkMode
      ? "bg-amber-500/15 text-amber-200 border-amber-500/25"
      : "bg-amber-50 text-amber-700 border-amber-200",
  };
}
if (confidenceTone === "high") {
      return {
        icon: <ShieldCheck className="w-4 h-4" />,
        title: confidence == null ? `신뢰도 —` : `신뢰도 ${confidence}%`,
        sub: "출처/커버리지 양호",
        cls: isDarkMode
          ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/25"
          : "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    }
    if (confidenceTone === "mid") {
      return {
        icon: <Sparkles className="w-4 h-4" />,
        title: confidence == null ? `신뢰도 —` : `신뢰도 ${confidence}%`,
        sub: "추가 근거 권장",
        cls: isDarkMode
          ? "bg-amber-500/15 text-amber-200 border-amber-500/25"
          : "bg-amber-50 text-amber-700 border-amber-200",
      };
    }
    return {
      icon: <ShieldAlert className="w-4 h-4" />,
      title: confidence == null ? `신뢰도 —` : `신뢰도 ${confidence}%`,
      sub: "근거 부족/리스크",
      cls: isDarkMode ? "bg-rose-500/15 text-rose-200 border-rose-500/25" : "bg-rose-50 text-rose-700 border-rose-200",
    };
  }, [confidence, confidenceTone, isDarkMode]);

  if (!analysis) {
    return (
      <div className={isDarkMode ? "text-gray-200" : "text-gray-800"}>
        분석 결과가 없습니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: one-page summary */}
      <div className={
        "lg:col-span-2 rounded-3xl border shadow-sm overflow-hidden " +
        (isDarkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-200")
      }>
        <div className="p-6 border-b" style={{ borderColor: isDarkMode ? "rgba(255,255,255,0.08)" : "#E5E7EB" }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className={"text-xs tracking-wider uppercase " + (isDarkMode ? "text-gray-400" : "text-gray-500")}>
                한 장 요약 카드
              </div>
              <div className={"mt-1 text-2xl font-extrabold " + (isDarkMode ? "text-white" : "text-gray-900")}>
                {keyword || "키워드"}
              </div>
              <div className={"mt-2 text-sm " + (isDarkMode ? "text-gray-300" : "text-gray-600")}>
                5포인트 요약
              </div>
            </div>

            <div className={"flex items-center gap-2 px-3 py-2 rounded-2xl border " + badge.cls}>
              {badge.icon}
              <div className="leading-tight">
                <div className="text-sm font-bold">{badge.title}</div>
                <div className="text-xs opacity-80">{badge.sub}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {points.map(({ point, text }) => {
            const fact = factByPoint.get(point);
            const meta = labelMeta((fact as any)?.label);
            const isActive = activePoint === point;

            const labelCls =
              meta.tone === "ok"
                ? isDarkMode
                  ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/25"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                : meta.tone === "warn"
                ? isDarkMode
                  ? "bg-rose-500/15 text-rose-200 border-rose-500/25"
                  : "bg-rose-50 text-rose-700 border-rose-200"
                : isDarkMode
                ? "bg-amber-500/15 text-amber-200 border-amber-500/25"
                : "bg-amber-50 text-amber-700 border-amber-200";

            return (
              <button
                key={point}
                type="button"
                onClick={() => onSelectPoint(isActive ? null : point)}
                className={
                  "w-full text-left rounded-2xl border p-4 transition " +
                  (isDarkMode
                    ? isActive
                      ? "bg-white/10 border-white/20"
                      : "bg-white/5 border-white/10 hover:bg-white/10"
                    : isActive
                    ? "bg-emerald-50/50 border-emerald-200"
                    : "bg-gray-50 border-gray-200 hover:bg-gray-100")
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={"text-base font-bold " + (isDarkMode ? "text-white" : "text-gray-900")}>
                    {point}. 핵심 포인트
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={"text-xs px-2 py-1 rounded-full border " + labelCls}>{meta.text}</span>
                    <span className={"text-xs " + (isDarkMode ? "text-gray-400" : "text-gray-500")}>
                      {(fact as any)?.confidence != null ? `확신 ${clamp(Number((fact as any).confidence), 0, 100)}%` : ""}
                    </span>
                  </div>
                </div>

                <div className={"mt-2 text-sm leading-relaxed whitespace-pre-wrap " + (isDarkMode ? "text-gray-200" : "text-gray-700")}>
                  {text}
                </div>

                {(fact as any)?.reason ? (
                  <div className={"mt-3 text-xs " + (isDarkMode ? "text-gray-400" : "text-gray-500")}>
                    {String((fact as any).reason)}
                  </div>
                ) : null}

                {/* Inline citations preview */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(citationsByPoint.get(point) || []).slice(0, 3).map((c, idx) => (
                    <a
                      key={idx}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className={
                        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition " +
                        (isDarkMode
                          ? "bg-white/5 border-white/10 text-gray-200 hover:bg-white/10"
                          : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                      }
                      title={c.title}
                    >
                      <LinkIcon className="w-3 h-3" />
                      <span className="max-w-[240px] truncate">{c.publisher || "source"}</span>
                    </a>
                  ))}
                </div>
              </button>
            );
          })}

          {!points.length ? (
            <div className={isDarkMode ? "text-gray-300" : "text-gray-700"}>요약 텍스트를 찾지 못했습니다.</div>
          ) : null}
        </div>
      </div>

      {/* Right: citations spotlight */}
      <div className={
        "rounded-3xl border shadow-sm overflow-hidden " +
        (isDarkMode ? "bg-white/5 border-white/10" : "bg-white border-gray-200")
      }>
        <div className="p-5 border-b" style={{ borderColor: isDarkMode ? "rgba(255,255,255,0.08)" : "#E5E7EB" }}>
          <div className={"text-sm font-bold " + (isDarkMode ? "text-white" : "text-gray-900")}>
            근거 링크 하이라이트
          </div>
          <div className={"mt-1 text-xs " + (isDarkMode ? "text-gray-400" : "text-gray-500")}>
            포인트를 클릭하면 해당 근거가 강조됩니다.
          </div>
        </div>

        <div className="p-5 space-y-3">
          {[1, 2, 3, 4, 5].map((p) => {
            const items = (citationsByPoint.get(p) || []).slice(0, 5);
            const isActive = activePoint === p;
            return (
              <div
                key={p}
                className={
                  "rounded-2xl border p-3 " +
                  (isDarkMode
                    ? isActive
                      ? "bg-white/10 border-white/20"
                      : "bg-white/5 border-white/10"
                    : isActive
                    ? "bg-emerald-50/50 border-emerald-200"
                    : "bg-gray-50 border-gray-200")
                }
              >
                <button
                  type="button"
                  onClick={() => onSelectPoint(isActive ? null : p)}
                  className="w-full text-left"
                >
                  <div className={"text-sm font-bold " + (isDarkMode ? "text-white" : "text-gray-900")}>
                    포인트 {p}
                  </div>
                </button>

                {items.length ? (
                  <div className="mt-2 space-y-2">
                    {items.map((c, idx) => (
                      <a
                        key={idx}
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className={
                          "block rounded-xl border p-2 text-xs transition " +
                          (isDarkMode
                            ? "bg-white/5 border-white/10 text-gray-200 hover:bg-white/10"
                            : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                        }
                        title={c.title}
                      >
                        <div className="font-semibold line-clamp-2">{c.title || "출처"}</div>
                        <div className={"mt-1 opacity-80 line-clamp-1 " + (isDarkMode ? "text-gray-300" : "text-gray-500")}>
                          {(c.publisher || "").trim() ? `${c.publisher} · ` : ""}{c.url}
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className={"mt-2 text-xs " + (isDarkMode ? "text-gray-400" : "text-gray-500")}>
                    근거 링크 없음
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
