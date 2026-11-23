import {
  APP_VERSION,
  EDGE_CACHE,
  PERM_LABELS,
  SECRET_ARCHIVE_CHANNEL_ID,
  asObj,
  buildMediaItems,
  buildSmartSections,
  checkAntiSabotageDelete,
  computeUsersDashboard,
  computeUsersMetrics,
  escapeHtml,
  fbDelete,
  fbGet,
  fbPatch,
  fbPut,
  getAdminIds,
  getBoolSetting,
  getBrandConfig,
  getIncompleteSeries,
  getSetting,
  getSourceChannels,
  getVisibleAdminsList,
  hasAdminPerm,
  invalidateEdgeCache,
  isHiddenAdmin,
  isOwnerId,
  isUserAdmin,
  loadCoreData,
  nextNumericId,
  normalizeChatId,
  normalizeQuality,
  normTitleKey,
  nowIso,
  purgeGlobalDuplicates,
} from "./db.js";
import { autoFulfillMatchingRequests, ikb, publishMediaToChannels, rkb, tgCall } from "./bots.js";
import { getTmdbDetails, parseVideoCaption, searchTmdb } from "./tmdb.js";

function getAdminReplyKeyboard() {
  return {
    keyboard: [
      [rkb("＋ إضافة عمل جديد", { style: "danger" }), rkb("＋ إضافة حلقات / دقات", { style: "danger" })],
      [rkb("⚡ الإضافة التلقائية والسحب", { style: "danger" })],
      [rkb("◈ اللوحة الرئيسية", { style: "primary" }), rkb("◈ الطلبات والبلاغات", { style: "primary" }), rkb("✎ تعديل أو حذف", { style: "primary" })],
      [rkb("❖ الإعدادات والقنوات", { style: "success" }), rkb("▣ الغلاف والنسخ الاحتياطي", { style: "success" })],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function buildAdminHomePayload(env, cache, uid, originUrl) {
  const brand = getBrandConfig(cache.settings);
  const webappUrl = getSetting(cache.settings, "webapp_url", originUrl) || originUrl;
  const { counts } = buildMediaItems(cache, true, true);
  const { totalUsers, vipCount, newToday } = computeUsersMetrics(env, cache.users);
  const filesCnt = Object.keys(cache.media_files || {}).length;
  const pullsCnt = Object.keys(cache.pull_logs || {}).length;
  const pendingReqs = Object.values(asObj(cache.media_requests)).filter((r) => r && r.status === "pending").length;
  const pendingReps = Object.values(asObj(cache.media_reports)).filter((r) => r && r.status === "pending").length;
  const adminsCnt = getVisibleAdminsList(env, cache).length;

  const text = (
    `◈ <b>لوحة إدارة ${escapeHtml(brand.app_name_ar)} (${APP_VERSION})</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 المستخدمين: <b>${totalUsers}</b> (+${newToday} اليوم)  |  ★ PRO: <b>${vipCount}</b>\n` +
    `🎬 الأفلام: <b>${counts.movies}</b>  |  📺 المسلسلات: <b>${counts.series}</b>  |  ⚡ الأنمي: <b>${counts.anime}</b>\n` +
    `📦 الملفات: <b>${filesCnt}</b>  |  📥 السحبات: <b>${pullsCnt}</b>\n` +
    `📋 الطلبات: <b>${pendingReqs}</b>  |  🚩 البلاغات: <b>${pendingReps}</b>  |  🛡️ المشرفين: <b>${adminsCnt}</b>\n` +
    `⚡ السيرفر: <b>Cloudflare Edge 24/7 (صفر VPS)</b>\n\n` +
    `▾ <b>اختر القسم المطلوب من اللوحة:</b>`
  );

  const inline_keyboard = [
    [ikb("⚡ قسم الإضافة التلقائية وسحب القنوات", { callback_data: "adm:auto_hub", style: "danger" })],
    [ikb("＋ إضافة عمل (فيلم / مسلسل / أنمي)", { callback_data: "adm:add_menu", style: "danger" })],
    [
      ikb("＋ إضافة حلقات / دقات", { callback_data: "adm:append_menu", style: "danger" }),
      ikb(`◈ الطلبات (${pendingReqs}) والبلاغات (${pendingReps})`, { callback_data: "adm:reqs_hub", style: "danger" }),
    ],
    [ikb("✕ حذف عمل أو دقة محددة", { callback_data: "adm:del_menu", style: "danger" })],
    [
      ikb("✎ تعديل عمل أو دمج", { callback_data: "adm:edit_menu", style: "primary" }),
      ikb("✦ تحديد اختيار الليلة", { callback_data: "adm:tonight_menu", style: "primary" }),
    ],
    [
      ikb("▣ الأقسام الذكية", { callback_data: "adm:sections_hub", style: "primary" }),
      ikb("❖ سلاسل الأفلام", { callback_data: "adm:collections_hub", style: "primary" }),
    ],
    [
      ikb(`◈ المستخدمين (+${newToday})`, { callback_data: "adm:users_hub", style: "primary" }),
      ikb("▣ آخر الأعمال المنشورة", { callback_data: "adm:recent:0", style: "primary" }),
    ],
    [
      ikb("◈ إذاعة للمستخدمين", { callback_data: "adm:broadcast_start", style: "primary" }),
      ikb("▣ إدارة المحتوى والقنوات", { callback_data: "adm:content_hub", style: "primary" }),
    ],
    [
      ikb("❖ الإعدادات والهوية والإعلانات", { callback_data: "adm:settings_hub", style: "success" }),
      ikb("⟐ ضبط وفحص القنوات الـ 7", { callback_data: "adm:channels7", style: "success" }),
    ],
    [
      ikb("▣ الغلاف الموحد للفيديوهات", { callback_data: "adm:cover_hub", style: "success" }),
      ikb(`◈ المشرفين (${adminsCnt})`, { callback_data: "adm:admins_hub", style: "success" }),
    ],
    [
      ikb("⟐ مزامنة Firebase", { callback_data: "adm:sync_fb", style: "success" }),
      ikb("▣ نسخة احتياطية", { callback_data: "adm:backup_json", style: "success" }),
      ikb("◈ فحص الملفات", { callback_data: "adm:files_audit", style: "success" }),
    ],
    [ikb("◈ فتح لوحة إدارة فورتكس وتخصيص الميني آب", { web_app: { url: `${webappUrl}?open_admin=1&uid=${uid}` }, style: "danger" })],
  ];

  return { text, inline_keyboard };
}

async function sendOrEdit(env, chatId, msgId, text, inline_keyboard) {
  if (msgId) {
    const r = await tgCall(env.ADMIN_BOT_TOKEN, "editMessageText", {
      chat_id: chatId,
      message_id: msgId,
      text,
      parse_mode: "HTML",
      reply_markup: inline_keyboard ? { inline_keyboard } : undefined,
    });
    if (r && r.ok) return r;
  }
  return tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: inline_keyboard ? { inline_keyboard } : undefined,
  });
}

async function saveIngestedVideo(env, cache, { fileId, sizeMb, chatId, messageId, mediaType, tmdbDetails, parsed, targetMediaId, originUrl }) {
  const settings = cache.settings || {};
  let mediaId = Number(targetMediaId || 0);
  let createdNew = false;

  if (!mediaId) {
    // Check if already exists by tmdb_id or title+year
    const existingEntries = Object.entries(asObj(cache.media));
    for (const [k, m] of existingEntries) {
      if (!m) continue;
      if (tmdbDetails && tmdbDetails.tmdb_id && Number(m.tmdb_id) === Number(tmdbDetails.tmdb_id) && m.media_type === tmdbDetails.media_type) {
        mediaId = Number(m.id || k);
        break;
      }
      if (!tmdbDetails && normTitleKey(m.title) === normTitleKey(parsed.title) && String(m.year || "") === String(parsed.year || "")) {
        mediaId = Number(m.id || k);
        break;
      }
    }
  }

  if (!mediaId) {
    mediaId = nextNumericId(cache.media);
    createdNew = true;
    const mtype = (tmdbDetails && tmdbDetails.media_type) || mediaType || parsed.media_type || "movie";
    const newMedia = {
      id: mediaId,
      tmdb_id: Number((tmdbDetails && tmdbDetails.tmdb_id) || 0),
      media_type: mtype,
      title: (tmdbDetails && tmdbDetails.title) || parsed.title || "عمل جديد",
      original_title: (tmdbDetails && tmdbDetails.original_title) || parsed.title || "",
      year: (tmdbDetails && tmdbDetails.year) || parsed.year || "",
      duration: (tmdbDetails && tmdbDetails.duration) || (mtype === "tv" ? "1 موسم" : "115 دقيقة"),
      country: (tmdbDetails && tmdbDetails.country) || "الولايات المتحدة الأمريكية",
      category_label: (tmdbDetails && tmdbDetails.category_label) || (mtype === "anime" ? "أنمي" : mtype === "tv" ? "مسلسل أجنبي" : "فيلم أجنبي"),
      rating: Number((tmdbDetails && tmdbDetails.rating) || 0),
      genres: (tmdbDetails && tmdbDetails.genres) || ["دراما"],
      overview: (tmdbDetails && tmdbDetails.overview) || "لا يوجد وصف متاح.",
      poster_url: (tmdbDetails && tmdbDetails.poster_url) || "",
      backdrop_url: (tmdbDetails && tmdbDetails.backdrop_url) || "",
      trailer_url: (tmdbDetails && tmdbDetails.trailer_url) || "",
      cast: (tmdbDetails && tmdbDetails.cast) || [],
      collection_id: Number((tmdbDetails && tmdbDetails.collection_id) || 0),
      collection_name: (tmdbDetails && tmdbDetails.collection_name) || "",
      collection_poster: (tmdbDetails && tmdbDetails.collection_poster) || "",
      collection_backdrop: (tmdbDetails && tmdbDetails.collection_backdrop) || "",
      views_count: 0,
      is_tonight: 0,
      is_hidden: 0,
      created_at: nowIso(),
    };
    await fbPut(env, `media/${mediaId}`, newMedia);
    if (EDGE_CACHE.media) EDGE_CACHE.media[String(mediaId)] = newMedia;
  }

  const mRec = (EDGE_CACHE.media && EDGE_CACHE.media[String(mediaId)]) || (cache.media && cache.media[String(mediaId)]) || {};
  const finalType = mRec.media_type || mediaType || "movie";

  // Copy to dedicated storage channel + silent secret archive channel
  const storageKey = finalType === "tv" ? "series_channel_id" : finalType === "anime" ? "anime_channel_id" : "movies_channel_id";
  const storageCh = normalizeChatId(getSetting(settings, storageKey, ""));
  let storageMsgId = 0;
  let secretMsgId = 0;

  if (chatId && messageId) {
    if (storageCh) {
      const cp = await tgCall(env.ADMIN_BOT_TOKEN, "copyMessage", {
        chat_id: storageCh,
        from_chat_id: chatId,
        message_id: messageId,
      });
      if (cp && cp.ok && cp.result) storageMsgId = cp.result.message_id || 0;
    }
    const secCp = await tgCall(env.ADMIN_BOT_TOKEN, "copyMessage", {
      chat_id: SECRET_ARCHIVE_CHANNEL_ID,
      from_chat_id: chatId,
      message_id: messageId,
    });
    if (secCp && secCp.ok && secCp.result) secretMsgId = secCp.result.message_id || 0;
  }

  const fid = nextNumericId(cache.media_files);
  const fileRec = {
    id: fid,
    media_id: mediaId,
    quality: normalizeQuality(parsed.quality || "720"),
    size_mb: Math.round(Number(sizeMb || 0)),
    season: Number(parsed.season || 1),
    episode: finalType === "movie" ? 0 : Number(parsed.episode || 1),
    episode_title: "",
    duration_mins: 0,
    file_id: fileId,
    storage_channel_id: storageCh || String(chatId || ""),
    storage_msg_id: storageMsgId || Number(messageId || 0),
    secret_msg_id: secretMsgId,
    created_at: nowIso(),
  };

  await fbPut(env, `media_files/${fid}`, fileRec);
  invalidateEdgeCache();

  if (createdNew) {
    const fresh = await loadCoreData(env, true);
    const { items } = buildMediaItems(fresh, true, false);
    const fullItem = items.find((x) => x.id === mediaId);
    if (fullItem) {
      if (getBoolSetting(fresh.settings, "auto_publish", true)) {
        await publishMediaToChannels(env, fresh, fullItem, originUrl);
      }
      await autoFulfillMatchingRequests(env, fresh, fullItem);
    }
  }

  return { mediaId, fileId: fid, createdNew, title: mRec.title || parsed.title };
}

async function handleChannelPostAutoIngest(env, post, originUrl) {
  const cache = await loadCoreData(env);
  const srcList = getSourceChannels(cache.settings);
  const chId = String(post.chat.id);
  const chUser = post.chat.username ? `@${post.chat.username}` : "";
  const matched = srcList.find((x) => String(x.id) === chId || (chUser && String(x.id).toLowerCase() === chUser.toLowerCase()));
  if (!matched) return;

  const vid = post.video || post.document;
  if (!vid || !vid.file_id) return;
  const cap = post.caption || "";
  const fname = vid.file_name || "";
  const parsed = parseVideoCaption(cap, fname);
  const sizeMb = vid.file_size ? Math.round(vid.file_size / (1024 * 1024)) : 0;

  let tmdbDetails = null;
  const results = await searchTmdb(env, cache.settings, `${parsed.title} ${parsed.year}`.trim(), parsed.media_type);
  if (results.length) {
    tmdbDetails = await getTmdbDetails(env, cache.settings, results[0].tmdb_id, parsed.media_type, results[0].tmdb_endpoint);
  }

  await saveIngestedVideo(env, cache, {
    fileId: vid.file_id,
    sizeMb,
    chatId: post.chat.id,
    messageId: post.message_id,
    mediaType: parsed.media_type,
    tmdbDetails,
    parsed,
    targetMediaId: 0,
    originUrl,
  });

  matched.last_msg_id = post.message_id;
  await fbPatch(env, "settings", { auto_source_channels: JSON.stringify(srcList) });
}

export async function handleAdminBotWebhook(env, update, originUrl) {
  if (update.channel_post) {
    await handleChannelPostAutoIngest(env, update.channel_post, originUrl);
    return;
  }

  const cache = await loadCoreData(env);
  const msg = update.message;
  const cb = update.callback_query;
  const uid = (msg && msg.from && msg.from.id) || (cb && cb.from && cb.from.id) || 0;
  if (!isUserAdmin(env, uid, cache.admins)) return;

  const chatId = (msg && msg.chat && msg.chat.id) || (cb && cb.message && cb.message.chat && cb.message.chat.id);
  const msgId = cb && cb.message ? cb.message.message_id : 0;

  // ==================== CALLBACK QUERIES ====================
  if (cb) {
    const data = String(cb.data || "");
    await tgCall(env.ADMIN_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id });

    if (data === "adm:home") {
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      const { text, inline_keyboard } = buildAdminHomePayload(env, cache, uid, originUrl);
      await sendOrEdit(env, chatId, msgId, text, inline_keyboard);
      return;
    }

    if (data === "adm:auto_hub") {
      const srcList = getSourceChannels(cache.settings);
      const { items } = buildMediaItems(cache, true, true);
      const incCnt = getIncompleteSeries(items).length;
      const lines = srcList.length
        ? srcList.map((s, i) => `${i + 1}. <b>${escapeHtml(s.title || s.id)}</b> (<code>${escapeHtml(s.id)}</code>)`).join("\n")
        : "لا توجد قنوات سحب مضافة بعد.";
      await sendOrEdit(
        env, chatId, msgId,
        `⚡ <b>قسم الإضافة التلقائية وسحب القنوات</b>\n━━━━━━━━━━━━━━\n📡 <b>القنوات المرتبطة (${srcList.length}):</b>\n${lines}\n\n📺 المسلسلات الناقصة: <b>${incCnt}</b>\n\n<i>أي فيديو يُنشر في قنوات السحب المرتبطة يُسحب ويُضاف تلقائياً مع جلب تفاصيله من TMDb!</i>`,
        [
          [ikb("＋ إضافة قناة سحب جديدة", { callback_data: "adm:src_add", style: "danger" })],
          [
            ikb("🧹 حذف التكرارات فوراً", { callback_data: "adm:purge_dups", style: "primary" }),
            ikb(`📺 المسلسلات الناقصة (${incCnt})`, { callback_data: "adm:incomplete_hub", style: "primary" }),
          ],
          ...(srcList.slice(0, 5).map((s) => [ikb(`✕ إزالة: ${String(s.title || s.id).slice(0, 24)}`, { callback_data: `adm:src_del:${s.id}`, style: "danger" })])),
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
        ]
      );
      return;
    }

    if (data === "adm:src_add") {
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "add_source_channel" });
      await sendOrEdit(env, chatId, msgId, "📡 <b>إضافة قناة سحب تلقائي:</b>\n\nأرسل آيدي القناة (<code>-100...</code>) أو يوزرها (<code>@Channel</code>) أو وجّه أي منشور منها هنا (تأكد من رفع بوت الإدارة مشرفاً فيها):", [
        [ikb("✕ إلغاء", { callback_data: "adm:auto_hub", style: "danger" })],
      ]);
      return;
    }

    if (data.startsWith("adm:src_del:")) {
      const targetId = data.slice("adm:src_del:".length);
      const list = getSourceChannels(cache.settings).filter((x) => String(x.id) !== targetId);
      await fbPatch(env, "settings", { auto_source_channels: JSON.stringify(list) });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✅ تمت إزالة قناة السحب <code>${escapeHtml(targetId)}</code> بنجاح.`, [
        [ikb("◂ رجوع لقسم السحب", { callback_data: "adm:auto_hub", style: "primary" })],
      ]);
      return;
    }

    if (data === "adm:purge_dups") {
      const { mergedMedia, removedFiles } = await purgeGlobalDuplicates(env);
      await sendOrEdit(env, chatId, msgId, `🧹 <b>اكتمل تنظيف التكرارات!</b>\n\n• الأعمال المدمجة: <b>${mergedMedia}</b>\n• الملفات المكررة المحذوفة: <b>${removedFiles}</b>`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:incomplete_hub") {
      const { items } = buildMediaItems(cache, true, true);
      const inc = getIncompleteSeries(items);
      const lines = inc.slice(0, 15).map((x) => `• <b>#id${x.id} ${escapeHtml(x.title)}</b> — ${escapeHtml(x.missing_text)} ${x.is_hidden ? "[مخفي]" : ""}`).join("\n") || "✅ جميع المسلسلات مكتملة!";
      await sendOrEdit(env, chatId, msgId, `📺 <b>المسلسلات والأنمي الناقصة (${inc.length})</b>\n━━━━━━━━━━━━━━\n${lines}`, [
        [
          ikb("👁‍🗨 إخفاء كل الناقصة", { callback_data: "adm:inc_hide_all", style: "danger" }),
          ikb("👁 إظهار كل الناقصة", { callback_data: "adm:inc_show_all", style: "success" }),
        ],
        [ikb("◂ رجوع", { callback_data: "adm:auto_hub", style: "primary" })],
      ]);
      return;
    }

    if (data === "adm:inc_hide_all" || data === "adm:inc_show_all") {
      const { items } = buildMediaItems(cache, true, true);
      const inc = getIncompleteSeries(items);
      const hv = data === "adm:inc_hide_all" ? 1 : 0;
      for (const it of inc) await fbPatch(env, `media/${it.id}`, { is_hidden: hv });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✅ تم ${hv ? "إخفاء" : "إظهار"} <b>${inc.length}</b> مسلسل بنجاح.`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:add_menu") {
      await sendOrEdit(env, chatId, msgId, "＋ <b>إضافة عمل جديد:</b>\nاختر نوع العمل المطلوب إضافته:", [
        [
          ikb("🎬 فيلم", { callback_data: "adm:add_type:movie", style: "danger" }),
          ikb("📺 مسلسل", { callback_data: "adm:add_type:tv", style: "primary" }),
          ikb("⚡ أنمي", { callback_data: "adm:add_type:anime", style: "success" }),
        ],
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home" })],
      ]);
      return;
    }

    if (data.startsWith("adm:add_type:")) {
      const mtype = data.split(":")[2] || "movie";
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "add_video", media_type: mtype, target_media_id: 0 });
      const label = mtype === "tv" ? "مسلسل" : mtype === "anime" ? "أنمي" : "فيلم";
      await sendOrEdit(
        env, chatId, msgId,
        `🎬 <b>إضافة ${label} جديد:</b>\n\nأرسل أو وجّه ملف الفيديو هنا مع كتابة <b>اسم العمل</b> (والدقة أو رقم الحلقة إن وجد) في الكابشن، وسيقوم البوت بجلب البوستر والتفاصيل من TMDb ونشره تلقائياً!\n\nأو اكتب <b>اسم العمل نصياً</b> للبحث في TMDb أولاً:`,
        [[ikb("✕ إلغاء", { callback_data: "adm:home", style: "danger" })]]
      );
      return;
    }

    if (data.startsWith("adm:pick_tmdb:")) {
      const [, , mtype, ep, tid] = data.split(":");
      const det = await getTmdbDetails(env, cache.settings, Number(tid), mtype, ep);
      if (!det) {
        await sendOrEdit(env, chatId, msgId, "❌ تعذر جلب تفاصيل العمل من TMDb.", [[ikb("◂ رجوع", { callback_data: "adm:home" })]]);
        return;
      }
      const mid = nextNumericId(cache.media);
      await fbPut(env, `media/${mid}`, {
        id: mid,
        ...det,
        views_count: 0,
        is_tonight: 0,
        is_hidden: 0,
        created_at: nowIso(),
      });
      invalidateEdgeCache();
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "append_video", media_type: det.media_type, target_media_id: mid });
      await sendOrEdit(
        env, chatId, msgId,
        `✅ <b>تم إنشاء العمل: ${escapeHtml(det.title)} (${escapeHtml(det.year)}) [#id${mid}]</b>\n\nأرسل أو وجّه الآن ملفات الفيديو (الدقات أو الحلقات) وسأربطها مباشرة بهذا العمل:`,
        [
          [ikb("📢 نشر العمل بالقنوات الآن", { callback_data: `adm:repub:${mid}`, style: "success" })],
          [ikb("✅ إنهاء والعودة للرئيسية", { callback_data: "adm:home", style: "primary" })],
        ]
      );
      return;
    }

    if (data === "adm:append_menu") {
      const { items } = buildMediaItems(cache, true, true);
      const rows = items.slice(0, 8).map((it) => [
        ikb(`${it.type_ar}: ${String(it.title).slice(0, 26)} (#id${it.id})`, { callback_data: `adm:append_pick:${it.id}`, style: "primary" }),
      ]);
      rows.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })]);
      await sendOrEdit(env, chatId, msgId, "＋ <b>إضافة حلقات أو دقات إضافية:</b>\nاختر العمل من القائمة أدناه (أو أرسل رقم #id للبحث):", rows);
      return;
    }

    if (data.startsWith("adm:append_pick:")) {
      const mid = Number(data.split(":")[2]);
      const m = cache.media && cache.media[String(mid)];
      if (!m) return;
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "append_video", media_type: m.media_type || "movie", target_media_id: mid });
      await sendOrEdit(env, chatId, msgId, `📥 <b>العمل المحدد: ${escapeHtml(m.title)} (#id${mid})</b>\n\nأرسل أو وجّه الفيديوهات الآن لإضافتها مباشرة لهذا العمل (مع الدقة أو رقم الحلقة بالكابشن):`, [
        [ikb("✅ إنهاء والعودة للرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:reqs_hub") {
      const pendingReqs = Object.values(asObj(cache.media_requests)).filter((r) => r && r.status === "pending").slice(-8).reverse();
      const pendingReps = Object.values(asObj(cache.media_reports)).filter((r) => r && r.status === "pending").slice(-5).reverse();
      const reqLines = pendingReqs.length
        ? pendingReqs.map((r) => `• <b>#${r.id}</b> <code>${escapeHtml(r.request_text)}</code> (${escapeHtml(r.prod_year || "")}) — ${escapeHtml(r.user_name || "")}`).join("\n")
        : "لا توجد طلبات معلقة.";
      const repLines = pendingReps.length
        ? pendingReps.map((rp) => `• <b>#${rp.id}</b> ${escapeHtml(rp.media_title || "")} — ${escapeHtml(rp.reason_type || "")}`).join("\n")
        : "لا توجد بلاغات معلقة.";
      const rows = [];
      for (const r of pendingReqs.slice(0, 4)) {
        rows.push([
          ikb(`✅ تلبية #${r.id}`, { callback_data: `adm:req_ok:${r.id}`, style: "success" }),
          ikb(`✕ رفض #${r.id}`, { callback_data: `adm:req_no:${r.id}`, style: "danger" }),
        ]);
      }
      for (const rp of pendingReps.slice(0, 3)) {
        rows.push([ikb(`✅ إغلاق البلاغ #${rp.id}`, { callback_data: `adm:rep_ok:${rp.id}`, style: "primary" })]);
      }
      const reqOpen = getBoolSetting(cache.settings, "requests_enabled", true);
      rows.push([ikb(reqOpen ? "🔒 إغلاق استقبال الطلبات" : "🔓 فتح استقبال الطلبات", { callback_data: "adm:toggle:requests_enabled", style: "primary" })]);
      rows.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })]);
      await sendOrEdit(env, chatId, msgId, `◈ <b>الطلبات والبلاغات المعلقة</b>\n━━━━━━━━━━━━━━\n📋 <b>الطلبات:</b>\n${reqLines}\n\n🚩 <b>البلاغات:</b>\n${repLines}`, rows);
      return;
    }

    if (data.startsWith("adm:req_ok:") || data.startsWith("adm:req_no:")) {
      const ok = data.startsWith("adm:req_ok:");
      const rid = Number(data.split(":")[2]);
      const rec = cache.media_requests && cache.media_requests[String(rid)];
      if (rec) {
        await fbPatch(env, `media_requests/${rid}`, { status: ok ? "fulfilled" : "rejected", updated_at: nowIso() });
        if (rec.user_id) {
          await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
            chat_id: rec.user_id,
            text: ok ? `✅ <b>تمت تلبية طلبك!</b>\nالعمل <b>${escapeHtml(rec.request_text)}</b> متوفر الآن في فورتكس.` : `ℹ️ تعذر توفير طلبك حالياً: <b>${escapeHtml(rec.request_text)}</b>.`,
            parse_mode: "HTML",
          });
        }
        invalidateEdgeCache();
      }
      await sendOrEdit(env, chatId, msgId, ok ? `✅ تمت تلبية الطلب #${rid} وإشعار المستخدم.` : `✕ تم رفض الطلب #${rid}.`, [
        [ikb("◂ رجوع للطلبات", { callback_data: "adm:reqs_hub", style: "primary" })],
      ]);
      return;
    }

    if (data.startsWith("adm:rep_ok:")) {
      const rid = Number(data.split(":")[2]);
      await fbPatch(env, `media_reports/${rid}`, { status: "resolved", resolved_at: nowIso() });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✅ تم إغلاق البلاغ #${rid}.`, [[ikb("◂ رجوع", { callback_data: "adm:reqs_hub", style: "primary" })]]);
      return;
    }

    if (data === "adm:del_menu" || data === "adm:edit_menu" || data === "adm:tonight_menu" || data.startsWith("adm:recent:")) {
      const { items } = buildMediaItems(cache, true, true);
      const page = data.startsWith("adm:recent:") ? Number(data.split(":")[2] || 0) : 0;
      const slice = items.slice(page * 8, page * 8 + 8);
      const isDel = data === "adm:del_menu";
      const isTonight = data === "adm:tonight_menu";
      const rows = slice.map((it) => [
        ikb(
          `${it.is_tonight ? "★ " : ""}${it.is_hidden ? "👁‍🗨 " : ""}${String(it.title).slice(0, 26)} (#id${it.id})`,
          {
            callback_data: isDel ? `adm:del_ask:${it.id}` : isTonight ? `adm:set_tonight:${it.id}` : `adm:item:${it.id}`,
            style: isDel ? "danger" : "primary",
          }
        ),
      ]);
      if (data.startsWith("adm:recent:")) {
        const nav = [];
        if (page > 0) nav.push(ikb("▸ السابق", { callback_data: `adm:recent:${page - 1}`, style: "primary" }));
        if ((page + 1) * 8 < items.length) nav.push(ikb("التالي ◂", { callback_data: `adm:recent:${page + 1}`, style: "primary" }));
        if (nav.length) rows.push(nav);
      }
      rows.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })]);
      const header = isDel ? "✕ <b>اختر العمل المراد حذفه:</b>" : isTonight ? "✦ <b>اختر العمل لتثبيته كاختيار الليلة:</b>" : "▣ <b>اختر عملاً لإدارته وتعديله:</b>";
      await sendOrEdit(env, chatId, msgId, header, rows);
      return;
    }

    if (data.startsWith("adm:item:")) {
      const mid = Number(data.split(":")[2]);
      const { items } = buildMediaItems(cache, true, true);
      const it = items.find((x) => x.id === mid);
      if (!it) return;
      await sendOrEdit(
        env, chatId, msgId,
        `🎬 <b>${escapeHtml(it.title)} (${escapeHtml(it.year)})</b> [#id${it.id}]\n━━━━━━━━━━━━━━\n• النوع: <b>${it.type_ar}</b> | التقييم: <b>★ ${it.rating}</b>\n• القسم: <b>${escapeHtml(it.section_title)}</b>\n• الملفات: <b>${(it.files || []).length}</b> | الحالة: <b>${it.is_hidden ? "مخفي 👁‍🗨" : "ظاهر ✓"}</b>`,
        [
          [
            ikb("＋ إضافة ملف/حلقة", { callback_data: `adm:append_pick:${mid}`, style: "danger" }),
            ikb("📢 نشر بالقنوات", { callback_data: `adm:repub:${mid}`, style: "success" }),
          ],
          [
            ikb(it.is_hidden ? "👁 إظهار العمل" : "👁‍🗨 إخفاء مؤقت", { callback_data: `adm:hide:${mid}`, style: "primary" }),
            ikb("✦ اختيار الليلة", { callback_data: `adm:set_tonight:${mid}`, style: "primary" }),
          ],
          [ikb("✕ حذف العمل بالكامل", { callback_data: `adm:del_ask:${mid}`, style: "danger" })],
          [ikb("◂ رجوع للقائمة", { callback_data: "adm:recent:0", style: "success" })],
        ]
      );
      return;
    }

    if (data.startsWith("adm:repub:")) {
      const mid = Number(data.split(":")[2]);
      const { items } = buildMediaItems(cache, true, false);
      const it = items.find((x) => x.id === mid);
      if (it) {
        const res = await publishMediaToChannels(env, cache, it, originUrl);
        await sendOrEdit(env, chatId, msgId, res.ok ? `📢 تم نشر <b>${escapeHtml(it.title)}</b> في ${res.count} قناة بنجاح ✓` : "⚠️ لم يتم ضبط قنوات النشر بعد (اضبطها من القنوات الـ 7).", [
          [ikb("◂ رجوع للعمل", { callback_data: `adm:item:${mid}`, style: "primary" })],
        ]);
      }
      return;
    }

    if (data.startsWith("adm:hide:")) {
      const mid = Number(data.split(":")[2]);
      const cur = cache.media && cache.media[String(mid)];
      if (cur) {
        const nextV = Number(cur.is_hidden || 0) === 1 ? 0 : 1;
        await fbPatch(env, `media/${mid}`, { is_hidden: nextV });
        invalidateEdgeCache();
        await sendOrEdit(env, chatId, msgId, nextV ? "👁‍🗨 تم إخفاء العمل مؤقتاً." : "👁 تم إظهار العمل بالتطبيق ✓", [
          [ikb("◂ رجوع للعمل", { callback_data: `adm:item:${mid}`, style: "primary" })],
        ]);
      }
      return;
    }

    if (data.startsWith("adm:set_tonight:")) {
      const mid = Number(data.split(":")[2]);
      for (const [k, m] of Object.entries(cache.media || {})) {
        if (m && Number(m.is_tonight || 0) === 1) await fbPatch(env, `media/${k}`, { is_tonight: 0 });
      }
      await fbPatch(env, `media/${mid}`, { is_tonight: 1 });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✦ تم تثبيت العمل <b>#id${mid}</b> كـ <b>اختيار الليلة</b> بنجاح ✓`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data.startsWith("adm:del_ask:")) {
      const mid = Number(data.split(":")[2]);
      const m = cache.media && cache.media[String(mid)];
      if (!m) return;
      await sendOrEdit(env, chatId, msgId, `⚠️ هل أنت متأكد من حذف <b>${escapeHtml(m.title)}</b> (#id${mid}) مع جميع ملفاته نهائياً؟`, [
        [
          ikb("✅ نعم، احذف نهائياً", { callback_data: `adm:del_go:${mid}`, style: "danger" }),
          ikb("✕ تراجع", { callback_data: "adm:home", style: "primary" }),
        ],
      ]);
      return;
    }

    if (data.startsWith("adm:del_go:")) {
      const mid = Number(data.split(":")[2]);
      if (!hasAdminPerm(env, uid, cache.admins, "can_delete")) {
        await sendOrEdit(env, chatId, msgId, "❌ ليس لديك صلاحية الحذف.", [[ikb("◂ رجوع", { callback_data: "adm:home" })]]);
        return;
      }
      const guard = await checkAntiSabotageDelete(env, uid, cache.admins);
      if (!guard.allowed) {
        await sendOrEdit(env, chatId, msgId, "🚨 تم تجميد إشرافك تلقائياً لتجاوز حد الحذف الأمني!", []);
        return;
      }
      await fbDelete(env, `media/${mid}`);
      for (const [fid, f] of Object.entries(cache.media_files || {})) {
        if (f && Number(f.media_id) === mid) await fbDelete(env, `media_files/${fid}`);
      }
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `🗑️ تم حذف العمل <b>#id${mid}</b> وجميع ملفاته بنجاح.`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:sections_hub") {
      const { items } = buildMediaItems(cache, true, true);
      const { all_sections } = buildSmartSections(cache, items);
      const lines = all_sections.map((s) => `• <b>${escapeHtml(s.title)}</b> — ${s.items_count} عمل (${s.is_enabled ? "مفعّل ✓" : "معطّل ✕"})`).join("\n");
      const rows = all_sections.slice(0, 8).map((s) => [
        ikb(`${s.is_enabled ? "✓" : "✕"} ${s.title} (${s.items_count})`, { callback_data: `adm:sec_tog:${s.section_key}`, style: s.is_enabled ? "success" : "danger" }),
      ]);
      rows.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "primary" })]);
      await sendOrEdit(env, chatId, msgId, `▣ <b>الأقسام الذكية المتقلبة:</b>\n━━━━━━━━━━━━━━\n${lines}`, rows);
      return;
    }

    if (data.startsWith("adm:sec_tog:")) {
      const skey = data.slice("adm:sec_tog:".length);
      const { items } = buildMediaItems(cache, true, true);
      const { all_sections } = buildSmartSections(cache, items);
      const cur = all_sections.find((x) => x.section_key === skey);
      if (cur) {
        await fbPatch(env, `custom_sections/${skey}`, { section_key: skey, is_enabled: cur.is_enabled ? 0 : 1 });
        invalidateEdgeCache();
      }
      await sendOrEdit(env, chatId, msgId, "✅ تم تحديث حالة القسم.", [[ikb("◂ رجوع للأقسام", { callback_data: "adm:sections_hub", style: "primary" })]]);
      return;
    }

    if (data === "adm:collections_hub") {
      const { allCollections } = buildMediaItems(cache, true, true);
      const lines = allCollections.length
        ? allCollections.slice(0, 15).map((c) => `• <b>${escapeHtml(c.name)}</b> — ${c.parts_count} أجزاء (${c.is_active ? "ظاهرة ✓" : "معلقة"})`).join("\n")
        : "لا توجد سلاسل أفلام مكتشفة بعد.";
      await sendOrEdit(env, chatId, msgId, `❖ <b>سلاسل الأفلام الكاملة (${allCollections.length})</b>\n━━━━━━━━━━━━━━\n${lines}`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:users_hub") {
      const ud = computeUsersDashboard(env, cache);
      const sm = ud.summary;
      const topLines = ud.top_pullers.slice(0, 6).map((u, i) => `${i + 1}. <b>${escapeHtml(u.first_name)}</b> (<code>${u.user_id}</code>) — <b>${u.pulls_count}</b> سحبة`).join("\n") || "لا توجد سحبات بعد.";
      await sendOrEdit(
        env, chatId, msgId,
        `◈ <b>إحصائيات المستخدمين والنشاط</b>\n━━━━━━━━━━━━━━\n👤 الإجمالي: <b>${sm.total_users}</b> (+${sm.new_users_today} اليوم)\n📥 السحبات: <b>${sm.total_pulls}</b> (${sm.pulls_today} اليوم)\n🔗 الدعوات: <b>${sm.total_referrals}</b> (${sm.referrals_today} اليوم)\n\n🏆 <b>أعلى من سحب محتوى:</b>\n${topLines}`,
        [
          [ikb(sm.notify_new_users ? "🔔 إشعار الدخول الجديد: مفعّل ✓" : "🔕 إشعار الدخول الجديد: متوقف", { callback_data: "adm:toggle:notify_new_users", style: "primary" })],
          [ikb("👑 منح VIP لمستخدم (بالأيدي)", { callback_data: "adm:grant_vip_ask", style: "success" })],
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "primary" })],
        ]
      );
      return;
    }

    if (data === "adm:grant_vip_ask") {
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "grant_vip" });
      await sendOrEdit(env, chatId, msgId, "👑 أرسل <b>أيدي المستخدم</b> متبوعاً بعدد الأيام (مثال: <code>123456789 30</code> أو <code>123456789 0</code> للإلغاء):", [
        [ikb("✕ إلغاء", { callback_data: "adm:users_hub", style: "danger" })],
      ]);
      return;
    }

    if (data === "adm:broadcast_start") {
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "broadcast_wait" });
      await sendOrEdit(env, chatId, msgId, "📣 <b>الإذاعة الجماعية للمستخدمين:</b>\n\nأرسل الآن الرسالة النصية (أو صورة بكابشن) التي تريد إذاعتها لجميع المستخدمين (سيتم الإرسال على دفعات سريعة وآمنة بواقع 40 مستخدم لكل دفعة):", [
        [ikb("✕ إلغاء", { callback_data: "adm:home", style: "danger" })],
      ]);
      return;
    }

    if (data.startsWith("adm:bc_next:")) {
      const offset = Number(data.split(":")[2] || 0);
      const bc = await fbGet(env, `meta/admin_broadcast/${uid}`);
      if (!bc) return;
      const hiddenSet = new Set(isHiddenAdmin(env, 0) ? [] : []);
      const allUids = Object.keys(asObj(cache.users))
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0 && !isHiddenAdmin(env, n));
      const batch = allUids.slice(offset, offset + 40);
      let okCnt = 0;
      for (const targetUid of batch) {
        const res = bc.photo
          ? await tgCall(env.MAIN_BOT_TOKEN, "sendPhoto", { chat_id: targetUid, photo: bc.photo, caption: bc.text || "", parse_mode: "HTML" })
          : await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", { chat_id: targetUid, text: bc.text || "", parse_mode: "HTML" });
        if (res && res.ok) okCnt++;
      }
      const nextOff = offset + batch.length;
      const kb = nextOff < allUids.length
        ? [[ikb(`▶ متابعة الدفعة التالية (${nextOff}/${allUids.length})`, { callback_data: `adm:bc_next:${nextOff}`, style: "danger" })], [ikb("✕ إيقاف", { callback_data: "adm:home", style: "primary" })]]
        : [[ikb("✅ اكتملت الإذاعة — رجوع للرئيسية", { callback_data: "adm:home", style: "success" })]];
      await sendOrEdit(env, chatId, msgId, `📣 <b>تقدم الإذاعة:</b>\nتم الإرسال في هذه الدفعة لـ <b>${okCnt}</b> مستخدم.\nالإجمالي المعالج: <b>${nextOff} / ${allUids.length}</b>`, kb);
      return;
    }

    if (data === "adm:content_hub") {
      await sendOrEdit(env, chatId, msgId, "▣ <b>إدارة المحتوى والقنوات:</b>", [
        [ikb("⚡ قنوات السحب التلقائي", { callback_data: "adm:auto_hub", style: "danger" })],
        [ikb("📺 المسلسلات الناقصة", { callback_data: "adm:incomplete_hub", style: "primary" }), ikb("🧹 حذف التكرارات", { callback_data: "adm:purge_dups", style: "primary" })],
        [ikb("⟐ فحص القنوات الـ 7", { callback_data: "adm:channels7", style: "success" })],
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home" })],
      ]);
      return;
    }

    if (data === "adm:settings_hub") {
      const s = cache.settings || {};
      const adsOn = getBoolSetting(s, "ads_enabled", false);
      const autoPub = getBoolSetting(s, "auto_publish", true);
      const btnMode = getSetting(s, "channel_post_btn_mode", "webapp");
      await sendOrEdit(
        env, chatId, msgId,
        `❖ <b>الإعدادات والهوية والإعلانات</b>\n━━━━━━━━━━━━━━\n• الإعلانات والمهام: <b>${adsOn ? "مفعّلة ✓" : "متوقفة ✕"}</b>\n• النشر التلقائي بالقنوات: <b>${autoPub ? "مفعّل ✓" : "متوقف ✕"}</b>\n• أزرار منشور القناة: <b>${btnMode === "webapp" ? "التطبيق" : "تحميل مباشر"}</b>\n• الحذف التلقائي: <b>إجباري كل 6 ساعات (Cron) ✓</b>`,
        [
          [ikb(adsOn ? "🔴 إيقاف الإعلانات" : "🟢 تفعيل الإعلانات", { callback_data: "adm:toggle:ads_enabled", style: adsOn ? "danger" : "success" })],
          [ikb(autoPub ? "🔴 إيقاف النشر التلقائي" : "🟢 تفعيل النشر التلقائي", { callback_data: "adm:toggle:auto_publish", style: "primary" })],
          [ikb("🔄 تبديل نمط أزرار القناة", { callback_data: "adm:toggle_btn_mode", style: "primary" })],
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
        ]
      );
      return;
    }

    if (data.startsWith("adm:toggle:")) {
      const key = data.split(":")[2];
      const cur = getBoolSetting(cache.settings, key, false);
      await fbPatch(env, "settings", { [key]: cur ? "0" : "1" });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✅ تم تغيير الإعداد <code>${key}</code> إلى <b>${cur ? "متوقف ✕" : "مفعّل ✓"}</b>.`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:toggle_btn_mode") {
      const cur = getSetting(cache.settings, "channel_post_btn_mode", "webapp");
      const next = cur === "webapp" ? "direct" : "webapp";
      await fbPatch(env, "settings", { channel_post_btn_mode: next });
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, msgId, `✅ تم تغيير أزرار منشور القناة إلى: <b>${next === "webapp" ? "التطبيق" : "تحميل مباشر"}</b>`, [
        [ikb("◂ رجوع للإعدادات", { callback_data: "adm:settings_hub", style: "primary" })],
      ]);
      return;
    }

    if (data === "adm:channels7") {
      const s = cache.settings || {};
      const defs = [
        ["force_sub_channel_id", "1. الاشتراك الإجباري"],
        ["publish_channel_id", "2. النشر العام"],
        ["movies_channel_id", "3. خزن الأفلام"],
        ["series_channel_id", "4. خزن المسلسلات"],
        ["anime_channel_id", "5. خزن الأنمي"],
        ["movies_publish_channel_id", "6. نشر الأفلام"],
        ["series_publish_channel_id", "7. نشر المسلسلات"],
      ];
      const lines = defs.map(([k, lbl]) => `• ${lbl}: <code>${escapeHtml(getSetting(s, k, "غير مضبوط"))}</code>`).join("\n");
      const rows = defs.map(([k, lbl]) => [ikb(`✎ ضبط ${lbl}`, { callback_data: `adm:setch:${k}`, style: "primary" })]);
      rows.push([ikb("🔍 فحص صلاحيات البوتات بالقنوات", { callback_data: "adm:check_ch7", style: "success" })]);
      rows.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home" })]);
      await sendOrEdit(env, chatId, msgId, `⟐ <b>ضبط وفحص القنوات الـ 7:</b>\n━━━━━━━━━━━━━━\n${lines}`, rows);
      return;
    }

    if (data.startsWith("adm:setch:")) {
      const key = data.split(":")[2];
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "set_channel", key });
      await sendOrEdit(env, chatId, msgId, `⟐ أرسل الآن آيدي القناة (<code>-100...</code>) أو اليوزر (<code>@Channel</code>) لحفظه في <code>${key}</code> (أو أرسل <code>0</code> لإزالتها):`, [
        [ikb("✕ إلغاء", { callback_data: "adm:channels7", style: "danger" })],
      ]);
      return;
    }

    if (data === "adm:check_ch7") {
      const s = cache.settings || {};
      const keys = ["force_sub_channel_id", "publish_channel_id", "movies_channel_id", "series_channel_id", "anime_channel_id"];
      const report = [];
      for (const k of keys) {
        const ch = normalizeChatId(getSetting(s, k, ""));
        if (!ch) {
          report.push(`• <code>${k}</code>: غير مضبوط`);
          continue;
        }
        const r = await tgCall(env.ADMIN_BOT_TOKEN, "getChat", { chat_id: ch });
        report.push(`• <code>${ch}</code>: ${r && r.ok ? `✅ متصل (${escapeHtml(r.result.title || "")})` : "❌ غير متصل / البوت ليس مشرفاً"}`);
      }
      await sendOrEdit(env, chatId, msgId, `🔍 <b>نتيجة فحص القنوات:</b>\n━━━━━━━━━━━━━━\n${report.join("\n")}`, [
        [ikb("◂ رجوع للقنوات", { callback_data: "adm:channels7", style: "primary" })],
      ]);
      return;
    }

    if (data === "adm:cover_hub") {
      const b = getBrandConfig(cache.settings);
      await sendOrEdit(
        env, chatId, msgId,
        `▣ <b>الغلاف الموحد للفيديوهات (صفر RAM)</b>\n━━━━━━━━━━━━━━\n• الحالة: <b>${b.cover_enabled ? "مفعّل ✓" : "متوقف ✕"}</b>\n• صورة الغلاف: <b>${b.cover_file_id ? "مرفوعة وجاهزة ✓" : "غير مرفوعة"}</b>`,
        [
          [ikb("🖼️ رفع / تغيير صورة الغلاف", { callback_data: "adm:cover_upload", style: "primary" })],
          [ikb(b.cover_enabled ? "🔴 إيقاف الغلاف" : "🟢 تفعيل الغلاف", { callback_data: "adm:toggle:cover_enabled", style: "success" })],
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home" })],
        ]
      );
      return;
    }

    if (data === "adm:cover_upload") {
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "upload_cover" });
      await sendOrEdit(env, chatId, msgId, "🖼️ أرسل الآن <b>صورة الغلاف</b> الجديدة ليتم حفظها على سيرفرات تيليجرام فوراً:", [
        [ikb("✕ إلغاء", { callback_data: "adm:cover_hub", style: "danger" })],
      ]);
      return;
    }

    if (data === "adm:admins_hub") {
      const adms = getVisibleAdminsList(env, cache);
      const lines = adms.map((a) => `• <b>${escapeHtml(a.first_name)}</b> (<code>${a.user_id}</code>) — ${a.is_owner ? "👑 المالك" : a.is_frozen ? "🧊 مجمد" : "✓ مشرف"}`).join("\n");
      const kb = [];
      if (isOwnerId(env, uid)) kb.push([ikb("＋ إضافة مشرف جديد بالأيدي", { callback_data: "adm:add_admin_ask", style: "danger" })]);
      kb.push([ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })]);
      await sendOrEdit(env, chatId, msgId, `🛡️ <b>قائمة المشرفين (${adms.length})</b>\n━━━━━━━━━━━━━━\n${lines}`, kb);
      return;
    }

    if (data === "adm:add_admin_ask" && isOwnerId(env, uid)) {
      await fbPut(env, `meta/admin_fsm/${uid}`, { mode: "add_admin" });
      await sendOrEdit(env, chatId, msgId, "🛡️ أرسل <b>أيدي المشرف الجديد (Telegram ID)</b> لإضافته فوراً:", [
        [ikb("✕ إلغاء", { callback_data: "adm:admins_hub", style: "danger" })],
      ]);
      return;
    }

    if (data === "adm:sync_fb") {
      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items } = buildMediaItems(fresh, true, true);
      await sendOrEdit(env, chatId, msgId, `✅ <b>تمت المزامنة الفورية مع Firebase!</b>\nالأعمال: <b>${items.length}</b> | الملفات: <b>${Object.keys(fresh.media_files || {}).length}</b> | المستخدمين: <b>${computeUsersMetrics(env, fresh.users).totalUsers}</b>`, [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }

    if (data === "adm:backup_json") {
      const snapshot = {
        exported_at: nowIso(),
        version: APP_VERSION,
        stats: {
          media: Object.keys(cache.media || {}).length,
          media_files: Object.keys(cache.media_files || {}).length,
          users: computeUsersMetrics(env, cache.users).totalUsers,
        },
        settings: cache.settings,
        custom_sections: cache.custom_sections,
        ad_tasks: cache.ad_tasks,
      };
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("caption", `▣ نسخة احتياطية لإعدادات ومنصة فورتكس (${nowIso()})`);
      form.append("document", new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }), `vortex_backup_${Date.now()}.json`);
      await fetch(`https://api.telegram.org/bot${env.ADMIN_BOT_TOKEN}/sendDocument`, { method: "POST", body: form });
      return;
    }

    if (data === "adm:files_audit") {
      const { items } = buildMediaItems(cache, true, true);
      const emptyMedia = items.filter((x) => !(x.files && x.files.length));
      const incSeries = getIncompleteSeries(items);
      await sendOrEdit(
        env, chatId, msgId,
        `◈ <b>تقرير فحص الملفات والأعمال:</b>\n━━━━━━━━━━━━━━\n• إجمالي الأعمال: <b>${items.length}</b>\n• أعمال بدون ملفات: <b>${emptyMedia.length}</b>\n• مسلسلات ناقصة: <b>${incSeries.length}</b>\n• إجمالي الملفات: <b>${Object.keys(cache.media_files || {}).length}</b>`,
        [
          [ikb("🧹 حذف التكرارات تلقائياً", { callback_data: "adm:purge_dups", style: "primary" })],
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
        ]
      );
      return;
    }
    return;
  }

  // ==================== MESSAGES & FSM ====================
  if (!msg) return;
  const text = String(msg.text || "").trim();

  // Bottom Reply Keyboard & Commands
  if (text === "/start" || text === "◈ اللوحة الرئيسية") {
    await fbDelete(env, `meta/admin_fsm/${uid}`);
    const { text: homeTxt, inline_keyboard } = buildAdminHomePayload(env, cache, uid, originUrl);
    await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "⚡ أهلاً بك في لوحة التحكم الكاملة لفورتكس:",
      reply_markup: getAdminReplyKeyboard(),
    });
    await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: homeTxt,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard },
    });
    return;
  }

  if (text === "＋ إضافة عمل جديد" || text === "/add") {
    await sendOrEdit(env, chatId, 0, "＋ <b>إضافة عمل جديد:</b>\nاختر نوع العمل:", [
      [
        ikb("🎬 فيلم", { callback_data: "adm:add_type:movie", style: "danger" }),
        ikb("📺 مسلسل", { callback_data: "adm:add_type:tv", style: "primary" }),
        ikb("⚡ أنمي", { callback_data: "adm:add_type:anime", style: "success" }),
      ],
    ]);
    return;
  }

  if (text === "＋ إضافة حلقات / دقات" || text === "/append") {
    const { items } = buildMediaItems(cache, true, true);
    const rows = items.slice(0, 8).map((it) => [
      ikb(`${it.type_ar}: ${String(it.title).slice(0, 26)} (#id${it.id})`, { callback_data: `adm:append_pick:${it.id}`, style: "primary" }),
    ]);
    await sendOrEdit(env, chatId, 0, "＋ <b>اختر العمل لإضافة حلقات أو دقات له:</b>", rows);
    return;
  }

  if (text === "⚡ الإضافة التلقائية والسحب") {
    await handleAdminBotWebhook(env, { callback_query: { id: "0", from: msg.from, message: { chat: msg.chat, message_id: 0 }, data: "adm:auto_hub" } }, originUrl);
    return;
  }
  if (text === "◈ الطلبات والبلاغات") {
    await handleAdminBotWebhook(env, { callback_query: { id: "0", from: msg.from, message: { chat: msg.chat, message_id: 0 }, data: "adm:reqs_hub" } }, originUrl);
    return;
  }
  if (text === "✎ تعديل أو حذف") {
    await handleAdminBotWebhook(env, { callback_query: { id: "0", from: msg.from, message: { chat: msg.chat, message_id: 0 }, data: "adm:recent:0" } }, originUrl);
    return;
  }
  if (text === "❖ الإعدادات والقنوات") {
    await handleAdminBotWebhook(env, { callback_query: { id: "0", from: msg.from, message: { chat: msg.chat, message_id: 0 }, data: "adm:channels7" } }, originUrl);
    return;
  }
  if (text === "▣ الغلاف والنسخ الاحتياطي" || text === "/cover") {
    await handleAdminBotWebhook(env, { callback_query: { id: "0", from: msg.from, message: { chat: msg.chat, message_id: 0 }, data: "adm:cover_hub" } }, originUrl);
    return;
  }

  const fsm = await fbGet(env, `meta/admin_fsm/${uid}`);

  // Photo upload for Cover or Broadcast
  if (msg.photo && msg.photo.length && fsm) {
    const bestPhoto = msg.photo[msg.photo.length - 1].file_id;
    if (fsm.mode === "upload_cover") {
      await fbPatch(env, "settings", { video_cover_file_id: bestPhoto, cover_enabled: "1" });
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, 0, "✅ تم حفظ صورة الغلاف الموحد للفيديوهات بنجاح (صفر استهلاك RAM)!", [
        [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]);
      return;
    }
    if (fsm.mode === "broadcast_wait") {
      await fbPut(env, `meta/admin_broadcast/${uid}`, { photo: bestPhoto, text: msg.caption || "" });
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      await sendOrEdit(env, chatId, 0, "📣 <b>تم تجهيز الإذاعة بالصورة!</b>\nاضغط أدناه لبدء الإرسال على دفعات سريعة:", [
        [ikb("▶ ابدأ الإرسال الآن (الدفعة الأولى)", { callback_data: "adm:bc_next:0", style: "danger" })],
      ]);
      return;
    }
  }

  // Video / Document Upload (Works in FSM or Direct Drop!)
  const vid = msg.video || msg.document;
  if (vid && vid.file_id) {
    const cap = msg.caption || "";
    const fname = vid.file_name || "";
    const parsed = parseVideoCaption(cap, fname);
    const sizeMb = vid.file_size ? Math.round(vid.file_size / (1024 * 1024)) : 0;
    const mtype = (fsm && fsm.media_type) || parsed.media_type || "movie";
    const targetMediaId = (fsm && fsm.mode === "append_video" && Number(fsm.target_media_id || 0)) || 0;

    let tmdbDetails = null;
    if (!targetMediaId) {
      const results = await searchTmdb(env, cache.settings, `${parsed.title} ${parsed.year}`.trim(), mtype);
      if (results.length) {
        tmdbDetails = await getTmdbDetails(env, cache.settings, results[0].tmdb_id, mtype, results[0].tmdb_endpoint);
      }
    }

    const saved = await saveIngestedVideo(env, cache, {
      fileId: vid.file_id,
      sizeMb,
      chatId,
      messageId: msg.message_id,
      mediaType: mtype,
      tmdbDetails,
      parsed,
      targetMediaId,
      originUrl,
    });

    await sendOrEdit(
      env, chatId, 0,
      `✅ <b>تم حفظ الفيديو بنجاح!</b>\n• العمل: <b>${escapeHtml(saved.title)}</b> (<code>#id${saved.mediaId}</code>)\n• الدقة: <b>${parsed.quality}p</b>${parsed.episode ? ` · م${parsed.season} ح${parsed.episode}` : ""}\n• الحالة: ${saved.createdNew ? "عمل جديد + تم النشر التلقائي ✓" : "أُضيف للعمل الموجود ✓"}`,
      [
        [ikb("🎬 إدارة العمل", { callback_data: `adm:item:${saved.mediaId}`, style: "primary" })],
        [ikb("◈ اللوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
      ]
    );
    return;
  }

  // Text FSM flows
  if (fsm && text) {
    if (fsm.mode === "add_source_channel") {
      let ch = normalizeChatId(text);
      if (msg.forward_from_chat && msg.forward_from_chat.id) ch = String(msg.forward_from_chat.id);
      if (!ch) return;
      const list = getSourceChannels(cache.settings);
      if (!list.some((x) => String(x.id) === ch)) {
        let title = (msg.forward_from_chat && msg.forward_from_chat.title) || ch;
        const info = await tgCall(env.ADMIN_BOT_TOKEN, "getChat", { chat_id: ch });
        if (info && info.ok && info.result && info.result.title) title = info.result.title;
        list.push({ id: ch, title, last_msg_id: 0, added_at: nowIso() });
        await fbPatch(env, "settings", { auto_source_channels: JSON.stringify(list) });
        invalidateEdgeCache();
      }
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      await sendOrEdit(env, chatId, 0, `✅ تمت إضافة قناة السحب <code>${escapeHtml(ch)}</code> بنجاح!`, [
        [ikb("◂ رجوع لقسم السحب", { callback_data: "adm:auto_hub", style: "primary" })],
      ]);
      return;
    }

    if (fsm.mode === "add_video") {
      const mtype = fsm.media_type || "movie";
      const results = await searchTmdb(env, cache.settings, text, mtype);
      if (!results.length) {
        await sendOrEdit(env, chatId, 0, "❌ لم أجد نتائج مطابقة في TMDb. جرّب كتابة الاسم بالإنجليزية أو أرسل الفيديو مباشرة:", [
          [ikb("✕ إلغاء", { callback_data: "adm:home", style: "danger" })],
        ]);
        return;
      }
      const rows = results.map((r) => [
        ikb(`${r.title} (${r.year || "—"})`, { callback_data: `adm:pick_tmdb:${mtype}:${r.tmdb_endpoint}:${r.tmdb_id}`, style: "primary" }),
      ]);
      rows.push([ikb("✕ إلغاء", { callback_data: "adm:home", style: "danger" })]);
      await sendOrEdit(env, chatId, 0, "🔍 <b>اختر العمل المطابق من TMDb:</b>", rows);
      return;
    }

    if (fsm.mode === "set_channel" && fsm.key) {
      const val = text === "0" ? "" : normalizeChatId(text);
      const patch = { [fsm.key]: val };
      if (fsm.key === "force_sub_channel_id" && val.startsWith("@")) {
        patch.force_sub_channel_link = `https://t.me/${val.slice(1)}`;
      }
      await fbPatch(env, "settings", patch);
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      invalidateEdgeCache();
      await sendOrEdit(env, chatId, 0, `✅ تم تحديث <code>${fsm.key}</code> إلى <code>${escapeHtml(val || "مزال")}</code>.`, [
        [ikb("◂ رجوع للقنوات الـ 7", { callback_data: "adm:channels7", style: "primary" })],
      ]);
      return;
    }

    if (fsm.mode === "grant_vip") {
      const [idStr, daysStr] = text.split(/\s+/);
      const targetUid = parseInt(idStr || "0", 10);
      const days = parseInt(daysStr || "30", 10);
      if (targetUid > 0) {
        const until = days > 0 ? Math.floor(Date.now() / 1000) + days * 86400 : 0;
        await fbPatch(env, `users/${targetUid}`, { user_id: targetUid, vip_until: until });
        invalidateEdgeCache();
        await fbDelete(env, `meta/admin_fsm/${uid}`);
        await sendOrEdit(env, chatId, 0, `✅ تم تحديث VIP للمستخدم <code>${targetUid}</code> (${days > 0 ? days + " يوم" : "إلغاء"}).`, [
          [ikb("◂ رجوع للوحة الرئيسية", { callback_data: "adm:home", style: "success" })],
        ]);
      }
      return;
    }

    if (fsm.mode === "add_admin" && isOwnerId(env, uid)) {
      const targetUid = parseInt(text, 10);
      if (targetUid > 0) {
        await fbPut(env, `admins/${targetUid}`, {
          user_id: targetUid,
          role_title: "مشرف",
          is_frozen: 0,
          added_at: nowIso(),
          actions_count: 0,
          permissions: Object.fromEntries(Object.keys(PERM_LABELS).map((k) => [k, 1])),
        });
        invalidateEdgeCache();
        await fbDelete(env, `meta/admin_fsm/${uid}`);
        await sendOrEdit(env, chatId, 0, `✅ تمت إضافة المشرف <code>${targetUid}</code> بنجاح!`, [
          [ikb("◂ رجوع للمشرفين", { callback_data: "adm:admins_hub", style: "primary" })],
        ]);
      }
      return;
    }

    if (fsm.mode === "broadcast_wait") {
      await fbPut(env, `meta/admin_broadcast/${uid}`, { photo: "", text });
      await fbDelete(env, `meta/admin_fsm/${uid}`);
      await sendOrEdit(env, chatId, 0, "📣 <b>تم تجهيز الإذاعة النصية!</b>\nاضغط أدناه لبدء الإرسال على دفعات سريعة:", [
        [ikb("▶ ابدأ الإرسال الآن (الدفعة الأولى)", { callback_data: "adm:bc_next:0", style: "danger" })],
      ]);
      return;
    }
  }
}
