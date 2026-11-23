
 * ============================================================================
 * VORTEX EDGE V1.0 — 100% Zero-VPS Cloudflare Worker (3 Bots + Mini App + API)
 * Connected natively to Firebase Realtime Database (vortex-b521e)
 * - No Python, No VPS, No GitHub Actions, No RAM/CPU limits, 24/7 Permanent HTTPS
 * ============================================================================
 */

const SECRET_ARCHIVE_CHANNEL_ID = "-1004386494829";
const DEFAULT_TMDB_KEY = "3fd2be6f0c70a2a598f084ddfb75487c";
const APP_VERSION = "1.0.0-Edge";

// Isolate-level fast cache (30s TTL) to keep /api/bootstrap under 15ms
const EDGE_CACHE = {
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
  botInfo: {
    main_username: "Vortex1_app",
    sender_username: "Vortexeserver_Bot",
    admin_username: "VortexeAdmin_Bot",
    main_id: 9073252184,
    sender_id: 9245596135,
    admin_id: 9124179798,
  },
};

function invalidateEdgeCache() {
  EDGE_CACHE.ts = 0;
}

// ============================================================================
// 1. Environment & Admin Helpers
// ============================================================================
function getAdminIds(env) {
  const raw = String(env.ADMIN_IDS || "8093483591,8736734440");
  return raw.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
}

function getHiddenAdminIds(env) {
  const raw = String(env.HIDDEN_ADMIN_IDS || "8407394858");
  return raw.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n) && n > 0);
}

function isOwnerId(env, uid) {
  const id = parseInt(uid, 10);
  if (!id) return false;
  return getAdminIds(env).includes(id) || getHiddenAdminIds(env).includes(id);
}

function isUserAdmin(env, uid, adminsMap) {
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

function asObj(val) {
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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nowIso() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ============================================================================
// 2. Firebase Realtime Database REST Client
// ============================================================================
function fbUrl(env, path, params = {}) {
  const base = String(env.FIREBASE_DATABASE_URL || "https://vortex-b521e-default-rtdb.firebaseio.com").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");
  const u = new URL(cleanPath ? `${base}/${cleanPath}.json` : `${base}/.json`);
  const auth = String(env.FIREBASE_AUTH || "").trim();
  if (auth) u.searchParams.set("auth", auth);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fbGet(env, path, params = {}) {
  const res = await fetch(fbUrl(env, path, params), { cf: { cacheTtl: 0 } });
  if (!res.ok) return null;
  return await res.json();
}

async function fbPut(env, path, data) {
  const res = await fetch(fbUrl(env, path), {
    method: data === null ? "DELETE" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: data === null ? undefined : JSON.stringify(data),
  });
  return res.ok;
}

async function fbPatch(env, path, data) {
  const res = await fetch(fbUrl(env, path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}

async function loadCoreData(env, force = false) {
  const now = Date.now();
  if (!force && EDGE_CACHE.settings && now - EDGE_CACHE.ts < 30000) {
    return EDGE_CACHE;
  }
  const [settings, media, media_files, admins, ad_tasks, custom_sections, comments] = await Promise.all([
    fbGet(env, "settings"),
    fbGet(env, "media"),
    fbGet(env, "media_files"),
    fbGet(env, "admins"),
    fbGet(env, "ad_tasks"),
    fbGet(env, "custom_sections"),
    fbGet(env, "comments"),
  ]);
  EDGE_CACHE.settings = asObj(settings);
  EDGE_CACHE.media = asObj(media);
  EDGE_CACHE.media_files = asObj(media_files);
  EDGE_CACHE.admins = asObj(admins);
  EDGE_CACHE.ad_tasks = asObj(ad_tasks);
  EDGE_CACHE.custom_sections = asObj(custom_sections);
  EDGE_CACHE.comments = asObj(comments);
  EDGE_CACHE.ts = now;
  return EDGE_CACHE;
}

function getSetting(settings, key, defVal = "") {
  const v = settings && settings[key];
  return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : defVal;
}

// ============================================================================
// 3. Telegram Bot API Helper (Zero Dependencies)
// ============================================================================
async function tgCall(token, method, payload = {}) {
  if (!token) return { ok: false, description: "Missing bot token" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

function ikb(text, opts = {}) {
  const btn = { text };
  if (opts.callback_data) btn.callback_data = opts.callback_data;
  if (opts.url) btn.url = opts.url;
  if (opts.web_app) btn.web_app = opts.web_app;
  if (opts.style) btn.style = opts.style;
  return btn;
}

async function checkUserSubscription(env, settings, uid, adminsMap, allowAnon = false) {
  const id = parseInt(uid, 10) || 0;
  const forceCh = getSetting(settings, "force_sub_channel_id", "");
  let forceLink = getSetting(settings, "force_sub_channel_link", "");
  const forceTitle = getSetting(settings, "force_sub_channel_title", "قناة فورتكس الرسمية");

  if (id > 0 && isUserAdmin(env, id, adminsMap)) {
    return { is_subscribed: true, channel_link: forceLink, channel_title: forceTitle };
  }
  if (!forceCh) {
    return { is_subscribed: true, channel_link: "", channel_title: "" };
  }
  if (forceCh.startsWith("@") && !forceLink) {
    forceLink = `https://t.me/${forceCh.slice(1)}`;
  }
  if (id <= 0) {
    return { is_subscribed: allowAnon, channel_link: forceLink, channel_title: forceTitle };
  }

  for (const tok of [env.MAIN_BOT_TOKEN, env.ADMIN_BOT_TOKEN]) {
    if (!tok) continue;
    const res = await tgCall(tok, "getChatMember", { chat_id: forceCh, user_id: id });
    if (res && res.ok && res.result) {
      const st = String(res.result.status || "").toLowerCase();
      const ok = ["member", "administrator", "creator"].includes(st) || (st === "restricted" && res.result.is_member);
      return { is_subscribed: ok, channel_link: forceLink, channel_title: forceTitle };
    }
    const desc = String((res && res.description) || "").toLowerCase();
    if (desc.includes("user not found") || desc.includes("user_not_participant")) {
      return { is_subscribed: false, channel_link: forceLink, channel_title: forceTitle };
    }
  }
  return { is_subscribed: true, channel_link: forceLink, channel_title: forceTitle };
}

// ============================================================================
// 4. Media Formatting, Sections, Collections & Incomplete Series
// ============================================================================
function normalizeQuality(q) {
  const s = String(q || "720").toUpperCase().replace("P", "").trim();
  if (s === "4K" || s === "2160" || s === "UHD") return "2160";
  const m = s.match(/\d+/);
  return m ? m[0] : "720";
}

function qualityLabel(q, sizeMb) {
  const mb = Number(sizeMb || 0);
  const gb = mb >= 100 ? Math.round((mb / 1024) * 10) / 10 : Math.round((mb / 1024) * 100) / 100;
  const sz = mb < 900 ? `${Math.round(mb)} ميجا` : `${gb} جيجا`;
  if (q === "2160") return `فائقة 4K UHD · ${sz}`;
  if (q === "1080") return `عالية 1080p FHD · ${sz}`;
  if (q === "720") return `متوسطة 720p HD · ${sz}`;
  if (q === "480") return `خفيفة 480p SD · ${sz}`;
  return `دقة ${q}p · ${sz}`;
}

function buildMediaItems(cache, includeHidden = false, slim = true) {
  const filesByMedia = {};
  for (const [fid, f] of Object.entries(cache.media_files || {})) {
    if (!f || typeof f !== "object") continue;
    const mid = Number(f.media_id || 0);
    if (!mid) continue;
    const q = normalizeQuality(f.quality);
    const sizeMb = Number(f.file_size_mb || 0);
    const epNum = Number(f.episode || 0);
    const sNum = Number(f.season || 1) || 1;
    const itemFile = {
      id: Number(fid),
      quality: q,
      season: sNum,
      episode: epNum,
      episode_title: String(f.episode_title || (epNum > 0 ? `الحلقة ${epNum}` : "")),
      duration_mins: f.duration_sec ? Math.max(1, Math.round(Number(f.duration_sec) / 60)) : 0,
      size_mb: Math.round(sizeMb * 10) / 10,
      size_gb: Math.round((sizeMb / 1024) * 100) / 100,
      label: qualityLabel(q, sizeMb),
    };
    if (!slim) {
      itemFile.storage_chat_id = String(f.storage_chat_id || "");
      itemFile.storage_message_id = Number(f.storage_message_id || 0);
      itemFile.video_file_id = String(f.video_file_id || "");
    }
    if (!filesByMedia[mid]) filesByMedia[mid] = [];
    filesByMedia[mid].push(itemFile);
  }
  for (const arr of Object.values(filesByMedia)) {
    arr.sort((a, b) => a.season - b.season || a.episode - b.episode || Number(b.quality) - Number(a.quality));
  }

  const commentsByMedia = {};
  for (const [cid, c] of Object.entries(cache.comments || {})) {
    if (!c || typeof c !== "object") continue;
    const mid = Number(c.media_id || 0);
    if (!commentsByMedia[mid]) commentsByMedia[mid] = [];
    if (commentsByMedia[mid].length < 20) {
      commentsByMedia[mid].push({
        id: Number(cid),
        user_name: c.user_name || "مستخدم",
        stars: Number(c.stars || 5),
        text: c.comment_text || "",
        date: String(c.created_at || "").slice(0, 10),
      });
    }
  }

  const items = [];
  for (const [midStr, m] of Object.entries(cache.media || {})) {
    if (!m || typeof m !== "object" || !m.title) continue;
    const isHidden = Boolean(Number(m.is_hidden || 0));
    if (!includeHidden && isHidden) continue;
    const mid = Number(midStr);
    const mtype = String(m.media_type || "movie").toLowerCase();
    let genres = Array.isArray(m.genres) ? m.genres : [];
    if (!genres.length && typeof m.genres === "string" && m.genres.startsWith("[")) {
      try { genres = JSON.parse(m.genres); } catch (_) { genres = []; }
    }
    let cast = [];
    if (typeof m.cast_json === "string" && m.cast_json.startsWith("[")) {
      try { cast = JSON.parse(m.cast_json); } catch (_) { cast = []; }
    } else if (Array.isArray(m.cast)) {
      cast = m.cast;
    }

    items.push({
      id: mid,
      tmdb_id: Number(m.tmdb_id || 0),
      media_type: mtype,
      type_ar: mtype === "anime" ? "أنمي" : mtype === "tv" ? "مسلسل" : "فيلم",
      title: String(m.title),
      original_title: String(m.original_title || m.title),
      year: String(m.year || ""),
      duration: String(m.duration || ""),
      country: String(m.country || "الولايات المتحدة الأمريكية"),
      category_label: String(m.category_label || (mtype === "movie" ? "فيلم أجنبي" : "مسلسل أجنبي")),
      views_count: Number(m.views_count || 0),
      rating: Math.round(Number(m.rating || 0) * 10) / 10,
      genres,
      overview: String(m.overview || ""),
      poster_url: String(m.poster_url || ""),
      backdrop_url: String(m.backdrop_url || m.poster_url || ""),
      is_tonight: Boolean(m.is_tonight),
      collection_id: Number(m.collection_id || 0),
      collection_name: String(m.collection_name || ""),
      is_hidden: isHidden,
      section_key: String(m.section_key || (mtype === "anime" ? "anime_all" : mtype === "tv" ? "foreign_series" : "foreign_movies")),
      cast,
      trailer_url: String(m.trailer_url || ""),
      files: filesByMedia[mid] || [],
      comments: commentsByMedia[mid] || [],
    });
  }

  items.sort((a, b) => b.id - a.id);

  // Compute counts
  const counts = { movies: 0, series: 0, anime: 0, genres: {} };
  for (const it of items) {
    if (it.media_type === "movie") counts.movies++;
    else if (it.media_type === "tv") counts.series++;
    else if (it.media_type === "anime") counts.anime++;
    for (const g of it.genres) {
      counts.genres[g] = (counts.genres[g] || 0) + 1;
    }
  }

  // Group collections
  const colGroups = {};
  for (const it of items) {
    if (it.media_type !== "movie") continue;
    const gkey = it.collection_id > 0 ? `cid_${it.collection_id}` : it.collection_name ? `cname_${it.collection_name.toLowerCase()}` : "";
    if (!gkey) continue;
    if (!colGroups[gkey]) colGroups[gkey] = [];
    colGroups[gkey].push(it);
  }
  const collections = [];
  for (const [gkey, parts] of Object.entries(colGroups)) {
    if (parts.length < 2 || parts.length > 15) continue;
    parts.sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999) || a.id - b.id);
    const partsSummary = parts.map((p, idx) => ({
      id: p.id,
      part_number: idx + 1,
      title: p.title,
      original_title: p.original_title,
      year: p.year,
      rating: p.rating,
      poster_url: p.poster_url,
      qualities: [...new Set((p.files || []).map((f) => f.quality))],
    }));
    const colObj = {
      collection_key: gkey,
      name: parts[0].collection_name || `سلسلة ${parts[0].title}`,
      poster_url: parts[parts.length - 1].poster_url || parts[0].poster_url,
      backdrop_url: parts[parts.length - 1].backdrop_url || parts[0].poster_url,
      parts_count: parts.length,
      is_active: parts.length >= 3,
      rating: Math.round((parts.reduce((s, x) => s + x.rating, 0) / parts.length) * 10) / 10,
      years_range: parts.length > 1 ? `${parts[0].year} – ${parts[parts.length - 1].year}` : parts[0].year,
      parts: partsSummary,
    };
    collections.push(colObj);
    parts.forEach((p, idx) => {
      p.collection_info = {
        collection_key: gkey,
        name: colObj.name,
        part_number: idx + 1,
        parts_count: parts.length,
        parts: partsSummary,
      };
    });
  }

  return { items, counts, collections: collections.filter((c) => c.is_active) };
}

function buildSmartSections(cache, items) {
  const customDefs = Object.values(cache.custom_sections || {});
  const defs = customDefs.length
    ? customDefs
    : [
        { section_key: "foreign_movies", title: "أفلام أجنبية", subtitle: "أحدث الأفلام العالمية", media_type_filter: "movie", accent_color: "#e11d48", sort_order: 10, is_enabled: 1 },
        { section_key: "foreign_series", title: "مسلسلات أجنبية", subtitle: "أقوى المسلسلات المترجمة", media_type_filter: "tv", accent_color: "#f59e0b", sort_order: 20, is_enabled: 1 },
        { section_key: "anime_all", title: "عالم الأنمي", subtitle: "أفلام ومسلسلات الأنمي", media_type_filter: "anime", accent_color: "#06b6d4", sort_order: 30, is_enabled: 1 },
      ];
  const out = [];
  for (const d of defs) {
    const skey = String(d.section_key || "");
    const secItems = items.filter((it) => !it.is_hidden && it.section_key === skey);
    if (!secItems.length) continue;
    out.push({
      section_key: skey,
      title: d.title,
      subtitle: d.subtitle || "",
      media_type_filter: d.media_type_filter || "all",
      accent_color: d.accent_color || "#e11d48",
      sort_order: Number(d.sort_order || 50),
      is_enabled: Number(d.is_enabled ?? 1) === 1,
      items_count: secItems.length,
      has_new: true,
      latest_title: secItems[0].title,
      latest_year: secItems[0].year,
      posters: secItems.map((x) => x.poster_url).filter(Boolean).slice(0, 8),
      backdrops: secItems.map((x) => x.backdrop_url || x.poster_url).filter(Boolean).slice(0, 8),
      item_ids: secItems.map((x) => x.id),
    });
  }
  out.sort((a, b) => a.sort_order - b.sort_order);
  return out;
}

function getBrandConfig(settings) {
  return {
    app_name_ar: getSetting(settings, "app_name_ar", "فورتكس"),
    app_name_en: getSetting(settings, "app_name_en", "VORTEX"),
    app_tagline: getSetting(settings, "app_tagline", "عالم الأفلام والمسلسلات والأنمي"),
    app_logo_url: getSetting(settings, "app_logo_url", ""),
    app_primary_color: getSetting(settings, "app_primary_color", "#e11d48"),
    app_accent_color: getSetting(settings, "app_accent_color", "#f43f5e"),
    default_theme: getSetting(settings, "default_theme", "vortex"),
    ui_show_tonight: getSetting(settings, "ui_show_tonight", "1") === "1",
    ui_show_collections: getSetting(settings, "ui_show_collections", "1") === "1",
    ui_show_smart_sections: getSetting(settings, "ui_show_smart_sections", "1") === "1",
    cover_enabled: getSetting(settings, "cover_enabled", "1") === "1",
  };
}

// ============================================================================
// 5. TMDb Helper (For Admin Bot Quick Video Ingestion)
// ============================================================================
async function searchTmdbSingle(env, settings, query, mediaType = "movie") {
  const apiKey = getSetting(settings, "tmdb_api_key", "") || String(env.FALLBACK_TMDB_KEYS || DEFAULT_TMDB_KEY).split(",")[0].trim();
  if (!apiKey || !query) return null;
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const u = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(apiKey)}&language=ar-SA&query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(u);
    if (!res.ok) return null;
    const data = await res.json();
    const first = (data.results || [])[0];
    if (!first) return null;
    const detRes = await fetch(`https://api.themoviedb.org/3/${endpoint}/${first.id}?api_key=${encodeURIComponent(apiKey)}&language=ar-SA&append_to_response=credits,videos`);
    const det = detRes.ok ? await detRes.json() : first;
    const cast = ((det.credits && det.credits.cast) || []).slice(0, 12).map((c) => ({
      name: c.name || "",
      character: c.character || "",
      profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : "",
    }));
    const trailer = ((det.videos && det.videos.results) || []).find((v) => v.site === "YouTube" && v.type === "Trailer");
    return {
      tmdb_id: det.id,
      media_type: mediaType,
      title: det.title || det.name || query,
      original_title: det.original_title || det.original_name || query,
      year: String(det.release_date || det.first_air_date || "").slice(0, 4),
      rating: Math.round(Number(det.vote_average || 0) * 10) / 10,
      overview: det.overview || "عمل مترجم بجودة عالية على منصة فورتكس.",
      genres: (det.genres || []).map((g) => g.name),
      poster_url: det.poster_path ? `https://image.tmdb.org/t/p/w500${det.poster_path}` : "",
      backdrop_url: det.backdrop_path ? `https://image.tmdb.org/t/p/w780${det.backdrop_path}` : "",
      cast_json: JSON.stringify(cast),
      trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : "",
    };
  } catch (_) {
    return null;
  }
}

// ============================================================================
// 6. Telegram Bot Webhook Handlers (Main + Sender + Admin)
// ============================================================================
async function handleMainBotWebhook(env, update, originUrl) {
  const cache = await loadCoreData(env);
  const settings = cache.settings;
  const brand = getBrandConfig(settings);
  const webappUrl = getSetting(settings, "webapp_url", originUrl) || originUrl;

  if (update.pre_checkout_query) {
    await tgCall(env.MAIN_BOT_TOKEN, "answerPreCheckoutQuery", {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true,
    });
    return;
  }

  const msg = update.message;
  const cb = update.callback_query;

  if (msg && msg.successful_payment) {
    const uid = msg.from.id;
    const untilTs = Math.floor(Date.now() / 1000) + 30 * 86400;
    await fbPatch(env, `users/${uid}`, { vip_until: untilTs });
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: "✦ <b>ألف مبروك! تفعل عندك اشتراك فورتكس PRO لمدة 30 يوم!</b>",
      parse_mode: "HTML",
    });
    return;
  }

  if (msg && msg.text) {
    const uid = msg.from.id;
    const text = msg.text.trim();
    const isAdm = isUserAdmin(env, uid, cache.admins);

    // Register user lightly in Firebase
    await fbPatch(env, `users/${uid}`, {
      first_name: msg.from.first_name || "مستخدم",
      username: msg.from.username || "",
    });

    if (text.startsWith("/start")) {
      const args = text.split(/\s+/)[1] || "";
      const sub = await checkUserSubscription(env, settings, uid, cache.admins, false);
      if (!sub.is_subscribed) {
        await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
          chat_id: msg.chat.id,
          text: "<b>نورت بوت فورتكس ✦</b>\n\nلازم قبل ما تشغل البوت تشترك بقناتنا الرسمية أولاً وبعدها تدوس <b>«✓ اشتركت، تحقق هسة»</b> ▾",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [ikb("+ انضم لقناة فورتكس أولاً", { url: sub.channel_link || "https://t.me/Vortexeo", style: "primary" })],
              [ikb("✓ اشتركت، تحقق هسة", { callback_data: `check_sub_main:${args}`, style: "success" })],
            ],
          },
        });
        return;
      }

      if (args.startsWith("watch_")) {
        const mid = parseInt(args.split("_")[1] || "0", 10);
        const mediaObj = cache.media[String(mid)];
        if (mediaObj) {
          const files = Object.entries(cache.media_files || {})
            .filter(([, f]) => f && Number(f.media_id) === mid)
            .map(([fid, f]) => ({ id: Number(fid), ...f }))
            .slice(0, 8);
          const kbRows = [];
          for (let i = 0; i < files.length; i += 2) {
            const row = [];
            for (const f of files.slice(i, i + 2)) {
              const q = normalizeQuality(f.quality);
              const lbl = f.episode ? `ح${f.episode} · ${q}p` : `▸ ${q}p`;
              row.push(ikb(lbl, { url: `https://t.me/${EDGE_CACHE.botInfo.sender_username}?start=file_${f.id}`, style: "primary" }));
            }
            kbRows.push(row);
          }
          kbRows.push([ikb(`◈ فتح ${String(mediaObj.title).slice(0, 22)} بالتطبيق`, { web_app: { url: `${webappUrl}?media_id=${mid}&uid=${uid}` }, style: "danger" })]);
          const cap = `◈ <b>${escapeHtml(mediaObj.title)} (${escapeHtml(mediaObj.year || "")})</b>\n★ التقييم: <b>${mediaObj.rating || 0}/10</b>\n\n✦ اختر الجودة لاستلام الفيديو فوراً أو افتحه بالتطبيق ▾`;
          if (mediaObj.poster_url && String(mediaObj.poster_url).startsWith("http")) {
            await tgCall(env.MAIN_BOT_TOKEN, "sendPhoto", {
              chat_id: msg.chat.id,
              photo: mediaObj.poster_url,
              caption: cap,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: kbRows },
            });
          } else {
            await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
              chat_id: msg.chat.id,
              text: cap,
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: kbRows },
            });
          }
          return;
        }
      }

      const chLink = getSetting(settings, "force_sub_channel_link", "https://t.me/Vortexeo");
      const supUser = getSetting(settings, "support_username", "Vortexeo").replace(/^@/, "");
      const kbRows = [
        [ikb(`◈ فـتـح تـطـبـيـق ${brand.app_name_ar} (${brand.app_name_en})`, { web_app: { url: `${webappUrl}?uid=${uid}` }, style: "danger" })],
        [
          ikb("◈ طلب فيلم / مسلسل / أنمي", { web_app: { url: `${webappUrl}?open_requests=1&uid=${uid}` }, style: "primary" }),
          ikb("◈ قناة فورتكس العامة", { url: chLink, style: "success" }),
        ],
        [ikb("◈ الدعم الفني", { url: `https://t.me/${supUser}`, style: "success" })],
      ];
      if (isAdm) {
        kbRows.push([ikb(`◈ لوحة إدارة ${brand.app_name_ar} بالميني آب`, { web_app: { url: `${webappUrl}?open_admin=1&uid=${uid}` }, style: "danger" })]);
      }

      await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: `◈ <b>أهلاً بك في عالم ${escapeHtml(brand.app_name_ar)} (${escapeHtml(brand.app_name_en)}) ✦</b>\n\n◈ <b>الأقسام المتوفرة:</b> أفلام | مسلسلات | أنمي\n✦ تصفح المكتبة الكاملة بواجهة سينمائية فائقة السرعة واختر العمل والدقة اللي تناسبك!\n\n▾ <b>اضغط على الزر الأحمر بالأسفل لفتح التطبيق:</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: kbRows },
      });
    }
  }

  if (cb && cb.data && cb.data.startsWith("check_sub_main:")) {
    const uid = cb.from.id;
    const sub = await checkUserSubscription(env, settings, uid, cache.admins, false);
    if (!sub.is_subscribed) {
      await tgCall(env.MAIN_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "بعدك ما مشترك بالقناة! انضم أولاً ثم اضغط تحقق.",
        show_alert: true,
      });
      return;
    }
    await tgCall(env.MAIN_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id, text: "تم التحقق ✓" });
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: cb.message.chat.id,
      text: "✓ <b>تم التحقق من اشتراكك! اضغط بالأسفل لفتح تطبيق فورتكس ▾</b>",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[ikb(`◈ فتح تطبيق ${brand.app_name_ar}`, { web_app: { url: `${webappUrl}?uid=${uid}` }, style: "danger" })]],
      },
    });
  }
}

async function deliverFileViaSender(env, cache, chatId, uid, fileId, originUrl) {
  const f = (cache.media_files || {})[String(fileId)];
  const webappUrl = getSetting(cache.settings, "webapp_url", originUrl) || originUrl;
  if (!f) {
    await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "◈ عذراً، هذا الملف غير متوفر حالياً.",
    });
    return;
  }
  const m = (cache.media || {})[String(f.media_id)] || {};
  const q = normalizeQuality(f.quality);
  const epText = Number(f.episode || 0) > 0 ? ` - الموسم ${f.season || 1} الحلقة ${f.episode}` : "";
  const caption = `◈ <b>${escapeHtml(m.title || "عمل فورتكس")} (${escapeHtml(m.year || "")})${epText} — الدقة ${q}p</b>\n\n✦ <b>منصة فورتكس | VORTEX</b>`;
  const replyMarkup = {
    inline_keyboard: [[ikb("◈ فتح صفحة العمل في فورتكس ▸", { web_app: { url: `${webappUrl}?media_id=${f.media_id}&uid=${uid}` }, style: "danger" })]],
  };

  let sent = await tgCall(env.SENDER_BOT_TOKEN, "copyMessage", {
    chat_id: chatId,
    from_chat_id: f.storage_chat_id,
    message_id: Number(f.storage_message_id || 0),
    caption,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });

  if (!sent.ok && f.storage_chat_id && f.storage_message_id) {
    // Fallback relay via Admin Bot -> Secret Archive -> Sender Bot
    const relayed = await tgCall(env.ADMIN_BOT_TOKEN, "copyMessage", {
      chat_id: SECRET_ARCHIVE_CHANNEL_ID,
      from_chat_id: f.storage_chat_id,
      message_id: Number(f.storage_message_id),
    });
    if (relayed.ok && relayed.result && relayed.result.message_id) {
      sent = await tgCall(env.SENDER_BOT_TOKEN, "copyMessage", {
        chat_id: chatId,
        from_chat_id: SECRET_ARCHIVE_CHANNEL_ID,
        message_id: relayed.result.message_id,
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
    }
  }

  if (!sent.ok) {
    await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "◈ تعذر إرسال الملف حالياً. تأكد من رفع بوت الإرسال مشرفاً في قناة الخزن.",
    });
  }
}

async function handleSenderBotWebhook(env, update, originUrl) {
  const cache = await loadCoreData(env);
  const msg = update.message;
  const cb = update.callback_query;

  if (msg && msg.text && msg.text.startsWith("/start")) {
    const uid = msg.from.id;
    const args = msg.text.split(/\s+/)[1] || "";
    const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, false);
    if (!sub.is_subscribed) {
      await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: "◈ <b>بوابة استلام الفيديو | فورتكس ✦</b>\n\nاشترك بالقناة الرسمية أولاً ثم اضغط زر التحقق لاستلام الفيديو فوراً ▾",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [ikb("+ انضم لقناة فورتكس", { url: sub.channel_link || "https://t.me/Vortexeo", style: "primary" })],
            [ikb("✓ اشتركت — أرسل الفيديو الآن", { callback_data: `check_sub_sender:${args}`, style: "success" })],
          ],
        },
      });
      return;
    }
    if (args.startsWith("file_")) {
      const fid = parseInt(args.split("_")[1] || "0", 10);
      await deliverFileViaSender(env, cache, msg.chat.id, uid, fid, originUrl);
    } else {
      await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: "◈ أهلاً بك في بوت إرسال فورتكس! اختر الفيلم أو المسلسل من البوت الرئيسي @Vortex1_app لاستلامه هنا فوراً.",
      });
    }
  }

  if (cb && cb.data && cb.data.startsWith("check_sub_sender:")) {
    const uid = cb.from.id;
    const args = cb.data.split(":")[1] || "";
    const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, false);
    if (!sub.is_subscribed) {
      await tgCall(env.SENDER_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "بعدك ما مشترك بالقناة! انضم أولاً.",
        show_alert: true,
      });
      return;
    }
    await tgCall(env.SENDER_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id, text: "جاري إرسال الفيديو..." });
    if (args.startsWith("file_")) {
      const fid = parseInt(args.split("_")[1] || "0", 10);
      await deliverFileViaSender(env, cache, cb.message.chat.id, uid, fid, originUrl);
    }
  }
}

async function handleAdminBotWebhook(env, update, originUrl) {
  const cache = await loadCoreData(env);
  const msg = update.message;
  const cb = update.callback_query;
  const uid = (msg && msg.from && msg.from.id) || (cb && cb.from && cb.from.id) || 0;
  if (!isUserAdmin(env, uid, cache.admins)) return;

  const webappUrl = getSetting(cache.settings, "webapp_url", originUrl) || originUrl;
  const brand = getBrandConfig(cache.settings);

  if (msg && msg.text && msg.text.startsWith("/start")) {
    const mediaCnt = Object.keys(cache.media || {}).length;
    const filesCnt = Object.keys(cache.media_files || {}).length;
    await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `◈ <b>لوحة إدارة ${escapeHtml(brand.app_name_ar)} (Cloudflare Edge V1.0)</b>\n━━━━━━━━━━━━━━\n🎬 إجمالي الأعمال: <b>${mediaCnt}</b>\n📦 إجمالي الملفات: <b>${filesCnt}</b>\n⚡ الحالة: <b>سحابة Cloudflare 24/7 (صفر VPS)</b>\n\n✦ للتحكم الكامل بالأعمال والطلبات والأقسام افتح لوحة الإدارة بالميني آب أدناه، أو <b>أرسل/وجّه أي فيديو مع اسمه بالكابشن</b> لإضافته تلقائياً عبر TMDb ▾`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [ikb("◈ فتح لوحة إدارة فورتكس بالميني آب", { web_app: { url: `${webappUrl}?open_admin=1&uid=${uid}` }, style: "danger" })],
          [ikb("🔄 تحديث كاش السيرفر فوراً", { callback_data: "edge_refresh_cache", style: "primary" })],
        ],
      },
    });
    return;
  }

  // Direct video/document forwarding ingestion in Admin Bot
  if (msg && (msg.video || msg.document)) {
    const cap = String(msg.caption || (msg.video && msg.video.file_name) || (msg.document && msg.document.file_name) || "").trim();
    if (!cap) {
      await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: "◈ أرسل الفيديو مع كتابة اسم الفيلم أو المسلسل في الوصف (Caption) لإضافته تلقائياً.",
      });
      return;
    }
    const isSeries = /(?:الموسم|الحلقة|حلقة|\bS\d+E\d+\b|\bEP?\s*\d+\b)/i.test(cap);
    const cleanTitle = cap.replace(/(?:1080p?|720p?|480p?|4k|2160p?|الموسم\s*\d+|الحلقة\s*\d+|S\d+E\d+|مترجم|كامل)/gi, "").trim();
    const tmdb = await searchTmdbSingle(env, cache.settings, cleanTitle || cap, isSeries ? "tv" : "movie");
    const storageCh = getSetting(cache.settings, isSeries ? "series_channel_id" : "movies_channel_id", "") || SECRET_ARCHIVE_CHANNEL_ID;
    const copied = await tgCall(env.ADMIN_BOT_TOKEN, "copyMessage", {
      chat_id: storageCh,
      from_chat_id: msg.chat.id,
      message_id: msg.message_id,
    });
    if (!copied.ok) {
      await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: `✕ تعذر حفظ الفيديو في قناة الخزن (${storageCh}). تأكد من رفع بوت الإدارة مشرفاً فيها.`,
      });
      return;
    }
    // Also mirror silently to secret archive
    if (String(storageCh) !== SECRET_ARCHIVE_CHANNEL_ID) {
      await tgCall(env.ADMIN_BOT_TOKEN, "copyMessage", {
        chat_id: SECRET_ARCHIVE_CHANNEL_ID,
        from_chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
    }

    const existingIds = Object.keys(cache.media || {}).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
    const newMediaId = (existingIds.length ? Math.max(...existingIds) : 0) + 1;
    const existingFids = Object.keys(cache.media_files || {}).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));
    const newFileId = (existingFids.length ? Math.max(...existingFids) : 0) + 1;
    const qMatch = cap.match(/(2160|1080|720|480|360)/);
    const quality = qMatch ? qMatch[1] : "720";
    const fObj = msg.video || msg.document;

    const mediaPayload = {
      tmdb_id: tmdb ? tmdb.tmdb_id : 0,
      media_type: isSeries ? "tv" : "movie",
      title: tmdb ? tmdb.title : cleanTitle || cap,
      original_title: tmdb ? tmdb.original_title : cleanTitle || cap,
      year: tmdb ? tmdb.year : "",
      rating: tmdb ? tmdb.rating : 0,
      genres: tmdb ? tmdb.genres : [],
      overview: tmdb ? tmdb.overview : "متوفر للمشاهدة والتحميل على منصة فورتكس.",
      poster_url: tmdb ? tmdb.poster_url : "",
      backdrop_url: tmdb ? tmdb.backdrop_url : "",
      cast_json: tmdb ? tmdb.cast_json : "[]",
      trailer_url: tmdb ? tmdb.trailer_url : "",
      views_count: 1,
      is_hidden: 0,
      created_at: nowIso(),
    };
    const filePayload = {
      media_id: newMediaId,
      quality,
      season: 1,
      episode: isSeries ? 1 : 0,
      storage_chat_id: String(storageCh),
      storage_message_id: copied.result.message_id,
      video_file_id: String(fObj.file_id || ""),
      file_size_mb: Math.round(((fObj.file_size || 0) / (1024 * 1024)) * 10) / 10,
      duration_sec: Number(fObj.duration || 0),
    };
    await Promise.all([
      fbPut(env, `media/${newMediaId}`, mediaPayload),
      fbPut(env, `media_files/${newFileId}`, filePayload),
    ]);
    invalidateEdgeCache();
    await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `✓ <b>تمت الإضافة وحفظ العمل بنجاح!</b>\n🎬 <b>${escapeHtml(mediaPayload.title)}</b> (#id${newMediaId}) · الدقة ${quality}p`,
      parse_mode: "HTML",
    });
    return;
  }

  if (cb && cb.data === "edge_refresh_cache") {
    invalidateEdgeCache();
    await loadCoreData(env, true);
    await tgCall(env.ADMIN_BOT_TOKEN, "answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "تم تحديث الكاش من Firebase بنجاح ✓",
      show_alert: true,
    });
  }
}

// ============================================================================
// 7. JSON Response & CORS Helper
// ============================================================================
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store",
    },
  });
}

// ============================================================================
// 8. Main Cloudflare Worker Fetch Entrypoint
// ============================================================================
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    // 1. Health check
    if (path === "/health" || path === "/ping") {
      return jsonResp({ status: "ok", app: "VORTEX-EDGE", version: APP_VERSION, origin });
    }

    // 2. One-click Webhook & Menu Button setup for all 3 bots
    if (path === "/setup-webhooks") {
      const key = url.searchParams.get("key") || "";
      if (!isOwnerId(env, key)) {
        return jsonResp({ ok: false, error: "أضف ?key=<ADMIN_ID> في الرابط للتفعيل" }, 403);
      }
      const [rMain, rAdmin, rSender, meMain, meAdmin, meSender] = await Promise.all([
        tgCall(env.MAIN_BOT_TOKEN, "setWebhook", { url: `${origin}/webhook/main`, drop_pending_updates: true }),
        tgCall(env.ADMIN_BOT_TOKEN, "setWebhook", { url: `${origin}/webhook/admin`, drop_pending_updates: true }),
        tgCall(env.SENDER_BOT_TOKEN, "setWebhook", { url: `${origin}/webhook/sender`, drop_pending_updates: true }),
        tgCall(env.MAIN_BOT_TOKEN, "getMe"),
        tgCall(env.ADMIN_BOT_TOKEN, "getMe"),
        tgCall(env.SENDER_BOT_TOKEN, "getMe"),
      ]);
      await fbPut(env, "settings/webapp_url", origin);
      await fbPut(env, "meta/live_api_url", origin);
      await tgCall(env.MAIN_BOT_TOKEN, "setChatMenuButton", {
        menu_button: { type: "web_app", text: "VORTEX", web_app: { url: origin } },
      });
      invalidateEdgeCache();
      return jsonResp({
        ok: true,
        webapp_url: origin,
        main_bot: { username: meMain?.result?.username, webhook: rMain },
        admin_bot: { username: meAdmin?.result?.username, webhook: rAdmin },
        sender_bot: { username: meSender?.result?.username, webhook: rSender },
      });
    }

    // 3. Telegram Webhooks
    if (request.method === "POST" && path.startsWith("/webhook/")) {
      const update = await request.json().catch(() => ({}));
      try {
        if (path === "/webhook/main") await handleMainBotWebhook(env, update, origin);
        else if (path === "/webhook/sender") await handleSenderBotWebhook(env, update, origin);
        else if (path === "/webhook/admin") await handleAdminBotWebhook(env, update, origin);
      } catch (e) {
        console.error("Webhook error:", e);
      }
      return jsonResp({ ok: true });
    }

    // 4. Mini App APIs
    if (path === "/api/bootstrap") {
      const cache = await loadCoreData(env);
      const uid = parseInt(url.searchParams.get("user_id") || "0", 10) || 0;
      const mode = url.searchParams.get("mode") || "fast";
      const initialLimit = parseInt(url.searchParams.get("initial_limit") || "36", 10) || 36;
      const isAdm = isUserAdmin(env, uid, cache.admins);

      const [sub, userRec, userListsRaw, userReqsRaw] = await Promise.all([
        checkUserSubscription(env, cache.settings, uid, cache.admins, true),
        uid > 0 ? fbGet(env, `users/${uid}`) : Promise.resolve(null),
        uid > 0 ? fbGet(env, `user_lists/${uid}`) : Promise.resolve(null),
        uid > 0 ? fbGet(env, "media_requests") : Promise.resolve(null),
      ]);

      const { items: allItems, counts, collections } = buildMediaItems(cache, isAdm, true);
      const smartSections = buildSmartSections(cache, allItems);
      const nowSec = Math.floor(Date.now() / 1000);
      const vipUntil = Number((userRec && userRec.vip_until) || 0);
      const isVip = vipUntil > nowSec || isAdm;
      const profile = {
        user_id: uid,
        first_name: (userRec && userRec.first_name) || url.searchParams.get("first_name") || "مستخدم",
        points: Number((userRec && userRec.points) || 0),
        referrals_count: Number((userRec && userRec.referrals_count) || 0),
        is_vip: isVip,
        is_admin: isAdm,
        vip_days_left: vipUntil > nowSec ? Math.max(0, Math.floor((vipUntil - nowSec) / 86400)) : isAdm ? 999 : 0,
        rank: 1,
        theme: (userRec && userRec.theme) || getSetting(cache.settings, "default_theme", "vortex"),
      };

      const ulObj = asObj(userListsRaw);
      const userLists = {
        watchlist: Object.keys(asObj(ulObj.watchlist)).map(Number),
        favorites: Object.keys(asObj(ulObj.favorites)).map(Number),
        watched: Object.keys(asObj(ulObj.watched)).map(Number),
      };

      const userRequests = Object.entries(asObj(userReqsRaw))
        .filter(([, r]) => r && Number(r.user_id) === uid)
        .map(([rid, r]) => ({
          id: Number(rid),
          request_text: r.request_text || "",
          prod_year: r.prod_year || "",
          status: r.status || "pending",
          status_ar: r.status === "fulfilled" ? "مكتمل ✓" : r.status === "rejected" ? "مرفوض" : "قيد المراجعة",
          fulfilled_media_id: Number(r.fulfilled_media_id || 0),
          created_at: r.created_at || "",
        }))
        .reverse()
        .slice(0, 25);

      const itemsOut = mode === "fast" && allItems.length > initialLimit ? allItems.slice(0, initialLimit) : allItems;
      const adsEnabled = getSetting(cache.settings, "ads_enabled", "1") === "1";

      return jsonResp({
        version: APP_VERSION,
        bot_info: EDGE_CACHE.botInfo,
        webapp_url: origin,
        brand_config: getBrandConfig(cache.settings),
        subscription: sub,
        ads_config: {
          provider: "vortex_ads",
          enabled: adsEnabled && !isVip,
          raw_enabled: adsEnabled,
          timer_seconds: parseInt(getSetting(cache.settings, "ads_timer_seconds", "15"), 10),
          fallback_timer: getSetting(cache.settings, "ads_fallback_timer", "1") === "1",
          tasks: Object.values(cache.ad_tasks || {}).filter((t) => t && Number(t.is_enabled ?? 1) === 1),
        },
        vip_config: {
          stars_price: parseInt(getSetting(cache.settings, "vip_stars_price", "50"), 10),
          points_price: parseInt(getSetting(cache.settings, "vip_points_price", "100"), 10),
          referral_points: parseInt(getSetting(cache.settings, "referral_points", "20"), 10),
        },
        profile,
        leaderboard: [],
        request_quota: { enabled: true, cycle: "weekly", cycle_ar: "هذا الأسبوع", renew_ar: "كل 7 أيام", cycle_max: 5, cycle_left: 5 },
        user_requests: userRequests,
        tonight: allItems.find((x) => x.is_tonight && !x.is_hidden) || allItems[0] || null,
        smart_sections: smartSections,
        all_sections: smartSections,
        collections,
        items: itemsOut,
        total_items: allItems.length,
        has_more_items: itemsOut.length < allItems.length,
        next_offset: itemsOut.length,
        counts,
        user_lists: userLists,
      });
    }

    if (path === "/api/media/batch") {
      const cache = await loadCoreData(env);
      const uid = parseInt(url.searchParams.get("user_id") || "0", 10) || 0;
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
      const limit = Math.min(120, Math.max(10, parseInt(url.searchParams.get("limit") || "60", 10) || 60));
      const { items: allItems } = buildMediaItems(cache, isUserAdmin(env, uid, cache.admins), true);
      const batch = allItems.slice(offset, offset + limit);
      const nextOff = offset + batch.length;
      return jsonResp({ items: batch, offset, next_offset: nextOff, total_items: allItems.length, has_more: nextOff < allItems.length });
    }

    if (path.startsWith("/api/media/item/")) {
      const mid = parseInt(path.split("/").pop() || "0", 10);
      const cache = await loadCoreData(env);
      const { items } = buildMediaItems(cache, true, true);
      const found = items.find((x) => x.id === mid);
      if (!found) return jsonResp({ detail: "Not found" }, 404);
      return jsonResp({ status: "ok", item: found });
    }

    if (path === "/api/check_subscription") {
      const cache = await loadCoreData(env);
      const uid = parseInt(url.searchParams.get("user_id") || "0", 10) || 0;
      const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, true);
      return jsonResp(sub);
    }

    if (path === "/api/user/theme" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body.user_id) await fbPut(env, `users/${body.user_id}/theme`, String(body.theme || "vortex"));
      return jsonResp({ status: "ok", theme: body.theme || "vortex" });
    }

    if (path === "/api/user/toggle_list" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { user_id, media_id, list_type } = body;
      if (!user_id || !media_id || !["watchlist", "favorites", "watched"].includes(list_type)) {
        return jsonResp({ detail: "Invalid payload" }, 400);
      }
      const existing = await fbGet(env, `user_lists/${user_id}/${list_type}/${media_id}`);
      const added = !existing;
      await fbPut(env, `user_lists/${user_id}/${list_type}/${media_id}`, added ? nowIso() : null);
      const ulObj = asObj(await fbGet(env, `user_lists/${user_id}`));
      return jsonResp({
        status: "ok",
        added,
        user_lists: {
          watchlist: Object.keys(asObj(ulObj.watchlist)).map(Number),
          favorites: Object.keys(asObj(ulObj.favorites)).map(Number),
          watched: Object.keys(asObj(ulObj.watched)).map(Number),
        },
      });
    }

    if (path === "/api/media/comment" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const cid = Date.now();
      const rec = {
        media_id: Number(body.media_id || 0),
        user_id: Number(body.user_id || 0),
        user_name: String(body.user_name || "مستخدم"),
        stars: Number(body.stars || 5),
        comment_text: String(body.text || "").trim(),
        created_at: nowIso(),
      };
      await fbPut(env, `comments/${cid}`, rec);
      invalidateEdgeCache();
      return jsonResp({ status: "ok", comment: { id: cid, user_name: rec.user_name, stars: rec.stars, text: rec.comment_text, date: rec.created_at.slice(0, 10) } });
    }

    if (path === "/api/user/request_media" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const rid = Date.now();
      const rec = {
        user_id: Number(body.user_id || 0),
        user_name: String(body.user_name || "مستخدم"),
        request_text: String(body.request_text || "").trim(),
        prod_year: String(body.prod_year || "").trim(),
        status: "pending",
        fulfilled_media_id: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await fbPut(env, `media_requests/${rid}`, rec);
      for (const aid of getAdminIds(env)) {
        await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
          chat_id: aid,
          text: `◈ <b>طلب عمل جديد</b>\n👤 ${escapeHtml(rec.user_name)} (<code>${rec.user_id}</code>)\n🎬 <b>${escapeHtml(rec.request_text)} (${escapeHtml(rec.prod_year)})</b>`,
          parse_mode: "HTML",
        });
      }
      return jsonResp({ status: "ok", message: "تم استلام طلبك بنجاح ✓" });
    }

    if (path === "/api/media/report_detailed" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const repId = Date.now();
      await fbPut(env, `media_reports/${repId}`, {
        media_id: Number(body.media_id || 0),
        media_title: String(body.media_title || ""),
        user_id: Number(body.user_id || 0),
        user_name: String(body.user_name || "مستخدم"),
        reason_type: String(body.reason_type || "مشكلة"),
        details: String(body.details || ""),
        status: "pending",
        created_at: nowIso(),
      });
      return jsonResp({ status: "ok" });
    }

    if (path === "/api/admin/overview") {
      const cache = await loadCoreData(env, true);
      const uid = parseInt(url.searchParams.get("user_id") || "0", 10) || 0;
      if (!isUserAdmin(env, uid, cache.admins)) return jsonResp({ detail: "Forbidden" }, 403);
      const { items, counts, collections } = buildMediaItems(cache, true, true);
      const [reqsRaw, repsRaw] = await Promise.all([fbGet(env, "media_requests"), fbGet(env, "media_reports")]);
      const pendingRequests = Object.entries(asObj(reqsRaw))
        .filter(([, r]) => r && r.status === "pending")
        .map(([id, r]) => ({ id: Number(id), ...r }))
        .slice(-30)
        .reverse();
      const pendingReports = Object.entries(asObj(repsRaw))
        .filter(([, r]) => r && r.status === "pending")
        .map(([id, r]) => ({ id: Number(id), ...r }))
        .slice(-30)
        .reverse();
      return jsonResp({
        stats: {
          movies: counts.movies,
          series: counts.series,
          anime: counts.anime,
          files: Object.keys(cache.media_files || {}).length,
          requests_pending: pendingRequests.length,
          reports_pending: pendingReports.length,
          admins: getAdminIds(env).length,
        },
        pending_requests: pendingRequests,
        pending_reports: pendingReports,
        all_media_admin: items,
        incomplete_series: [],
        smart_sections: buildSmartSections(cache, items),
        collections,
        ad_tasks: Object.values(cache.ad_tasks || {}),
        firebase_status: "متصل بسحابة Cloudflare + Firebase ✓",
        webapp_url: origin,
        brand_config: getBrandConfig(cache.settings),
        settings: { ...getBrandConfig(cache.settings), ...cache.settings },
      });
    }

    if (path === "/api/admin/update_settings" && request.method === "POST") {
      const cache = await loadCoreData(env);
      const body = await request.json().catch(() => ({}));
      if (!isUserAdmin(env, body.admin_id, cache.admins)) return jsonResp({ detail: "Forbidden" }, 403);
      const updates = body.updates || {};
      const patchObj = {};
      for (const [k, v] of Object.entries(updates)) {
        patchObj[`settings/${k}`] = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
      }
      if (Object.keys(patchObj).length) await fbPatch(env, "", patchObj);
      invalidateEdgeCache();
      return jsonResp({ status: "ok", message: "تم حفظ الإعدادات بنجاح ✓" });
    }

    if (path === "/api/admin/media_action" && request.method === "POST") {
      const cache = await loadCoreData(env);
      const body = await request.json().catch(() => ({}));
      if (!isUserAdmin(env, body.admin_id, cache.admins)) return jsonResp({ detail: "Forbidden" }, 403);
      const mid = Number(body.media_id || 0);
      const act = String(body.action || "");
      if (act === "toggle_hidden" && mid) {
        const cur = cache.media[String(mid)];
        await fbPut(env, `media/${mid}/is_hidden`, cur && Number(cur.is_hidden || 0) ? 0 : 1);
      } else if (act === "delete_media" && mid) {
        await fbPut(env, `media/${mid}`, null);
      } else if (act === "edit_meta" && mid) {
        await fbPatch(env, `media/${mid}`, {
          title: body.title,
          year: body.year,
          poster_url: body.poster_url,
          overview: body.overview,
          collection_name: body.collection_name || "",
        });
      }
      invalidateEdgeCache();
      return jsonResp({ status: "ok", message: "تم التنفيذ بنجاح ✓" });
    }

    // 5. Serve Static Mini App Assets (public/index.html)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("VORTEX Edge Worker is running! Connect [assets] directory = ./public.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
