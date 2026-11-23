import { DEFAULT_TMDB_KEY, getSetting, normalizeQuality } from "./db.js";

export const TMDB_GENRES_AR = {
  28: "أكشن وحركة", 12: "مغامرة", 16: "أنميشن", 35: "كوميديا",
  80: "جريمة", 99: "وثائقي", 18: "دراما", 10751: "عائلي",
  14: "فانتازيا", 36: "تاريخي", 27: "رعب", 10402: "موسيقى",
  9648: "غموض", 10749: "رومانسية", 878: "خيال علمي", 10770: "فيلم تلفزيوني",
  53: "إثارة وتشويق", 10752: "حرب", 37: "غربي", 10759: "أكشن وحركة",
  10762: "أطفال", 10765: "فانتازيا", 10768: "حرب وسياسة",
};

export const COUNTRY_NAMES_AR = {
  US: "الولايات المتحدة الأمريكية", GB: "المملكة المتحدة", KR: "كوريا الجنوبية",
  JP: "اليابان", CN: "الصين", IN: "الهند", TR: "تركيا", EG: "مصر",
  SA: "السعودية", IQ: "العراق", SY: "سوريا", LB: "لبنان", KW: "الكويت",
  AE: "الإمارات", FR: "فرنسا", ES: "إسبانيا", DE: "ألمانيا", IT: "إيطاليا",
  CA: "كندا", AU: "أستراليا", RU: "روسيا", NL: "هولندا", JO: "الأردن",
  MA: "المغرب", TN: "تونس", DZ: "الجزائر", QA: "قطر", BH: "البحرين",
  OM: "عُمان", TH: "تايلاند", ID: "إندونيسيا", IR: "إيران", PK: "باكستان",
};

function getTmdbKey(env, settings) {
  return (getSetting(settings, "tmdb_api_key", "") || String(env.TMDB_API_KEY || "") || DEFAULT_TMDB_KEY).trim();
}

async function tmdbFetchJson(env, settings, path, params = {}) {
  const apiKey = getTmdbKey(env, settings);
  const url = new URL(`https://api.themoviedb.org/3/${path.replace(/^\/+/, "")}`);
  const headers = {};
  if (apiKey.length > 60) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set("api_key", apiKey);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  try {
    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export function parseQueryAndYear(rawQuery) {
  const s = String(rawQuery || "").trim();
  const m = s.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return { cleanQuery: s, year: "" };
  return { cleanQuery: s.replace(m[0], "").replace(/\s{2,}/g, " ").trim() || s, year: m[1] };
}

export function parseVideoCaption(caption, fileName = "") {
  const raw = `${caption || ""} ${fileName || ""}`.trim();
  const firstLine = String(caption || fileName || "").split("\n")[0].trim();

  // Quality
  let quality = "720";
  const qm = raw.match(/\b(4k|2160p?|1440p?|1080p?|720p?|540p?|480p?|360p?|240p?|144p?)\b/i);
  if (qm) quality = normalizeQuality(qm[1]);

  // Season & Episode
  let season = 1;
  let episode = 0;
  let detectedType = "movie";

  const seMatch = raw.match(/S(\d{1,2})\s*E(\d{1,3})/i)
    || raw.match(/الموسم\s*(\d{1,2}).*?(?:الحلقة|حلقة)\s*(\d{1,3})/i)
    || raw.match(/م(\d{1,2})\s*ح(\d{1,3})/i);

  if (seMatch) {
    season = parseInt(seMatch[1], 10) || 1;
    episode = parseInt(seMatch[2], 10) || 0;
    detectedType = "tv";
  } else {
    const epOnly = raw.match(/(?:الحلقة|حلقة|EP|E)\s*[:#-]?\s*(\d{1,3})\b/i);
    if (epOnly) {
      episode = parseInt(epOnly[1], 10) || 0;
      detectedType = "tv";
    }
    const sOnly = raw.match(/(?:الموسم|موسم|Season|S)\s*[:#-]?\s*(\d{1,2})\b/i);
    if (sOnly) {
      season = parseInt(sOnly[1], 10) || 1;
      detectedType = "tv";
    }
  }

  if (/أنمي|انمي|anime/i.test(raw)) detectedType = "anime";

  // Clean title
  let title = firstLine
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/S\d{1,2}\s*E\d{1,3}/gi, "")
    .replace(/(?:الموسم|موسم)\s*\d{1,2}/gi, "")
    .replace(/(?:الحلقة|حلقة)\s*\d{1,3}/gi, "")
    .replace(/\b(4k|2160p?|1440p?|1080p?|720p?|540p?|480p?|360p?|240p?|144p?|web-?dl|bluray|hdrip|x264|x265|hevc|aac|مترجم|مدبلج|كامل|جودة عالية|فيلم|مسلسل|أنمي|انمي)\b/gi, "")
    .replace(/[@#]\S+/g, "")
    .replace(/[\[\](){}|_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const { cleanQuery, year } = parseQueryAndYear(title);
  return {
    title: cleanQuery || firstLine.slice(0, 60) || "عمل جديد",
    year,
    quality,
    season,
    episode,
    media_type: detectedType,
  };
}

export async function searchTmdb(env, settings, query, mediaType = "movie") {
  const { cleanQuery, year } = parseQueryAndYear(query);
  if (!cleanQuery) return [];

  if (mediaType === "anime") {
    const [tvRes, mvRes] = await Promise.all([
      tmdbFetchJson(env, settings, "search/tv", { query: cleanQuery, language: "ar-SA", include_adult: "false", first_air_date_year: year }),
      tmdbFetchJson(env, settings, "search/movie", { query: cleanQuery, language: "ar-SA", include_adult: "false", year }),
    ]);
    const combined = [
      ...((tvRes && tvRes.results) || []).slice(0, 5).map((x) => ({ ...x, _ep: "tv" })),
      ...((mvRes && mvRes.results) || []).slice(0, 5).map((x) => ({ ...x, _ep: "movie" })),
    ];
    combined.sort((a, b) => {
      const aAni = (a.genre_ids || []).includes(16) ? 1 : 0;
      const bAni = (b.genre_ids || []).includes(16) ? 1 : 0;
      if (aAni !== bAni) return bAni - aAni;
      return (b.popularity || 0) - (a.popularity || 0);
    });
    return combined.slice(0, 6).map((it) => ({
      tmdb_id: it.id,
      media_type: "anime",
      tmdb_endpoint: it._ep,
      title: it.title || it.name || it.original_title || "بدون عنوان",
      original_title: it.original_title || it.original_name || it.title || "",
      year: String(it.release_date || it.first_air_date || "").slice(0, 4),
    }));
  }

  const ep = mediaType === "tv" ? "tv" : "movie";
  const params = { query: cleanQuery, language: "ar-SA", include_adult: "false" };
  if (year) params[ep === "tv" ? "first_air_date_year" : "year"] = year;
  const data = await tmdbFetchJson(env, settings, `search/${ep}`, params);
  const results = (data && data.results) || [];
  return results.slice(0, 6).map((it) => ({
    tmdb_id: it.id,
    media_type: mediaType,
    tmdb_endpoint: ep,
    title: it.title || it.name || it.original_title || "بدون عنوان",
    original_title: it.original_title || it.original_name || it.title || "",
    year: String(it.release_date || it.first_air_date || "").slice(0, 4),
  }));
}

export async function getTmdbDetails(env, settings, tmdbId, mediaType = "movie", tmdbEndpoint = "") {
  const isAnimeForced = mediaType === "anime";
  let ep = tmdbEndpoint === "movie" || tmdbEndpoint === "tv" ? tmdbEndpoint : (mediaType === "movie" ? "movie" : "tv");
  let item = await tmdbFetchJson(env, settings, `${ep}/${tmdbId}`, {
    language: "ar-SA",
    append_to_response: "credits,videos",
    include_video_language: "ar,en,null",
  });
  if (!item && isAnimeForced && !tmdbEndpoint) {
    ep = ep === "tv" ? "movie" : "tv";
    item = await tmdbFetchJson(env, settings, `${ep}/${tmdbId}`, {
      language: "ar-SA",
      append_to_response: "credits,videos",
      include_video_language: "ar,en,null",
    });
  }
  if (!item) return null;

  let overview = String(item.overview || "").trim();
  if (!overview) {
    const enItem = await tmdbFetchJson(env, settings, `${ep}/${tmdbId}`, { language: "en-US" });
    overview = String((enItem && enItem.overview) || "لا يوجد وصف متاح لهذا العمل.").trim();
  }

  const title = item.title || item.name || "بدون عنوان";
  const origTitle = item.original_title || item.original_name || title;
  const year = String(item.release_date || item.first_air_date || "").slice(0, 4);
  const runtime = item.runtime || (Array.isArray(item.episode_run_time) && item.episode_run_time[0]) || 0;
  const duration = ep === "tv"
    ? `${item.number_of_seasons || 1} موسم`
    : (runtime ? `${runtime} دقيقة` : "115 دقيقة");

  const countryCode = (Array.isArray(item.origin_country) && item.origin_country[0])
    || (Array.isArray(item.production_countries) && item.production_countries[0] && item.production_countries[0].iso_3166_1)
    || "US";
  const countryAr = COUNTRY_NAMES_AR[countryCode] || "الولايات المتحدة الأمريكية";
  const origLang = item.original_language || "en";

  const genres = [];
  for (const g of item.genres || []) {
    const gname = TMDB_GENRES_AR[g.id] || g.name || "";
    if (gname && !genres.includes(gname)) genres.push(gname);
  }

  const isAnime = isAnimeForced || (genres.includes("أنميشن") && (origLang === "ja" || countryCode === "JP"));
  const finalType = isAnime ? "anime" : mediaType;

  let catLabel = finalType === "movie" ? "فيلم أجنبي" : "مسلسل أجنبي";
  if (finalType === "anime") catLabel = "أنمي";
  else if (countryCode === "IQ") catLabel = finalType === "movie" ? "فيلم عراقي" : "مسلسل عراقي";
  else if (countryCode === "TR" || origLang === "tr") catLabel = finalType === "movie" ? "فيلم تركي" : "مسلسل تركي";
  else if (countryCode === "IN" || ["hi", "ta", "te", "ml"].includes(origLang)) catLabel = finalType === "movie" ? "فيلم هندي" : "مسلسل هندي";
  else if (origLang === "ar" || ["EG", "SY", "LB", "KW", "SA", "AE", "JO", "MA", "TN", "DZ"].includes(countryCode)) {
    catLabel = finalType === "movie" ? "فيلم عربي" : "مسلسل عربي";
  } else if (["ko", "zh", "ja", "th", "id"].includes(origLang) || ["KR", "JP", "CN", "TH", "ID"].includes(countryCode)) {
    catLabel = finalType === "movie" ? "فيلم آسيوي" : "مسلسل آسيوي";
  }

  const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "";
  const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : posterUrl;

  let colId = 0;
  let colName = "";
  let colPoster = "";
  let colBackdrop = "";
  if (ep === "movie" && item.belongs_to_collection && item.belongs_to_collection.id) {
    const btc = item.belongs_to_collection;
    colId = Number(btc.id);
    const rawName = String(btc.name || "").replace(/\s*-\s*السلسلة\s*$/i, "").replace(/\s*Collection\s*$/i, "").trim();
    colName = rawName.startsWith("سلسلة") ? rawName : `سلسلة ${rawName || origTitle}`;
    colPoster = btc.poster_path ? `https://image.tmdb.org/t/p/w500${btc.poster_path}` : "";
    colBackdrop = btc.backdrop_path ? `https://image.tmdb.org/t/p/w780${btc.backdrop_path}` : "";
  }

  const cast = ((item.credits && item.credits.cast) || []).slice(0, 10).map((c) => ({
    id: Number(c.id || 0),
    name: String(c.name || c.original_name || "").trim(),
    character: String(c.character || "").trim(),
    profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : "",
  })).filter((c) => c.name);

  let trailerUrl = "";
  const vids = (item.videos && item.videos.results) || [];
  const yt = vids.find((v) => String(v.site || "").toLowerCase() === "youtube" && v.key && ["trailer", "teaser"].includes(String(v.type || "").toLowerCase()))
    || vids.find((v) => String(v.site || "").toLowerCase() === "youtube" && v.key);
  if (yt) trailerUrl = `https://www.youtube.com/watch?v=${yt.key}`;

  return {
    tmdb_id: Number(tmdbId),
    media_type: finalType,
    title,
    original_title: origTitle,
    year,
    duration,
    country: countryAr,
    category_label: catLabel,
    rating: Math.round((Number(item.vote_average || 0)) * 10) / 10,
    genres: genres.length ? genres.slice(0, 3) : ["دراما"],
    overview,
    poster_url: posterUrl,
    backdrop_url: backdropUrl,
    cast,
    trailer_url: trailerUrl,
    collection_id: colId,
    collection_name: colName,
    collection_poster: colPoster,
    collection_backdrop: colBackdrop,
  };
}

export async function getTmdbSeasonEpisodes(env, settings, tmdbId, season = 1) {
  const tid = Number(tmdbId || 0);
  const sNum = Number(season || 1);
  if (!tid) return {};
  const [arData, enData] = await Promise.all([
    tmdbFetchJson(env, settings, `tv/${tid}/season/${sNum}`, { language: "ar-SA" }),
    tmdbFetchJson(env, settings, `tv/${tid}/season/${sNum}`, { language: "en-US" }),
  ]);
  const arEps = (arData && arData.episodes) || [];
  const enEps = (enData && enData.episodes) || [];
  if (!arEps.length && !enEps.length) return {};
  const baseEps = arEps.length ? arEps : enEps;
  const enMap = Object.fromEntries(enEps.map((e) => [Number(e.episode_number || 0), e]));
  const out = {};
  for (const e of baseEps) {
    const num = Number(e.episode_number || 0);
    if (!num) continue;
    const en = enMap[num] || {};
    let name = String(e.name || "").trim();
    if (/^(?:الحلقة|حلقة|episode)\s*\d+$/i.test(name)) name = "";
    if (!name) {
      const enName = String(en.name || "").trim();
      if (!/^episode\s*\d+$/i.test(enName)) name = enName;
    }
    out[num] = {
      title: name,
      runtime_min: Number(e.runtime || en.runtime || 0),
    };
  }
  return out;
}

export async function verifySeriesWithTmdb(env, settings, mediaItem) {
  if (!mediaItem || !["tv", "anime"].includes(mediaItem.media_type)) {
    return { ok: false, seasons: [] };
  }
  const tid = Number(mediaItem.tmdb_id || 0);
  const bySeason = {};
  const titledSet = new Set();
  for (const f of mediaItem.files || []) {
    const s = Number(f.season || 1);
    const e = Number(f.episode || 0);
    if (!e) continue;
    if (!bySeason[s]) bySeason[s] = new Set();
    bySeason[s].add(e);
    const t = String(f.episode_title || "").trim();
    if (t && !/^(?:الحلقة|حلقة|episode)\s*\d+$/i.test(t)) titledSet.add(`${s}:${e}`);
  }
  const seasons = [];
  for (const sNum of Object.keys(bySeason).map(Number).sort((a, b) => a - b)) {
    const uploaded = Array.from(bySeason[sNum]).sort((a, b) => a - b);
    const tmdbEps = tid > 0 ? await getTmdbSeasonEpisodes(env, settings, tid, sNum) : {};
    const tmdbNums = Object.keys(tmdbEps).map(Number).sort((a, b) => a - b);
    const tmdbTotal = tmdbNums.length;
    let missing = [];
    let extra = [];
    let isComplete = false;
    if (tmdbTotal > 0) {
      missing = tmdbNums.filter((n) => !bySeason[sNum].has(n));
      extra = uploaded.filter((n) => !tmdbEps[n]);
      isComplete = missing.length === 0 && uploaded.length >= tmdbTotal;
    } else {
      const maxE = uploaded[uploaded.length - 1] || 0;
      for (let i = 1; i <= maxE; i++) {
        if (!bySeason[sNum].has(i)) missing.push(i);
      }
      isComplete = missing.length === 0 && uploaded.length > 0;
    }
    const titledCount = uploaded.filter((e) => titledSet.has(`${sNum}:${e}`)).length;
    seasons.push({
      season: sNum,
      uploaded_count: uploaded.length,
      tmdb_total: tmdbTotal,
      uploaded_episodes: uploaded,
      missing_episodes: missing,
      extra_episodes: extra,
      titled_count: titledCount,
      is_complete: isComplete,
    });
  }
  return { ok: true, seasons };
}
