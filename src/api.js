import {
  EDGE_CACHE,
  PERM_LABELS,
  asObj,
  buildMediaItems,
  buildSmartSections,
  checkAntiSabotageDelete,
  computeUsersDashboard,
  computeUsersMetrics,
  ensureUserRecord,
  fbDelete,
  fbGet,
  fbPatch,
  fbPut,
  getAllSectionsConfig,
  getBoolSetting,
  getBrandConfig,
  getIncompleteSeries,
  getSetting,
  getSourceChannels,
  getVisibleAdminsList,
  hasAdminPerm,
  invalidateEdgeCache,
  isOwnerId,
  isUserAdmin,
  loadCoreData,
  nextNumericId,
  normalizeChatId,
  normTitleKey,
  nowIso,
  purgeGlobalDuplicates,
  verifyTelegramInitData,
} from "./db.js";
import {
  checkChannelMembership,
  checkUserSubscription,
  publishMediaToChannels,
  tgCall,
} from "./bots.js";
import { getTmdbDetails, getTmdbSeasonEpisodes, searchTmdb, verifySeriesWithTmdb } from "./tmdb.js";

export function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Init-Data",
      "Cache-Control": "no-store",
    },
  });
}

async function resolveAuthUserId(request, env, fallbackUid = 0) {
  const initData = request.headers.get("X-Telegram-Init-Data") || "";
  if (initData) {
    const verified = await verifyTelegramInitData(initData, [
      env.MAIN_BOT_TOKEN,
      env.ADMIN_BOT_TOKEN,
      env.SENDER_BOT_TOKEN,
    ]);
    if (verified > 0) return verified;
  }
  return parseInt(fallbackUid || 0, 10) || 0;
}

function computeUserRequestQuota(cache, uid) {
  const settings = cache.settings || {};
  const cycle = getSetting(settings, "requests_cycle", "weekly");
  const cycleMax = parseInt(getSetting(settings, "requests_quota_max", "5"), 10) || 5;
  const days = cycle === "daily" ? 1 : cycle === "monthly" ? 30 : 7;
  const cycleAr = cycle === "daily" ? "اليوم" : cycle === "monthly" ? "هذا الشهر" : "هذا الأسبوع";
  const renewAr = cycle === "daily" ? "كل 24 ساعة" : cycle === "monthly" ? "كل 30 يوم" : "كل 7 أيام";

  const cutoff = Date.now() - days * 86400 * 1000;
  const allReqs = Object.values(asObj(cache.media_requests)).filter((r) => r && Number(r.user_id || 0) === Number(uid));
  const usedInCycle = allReqs.filter((r) => {
    const t = Date.parse(String(r.created_at || "").replace(" ", "T") + "Z");
    return !Number.isNaN(t) && t >= cutoff;
  }).length;
  const left = Math.max(0, cycleMax - usedInCycle);

  const userReqs = allReqs
    .slice()
    .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
    .slice(0, 25)
    .map((r) => ({
      ...r,
      status_ar: r.status === "fulfilled" ? "تم النشر ✓" : r.status === "rejected" ? "مرفوض" : "قيد المراجعة ⏳",
    }));

  return {
    quota: {
      cycle,
      cycle_ar: cycleAr,
      renew_ar: renewAr,
      cycle_max: cycleMax,
      cycle_left: left,
      daily_max: cycleMax,
      daily_left: left,
      monthly_max: cycleMax,
      monthly_left: left,
    },
    user_requests: userReqs,
  };
}

export async function handleApiRequest(request, env, url) {
  const path = url.pathname;
  const origin = url.origin;

  if (path === "/api/bootstrap") {
    const cache = await loadCoreData(env);
    const uidParam = parseInt(url.searchParams.get("user_id") || "0", 10);
    const uid = await resolveAuthUserId(request, env, uidParam);
    const firstName = url.searchParams.get("first_name") || "";
    const username = url.searchParams.get("username") || "";
    const mode = url.searchParams.get("mode") || "full";
    const initialLimit = Math.max(12, Math.min(200, parseInt(url.searchParams.get("initial_limit") || "36", 10) || 36));

    if (uid > 0) await ensureUserRecord(env, cache, uid, firstName, username);

    const isAdm = isUserAdmin(env, uid, cache.admins);
    const { items, counts, activeCollections } = buildMediaItems(cache, isAdm, mode === "fast");
    const { smart_sections, all_sections } = buildSmartSections(cache, items);
    const { leaderboard } = computeUsersMetrics(env, cache.users);
    const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, true);

    const uRec = (cache.users && cache.users[String(uid)]) || {};
    const nowSec = Math.floor(Date.now() / 1000);
    const vipUntil = Number(uRec.vip_until || 0);
    const isVip = vipUntil > nowSec || isAdm;
    const vipDaysLeft = vipUntil > nowSec ? Math.ceil((vipUntil - nowSec) / 86400) : 0;
    const rankIdx = leaderboard.findIndex((x) => x.user_id === uid);

    const uListsRaw = (cache.user_lists && cache.user_lists[String(uid)]) || {};
    const userLists = {
      watchlist: Array.isArray(uListsRaw.watchlist) ? uListsRaw.watchlist.map(Number) : [],
      favorites: Array.isArray(uListsRaw.favorites) ? uListsRaw.favorites.map(Number) : [],
      watched: Array.isArray(uListsRaw.watched) ? uListsRaw.watched.map(Number) : [],
    };

    const { quota, user_requests } = computeUserRequestQuota(cache, uid);
    const activeTasks = Object.values(asObj(cache.ad_tasks)).filter((t) => t && Number(t.is_enabled ?? 1) !== 0);
    const adsRawEnabled = getBoolSetting(cache.settings, "ads_enabled", false);

    const sliced = mode === "fast" ? items.slice(0, initialLimit) : items;

    return jsonResp({
      ok: true,
      bot_info: EDGE_CACHE.botInfo,
      brand_config: getBrandConfig(cache.settings),
      subscription: sub,
      ads_config: {
        provider: "vortex_ads",
        enabled: !isVip && adsRawEnabled && activeTasks.length > 0,
        raw_enabled: adsRawEnabled,
        timer_seconds: 15,
        fallback_timer: true,
        tasks: activeTasks,
      },
      vip_config: {
        stars_price: parseInt(getSetting(cache.settings, "vip_stars_price", "50"), 10) || 50,
        points_price: parseInt(getSetting(cache.settings, "vip_points_price", "100"), 10) || 100,
        referral_points: parseInt(getSetting(cache.settings, "referral_points", "20"), 10) || 20,
      },
      profile: {
        user_id: uid,
        first_name: String(uRec.first_name || firstName || "مستخدم فورتكس"),
        points: Number(uRec.points || 0),
        referrals_count: Number(uRec.referrals_count || 0),
        pending_referrals_count: 0,
        is_vip: isVip,
        is_admin: isAdm,
        vip_days_left: vipDaysLeft,
        rank: rankIdx >= 0 ? rankIdx + 1 : 1,
        theme: String(uRec.theme || "vortex"),
      },
      leaderboard,
      request_quota: quota,
      user_requests,
      smart_sections,
      all_sections,
      collections: activeCollections,
      items: sliced,
      total_items: items.length,
      has_more_items: sliced.length < items.length,
      next_offset: sliced.length,
      counts,
      user_lists: userLists,
    });
  }

  if (path === "/api/media/batch") {
    const cache = await loadCoreData(env);
    const uid = await resolveAuthUserId(request, env, url.searchParams.get("user_id"));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
    const limit = Math.max(1, Math.min(120, parseInt(url.searchParams.get("limit") || "60", 10) || 60));
    const isAdm = isUserAdmin(env, uid, cache.admins);
    const { items } = buildMediaItems(cache, isAdm, true);
    const slice = items.slice(offset, offset + limit);
    return jsonResp({
      ok: true,
      items: slice,
      next_offset: offset + slice.length,
      has_more: offset + slice.length < items.length,
      total: items.length,
    });
  }

  if (path.startsWith("/api/media/item/")) {
    const mid = parseInt(path.split("/").pop() || "0", 10);
    const cache = await loadCoreData(env);
    const uid = await resolveAuthUserId(request, env, url.searchParams.get("user_id"));
    const { items } = buildMediaItems(cache, isUserAdmin(env, uid, cache.admins), false);
    const item = items.find((x) => x.id === mid) || null;
    return jsonResp({ ok: Boolean(item), item }, item ? 200 : 404);
  }

  if (path === "/api/check_subscription") {
    const cache = await loadCoreData(env);
    const uid = await resolveAuthUserId(request, env, url.searchParams.get("user_id"));
    const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, false);
    return jsonResp(sub);
  }

  if (path === "/api/user/theme" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    if (uid > 0 && body.theme) {
      await fbPatch(env, `users/${uid}`, { theme: String(body.theme).slice(0, 24) });
    }
    return jsonResp({ ok: true });
  }

  if (path === "/api/user/toggle_list" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const mediaId = Number(body.media_id || 0);
    const listType = ["watchlist", "favorites", "watched"].includes(body.list_type) ? body.list_type : "watchlist";
    if (!uid || !mediaId) return jsonResp({ ok: false }, 400);

    const cache = await loadCoreData(env);
    const cur = (cache.user_lists && cache.user_lists[String(uid)]) || { watchlist: [], favorites: [], watched: [] };
    const arr = Array.isArray(cur[listType]) ? cur[listType].map(Number) : [];
    const idx = arr.indexOf(mediaId);
    let added = false;
    if (listType === "watched") {
      if (idx < 0) {
        arr.push(mediaId);
        added = true;
      }
    } else if (idx >= 0) {
      arr.splice(idx, 1);
      added = false;
    } else {
      arr.push(mediaId);
      added = true;
    }
    const updated = {
      watchlist: Array.isArray(cur.watchlist) ? cur.watchlist.map(Number) : [],
      favorites: Array.isArray(cur.favorites) ? cur.favorites.map(Number) : [],
      watched: Array.isArray(cur.watched) ? cur.watched.map(Number) : [],
      [listType]: arr,
    };
    await fbPut(env, `user_lists/${uid}`, updated);
    if (EDGE_CACHE.user_lists) EDGE_CACHE.user_lists[String(uid)] = updated;
    return jsonResp({ ok: true, added, user_lists: updated });
  }

  if (path === "/api/media/comment" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const mid = Number(body.media_id || 0);
    const text = String(body.text || "").trim().slice(0, 500);
    if (!mid || !text) return jsonResp({ ok: false }, 400);
    const cache = await loadCoreData(env);
    const cid = nextNumericId(cache.comments);
    const comment = {
      id: cid,
      media_id: mid,
      user_id: uid,
      user_name: String(body.user_name || "مستخدم").slice(0, 60),
      stars: Math.max(1, Math.min(5, Number(body.stars || 5))),
      text,
      created_at: nowIso(),
    };
    await fbPut(env, `comments/${cid}`, comment);
    if (EDGE_CACHE.comments) EDGE_CACHE.comments[String(cid)] = comment;
    return jsonResp({ ok: true, comment });
  }

  if (path === "/api/media/share" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const sid = nextNumericId(cache.share_logs);
    const entry = {
      id: sid,
      user_id: uid,
      user_name: String(body.user_name || "مستخدم"),
      media_id: Number(body.media_id || 0),
      media_title: String(body.media_title || ""),
      created_at: nowIso(),
    };
    await fbPut(env, `share_logs/${sid}`, entry);
    return jsonResp({ ok: true });
  }

  if (path === "/api/media/report_detailed" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const rid = nextNumericId(cache.media_reports);
    const rep = {
      id: rid,
      user_id: uid,
      user_name: String(body.user_name || "مستخدم"),
      media_id: Number(body.media_id || 0),
      media_title: String(body.media_title || ""),
      reason_type: String(body.reason_type || "مشكلة عامة"),
      details: String(body.details || "").slice(0, 500),
      status: "pending",
      created_at: nowIso(),
    };
    await fbPut(env, `media_reports/${rid}`, rep);
    invalidateEdgeCache();
    return jsonResp({ ok: true, report: rep });
  }

  if (path === "/api/user/request_media" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const reqText = String(body.request_text || "").trim();
    const prodYear = String(body.prod_year || "").trim();
    const cache = await loadCoreData(env);

    if (!getBoolSetting(cache.settings, "requests_enabled", true)) {
      return jsonResp({ ok: false, message: "استقبال الطلبات مغلق مؤقتاً من قبل الإدارة." }, 403);
    }

    const { items } = buildMediaItems(cache, false, true);
    const rKey = normTitleKey(reqText);
    const existing = items.find((it) => normTitleKey(it.title) === rKey || normTitleKey(it.original_title) === rKey);
    if (existing) {
      return jsonResp({ ok: true, status: "already_exists", existing_media: existing });
    }

    const { quota } = computeUserRequestQuota(cache, uid);
    if (quota.cycle_left <= 0 && !isUserAdmin(env, uid, cache.admins)) {
      return jsonResp({ ok: false, message: `استهلكت رصيد طلباتك (${quota.cycle_max}) لهذا ${quota.cycle_ar}.` }, 429);
    }

    const rid = nextNumericId(cache.media_requests);
    const rec = {
      id: rid,
      user_id: uid,
      user_name: String(body.user_name || "مستخدم"),
      request_text: reqText,
      prod_year: prodYear,
      status: "pending",
      created_at: nowIso(),
    };
    await fbPut(env, `media_requests/${rid}`, rec);
    if (EDGE_CACHE.media_requests) EDGE_CACHE.media_requests[String(rid)] = rec;
    const after = computeUserRequestQuota(EDGE_CACHE, uid);
    return jsonResp({ ok: true, request_quota: after.quota, user_requests: after.user_requests });
  }

  if (path === "/api/vip/create_stars_invoice" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const price = parseInt(getSetting(cache.settings, "vip_stars_price", "50"), 10) || 50;
    const inv = await tgCall(env.MAIN_BOT_TOKEN, "createInvoiceLink", {
      title: "اشتراك فورتكس VIP PRO (شهر كامل)",
      description: "مشاهدة واستلام فوري بدون إعلانات أو انتظار لمدة 30 يوماً.",
      payload: `vip_30d_${uid}_${Date.now()}`,
      currency: "XTR",
      prices: [{ label: "VIP PRO 30 Days", amount: price }],
    });
    if (!inv || !inv.ok || !inv.result) {
      return jsonResp({ ok: false, message: inv?.description || "تعذر إنشاء فاتورة النجوم" }, 400);
    }
    return jsonResp({ ok: true, invoice_link: inv.result });
  }

  if (path === "/api/vip/redeem_points" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const cost = parseInt(getSetting(cache.settings, "vip_points_price", "100"), 10) || 100;
    const uRec = (cache.users && cache.users[String(uid)]) || null;
    if (!uRec || Number(uRec.points || 0) < cost) {
      return jsonResp({ ok: false, message: `رصيدك الحالي غير كافٍ (تحتاج ${cost} نقطة).` }, 400);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const newVipUntil = Math.max(nowSec, Number(uRec.vip_until || 0)) + 30 * 86400;
    const newPts = Number(uRec.points || 0) - cost;
    await fbPatch(env, `users/${uid}`, { points: newPts, vip_until: newVipUntil });
    invalidateEdgeCache();
    return jsonResp({
      ok: true,
      message: "ألف مبروك! تم تفعيل اشتراك PRO لمدة 30 يوماً بالنقاط ✓",
      profile: {
        user_id: uid,
        points: newPts,
        referrals_count: Number(uRec.referrals_count || 0),
        is_vip: true,
        vip_days_left: Math.ceil((newVipUntil - nowSec) / 86400),
      },
    });
  }

  if (path === "/api/leaderboard/set_channel" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const { leaderboard } = computeUsersMetrics(env, cache.users);
    const inTop3 = leaderboard.slice(0, 3).some((x) => x.user_id === uid);
    if (!inTop3) return jsonResp({ ok: false, message: "هذه الميزة متاحة لأول 3 متصدرين فقط." }, 403);
    let chUrl = String(body.channel_url || "").trim();
    if (chUrl.startsWith("@")) chUrl = `https://t.me/${chUrl.slice(1)}`;
    await fbPatch(env, `users/${uid}`, {
      channel_title: String(body.channel_title || "").slice(0, 60),
      channel_url: chUrl.slice(0, 200),
    });
    invalidateEdgeCache();
    const fresh = await loadCoreData(env, true);
    return jsonResp({ ok: true, leaderboard: computeUsersMetrics(env, fresh.users).leaderboard });
  }

  if (path === "/api/ads/check_tasks" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const cache = await loadCoreData(env);
    const adsEnabled = getBoolSetting(cache.settings, "ads_enabled", false);
    const activeTasks = Object.values(asObj(cache.ad_tasks)).filter((t) => t && Number(t.is_enabled ?? 1) !== 0);
    if (!adsEnabled || !activeTasks.length) {
      return jsonResp({ ok: true, ads_enabled: false, tasks: [], all_completed: true });
    }
    const doneMap = asObj(await fbGet(env, `meta/user_ad_tasks/${uid}`));
    const tasksOut = [];
    for (const t of activeTasks) {
      let isDone = Boolean(doneMap[String(t.id)]);
      if (t.task_type === "channel" && t.target_channel_id) {
        isDone = await checkChannelMembership(env.MAIN_BOT_TOKEN, t.target_channel_id, uid);
      }
      tasksOut.push({ ...t, is_completed: isDone });
    }
    return jsonResp({
      ok: true,
      ads_enabled: true,
      tasks: tasksOut,
      all_completed: tasksOut.every((x) => x.is_completed),
    });
  }

  if (path === "/api/ads/complete_task" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const uid = await resolveAuthUserId(request, env, body.user_id);
    const taskId = Number(body.task_id || 0);
    const cache = await loadCoreData(env);
    const task = (cache.ad_tasks && cache.ad_tasks[String(taskId)]) || null;
    if (!task) return jsonResp({ ok: false, verified: false, message: "المهمة غير موجودة" }, 404);

    if (task.task_type === "channel" && task.target_channel_id) {
      const ok = await checkChannelMembership(env.MAIN_BOT_TOKEN, task.target_channel_id, uid);
      if (!ok) {
        return jsonResp({ ok: true, verified: false, message: "لم تشترك في القناة بعد! اشترك أولاً ثم اضغط تحقق." });
      }
    }

    await fbPatch(env, `meta/user_ad_tasks/${uid}`, { [String(taskId)]: nowIso() });
    const newClicks = Number(task.clicks_count || 0) + 1;
    const patch = { clicks_count: newClicks };
    if (Number(task.max_completions || 0) > 0 && newClicks >= Number(task.max_completions)) {
      patch.is_enabled = 0;
    }
    await fbPatch(env, `ad_tasks/${taskId}`, patch);
    invalidateEdgeCache();

    const fresh = await loadCoreData(env, true);
    const activeTasks = Object.values(asObj(fresh.ad_tasks)).filter((t) => t && Number(t.is_enabled ?? 1) !== 0);
    const doneMap = asObj(await fbGet(env, `meta/user_ad_tasks/${uid}`));
    const tasksOut = [];
    for (const t of activeTasks) {
      let isDone = Boolean(doneMap[String(t.id)]);
      if (t.task_type === "channel" && t.target_channel_id) {
        isDone = await checkChannelMembership(env.MAIN_BOT_TOKEN, t.target_channel_id, uid);
      }
      tasksOut.push({ ...t, is_completed: isDone });
    }
    return jsonResp({
      ok: true,
      verified: true,
      tasks: tasksOut,
      all_completed: tasksOut.every((x) => x.is_completed),
    });
  }

  // ==================== ADMIN MINI APP ENDPOINTS ====================
  if (path.startsWith("/api/admin/")) {
    const cache = await loadCoreData(env);
    let body = {};
    if (request.method === "POST") body = await request.json().catch(() => ({}));
    const rawAdmId = body.admin_id || body.user_id || url.searchParams.get("admin_id") || url.searchParams.get("user_id") || 0;
    const adminId = await resolveAuthUserId(request, env, rawAdmId);
    if (!isUserAdmin(env, adminId, cache.admins)) {
      return jsonResp({ ok: false, message: "غير مصرح لك بالوصول" }, 403);
    }

    if (path === "/api/admin/overview") {
      const { items, counts, allCollections } = buildMediaItems(cache, true, true);
      const { all_sections } = buildSmartSections(cache, items);
      const { totalUsers, vipCount } = computeUsersMetrics(env, cache.users);
      const pendingReqsRaw = Object.values(asObj(cache.media_requests)).filter((r) => r && r.status === "pending");
      const reqCounts = {};
      for (const r of pendingReqsRaw) {
        const k = normTitleKey(r.request_text);
        reqCounts[k] = (reqCounts[k] || 0) + 1;
      }
      const pendingRequests = pendingReqsRaw
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
        .map((r) => ({ ...r, requesters_count: reqCounts[normTitleKey(r.request_text)] || 1 }));

      const pendingReports = Object.values(asObj(cache.media_reports))
        .filter((rp) => rp && rp.status === "pending")
        .sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

      const s = cache.settings || {};
      return jsonResp({
        ok: true,
        stats: {
          users: totalUsers,
          vips: vipCount,
          movies: counts.movies,
          series: counts.series,
          anime: counts.anime,
          files: Object.keys(cache.media_files || {}).length,
        },
        pending_requests: pendingRequests,
        pending_reports: pendingReports,
        all_media_admin: items,
        incomplete_series: getIncompleteSeries(items),
        smart_sections: all_sections,
        collections: allCollections,
        users_dashboard: computeUsersDashboard(env, cache),
        admins_list: getVisibleAdminsList(env, cache),
        perm_labels: PERM_LABELS,
        viewer_admin: { user_id: adminId, is_owner: isOwnerId(env, adminId) },
        ad_tasks: Object.values(asObj(cache.ad_tasks)).sort((a, b) => Number(b.id || 0) - Number(a.id || 0)),
        brand_config: getBrandConfig(s),
        firebase_status: "متصل بسحابة Cloudflare + Firebase 24/7 ✓",
        settings: {
          requests_enabled: getBoolSetting(s, "requests_enabled", true),
          requests_cycle: getSetting(s, "requests_cycle", "weekly"),
          requests_quota_max: parseInt(getSetting(s, "requests_quota_max", "5"), 10) || 5,
          ads_enabled: getBoolSetting(s, "ads_enabled", false),
          channel_post_btn_mode: getSetting(s, "channel_post_btn_mode", "webapp"),
          vip_stars_price: parseInt(getSetting(s, "vip_stars_price", "50"), 10) || 50,
          vip_points_price: parseInt(getSetting(s, "vip_points_price", "100"), 10) || 100,
          referral_points: parseInt(getSetting(s, "referral_points", "20"), 10) || 20,
          force_sub_channel_id: getSetting(s, "force_sub_channel_id", ""),
          force_sub_channel_title: getSetting(s, "force_sub_channel_title", "قناة فورتكس العامة"),
          force_sub_channel_link: getSetting(s, "force_sub_channel_link", ""),
          publish_channel_id: getSetting(s, "publish_channel_id", ""),
          movies_channel_id: getSetting(s, "movies_channel_id", ""),
          series_channel_id: getSetting(s, "series_channel_id", ""),
          anime_channel_id: getSetting(s, "anime_channel_id", ""),
          movies_publish_channel_id: getSetting(s, "movies_publish_channel_id", ""),
          series_publish_channel_id: getSetting(s, "series_publish_channel_id", ""),
          anime_publish_channel_id: getSetting(s, "anime_publish_channel_id", ""),
          source_channels: getSourceChannels(s),
        },
      });
    }

    if (path === "/api/admin/user_pulls") {
      const targetUid = parseInt(url.searchParams.get("target_user_id") || "0", 10);
      const u = (cache.users && cache.users[String(targetUid)]) || {};
      const pulls = Object.values(asObj(cache.pull_logs))
        .filter((p) => p && Number(p.user_id || 0) === targetUid)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return jsonResp({
        ok: true,
        user_id: targetUid,
        first_name: String(u.first_name || "مستخدم"),
        username: String(u.username || ""),
        points: Number(u.points || 0),
        referrals_count: Number(u.referrals_count || 0),
        pulls_count: pulls.length,
        pulled_items: pulls.slice(0, 60),
      });
    }

    if (path === "/api/admin/update_settings" && request.method === "POST") {
      const updates = body.updates || {};
      const patch = {};
      for (const [k, v] of Object.entries(updates)) {
        patch[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v ?? "");
      }
      await fbPatch(env, "settings", patch);
      invalidateEdgeCache();
      return jsonResp({ ok: true, message: "تم حفظ الإعدادات بنجاح ✓" });
    }

    if (path === "/api/admin/media_action" && request.method === "POST") {
      const mid = Number(body.media_id || 0);
      const action = String(body.action || "");

      if (action === "purge_duplicates") {
        const { mergedMedia, removedFiles } = await purgeGlobalDuplicates(env);
        return jsonResp({ ok: true, message: `تم دمج ${mergedMedia} عمل مكرر وحذف ${removedFiles} ملف مكرر ✓` });
      }

      if (action === "hide_all_incomplete" || action === "show_all_incomplete") {
        const { items } = buildMediaItems(cache, true, true);
        const inc = getIncompleteSeries(items);
        const hiddenVal = action === "hide_all_incomplete" ? 1 : 0;
        for (const it of inc) {
          await fbPatch(env, `media/${it.id}`, { is_hidden: hiddenVal });
        }
        invalidateEdgeCache();
        return jsonResp({ ok: true, message: `تم تحديث حالة ${inc.length} مسلسل ✓` });
      }

      const cur = cache.media && cache.media[String(mid)];
      if (!cur) return jsonResp({ ok: false, message: "العمل غير موجود" }, 404);

      if (action === "toggle_hidden") {
        const nextVal = Number(cur.is_hidden || 0) === 1 ? 0 : 1;
        await fbPatch(env, `media/${mid}`, { is_hidden: nextVal });
      } else if (action === "set_tonight") {
        for (const [k, m] of Object.entries(cache.media || {})) {
          if (m && Number(m.is_tonight || 0) === 1) await fbPatch(env, `media/${k}`, { is_tonight: 0 });
        }
        await fbPatch(env, `media/${mid}`, { is_tonight: 1 });
      } else if (action === "delete_media") {
        if (!hasAdminPerm(env, adminId, cache.admins, "can_delete")) {
          return jsonResp({ ok: false, message: "ليس لديك صلاحية الحذف" }, 403);
        }
        const guard = await checkAntiSabotageDelete(env, adminId, cache.admins);
        if (!guard.allowed) {
          return jsonResp({ ok: false, message: "تم تجميد حسابك أمنياً لتجاوز حد الحذف!" }, 403);
        }
        await fbDelete(env, `media/${mid}`);
        for (const [fid, f] of Object.entries(cache.media_files || {})) {
          if (f && Number(f.media_id || 0) === mid) await fbDelete(env, `media_files/${fid}`);
        }
      } else if (action === "edit_meta") {
        const patch = {};
        if (body.title !== undefined) patch.title = String(body.title).trim();
        if (body.year !== undefined) patch.year = String(body.year).trim();
        if (body.poster_url !== undefined) patch.poster_url = String(body.poster_url).trim();
        if (body.overview !== undefined) patch.overview = String(body.overview).trim();
        if (body.section_key !== undefined) patch.section_key = String(body.section_key).trim();
        await fbPatch(env, `media/${mid}`, patch);
      } else if (action === "republish_post") {
        const { items } = buildMediaItems(cache, true, false);
        const item = items.find((x) => x.id === mid);
        if (item) await publishMediaToChannels(env, cache, item, origin);
      }

      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items } = buildMediaItems(fresh, true, true);
      return jsonResp({ ok: true, message: "تم تنفيذ الإجراء بنجاح ✓", items });
    }

    if (path === "/api/admin/series_action" && request.method === "POST") {
      const mid = Number(body.media_id || 0);
      const action = String(body.action || "");
      const mRec = cache.media && cache.media[String(mid)];
      if (!mRec) return jsonResp({ ok: false, message: "المسلسل غير موجود" }, 404);

      if (action === "edit_episode") {
        const s = Number(body.season || 1);
        const e = Number(body.episode || 0);
        for (const [fid, f] of Object.entries(cache.media_files || {})) {
          if (f && Number(f.media_id) === mid && Number(f.season || 1) === s && Number(f.episode || 0) === e) {
            const patch = {
              season: Number(body.new_season || s),
              episode: Number(body.new_episode || e),
            };
            if (body.title !== undefined) patch.episode_title = String(body.title).trim();
            if (body.duration_min !== null && body.duration_min !== undefined) patch.duration_mins = Number(body.duration_min) || 0;
            await fbPatch(env, `media_files/${fid}`, patch);
          }
        }
      } else if (action === "delete_episode") {
        const s = Number(body.season || 1);
        const e = Number(body.episode || 0);
        for (const [fid, f] of Object.entries(cache.media_files || {})) {
          if (f && Number(f.media_id) === mid && Number(f.season || 1) === s && Number(f.episode || 0) === e) {
            await fbDelete(env, `media_files/${fid}`);
          }
        }
      } else if (action === "delete_season") {
        const s = Number(body.season || 1);
        for (const [fid, f] of Object.entries(cache.media_files || {})) {
          if (f && Number(f.media_id) === mid && Number(f.season || 1) === s) {
            await fbDelete(env, `media_files/${fid}`);
          }
        }
      } else if (action === "sync_tmdb" || action === "verify_tmdb") {
        let tid = Number(body.tmdb_id || mRec.tmdb_id || 0);
        if (tid > 0 && tid !== Number(mRec.tmdb_id || 0)) {
          await fbPatch(env, `media/${mid}`, { tmdb_id: tid });
        }
        if (action === "sync_tmdb" && tid > 0) {
          const targetSeason = Number(body.season || 0);
          const filesForM = Object.entries(cache.media_files || {}).filter(([, f]) => f && Number(f.media_id) === mid);
          const seasonsSet = new Set(filesForM.map(([, f]) => Number(f.season || 1)));
          for (const sNum of seasonsSet) {
            if (targetSeason > 0 && sNum !== targetSeason) continue;
            const epsMap = await getTmdbSeasonEpisodes(env, cache.settings, tid, sNum);
            for (const [fid, f] of filesForM) {
              if (Number(f.season || 1) !== sNum) continue;
              const eNum = Number(f.episode || 0);
              const info = epsMap[eNum];
              if (!info) continue;
              const patch = {};
              if (info.title && (body.force || !f.episode_title)) patch.episode_title = info.title;
              if (info.runtime_min && (body.force || !f.duration_mins)) patch.duration_mins = info.runtime_min;
              if (Object.keys(patch).length) await fbPatch(env, `media_files/${fid}`, patch);
            }
          }
        }
      }

      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items } = buildMediaItems(fresh, true, false);
      const media = items.find((x) => x.id === mid) || null;
      const verification = media ? await verifySeriesWithTmdb(env, fresh.settings, media) : null;
      return jsonResp({ ok: true, message: "تم التحديث والمزامنة ✓", media, verification });
    }

    if (path === "/api/admin/request_action" && request.method === "POST") {
      const reqId = Number(body.request_id || 0);
      const act = String(body.action || "");
      const rec = cache.media_requests && cache.media_requests[String(reqId)];
      if (!rec) return jsonResp({ ok: false, message: "الطلب غير موجود" }, 404);
      const newStatus = act === "fulfill" ? "fulfilled" : "rejected";
      await fbPatch(env, `media_requests/${reqId}`, { status: newStatus, updated_at: nowIso() });
      if (rec.user_id) {
        const txt = act === "fulfill"
          ? `✅ <b>تمت تلبية طلبك!</b>\nالعمل: <b>${rec.request_text}</b> متوفر الآن في تطبيق فورتكس.`
          : `ℹ️ تعذر توفير طلبك حالياً: <b>${rec.request_text}</b>.`;
        await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", { chat_id: rec.user_id, text: txt, parse_mode: "HTML" });
      }
      invalidateEdgeCache();
      return jsonResp({ ok: true, message: act === "fulfill" ? "تمت التلبية وإشعار المستخدم ✓" : "تم رفض الطلب" });
    }

    if (path === "/api/admin/report_action" && request.method === "POST") {
      const repId = Number(body.report_id || 0);
      await fbPatch(env, `media_reports/${repId}`, { status: "resolved", resolved_at: nowIso() });
      invalidateEdgeCache();
      return jsonResp({ ok: true, message: "تم إغلاق البلاغ ✓" });
    }

    if (path === "/api/admin/section_action" && request.method === "POST") {
      const act = String(body.action || "");
      let skey = String(body.section_key || "").trim();
      if (act === "create_or_update") {
        const title = String(body.title || "").trim();
        if (!title) return jsonResp({ ok: false, message: "اكتب اسم القسم" }, 400);
        if (!skey) skey = `custom_${Date.now().toString(36)}`;
        await fbPut(env, `custom_sections/${skey}`, {
          section_key: skey,
          title,
          subtitle: `أعمال ${title}`,
          media_type_filter: String(body.media_type_filter || "all"),
          auto_country: String(body.auto_country || ""),
          accent_color: "#e11d48",
          is_enabled: 1,
        });
      } else if (act === "toggle" && skey) {
        const all = getAllSectionsConfig(cache);
        const cur = all.find((x) => x.section_key === skey);
        const nextVal = cur && cur.is_enabled ? 0 : 1;
        await fbPatch(env, `custom_sections/${skey}`, { section_key: skey, is_enabled: nextVal });
      } else if (act === "delete" && skey) {
        await fbDelete(env, `custom_sections/${skey}`);
      }
      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items } = buildMediaItems(fresh, true, true);
      const { smart_sections, all_sections } = buildSmartSections(fresh, items);
      return jsonResp({ ok: true, message: "تم تحديث الأقسام ✓", smart_sections, all_sections, items });
    }

    if (path === "/api/admin/collection_action" && request.method === "POST") {
      const act = String(body.action || "");
      if (act === "group" || act === "toggle_force") {
        const mids = Array.isArray(body.media_ids) ? body.media_ids.map(Number) : [];
        const colName = String(body.collection_name || "").trim();
        const forceVal = body.force_active ? 1 : 0;
        for (const mid of mids) {
          const patch = { collection_force_active: forceVal };
          if (colName) patch.collection_name = colName;
          await fbPatch(env, `media/${mid}`, patch);
        }
      } else if (act === "auto_scan") {
        const movies = Object.entries(cache.media || {}).filter(([, m]) => m && m.media_type === "movie" && Number(m.tmdb_id || 0) > 0 && !m.collection_name).slice(0, 12);
        for (const [mid, m] of movies) {
          const det = await getTmdbDetails(env, cache.settings, m.tmdb_id, "movie", "movie");
          if (det && det.collection_id) {
            await fbPatch(env, `media/${mid}`, {
              collection_id: det.collection_id,
              collection_name: det.collection_name,
              collection_poster: det.collection_poster,
              collection_backdrop: det.collection_backdrop,
            });
          }
        }
      }
      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items, activeCollections } = buildMediaItems(fresh, true, true);
      return jsonResp({ ok: true, message: "تم تحديث السلاسل ✓", active_collections: activeCollections, items });
    }

    if (path === "/api/admin/user_action" && request.method === "POST") {
      const targetUid = parseInt(body.target_user_id || 0, 10);
      const act = String(body.action || "");
      const val = parseInt(body.value || 0, 10);
      if (!targetUid) return jsonResp({ ok: false, message: "أيدي غير صالح" }, 400);

      if (act === "grant_vip") {
        const nowSec = Math.floor(Date.now() / 1000);
        const newUntil = val > 0 ? nowSec + val * 86400 : 0;
        await fbPatch(env, `users/${targetUid}`, { user_id: targetUid, vip_until: newUntil });
        invalidateEdgeCache();
        return jsonResp({ ok: true, message: val > 0 ? `تم منح PRO لمدة ${val} يوم ✓` : "تم إلغاء PRO ✓" });
      }
      if (act === "add_points") {
        const cur = (cache.users && cache.users[String(targetUid)]) || {};
        const newPts = Math.max(0, Number(cur.points || 0) + val);
        await fbPatch(env, `users/${targetUid}`, { user_id: targetUid, points: newPts });
        invalidateEdgeCache();
        return jsonResp({ ok: true, message: `تم تحديث النقاط إلى ${newPts} ✓` });
      }
      if (!isOwnerId(env, adminId)) {
        return jsonResp({ ok: false, message: "إدارة المشرفين متاحة للمالك الأساسي فقط" }, 403);
      }
      if (act === "add_admin") {
        const perms = body.perms || Object.fromEntries(Object.keys(PERM_LABELS).map((k) => [k, 1]));
        await fbPut(env, `admins/${targetUid}`, {
          user_id: targetUid,
          role_title: String(body.role_title || "مشرف"),
          is_frozen: 0,
          added_at: nowIso(),
          actions_count: 0,
          permissions: perms,
        });
      } else if (act === "toggle_perm") {
        const pk = String(body.perm_key || "");
        const rec = (cache.admins && cache.admins[String(targetUid)]) || {};
        const perms = { ...(rec.permissions || {}) };
        perms[pk] = Number(perms[pk] ?? 1) ? 0 : 1;
        await fbPatch(env, `admins/${targetUid}`, { permissions: perms });
      } else if (act === "freeze_admin" || act === "unfreeze_admin") {
        await fbPatch(env, `admins/${targetUid}`, { is_frozen: act === "freeze_admin" ? 1 : 0 });
      } else if (act === "remove_admin") {
        await fbDelete(env, `admins/${targetUid}`);
      }
      invalidateEdgeCache();
      return jsonResp({ ok: true, message: "تم تحديث بيانات المشرف ✓" });
    }

    if (path === "/api/admin/ad_task_action" && request.method === "POST") {
      const act = String(body.action || "");
      if (act === "add") {
        const tid = nextNumericId(cache.ad_tasks);
        const chId = normalizeChatId(body.target_channel_id || "");
        let targetUrl = String(body.target_url || "").trim();
        if (!targetUrl && chId.startsWith("@")) targetUrl = `https://t.me/${chId.slice(1)}`;
        await fbPut(env, `ad_tasks/${tid}`, {
          id: tid,
          task_type: String(body.task_type || "channel"),
          title: String(body.title || "مهمة إعلانية"),
          target_channel_id: chId,
          target_url: targetUrl,
          timer_seconds: Number(body.timer_seconds || 10),
          max_completions: Number(body.max_completions || 0),
          clicks_count: 0,
          is_enabled: 1,
          created_at: nowIso(),
        });
        await fbPatch(env, "settings", { ads_enabled: "1" });
      } else if (act === "toggle") {
        const tid = Number(body.task_id || 0);
        const cur = cache.ad_tasks && cache.ad_tasks[String(tid)];
        if (cur) await fbPatch(env, `ad_tasks/${tid}`, { is_enabled: Number(cur.is_enabled ?? 1) ? 0 : 1 });
      } else if (act === "delete") {
        await fbDelete(env, `ad_tasks/${Number(body.task_id || 0)}`);
      }
      invalidateEdgeCache();
      return jsonResp({ ok: true, message: "تم تحديث مهام الإعلانات ✓" });
    }

    if (path === "/api/admin/auto_source_action" && request.method === "POST") {
      const act = String(body.action || "");
      const list = getSourceChannels(cache.settings);
      if (act === "add") {
        const ch = normalizeChatId(body.channel_input || "");
        if (!ch) return jsonResp({ ok: false, message: "معرف قناة غير صالح" }, 400);
        if (!list.some((x) => String(x.id) === ch)) {
          let title = ch;
          const info = await tgCall(env.ADMIN_BOT_TOKEN, "getChat", { chat_id: ch });
          if (info && info.ok && info.result && info.result.title) title = info.result.title;
          list.push({ id: ch, title, last_msg_id: 0, added_at: nowIso() });
          await fbPatch(env, "settings", { auto_source_channels: JSON.stringify(list) });
          invalidateEdgeCache();
        }
        return jsonResp({ ok: true, message: `تمت إضافة قناة السحب (${ch}) ✓` });
      }
      if (act === "delete") {
        const ch = String(body.channel_input || "");
        const filtered = list.filter((x) => String(x.id) !== ch);
        await fbPatch(env, "settings", { auto_source_channels: JSON.stringify(filtered) });
        invalidateEdgeCache();
        return jsonResp({ ok: true, message: "تمت إزالة قناة السحب ✓" });
      }
      return jsonResp({
        ok: true,
        message: "قنوات السحب تعمل بالاستماع الفوري (Live Auto-Ingest) عند نشر أي فيديو جديد فيها ✓",
      });
    }

    if (path === "/api/admin/firebase_action" && request.method === "POST") {
      invalidateEdgeCache();
      const fresh = await loadCoreData(env, true);
      const { items } = buildMediaItems(fresh, true, true);
      return jsonResp({ ok: true, message: `تمت مزامنة ${items.length} عمل مع Firebase بنجاح ✓`, items });
    }

    return jsonResp({ ok: false, message: "مسار إدارة غير معروف" }, 404);
  }

  return null;
}
