export const SECRET_ARCHIVE_CHANNEL_ID = "-1004386494829";
export const DEFAULT_TMDB_KEY = "3fd2be6f0c70a2a598f084ddfb75487c";
export const APP_VERSION = "3.0.0-Edge";

export const PERM_LABELS = {
  can_add: "إضافة أعمال وحلقات وإضافة محتوى",
  can_edit: "تعديل الأعمال والدمج واختيار الليلة",
  can_delete: "حذف الأعمال والملفات",
  can_requests: "إدارة الطلبات والبلاغات",
  can_users: "إدارة المستخدمين ومنح VIP ونقاط",
  can_broadcast: "إرسال إذاعة عامة للمستخدمين",
};

export const DEFAULT_SMART_SECTIONS = [
  { section_key: "foreign_movies", title: "أفلام أجنبية", subtitle: "أحدث الأفلام العالمية المترجمة", media_type_filter: "movie", auto_category: "فيلم أجنبي", accent_color: "#e11d48", is_enabled: true },
  { section_key: "foreign_series", title: "مسلسلات أجنبية", subtitle: "أقوى المسلسلات العالمية", media_type_filter: "tv", auto_category: "مسلسل أجنبي", accent_color: "#3b82f6", is_enabled: true },
  { section_key: "anime", title: "قسم الأنمي", subtitle: "حلقات وأفلام الأنمي المترجمة", media_type_filter: "anime", auto_category: "أنمي", accent_color: "#f43f5e", is_enabled: true },
  { section_key: "arabic_movies", title: "أفلام عربية", subtitle: "سينما عربية مختارة", media_type_filter: "movie", auto_category: "فيلم عربي", accent_color: "#10b981", is_enabled: true },
  { section_key: "arabic_series", title: "مسلسلات عربية", subtitle: "دراما عربية ورمضانية", media_type_filter: "tv", auto_category: "مسلسل عربي", accent_color: "#14b8a6", is_enabled: true },
  { section_key: "iraqi_series", title: "مسلسلات عراقية", subtitle: "أحدث الأعمال العراقية", media_type_filter: "tv", auto_country: "العراق", auto_category: "مسلسل عراقي", accent_color: "#f59e0b", is_enabled: true },
  { section_key: "turkish_series", title: "مسلسلات تركية", subtitle: "دراما تركية مترجمة", media_type_filter: "tv", auto_country: "تركيا", auto_category: "مسلسل تركي", accent_color: "#ef4444", is_enabled: true },
  { section_key: "indian_movies", title: "أفلام هندية", subtitle: "بوليوود وأكشن هندي", media_type_filter: "movie", auto_country: "الهند", auto_category: "فيلم هندي", accent_color: "#f97316", is_enabled: true },
  { section_key: "asian_series", title: "مسلسلات آسيوية", subtitle: "كورية وصينية ويابانية", media_type_filter: "tv", auto_category: "مسلسل آسيوي", accent_color: "#8b5cf6", is_enabled: true },
];

export const EDGE_CACHE = {
  ts: 0,
  settings: null,
  media: null,
  media_files: null,
  users: null,
  admins: null,
  ad_tasks: null,
  custom_sections: null,
  media_requests: null,
  media_reports: null,
  comments: null,
  user_lists: null,
  pull_logs: null,
  share_logs: null,
  botInfo: {
    main_username: "Vortexee_Bot",
    sender_username: "Vortexeeserver_Bot",
    admin_username: "Vortexeadmin_Bot",
    main_id: 9073252184,
    sender_id: 9245596135,
    admin_id: 9124179798,
  },
};

export function invalidateEdgeCache() {
  EDGE_CACHE.ts = 0;
}

export function getAdminIds(env) {
  const raw = String(env.ADMIN_IDS || "8093483591,8736734440");
  return raw.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
}

export function getHiddenAdminIds(env) {
  const raw = String(env.HIDDEN_ADMIN_IDS || "8407394858");
  return raw.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
}

export function isHiddenAdmin(env, uid) {
  const id = parseInt(uid, 10);
  return Boolean(id && getHiddenAdminIds(env).includes(id));
}

export function isOwnerId(env, uid) {
  const id = parseInt(uid, 10);
  if (!id) return false;
  return getAdminIds(env).includes(id) || getHiddenAdminIds(env).includes(id);
}

export function isUserAdmin(env, uid, adminsMap) {
  const id = parseInt(uid, 10);
  if (!id) return false;
  if (isOwnerId(env, id)) return true;
  if (adminsMap && adminsMap[String(id)]) {
    const rec = adminsMap[String(id)];
    if (typeof rec === "object" && Number(rec.is_frozen || 0) === 1) return false;
    return true;
  }
  return false;
}

export function hasAdminPerm(env, uid, adminsMap, permKey) {
  const id = parseInt(uid, 10);
  if (!id) return false;
  if (isOwnerId(env, id)) return true;
  if (!adminsMap || !adminsMap[String(id)]) return false;
  const rec = adminsMap[String(id)];
  if (Number(rec.is_frozen || 0) === 1) return false;
  if (!permKey) return true;
  const perms = rec.permissions || rec;
  return Boolean(Number(perms[permKey] ?? 1));
}

export function asObj(val) {
  if (!val || typeof val !== "object") return {};
  if (Array.isArray(val)) {
    const out = {};
    val.forEach((v, i) => {
      if (v !== null && v !== undefined) out[String(i)] = v;
    });
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== null && v !== undefined) out[String(k)] = v;
  }
  return out;
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function nowIso() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeChatId(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  if (s.startsWith("-100") || s.startsWith("@")) return s;
  if (/^\d{8,}$/.test(s)) return `-100${s}`;
  if (s.includes("t.me/")) {
    const m = s.match(/t\.me\/c\/(\d+)/);
    if (m) return `-100${m[1]}`;
    const m2 = s.match(/t\.me\/([a-zA-Z0-9_]+)/);
    if (m2 && m2[1] !== "joinchat" && !m2[1].startsWith("+")) return `@${m2[1]}`;
  }
  return s;
}

export function normTitleKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
    .trim();
}

export function nextNumericId(mapObj) {
  const keys = Object.keys(mapObj || {}).map((k) => parseInt(k, 10)).filter((n) => !Number.isNaN(n) && n > 0);
  return keys.length ? Math.max(...keys) + 1 : 1;
}

export function fbUrl(env, path, params = {}) {
  const base = String(env.FIREBASE_DATABASE_URL || "https://vortex-b521e-default-rtdb.firebaseio.com").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "").replace(/\.json$/, "");
  const u = new URL(`${base}/${cleanPath}.json`);
  if (env.FIREBASE_AUTH) u.searchParams.set("auth", env.FIREBASE_AUTH);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export async function fbGet(env, path, params = {}) {
  const resp = await fetch(fbUrl(env, path, params), { cf: { cacheTtl: 0 } });
  if (!resp.ok) return null;
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export async function fbPut(env, path, data) {
  const resp = await fetch(fbUrl(env, path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.ok;
}

export async function fbPatch(env, path, data) {
  const resp = await fetch(fbUrl(env, path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.ok;
}

export async function fbDelete(env, path) {
  const resp = await fetch(fbUrl(env, path), { method: "DELETE" });
  return resp.ok;
}

export async function loadCoreData(env, force = false) {
  const now = Date.now();
  if (!force && EDGE_CACHE.ts && now - EDGE_CACHE.ts < 25000 && EDGE_CACHE.media && EDGE_CACHE.settings) {
    return EDGE_CACHE;
  }
  const [
    settings,
    media,
    media_files,
    users,
    admins,
    ad_tasks,
    custom_sections,
    media_requests,
    media_reports,
    comments,
    user_lists,
    pull_logs,
    share_logs,
  ] = await Promise.all([
    fbGet(env, "settings"),
    fbGet(env, "media"),
    fbGet(env, "media_files"),
    fbGet(env, "users"),
    fbGet(env, "admins"),
    fbGet(env, "ad_tasks"),
    fbGet(env, "custom_sections"),
    fbGet(env, "media_requests"),
    fbGet(env, "media_reports"),
    fbGet(env, "comments"),
    fbGet(env, "user_lists"),
    fbGet(env, "pull_logs"),
    fbGet(env, "share_logs"),
  ]);

  EDGE_CACHE.settings = asObj(settings);
  EDGE_CACHE.media = asObj(media);
  EDGE_CACHE.media_files = asObj(media_files);
  EDGE_CACHE.users = asObj(users);
  EDGE_CACHE.admins = asObj(admins);
  EDGE_CACHE.ad_tasks = asObj(ad_tasks);
  EDGE_CACHE.custom_sections = asObj(custom_sections);
  EDGE_CACHE.media_requests = asObj(media_requests);
  EDGE_CACHE.media_reports = asObj(media_reports);
  EDGE_CACHE.comments = asObj(comments);
  EDGE_CACHE.user_lists = asObj(user_lists);
  EDGE_CACHE.pull_logs = asObj(pull_logs);
  EDGE_CACHE.share_logs = asObj(share_logs);

  const mainUn = getSetting(EDGE_CACHE.settings, "bot_main_username", "");
  const senderUn = getSetting(EDGE_CACHE.settings, "bot_sender_username", "");
  const adminUn = getSetting(EDGE_CACHE.settings, "bot_admin_username", "");
  if (mainUn) EDGE_CACHE.botInfo.main_username = mainUn;
  if (senderUn) EDGE_CACHE.botInfo.sender_username = senderUn;
  if (adminUn) EDGE_CACHE.botInfo.admin_username = adminUn;

  EDGE_CACHE.ts = now;
  return EDGE_CACHE;
}

export function getSetting(settings, key, defVal = "") {
  if (!settings || settings[key] === undefined || settings[key] === null) return defVal;
  const v = settings[key];
  if (typeof v === "object" && v.value !== undefined) return String(v.value);
  return String(v);
}

export function getBoolSetting(settings, key, defVal = false) {
  const v = getSetting(settings, key, defVal ? "1" : "0").toLowerCase().trim();
  return !["0", "false", "no", "off", ""].includes(v);
}

export function getSourceChannels(settings) {
  try {
    const raw = getSetting(settings, "auto_source_channels", "[]");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getBrandConfig(settings) {
  return {
    app_name_ar: getSetting(settings, "app_name_ar", "فورتكس"),
    app_name_en: getSetting(settings, "app_name_en", "VORTEX"),
    app_tagline: getSetting(settings, "app_tagline", "عالم الأفلام والمسلسلات والأنمي"),
    app_logo_url: getSetting(settings, "app_logo_url", ""),
    app_primary_color: getSetting(settings, "app_primary_color", "#e11d48"),
    ui_show_tonight: getBoolSetting(settings, "ui_show_tonight", true),
    ui_show_collections: getBoolSetting(settings, "ui_show_collections", true),
    ui_show_smart_sections: getBoolSetting(settings, "ui_show_smart_sections", true),
    cover_enabled: getBoolSetting(settings, "cover_enabled", true),
    cover_file_id: getSetting(settings, "video_cover_file_id", ""),
  };
}

export function normalizeQuality(q) {
  const s = String(q || "720").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s === "4K" || s === "2160P" || s === "2160" || s === "UHD") return "2160";
  const m = s.match(/(144|240|360|480|540|720|1080|1440|2160)/);
  return m ? m[1] : "720";
}

export function qualityRank(q) {
  const n = parseInt(normalizeQuality(q), 10);
  return Number.isNaN(n) ? 720 : n;
}

export function qualityLabel(q, sizeMb) {
  const nq = normalizeQuality(q);
  const tag = nq === "2160" ? "4K UHD" : nq === "1080" ? "1080p FHD" : `${nq}p`;
  return sizeMb ? `${tag} (${sizeMb} MB)` : tag;
}

export function resolveSectionKey(item, allSections) {
  const manual = String(item.section_key || "").trim();
  if (manual && allSections.some((s) => s.section_key === manual)) return manual;
  const mtype = String(item.media_type || "movie");
  const cat = String(item.category_label || "");
  const country = String(item.country || "");
  if (mtype === "anime" || cat.includes("أنمي")) return "anime";
  for (const s of allSections) {
    if (s.section_key.startsWith("custom_") && s.auto_country && country.includes(s.auto_country)) {
      if (s.media_type_filter === "all" || s.media_type_filter === "auto" || s.media_type_filter === mtype) {
        return s.section_key;
      }
    }
  }
  if (country.includes("العراق") || cat.includes("عراقي")) return mtype === "tv" ? "iraqi_series" : "arabic_movies";
  if (country.includes("تركيا") || cat.includes("تركي")) return mtype === "tv" ? "turkish_series" : "foreign_movies";
  if (country.includes("الهند") || cat.includes("هندي")) return mtype === "movie" ? "indian_movies" : "asian_series";
  if (cat.includes("عربي")) return mtype === "tv" ? "arabic_series" : "arabic_movies";
  if (cat.includes("آسيوي")) return mtype === "tv" ? "asian_series" : "foreign_movies";
  return mtype === "tv" ? "foreign_series" : "foreign_movies";
}

export function getAllSectionsConfig(cache) {
  const customMap = asObj(cache.custom_sections);
  const merged = new Map();
  for (const d of DEFAULT_SMART_SECTIONS) {
    merged.set(d.section_key, { ...d });
  }
  for (const [k, v] of Object.entries(customMap)) {
    if (!v || typeof v !== "object") continue;
    const key = v.section_key || k;
    const base = merged.get(key) || {
      section_key: key,
      title: v.title || key,
      subtitle: v.subtitle || "",
      media_type_filter: v.media_type_filter || "all",
      auto_country: v.auto_country || "",
      auto_category: v.auto_category || "",
      accent_color: v.accent_color || "#e11d48",
      is_enabled: true,
    };
    merged.set(key, {
      ...base,
      ...v,
      section_key: key,
      is_enabled: v.is_enabled === undefined ? true : Boolean(Number(v.is_enabled) !== 0 && v.is_enabled !== false),
    });
  }
  return Array.from(merged.values());
}

export function buildMediaItems(cache, includeHidden = false, slim = false) {
  const mediaMap = asObj(cache.media);
  const filesMap = asObj(cache.media_files);
  const commentsMap = asObj(cache.comments);
  const allSections = getAllSectionsConfig(cache);
  const secTitleMap = Object.fromEntries(allSections.map((s) => [s.section_key, s.title]));

  const filesByMedia = {};
  for (const [fid, f] of Object.entries(filesMap)) {
    if (!f || typeof f !== "object") continue;
    const mid = Number(f.media_id || 0);
    if (!mid) continue;
    if (!filesByMedia[mid]) filesByMedia[mid] = [];
    const q = normalizeQuality(f.quality);
    const sz = Number(f.size_mb || 0);
    filesByMedia[mid].push({
      id: Number(f.id || fid),
      media_id: mid,
      quality: q,
      label: qualityLabel(q, sz),
      size_mb: sz,
      season: Number(f.season || 1),
      episode: Number(f.episode || 0),
      episode_title: String(f.episode_title || ""),
      duration_mins: Number(f.duration_mins || f.duration_min || 0),
      file_id: String(f.file_id || ""),
      storage_channel_id: String(f.storage_channel_id || ""),
      storage_msg_id: Number(f.storage_msg_id || 0),
      secret_msg_id: Number(f.secret_msg_id || 0),
    });
  }

  const commentsByMedia = {};
  if (!slim) {
    for (const [cid, c] of Object.entries(commentsMap)) {
      if (!c || typeof c !== "object") continue;
      const mid = Number(c.media_id || 0);
      if (!mid) continue;
      if (!commentsByMedia[mid]) commentsByMedia[mid] = [];
      commentsByMedia[mid].push({
        id: Number(c.id || cid),
        user_id: Number(c.user_id || 0),
        user_name: String(c.user_name || "مستخدم"),
        stars: Number(c.stars || 5),
        text: String(c.text || ""),
        created_at: String(c.created_at || ""),
      });
    }
  }

  const items = [];
  const counts = { movies: 0, series: 0, anime: 0, genres: {} };

  for (const [midStr, m] of Object.entries(mediaMap)) {
    if (!m || typeof m !== "object") continue;
    const id = Number(m.id || midStr);
    const isHidden = Boolean(Number(m.is_hidden || 0) === 1 || m.is_hidden === true);
    if (isHidden && !includeHidden) continue;

    let mtype = String(m.media_type || "movie").toLowerCase();
    if (!["movie", "tv", "anime"].includes(mtype)) mtype = "movie";
    const typeAr = mtype === "tv" ? "مسلسل" : mtype === "anime" ? "أنمي" : "فيلم";

    let genres = m.genres || [];
    if (typeof genres === "string") {
      try {
        genres = JSON.parse(genres);
      } catch {
        genres = genres.split(",").map((x) => x.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(genres)) genres = [];

    let cast = m.cast || [];
    if (typeof cast === "string") {
      try {
        cast = JSON.parse(cast);
      } catch {
        cast = [];
      }
    }
    if (!Array.isArray(cast)) cast = [];

    const mFiles = (filesByMedia[id] || []).slice().sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      if (a.episode !== b.episode) return a.episode - b.episode;
      return qualityRank(b.quality) - qualityRank(a.quality);
    });

    const item = {
      id,
      tmdb_id: Number(m.tmdb_id || 0),
      media_type: mtype,
      type_ar: typeAr,
      title: String(m.title || "بدون عنوان"),
      original_title: String(m.original_title || m.title || ""),
      year: String(m.year || ""),
      duration: String(m.duration || (mtype === "tv" ? "1 موسم" : "115 دقيقة")),
      country: String(m.country || "الولايات المتحدة الأمريكية"),
      category_label: String(m.category_label || typeAr),
      rating: Number(m.rating || 0),
      genres,
      overview: String(m.overview || "لا يوجد وصف متاح."),
      poster_url: String(m.poster_url || ""),
      backdrop_url: String(m.backdrop_url || m.poster_url || ""),
      trailer_url: String(m.trailer_url || ""),
      cast: slim ? cast.slice(0, 6) : cast,
      views_count: Number(m.views_count || 0),
      is_tonight: Boolean(Number(m.is_tonight || 0) === 1 || m.is_tonight === true),
      is_hidden: isHidden,
      collection_id: Number(m.collection_id || 0),
      collection_name: String(m.collection_name || ""),
      collection_poster: String(m.collection_poster || ""),
      collection_backdrop: String(m.collection_backdrop || ""),
      collection_force_active: Boolean(Number(m.collection_force_active || 0) === 1 || m.collection_force_active === true),
      channel_msg_id: Number(m.channel_msg_id || 0),
      created_at: String(m.created_at || ""),
      files: mFiles,
      comments: (commentsByMedia[id] || []).sort((a, b) => b.id - a.id),
    };

    item.section_key = resolveSectionKey({ ...item, section_key: m.section_key }, allSections);
    item.section_title = secTitleMap[item.section_key] || "تلقائي";

    items.push(item);
    if (!isHidden) {
      if (mtype === "movie") counts.movies++;
      else if (mtype === "tv") counts.series++;
      else if (mtype === "anime") counts.anime++;
      for (const g of genres) {
        counts.genres[g] = (counts.genres[g] || 0) + 1;
      }
    }
  }

  items.sort((a, b) => {
    if (a.is_tonight !== b.is_tonight) return a.is_tonight ? -1 : 1;
    return b.id - a.id;
  });

  // Build collections and attach collection_info to movies
  const colGroups = {};
  for (const it of items) {
    if (it.media_type !== "movie" || it.is_hidden) continue;
    const cKey = it.collection_id > 0
      ? `tmdb_${it.collection_id}`
      : it.collection_name
        ? `name_${normTitleKey(it.collection_name)}`
        : "";
    if (!cKey) continue;
    if (!colGroups[cKey]) {
      colGroups[cKey] = {
        collection_key: cKey,
        name: it.collection_name || `سلسلة ${it.title}`,
        poster_url: it.collection_poster || it.poster_url,
        backdrop_url: it.collection_backdrop || it.backdrop_url || it.poster_url,
        force_active: false,
        parts: [],
      };
    }
    if (it.collection_force_active) colGroups[cKey].force_active = true;
    colGroups[cKey].parts.push(it);
  }

  const allCollections = [];
  const activeCollections = [];
  for (const grp of Object.values(colGroups)) {
    grp.parts.sort((a, b) => (parseInt(a.year || "9999", 10) - parseInt(b.year || "9999", 10)) || (a.id - b.id));
    const years = grp.parts.map((p) => parseInt(p.year || "0", 10)).filter((y) => y > 1900);
    const avgRating = grp.parts.length
      ? Math.round((grp.parts.reduce((acc, p) => acc + (p.rating || 0), 0) / grp.parts.length) * 10) / 10
      : 0;
    const partsFormatted = grp.parts.map((p, idx) => ({
      id: p.id,
      part_number: idx + 1,
      title: p.title,
      year: p.year,
      rating: p.rating,
      poster_url: p.poster_url,
      overview: p.overview,
      qualities: Array.from(new Set((p.files || []).map((f) => f.quality))),
    }));
    const isActive = grp.parts.length >= 3 || (grp.force_active && grp.parts.length >= 2);
    const colObj = {
      collection_key: grp.collection_key,
      name: grp.name,
      parts_count: grp.parts.length,
      poster_url: grp.poster_url || (grp.parts[0] && grp.parts[0].poster_url) || "",
      backdrop_url: grp.backdrop_url || (grp.parts[0] && grp.parts[0].backdrop_url) || "",
      rating: avgRating,
      years_range: years.length >= 2 ? `${Math.min(...years)} - ${Math.max(...years)}` : (years[0] ? String(years[0]) : ""),
      is_active: isActive,
      parts: partsFormatted,
    };
    if (grp.parts.length >= 2) {
      allCollections.push(colObj);
      if (isActive) activeCollections.push(colObj);
      grp.parts.forEach((p, idx) => {
        p.collection_info = {
          collection_key: colObj.collection_key,
          name: colObj.name,
          parts_count: colObj.parts_count,
          part_number: idx + 1,
          parts: partsFormatted,
        };
      });
    }
  }

  return { items, counts, activeCollections, allCollections };
}

export function buildSmartSections(cache, items) {
  const allSecs = getAllSectionsConfig(cache);
  const visibleItems = (items || []).filter((x) => !x.is_hidden);
  const allFormatted = allSecs.map((sec) => {
    const secItems = visibleItems.filter((it) => it.section_key === sec.section_key);
    const posters = secItems.slice(0, 6).map((x) => x.poster_url).filter(Boolean);
    const backdrops = secItems.slice(0, 4).map((x) => x.backdrop_url || x.poster_url).filter(Boolean);
    return {
      ...sec,
      items_count: secItems.length,
      posters,
      backdrops,
      latest_title: secItems[0] ? secItems[0].title : "",
      has_new: secItems.some((x) => String(x.created_at || "").startsWith(todayPrefix())),
    };
  });
  const activeSmart = allFormatted.filter((s) => s.is_enabled && s.items_count > 0);
  return { smart_sections: activeSmart, all_sections: allFormatted };
}

export function getIncompleteSeries(items) {
  const out = [];
  for (const it of items || []) {
    if (it.media_type !== "tv" && it.media_type !== "anime") continue;
    const files = it.files || [];
    const bySeason = {};
    for (const f of files) {
      const s = Number(f.season || 1);
      const e = Number(f.episode || 0);
      if (e > 0) {
        if (!bySeason[s]) bySeason[s] = new Set();
        bySeason[s].add(e);
      }
    }
    const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
    if (!seasons.length) {
      out.push({
        id: it.id,
        title: it.title,
        original_title: it.original_title,
        year: it.year,
        type_ar: it.type_ar,
        is_hidden: it.is_hidden,
        uploaded_summary: "0 حلقات",
        missing_text: "لا توجد حلقات مرفوعة بعد",
      });
      continue;
    }
    const missingParts = [];
    const uploadedParts = [];
    let isIncomplete = false;
    for (const s of seasons) {
      const eps = Array.from(bySeason[s]).sort((a, b) => a - b);
      const maxE = eps[eps.length - 1];
      uploadedParts.push(`م${s}: ${eps.length} حلقة`);
      const gaps = [];
      for (let i = 1; i <= maxE; i++) {
        if (!bySeason[s].has(i)) gaps.push(i);
      }
      if (gaps.length) {
        isIncomplete = true;
        missingParts.push(`م${s} ناقص: ${gaps.slice(0, 8).join(", ")}${gaps.length > 8 ? "..." : ""}`);
      } else if (eps.length <= 2) {
        isIncomplete = true;
        missingParts.push(`م${s} يحتوي ${eps.length} حلقة فقط`);
      }
    }
    if (isIncomplete) {
      out.push({
        id: it.id,
        title: it.title,
        original_title: it.original_title,
        year: it.year,
        type_ar: it.type_ar,
        is_hidden: it.is_hidden,
        uploaded_summary: uploadedParts.join(" · "),
        missing_text: missingParts.join(" | "),
      });
    }
  }
  return out;
}

export function computeUsersMetrics(env, usersMap) {
  const hiddenSet = new Set(getHiddenAdminIds(env));
  const nowSec = Math.floor(Date.now() / 1000);
  const today = todayPrefix();
  let totalUsers = 0;
  let vipCount = 0;
  let newToday = 0;
  const lb = [];

  for (const [k, u] of Object.entries(usersMap || {})) {
    if (!u || typeof u !== "object") continue;
    const uid = parseInt(u.user_id || k, 10);
    if (!uid || hiddenSet.has(uid)) continue;
    totalUsers++;
    const vipUntil = Number(u.vip_until || 0);
    if (vipUntil > nowSec) vipCount++;
    if (String(u.joined_at || u.created_at || "").startsWith(today)) newToday++;
    const refs = Number(u.referrals_count || 0);
    if (refs > 0) {
      lb.push({
        user_id: uid,
        name: String(u.first_name || "مستخدم"),
        referrals: refs,
        channel_url: String(u.channel_url || ""),
        channel_title: String(u.channel_title || ""),
      });
    }
  }

  lb.sort((a, b) => b.referrals - a.referrals);
  const leaderboard = lb.slice(0, 10).map((x, idx) => ({ ...x, rank: idx + 1 }));
  return { totalUsers, vipCount, newToday, leaderboard };
}

export function computeUsersDashboard(env, cache) {
  const hiddenSet = new Set(getHiddenAdminIds(env));
  const usersMap = asObj(cache.users);
  const pullsMap = asObj(cache.pull_logs);
  const sharesMap = asObj(cache.share_logs);
  const today = todayPrefix();
  const nowSec = Math.floor(Date.now() / 1000);

  const pullsByUser = {};
  const todayPullsList = [];
  let totalPulls = 0;

  for (const [k, p] of Object.entries(pullsMap)) {
    if (!p || typeof p !== "object") continue;
    const uid = parseInt(p.user_id || 0, 10);
    if (!uid || hiddenSet.has(uid)) continue;
    totalPulls++;
    const entry = {
      id: Number(p.id || k) || 0,
      user_id: uid,
      user_name: String(p.user_name || (usersMap[String(uid)] && usersMap[String(uid)].first_name) || "مستخدم"),
      media_id: Number(p.media_id || 0),
      media_title: String(p.media_title || "عمل"),
      quality: normalizeQuality(p.quality || "720"),
      season: Number(p.season || 1),
      episode: Number(p.episode || 0),
      pull_mode: String(p.pull_mode || "sender_bot"),
      created_at: String(p.created_at || ""),
    };
    if (!pullsByUser[uid]) pullsByUser[uid] = [];
    pullsByUser[uid].push(entry);
    if (entry.created_at.startsWith(today)) todayPullsList.push(entry);
  }

  todayPullsList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const todaySharesList = [];
  let totalShares = 0;
  for (const s of Object.values(sharesMap)) {
    if (!s || typeof s !== "object") continue;
    const uid = parseInt(s.user_id || 0, 10);
    if (!uid || hiddenSet.has(uid)) continue;
    totalShares++;
    if (String(s.created_at || "").startsWith(today)) {
      todaySharesList.push({
        user_id: uid,
        user_name: String(s.user_name || "مستخدم"),
        media_title: String(s.media_title || "التطبيق"),
        created_at: String(s.created_at || ""),
      });
    }
  }

  const allUsersArr = [];
  const todayReferralsList = [];
  let totalReferrals = 0;
  let newToday = 0;

  for (const [k, u] of Object.entries(usersMap)) {
    if (!u || typeof u !== "object") continue;
    const uid = parseInt(u.user_id || k, 10);
    if (!uid || hiddenSet.has(uid)) continue;
    const joined = String(u.joined_at || u.created_at || "");
    if (joined.startsWith(today)) newToday++;
    const refs = Number(u.referrals_count || 0);
    totalReferrals += refs;
    const refBy = parseInt(u.referred_by || 0, 10);
    const refRec = refBy ? usersMap[String(refBy)] : null;
    if (refBy && joined.startsWith(today)) {
      todayReferralsList.push({
        referrer_id: refBy,
        referrer_name: String((refRec && refRec.first_name) || refBy),
        invited_id: uid,
        invited_name: String(u.first_name || uid),
      });
    }
    const uPulls = (pullsByUser[uid] || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    allUsersArr.push({
      user_id: uid,
      first_name: String(u.first_name || "مستخدم"),
      username: String(u.username || ""),
      points: Number(u.points || 0),
      referrals_count: refs,
      referred_by: refBy,
      referrer_name: String((refRec && refRec.first_name) || ""),
      is_vip: Number(u.vip_until || 0) > nowSec,
      joined_at: joined,
      pulls_count: uPulls.length,
      pulled_items: uPulls.slice(0, 15),
    });
  }

  const topPullers = allUsersArr
    .filter((u) => u.pulls_count > 0)
    .sort((a, b) => b.pulls_count - a.pulls_count)
    .slice(0, 25);

  const newUsers = allUsersArr
    .slice()
    .sort((a, b) => String(b.joined_at).localeCompare(String(a.joined_at)))
    .slice(0, 30);

  return {
    summary: {
      total_users: allUsersArr.length,
      new_users_today: newToday,
      total_pulls: totalPulls,
      pulls_today: todayPullsList.length,
      total_referrals: totalReferrals,
      referrals_today: todayReferralsList.length,
      total_shares: totalShares,
      shares_today: todaySharesList.length,
      notify_new_users: getBoolSetting(cache.settings, "notify_new_users", true),
    },
    top_pullers: topPullers,
    new_users: newUsers,
    today_pulls_list: todayPullsList.slice(0, 40),
    today_referrals_list: todayReferralsList.slice(0, 30),
    today_shares_list: todaySharesList.slice(0, 30),
  };
}

export function getVisibleAdminsList(env, cache) {
  const hiddenSet = new Set(getHiddenAdminIds(env));
  const ownerIds = getAdminIds(env);
  const usersMap = asObj(cache.users);
  const adminsMap = asObj(cache.admins);
  const out = [];
  const seen = new Set();

  for (const oid of ownerIds) {
    if (hiddenSet.has(oid) || seen.has(oid)) continue;
    seen.add(oid);
    const u = usersMap[String(oid)] || {};
    out.push({
      user_id: oid,
      first_name: String(u.first_name || "المالك الأساسي"),
      username: String(u.username || ""),
      role_title: "المالك الأساسي",
      is_owner: true,
      is_frozen: false,
      added_at: String(u.joined_at || "—"),
      actions_count: Number((adminsMap[String(oid)] && adminsMap[String(oid)].actions_count) || 0),
      permissions: Object.fromEntries(Object.keys(PERM_LABELS).map((k) => [k, 1])),
    });
  }

  for (const [k, a] of Object.entries(adminsMap)) {
    if (!a || typeof a !== "object") continue;
    const uid = parseInt(a.user_id || k, 10);
    if (!uid || hiddenSet.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    const u = usersMap[String(uid)] || {};
    const permsRaw = a.permissions || a;
    const permissions = {};
    for (const pk of Object.keys(PERM_LABELS)) {
      permissions[pk] = Number(permsRaw[pk] ?? 1) ? 1 : 0;
    }
    out.push({
      user_id: uid,
      first_name: String(a.first_name || u.first_name || `مشرف ${uid}`),
      username: String(a.username || u.username || ""),
      role_title: String(a.role_title || "مشرف"),
      is_owner: false,
      is_frozen: Boolean(Number(a.is_frozen || 0) === 1),
      added_at: String(a.added_at || "—"),
      actions_count: Number(a.actions_count || 0),
      permissions,
    });
  }
  return out;
}

export async function ensureUserRecord(env, cache, uid, firstName = "", username = "") {
  const id = parseInt(uid, 10);
  if (!id) return { user: null, isNew: false };
  const usersMap = asObj(cache.users);
  const existing = usersMap[String(id)];
  if (existing) {
    const patch = {};
    if (firstName && existing.first_name !== firstName) patch.first_name = firstName;
    if (username && existing.username !== username) patch.username = username;
    if (Object.keys(patch).length) {
      await fbPatch(env, `users/${id}`, patch);
      Object.assign(existing, patch);
    }
    return { user: existing, isNew: false };
  }
  const rec = {
    user_id: id,
    first_name: firstName || "مستخدم",
    username: username || "",
    points: 0,
    referrals_count: 0,
    vip_until: 0,
    theme: "vortex",
    joined_at: nowIso(),
  };
  await fbPut(env, `users/${id}`, rec);
  if (EDGE_CACHE.users) EDGE_CACHE.users[String(id)] = rec;
  return { user: rec, isNew: true };
}

export async function purgeGlobalDuplicates(env) {
  const cache = await loadCoreData(env, true);
  const mediaMap = asObj(cache.media);
  const filesMap = asObj(cache.media_files);

  const byKey = new Map();
  let mergedMedia = 0;
  let removedFiles = 0;

  const sortedIds = Object.keys(mediaMap).map((k) => parseInt(k, 10)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const redirectMap = {};

  for (const mid of sortedIds) {
    const m = mediaMap[String(mid)];
    if (!m) continue;
    const mtype = String(m.media_type || "movie").toLowerCase();
    const tmdb = Number(m.tmdb_id || 0);
    const key = tmdb > 0
      ? `tmdb:${mtype}:${tmdb}`
      : `title:${mtype}:${normTitleKey(m.original_title || m.title)}:${String(m.year || "").slice(0, 4)}`;
    if (!byKey.has(key)) {
      byKey.set(key, mid);
    } else {
      const primaryId = byKey.get(key);
      redirectMap[mid] = primaryId;
      mergedMedia++;
    }
  }

  const seenFileSig = new Set();
  for (const [fid, f] of Object.entries(filesMap)) {
    if (!f || typeof f !== "object") continue;
    let mid = Number(f.media_id || 0);
    if (redirectMap[mid]) {
      mid = redirectMap[mid];
      await fbPatch(env, `media_files/${fid}`, { media_id: mid });
    }
    const sig = `${mid}:${Number(f.season || 1)}:${Number(f.episode || 0)}:${normalizeQuality(f.quality)}`;
    if (seenFileSig.has(sig)) {
      await fbDelete(env, `media_files/${fid}`);
      removedFiles++;
    } else {
      seenFileSig.add(sig);
    }
  }

  for (const dupMid of Object.keys(redirectMap)) {
    await fbDelete(env, `media/${dupMid}`);
  }

  invalidateEdgeCache();
  return { mergedMedia, removedFiles };
}

export async function checkAntiSabotageDelete(env, uid, adminsMap) {
  if (isOwnerId(env, uid)) return { allowed: true, frozenNow: false };
  const now = Date.now();
  const rec = (await fbGet(env, `meta/delete_guard/${uid}`)) || { timestamps: [] };
  const recent = (Array.isArray(rec.timestamps) ? rec.timestamps : []).filter((ts) => now - ts < 10 * 60 * 1000);
  recent.push(now);
  await fbPut(env, `meta/delete_guard/${uid}`, { timestamps: recent });
  if (recent.length > 3) {
    await fbPatch(env, `admins/${uid}`, { is_frozen: 1 });
    invalidateEdgeCache();
    return { allowed: false, frozenNow: true };
  }
  return { allowed: true, frozenNow: false };
}

export async function scheduleSixHourDeletion(env, { chatId, messageId, mediaId, mediaTitle }) {
  if (!chatId || !messageId) return;
  const key = `${chatId}_${messageId}`;
  const deleteAt = Date.now() + 6 * 60 * 60 * 1000;
  await fbPut(env, `scheduled_deletions/${key}`, {
    chat_id: Number(chatId),
    message_id: Number(messageId),
    media_id: Number(mediaId || 0),
    media_title: String(mediaTitle || ""),
    delete_at: deleteAt,
    created_at: nowIso(),
  });
}

export async function verifyTelegramInitData(initData, botTokens) {
  if (!initData || initData.length > 8192) return 0;
  try {
    const params = new URLSearchParams(initData);
    const recvHash = params.get("hash") || "";
    if (!recvHash) return 0;
    params.delete("hash");
    const pairs = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const checkString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
    const enc = new TextEncoder();

    for (const tok of botTokens) {
      if (!tok) continue;
      const webAppKey = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const secretBuf = await crypto.subtle.sign("HMAC", webAppKey, enc.encode(tok));
      const hmacKey = await crypto.subtle.importKey("raw", secretBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuf = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(checkString));
      const hex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex === recvHash) {
        const userJson = params.get("user") || "{}";
        const u = JSON.parse(userJson);
        return parseInt(u.id || 0, 10) || 0;
      }
    }
  } catch {
    return 0;
  }
  return 0;
}
