/* eslint-disable @typescript-eslint/no-explicit-any */

const REQUEST_TIMEOUT_MS = 8000;

const ARTICLE_DATE_PATTERNS: RegExp[] = [
  /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
  /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:published_time["'][^>]*>/i,
  /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']pubdate["'][^>]*>/i,
  /<meta[^>]+name=["']publishdate["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']publishdate["'][^>]*>/i,
  /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i,
  /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']datePublished["'][^>]*>/i,
  /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
];

const INPUT_LABEL_PATTERNS: RegExp[] = [
  /(입력|등록|기사입력|기사등록|최초등록|작성)\s*[:|]?\s*(20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
  /(발행|게시|보도|보도일시|업로드)\s*[:|]?\s*(20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
];

const UPDATE_LABEL_PATTERNS: RegExp[] = [
  /(수정|업데이트|최종수정|갱신)\s*[:|]?\s*(20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
];

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }

  const targetUrl = String(req.query?.url || "").trim();
  if (!targetUrl) {
    res.status(400).json({ ok: false, error: "Missing url query" });
    return;
  }

  let normalizedUrl = "";
  try {
    normalizedUrl = new URL(targetUrl).toString();
  } catch {
    res.status(400).json({ ok: false, error: "Invalid url" });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      res.status(response.status).json({
        ok: false,
        url: normalizedUrl,
        error: `Upstream responded with ${response.status}`,
      });
      return;
    }

    const html = await response.text();
    const parsed = extractPublishedDateWithPriority(html);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    res.status(200).json({
      ok: true,
      url: normalizedUrl,
      finalUrl: response.url || normalizedUrl,
      publishedAt: parsed.publishedAt || "",
      matchedBy: parsed.matchedBy || "",
      rawValue: parsed.rawValue || "",
    });
  } catch (error: any) {
    clearTimeout(timer);
    res.status(500).json({
      ok: false,
      url: normalizedUrl,
      error: error?.name === "AbortError" ? "Request timeout" : error?.message || "Unknown error",
    });
  }
}

function extractPublishedDateWithPriority(html: string): {
  publishedAt: string;
  matchedBy: string;
  rawValue: string;
} {
  const text = String(html || "");
  if (!text) return { publishedAt: "", matchedBy: "", rawValue: "" };

  for (const re of ARTICLE_DATE_PATTERNS) {
    const match = text.match(re);
    const raw = String(match?.[1] || "").trim();
    const iso = normalizeAnyDateToIso(raw);
    if (iso) {
      return { publishedAt: iso, matchedBy: re.source, rawValue: raw };
    }
  }

  const jsonLdBlocks =
    text.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const block of jsonLdBlocks) {
    const directDatePublished = block.match(/"datePublished"\s*:\s*"([^"]+)"/i);
    const directDateCreated = block.match(/"dateCreated"\s*:\s*"([^"]+)"/i);
    const candidate =
      String(directDatePublished?.[1] || "").trim() ||
      String(directDateCreated?.[1] || "").trim();
    const iso = normalizeAnyDateToIso(candidate);
    if (iso) {
      return { publishedAt: iso, matchedBy: "jsonld:datePublished", rawValue: candidate };
    }
  }

  for (const re of INPUT_LABEL_PATTERNS) {
    const match = text.match(re);
    const raw = String(match?.[2] || "").trim();
    const iso = normalizeAnyDateToIso(raw);
    if (iso) {
      return { publishedAt: iso, matchedBy: `label-input:${re.source}`, rawValue: raw };
    }
  }

  for (const re of UPDATE_LABEL_PATTERNS) {
    const match = text.match(re);
    const raw = String(match?.[2] || "").trim();
    const iso = normalizeAnyDateToIso(raw);
    if (iso) {
      return { publishedAt: iso, matchedBy: `label-update:${re.source}`, rawValue: raw };
    }
  }

  const wideDateMatches =
    text.match(/20\d{2}[.\/-]\s*\d{1,2}[.\/-]\s*\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g) || [];
  for (const raw of wideDateMatches) {
    const iso = normalizeAnyDateToIso(raw);
    if (iso) {
      return { publishedAt: iso, matchedBy: "wide-date-scan", rawValue: raw };
    }
  }

  return { publishedAt: "", matchedBy: "", rawValue: "" };
}

function normalizeAnyDateToIso(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const cleaned = raw
    .replace(/년/g, "-")
    .replace(/월/g, "-")
    .replace(/일/g, " ")
    .replace(/[.]/g, "-")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const withTime = cleaned.match(
    /^(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)$/
  );
  if (withTime) {
    const [, y, mo, d, h, mi, sec] = withTime;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec || 0)
    ).toISOString();
  }

  const dateOnly = cleaned.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0).toISOString();
  }

  return "";
}
