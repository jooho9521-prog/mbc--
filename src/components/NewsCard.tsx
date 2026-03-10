import React, { useMemo, useState } from "react";
import {
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronUp,
  BadgeCheck,
  Link as LinkIcon,
} from "lucide-react";
import type { NewsItem, TrendAnalysis, Citation } from "../types";

type Props = {
  item: NewsItem;
  keyword?: string;
  analysis?: TrendAnalysis | null;
  onShowToast?: (msg: string) => void;
  isDarkMode?: boolean;
  /** ✅ C단계: 선택된 포인트(1~5). 해당 포인트 근거 카드 자동 강조/펼침 */
  activePoint?: number | null;
  /** ✅ 소스피드 표시용: 근거 N 라벨 */
  ordinal?: number;
};

/** ---------------- Utils ---------------- */

const safeHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "";
  }
};

const getFaviconUrl = (url: string) => {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`;
  } catch {
    return "";
  }
};

const normalizeUrl = (u: string) => {
  try {
    const url = new URL(u);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) =>
      url.searchParams.delete(k)
    );
    return url.toString();
  } catch {
    return (u || "").trim();
  }
};

const getItemUrl = (item: any) => {
  const u = (item?.uri || item?.url || "").trim();
  return u;
};

const matchCitationsForUrl = (citations: Citation[] | undefined, uri: string) => {
  const target = normalizeUrl(uri);
  const targetHost = safeHostname(target);

  if (!citations?.length) return [];

  const exact = citations.filter((c) => normalizeUrl(String(c?.url || "")) === target);
  if (exact.length) return exact;

  const hostMatches = citations.filter((c) => safeHostname(String(c?.url || "")) === targetHost);
  if (hostMatches.length) return hostMatches;

  const loose = citations.filter((c) => {
    const cu = String(c?.url || "");
    return cu && safeHostname(cu) && safeHostname(cu) === targetHost;
  });
  return loose;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const highlightKeyword = (text: string, keyword?: string) => {
  const k = (keyword || "").trim();
  if (!k || k.length < 2) return text;
  try {
    const reg = new RegExp(`(${escapeRegExp(k)})`, "gi");
    const parts = text.split(reg);
    return (
      <>
        {parts.map((p, i) =>
          reg.test(p) ? (
            <mark key={i} className="bg-yellow-200/60 text-inherit px-0.5 rounded-sm">
              {p}
            </mark>
          ) : (
            <React.Fragment key={i}>{p}</React.Fragment>
          )
        )}
      </>
    );
  } catch {
    return text;
  }
};


const hashToPointNotation = (point: number) => {
  const p = Number(point);
  if (!Number.isFinite(p) || p <= 0) return "검증";
  return `검증 · 포인트 ${Math.min(5, Math.max(1, Math.round(p)))}`;
};

/** ---------------- Component ---------------- */

export const NewsCard: React.FC<Props> = ({
  item,
  analysis,
  onShowToast,
  isDarkMode,
  keyword,
  activePoint,
  ordinal,
}) => {
  const [expanded, setExpanded] = useState(false);

  const uri = useMemo(() => getItemUrl(item), [item]);

  const dateText = useMemo(() => {
    if (!item?.date) return "";
    return String(item.date);
  }, [item?.date]);

  const sourceText = useMemo(() => {
    return (item?.source || safeHostname(uri) || "Web").toString();
  }, [item?.source, uri]);

  const favicon = useMemo(() => getFaviconUrl(uri), [uri]);

  const citationsForThisCard = useMemo(() => {
    const arr = Array.isArray(analysis?.citations) ? analysis?.citations : [];
    return matchCitationsForUrl(arr, uri);
  }, [analysis?.citations, uri]);

  const hasEvidence = citationsForThisCard.length > 0;

  const evidenceInline = useMemo(() => citationsForThisCard.slice(0, 2), [citationsForThisCard]);
  const evidenceMore = useMemo(() => citationsForThisCard.slice(2, 5), [citationsForThisCard]);

  // ✅ C단계: 선택된 포인트가 이 카드의 근거와 매칭되면 자동으로 더보기 펼침
  React.useEffect(() => {
    if (!activePoint) return;
    if (!citationsForThisCard?.length) return;
    const hit = citationsForThisCard.some((c) => Number(c?.point) === Number(activePoint));
    if (hit) setExpanded(true);
  }, [activePoint, citationsForThisCard]);


  const copyLink = async () => {
    if (!uri) return;
    try {
      await navigator.clipboard.writeText(uri);
      onShowToast?.("✅ 링크가 복사되었습니다.");
    } catch {
      onShowToast?.("복사에 실패했습니다. (브라우저 권한 확인)");
    }
  };

  /** ---------------- Styles ---------------- */
  const cardBase =
    `rounded-2xl border shadow-sm hover:shadow-md transition-all p-5 ` +
    (isDarkMode
      ? "border-gray-800 bg-gray-900 text-gray-100"
      : "border-gray-100 bg-white text-gray-900");

  const subText = isDarkMode ? "text-gray-400" : "text-gray-500";
  const subText2 = isDarkMode ? "text-gray-500" : "text-gray-400";
  const snippetText = isDarkMode ? "text-gray-300" : "text-gray-600";
  const btnBg = isDarkMode
    ? "bg-gray-800 hover:bg-gray-700 text-gray-200"
    : "bg-gray-50 hover:bg-gray-100 text-gray-600";

  const evidenceChip = isDarkMode
    ? "bg-emerald-900/30 text-emerald-200 border-emerald-800"
    : "bg-emerald-50 text-emerald-700 border-emerald-100";

  const inlineLinkStyle = isDarkMode
    ? "text-gray-200 hover:text-[#8abfff]"
    : "text-gray-700 hover:text-[#0071e3]";

  const inlineBox = isDarkMode ? "bg-gray-800/60 border-gray-800" : "bg-gray-50 border-gray-100";

  if (!uri) {
    return (
      <div className={cardBase}>
        <div className="text-[12px] font-black text-rose-500">유효한 링크가 없는 소스입니다.</div>
        <div className={`mt-2 text-[12px] ${subText}`}>{item?.title || "제목 없음"}</div>
      </div>
    );
  }

  return (
    <div className={cardBase}>
      <div className="flex items-start justify-between gap-3">
        <a
          href={uri}
          target="_blank"
          rel="noreferrer"
          className="flex-1 min-w-0"
          title={item?.title || uri}
        >
          <div className="flex items-center gap-2 mb-2">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="w-4 h-4 rounded-sm"
                loading="lazy"
                onError={(e) => {
                  (e.target as any).style.display = "none";
                }}
              />
            ) : null}

            <span className={`text-[11px] font-black ${subText}`}>{sourceText}</span>

            {dateText ? (
              <span className={`text-[11px] font-bold ${subText2}`}>· {dateText}</span>
            ) : null}

            {hasEvidence ? (
              <span
                className={
                  "ml-auto inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full border " +
                  evidenceChip +
                  (activePoint && citationsForThisCard.some((c) => Number(c?.point) === Number(activePoint))
                    ? (isDarkMode ? " ring-2 ring-emerald-500/40" : " ring-2 ring-emerald-300")
                    : "")
                }
                title={`출처 링크 ${citationsForThisCard.length}개 매칭`}
              >
                <BadgeCheck size={12} /> 근거 {citationsForThisCard.length}
              </span>
            ) : null}
          </div>

          <h4
            className={`font-black text-[14px] leading-snug line-clamp-2 ${
              isDarkMode ? "text-white" : "text-gray-900"
            }`}
          >
            {item?.title ? highlightKeyword(String(item.title), keyword) : "제목 없음"}
          </h4>

          {item?.snippet ? (
            <p className={`mt-2 text-[12px] leading-relaxed line-clamp-3 whitespace-pre-line ${snippetText}`}>
              {highlightKeyword(String(item.snippet), keyword)}
            </p>
          ) : null}
        </a>

        <div className="flex items-center gap-1">
          <button onClick={copyLink} className={`p-2 rounded-xl ${btnBg}`} title="링크 복사">
            <Copy size={16} />
          </button>
          <a href={uri} target="_blank" rel="noreferrer" className={`p-2 rounded-xl ${btnBg}`} title="새 탭에서 열기">
            <ExternalLink size={16} />
          </a>
        </div>
      </div>

      {hasEvidence ? (
        <div className={`mt-4 rounded-xl border p-3 ${inlineBox}`}>
          <div className="flex items-center justify-between gap-2">
            <div className={`text-[11px] font-black ${subText} flex items-center gap-2`}>
              <LinkIcon size={14} />
              출처 링크
            </div>

            {citationsForThisCard.length > 2 ? (
              <button
                onClick={() => setExpanded((v) => !v)}
                className={
                  "text-[11px] font-black px-3 py-1 rounded-full border transition-all " +
                  (isDarkMode
                    ? "bg-gray-900 border-gray-700 text-gray-200 hover:bg-gray-800"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50")
                }
              >
                {expanded ? (
                  <span className="inline-flex items-center gap-1">
                    접기 <ChevronUp size={14} />
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    더보기 <ChevronDown size={14} />
                  </span>
                )}
              </button>
            ) : null}
          </div>

          {/* ✅ 옵션 A: “검증 · 포인트 n” + 툴팁 */}
          <div className="mt-2 space-y-2">
            {evidenceInline.map((c, idx) => {
              const curl = String(c?.url || "").trim();
              const title = String(c?.title || "").trim() || safeHostname(curl) || "출처 링크";
              const point = Number(c?.point) || 0;

              return (
                <a
                  key={`inline-${idx}`}
                  href={curl}
                  target="_blank"
                  rel="noreferrer"
                  className={`block text-[12px] font-bold hover:underline ${inlineLinkStyle} ${activePoint && point && Number(activePoint)===Number(point) ? (isDarkMode ? 'bg-emerald-900/20 ring-1 ring-emerald-700 rounded-lg px-2 py-1' : 'bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-2 py-1') : ''}`}
                  title={point ? `요약의 ${point}번 주장/포인트를 뒷받침하는 출처` : curl}
                >
                  • {point ? `검증 · 포인트 ${point} — ` : ""}
                  {title}
                </a>
              );
            })}
          </div>

          {expanded && evidenceMore.length ? (
            <div className="mt-2 pt-2 border-t border-gray-200/40 space-y-2">
              {evidenceMore.map((c, idx) => {
                const curl = String(c?.url || "").trim();
                const title = String(c?.title || "").trim() || safeHostname(curl) || "출처 링크";
                const point = Number(c?.point) || 0;

                return (
                  <a
                    key={`more-${idx}`}
                    href={curl}
                    target="_blank"
                    rel="noreferrer"
                    className={`block text-[12px] font-bold hover:underline ${inlineLinkStyle} ${activePoint && point && Number(activePoint)===Number(point) ? (isDarkMode ? 'bg-emerald-900/20 ring-1 ring-emerald-700 rounded-lg px-2 py-1' : 'bg-emerald-50 ring-1 ring-emerald-200 rounded-lg px-2 py-1') : ''}`}
                    title={point ? `요약의 ${point}번 주장/포인트를 뒷받침하는 출처` : curl}
                  >
                    • {point ? `검증 · 포인트 ${point} — ` : ""}
                    {title}
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default NewsCard;