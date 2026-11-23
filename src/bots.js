import {
  SECRET_ARCHIVE_CHANNEL_ID,
  EDGE_CACHE,
  asObj,
  buildMediaItems,
  ensureUserRecord,
  escapeHtml,
  fbDelete,
  fbGet,
  fbPatch,
  fbPut,
  getAdminIds,
  getBoolSetting,
  getBrandConfig,
  getSetting,
  invalidateEdgeCache,
  isHiddenAdmin,
  isUserAdmin,
  loadCoreData,
  nextNumericId,
  normalizeChatId,
  normalizeQuality,
  normTitleKey,
  nowIso,
  scheduleSixHourDeletion,
} from "./db.js";

export async function tgCall(token, method, payload = {}) {
  if (!token) return { ok: false, description: "Missing bot token" };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

export function ikb(text, opts = {}) {
  const btn = { text };
  if (opts.callback_data) btn.callback_data = opts.callback_data;
  if (opts.url) btn.url = opts.url;
  if (opts.web_app) btn.web_app = opts.web_app;
  if (opts.style) btn.style = opts.style;
  return btn;
}

export function rkb(text, opts = {}) {
  const btn = { text };
  if (opts.web_app) btn.web_app = opts.web_app;
  if (opts.style) btn.style = opts.style;
  return btn;
}

export async function checkChannelMembership(token, channelId, uid) {
  const ch = normalizeChatId(channelId);
  if (!ch || !uid || !token) return true;
  const res = await tgCall(token, "getChatMember", { chat_id: ch, user_id: Number(uid) });
  if (!res || !res.ok || !res.result) return true;
  const status = String(res.result.status || "");
  return ["creator", "administrator", "member", "restricted"].includes(status);
}

export async function checkUserSubscription(env, settings, uid, adminsMap, allowAnon = false) {
  const chId = normalizeChatId(getSetting(settings, "force_sub_channel_id", ""));
  const chTitle = getSetting(settings, "force_sub_channel_title", "قناة فورتكس العامة");
  let chLink = getSetting(settings, "force_sub_channel_link", "");
  if (!chLink && chId.startsWith("@")) chLink = `https://t.me/${chId.slice(1)}`;
  if (!chId) return { is_subscribed: true, channel_link: chLink, channel_title: chTitle };
  if (!uid) return { is_subscribed: allowAnon, channel_link: chLink, channel_title: chTitle };
  if (isUserAdmin(env, uid, adminsMap)) return { is_subscribed: true, channel_link: chLink, channel_title: chTitle };
  const ok = await checkChannelMembership(env.MAIN_BOT_TOKEN, chId, uid);
  return { is_subscribed: ok, channel_link: chLink, channel_title: chTitle };
}

export async function publishMediaToChannels(env, cache, mediaItem, originUrl) {
  const settings = cache.settings || {};
  const brand = getBrandConfig(settings);
  const webappUrl = getSetting(settings, "webapp_url", originUrl) || originUrl;
  const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";
  const senderBot = EDGE_CACHE.botInfo.sender_username || "Vortexeeserver_Bot";
  const btnMode = getSetting(settings, "channel_post_btn_mode", "webapp");

  const targets = new Set();
  const mainPub = normalizeChatId(getSetting(settings, "publish_channel_id", ""));
  if (mainPub) targets.add(mainPub);
  if (mediaItem.media_type === "movie") {
    const mp = normalizeChatId(getSetting(settings, "movies_publish_channel_id", ""));
    if (mp) targets.add(mp);
  } else if (mediaItem.media_type === "tv") {
    const sp = normalizeChatId(getSetting(settings, "series_publish_channel_id", ""));
    if (sp) targets.add(sp);
  } else if (mediaItem.media_type === "anime") {
    const ap = normalizeChatId(getSetting(settings, "anime_publish_channel_id", ""));
    if (ap) targets.add(ap);
  }

  if (!targets.size) return { ok: false, count: 0 };

  const genresStr = (mediaItem.genres || []).join(" · ") || "دراما";
  const caption = (
    `🎬 <b>${escapeHtml(mediaItem.title)}</b> (${escapeHtml(mediaItem.year || "—")})\n` +
    (mediaItem.original_title && mediaItem.original_title !== mediaItem.title ? `<i>${escapeHtml(mediaItem.original_title)}</i>\n` : "") +
    `━━━━━━━━━━━━━━\n` +
    `★ التقييم: <b>${mediaItem.rating || 0}</b>  |  🎭 ${escapeHtml(genresStr)}\n` +
    `🌍 ${escapeHtml(mediaItem.country || "—")}  |  ◷ ${escapeHtml(mediaItem.duration || "—")}\n\n` +
    `📖 ${escapeHtml(String(mediaItem.overview || "").slice(0, 320))}\n\n` +
    `✦ عبر منصة <b>${escapeHtml(brand.app_name_ar)}</b>`
  );

  const inline_keyboard = [];
  if (btnMode === "direct" && mediaItem.media_type === "movie" && (mediaItem.files || []).length) {
    const row = (mediaItem.files || []).slice(0, 3).map((f) =>
      ikb(`📥 ${f.quality === "2160" ? "4K" : f.quality + "p"}`, {
        url: `https://t.me/${senderBot}?start=file_${f.id}`,
        style: "primary",
      })
    );
    inline_keyboard.push(row);
  }
  inline_keyboard.push([
    ikb("🎬 مشاهدة وتحميل الآن", { url: `https://t.me/${mainBot}?start=watch_${mediaItem.id}`, style: "danger" }),
  ]);

  let sentCount = 0;
  let lastMsgId = 0;
  for (const ch of targets) {
    let res;
    if (mediaItem.poster_url) {
      res = await tgCall(env.MAIN_BOT_TOKEN, "sendPhoto", {
        chat_id: ch,
        photo: mediaItem.poster_url,
        caption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard },
      });
    } else {
      res = await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
        chat_id: ch,
        text: caption,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard },
      });
    }
    if (res && res.ok && res.result) {
      sentCount++;
      lastMsgId = res.result.message_id || lastMsgId;
    }
  }
  if (lastMsgId) {
    await fbPatch(env, `media/${mediaItem.id}`, { channel_msg_id: lastMsgId });
  }
  return { ok: sentCount > 0, count: sentCount };
}

export async function autoFulfillMatchingRequests(env, cache, mediaItem) {
  const reqsMap = asObj(cache.media_requests);
  const tKey1 = normTitleKey(mediaItem.title);
  const tKey2 = normTitleKey(mediaItem.original_title);
  const mYear = parseInt(String(mediaItem.year || "0").slice(0, 4), 10) || 0;
  const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";
  let fulfilled = 0;

  for (const [rid, r] of Object.entries(reqsMap)) {
    if (!r || r.status !== "pending") continue;
    const rKey = normTitleKey(r.request_text);
    if (!rKey) continue;
    const titleMatches = (rKey === tKey1 || rKey === tKey2 || (rKey.length >= 4 && (tKey1.includes(rKey) || tKey2.includes(rKey))));
    if (!titleMatches) continue;
    const rYear = parseInt(String(r.prod_year || "0").slice(0, 4), 10) || 0;
    if (mYear && rYear && Math.abs(mYear - rYear) > 1) continue;

    await fbPatch(env, `media_requests/${rid}`, {
      status: "fulfilled",
      fulfilled_media_id: mediaItem.id,
      fulfilled_at: nowIso(),
    });
    fulfilled++;

    const uid = Number(r.user_id || 0);
    if (uid) {
      const cap = (
        `✅ <b>تم نشر طلبك بنجاح!</b>\n\n` +
        `🎬 <b>${escapeHtml(mediaItem.title)}</b> (${escapeHtml(mediaItem.year || "")})\n` +
        `★ التقييم: <b>${mediaItem.rating || 0}</b>\n\n` +
        `اضغط على الزر أدناه للمشاهدة والتحميل فوراً:`
      );
      const kb = [[ikb("🎬 شاهد الآن", { url: `https://t.me/${mainBot}?start=watch_${mediaItem.id}`, style: "danger" })]];
      if (mediaItem.poster_url) {
        await tgCall(env.MAIN_BOT_TOKEN, "sendPhoto", {
          chat_id: uid,
          photo: mediaItem.poster_url,
          caption: cap,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: kb },
        });
      } else {
        await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
          chat_id: uid,
          text: cap,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: kb },
        });
      }
    }
  }
  return fulfilled;
}

export async function creditPendingReferralIfSubscribed(env, cache, uid) {
  const usersMap = asObj(cache.users);
  const u = usersMap[String(uid)];
  if (!u || !u.pending_referrer_id || u.referral_credited) return;
  const sub = await checkUserSubscription(env, cache.settings, uid, cache.admins, false);
  if (!sub.is_subscribed) return;
  const refId = parseInt(u.pending_referrer_id, 10);
  if (!refId || refId === Number(uid)) return;
  const refPoints = parseInt(getSetting(cache.settings, "referral_points", "20"), 10) || 20;
  const refUser = usersMap[String(refId)] || { user_id: refId, points: 0, referrals_count: 0 };
  const newPts = Number(refUser.points || 0) + refPoints;
  const newRefs = Number(refUser.referrals_count || 0) + 1;
  await Promise.all([
    fbPatch(env, `users/${uid}`, { referred_by: refId, referral_credited: 1, pending_referrer_id: 0 }),
    fbPatch(env, `users/${refId}`, { points: newPts, referrals_count: newRefs }),
  ]);
  await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
    chat_id: refId,
    text: `🎉 <b>دعوة ناجحة!</b>\nاشترك صديقك <b>${escapeHtml(u.first_name || "مستخدم")}</b> بالقناة وتمت إضافة <b>+${refPoints} نقطة</b> لرصيدك!\nرصيدك الحالي: <b>${newPts} نقطة</b>.`,
    parse_mode: "HTML",
  });
  invalidateEdgeCache();
}

function getMainReplyKeyboard(webappUrl, uid) {
  return {
    keyboard: [
      [rkb("🎬 فتح تطبيق فورتكس", { web_app: { url: `${webappUrl}?uid=${uid}` }, style: "danger" })],
      [rkb("📋 طلباتي", { style: "primary" }), rkb("🏆 نقاطي ودعواتي", { style: "primary" })],
      [rkb("👑 اشتراك VIP PRO", { style: "success" })],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export async function handleMainBotWebhook(env, update, originUrl) {
  const cache = await loadCoreData(env);
  const settings = cache.settings || {};
  const brand = getBrandConfig(settings);
  const webappUrl = getSetting(settings, "webapp_url", originUrl) || originUrl;
  const senderBot = EDGE_CACHE.botInfo.sender_username || "Vortexeeserver_Bot";
  const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";

  // Telegram Stars Pre-Checkout Query
  if (update.pre_checkout_query) {
    await tgCall(env.MAIN_BOT_TOKEN, "answerPreCheckoutQuery", {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true,
    });
    return;
  }

  const msg = update.message;
  const cb = update.callback_query;

  // Successful Telegram Stars VIP Payment
  if (msg && msg.successful_payment) {
    const uid = msg.from.id;
    const nowSec = Math.floor(Date.now() / 1000);
    const uRec = (cache.users && cache.users[String(uid)]) || {};
    const baseExp = Math.max(nowSec, Number(uRec.vip_until || 0));
    const newVipUntil = baseExp + 30 * 86400;
    await fbPatch(env, `users/${uid}`, { vip_until: newVipUntil });
    invalidateEdgeCache();
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `👑 <b>ألف مبروك! تم تفعيل اشتراك VIP PRO لمدة 30 يوماً بنجاح!</b>\nاستمتع بالاستلام الفوري بدون إعلانات أو انتظار.`,
      parse_mode: "HTML",
    });
    return;
  }

  if (cb) {
    const uid = cb.from.id;
    const data = String(cb.data || "");
    await tgCall(env.MAIN_BOT_TOKEN, "answerCallbackQuery", { callback_query_id: cb.id });

    if (data.startsWith("watch_season:")) {
      const [, midStr, sStr] = data.split(":");
      const { items } = buildMediaItems(cache, false, true);
      const item = items.find((x) => x.id === Number(midStr));
      if (!item) return;
      const sNum = Number(sStr || 1);
      const eps = (item.files || []).filter((f) => Number(f.season || 1) === sNum);
      const epRows = [];
      for (let i = 0; i < eps.length; i += 2) {
        const chunk = eps.slice(i, i + 2).map((f) =>
          ikb(`ح${f.episode || i + 1} (${f.quality === "2160" ? "4K" : f.quality + "p"})`, {
            url: `https://t.me/${senderBot}?start=file_${f.id}`,
            style: "primary",
          })
        );
        epRows.push(chunk);
      }
      epRows.push([ikb("🎬 فتح بالتطبيق", { web_app: { url: `${webappUrl}?media_id=${item.id}&uid=${uid}` }, style: "danger" })]);
      await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
        chat_id: cb.message.chat.id,
        text: `📺 <b>${escapeHtml(item.title)} — الموسم ${sNum}</b>\nاختر الحلقة المطلوبة:`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: epRows },
      });
      return;
    }

    if (data === "main_verify_sub") {
      const sub = await checkUserSubscription(env, settings, uid, cache.admins, false);
      if (sub.is_subscribed) {
        await creditPendingReferralIfSubscribed(env, cache, uid);
        await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
          chat_id: cb.message.chat.id,
          text: `✅ <b>تم التحقق من اشتراكك بنجاح!</b>\nأهلاً بك في <b>${escapeHtml(brand.app_name_ar)}</b>.`,
          parse_mode: "HTML",
          reply_markup: getMainReplyKeyboard(webappUrl, uid),
        });
      } else {
        await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
          chat_id: cb.message.chat.id,
          text: "⚠️ لم تشترك في القناة بعد! اشترك أولاً ثم اضغط تحقق.",
        });
      }
      return;
    }
    return;
  }

  if (!msg || !msg.from) return;
  const uid = msg.from.id;
  const { user: uRec, isNew } = await ensureUserRecord(env, cache, uid, msg.from.first_name || "", msg.from.username || "");

  if (isNew && !isHiddenAdmin(env, uid) && getBoolSetting(settings, "notify_new_users", true)) {
    const owners = getAdminIds(env);
    for (const oid of owners) {
      await tgCall(env.ADMIN_BOT_TOKEN, "sendMessage", {
        chat_id: oid,
        text: `👤 <b>مستخدم جديد دخل البوت!</b>\nالاسم: <b>${escapeHtml(msg.from.first_name || "مستخدم")}</b>\nاليوزر: ${msg.from.username ? "@" + escapeHtml(msg.from.username) : "—"}\nالأيدي: <code>${uid}</code>`,
        parse_mode: "HTML",
      });
    }
  }

  const text = String(msg.text || "").trim();

  if (text.startsWith("/start")) {
    const param = text.split(/\s+/)[1] || "";

    if (param.startsWith("ref_")) {
      const refId = parseInt(param.slice(4), 10);
      if (refId && refId !== uid && uRec && !uRec.referred_by && !uRec.pending_referrer_id) {
        await fbPatch(env, `users/${uid}`, { pending_referrer_id: refId });
        if (EDGE_CACHE.users && EDGE_CACHE.users[String(uid)]) {
          EDGE_CACHE.users[String(uid)].pending_referrer_id = refId;
        }
      }
    }

    const sub = await checkUserSubscription(env, settings, uid, cache.admins, false);
    if (!sub.is_subscribed) {
      const subKb = [];
      if (sub.channel_link) subKb.push([ikb("📢 اشترك في القناة أولاً", { url: sub.channel_link, style: "danger" })]);
      subKb.push([ikb("✅ اشتركت — تحقق الآن", { callback_data: "main_verify_sub", style: "success" })]);
      await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: `🔒 <b>الاشتراك الإجباري</b>\n\nلفتح مكتبة <b>${escapeHtml(brand.app_name_ar)}</b> واستلام الأفلام والمسلسلات مجاناً، اشترك في قناتنا الرسمية:\n<b>${escapeHtml(sub.channel_title)}</b>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: subKb },
      });
      return;
    }

    await creditPendingReferralIfSubscribed(env, cache, uid);

    if (param.startsWith("file_")) {
      const fid = param.slice(5);
      await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
        chat_id: msg.chat.id,
        text: "📥 اضغط الزر أدناه لاستلام الملف من بوت الإرسال:",
        reply_markup: {
          inline_keyboard: [[ikb("⚡ استلام الفيديو الآن", { url: `https://t.me/${senderBot}?start=file_${fid}`, style: "danger" })]],
        },
      });
      return;
    }

    if (param.startsWith("watch_") || param.startsWith("media_")) {
      const mid = parseInt(param.split("_")[1], 10);
      const { items } = buildMediaItems(cache, false, true);
      const item = items.find((x) => x.id === mid);
      if (item) {
        const rows = [];
        if (item.media_type === "movie") {
          const qBtns = (item.files || []).slice(0, 4).map((f) =>
            ikb(`📥 ${f.quality === "2160" ? "4K" : f.quality + "p"}`, {
              url: `https://t.me/${senderBot}?start=file_${f.id}`,
              style: "primary",
            })
          );
          if (qBtns.length) rows.push(qBtns);
        } else {
          const seasons = Array.from(new Set((item.files || []).map((f) => Number(f.season || 1)))).sort((a, b) => a - b);
          const sBtns = seasons.slice(0, 4).map((s) =>
            ikb(`📺 الموسم ${s}`, { callback_data: `watch_season:${item.id}:${s}`, style: "primary" })
          );
          if (sBtns.length) rows.push(sBtns);
        }
        rows.push([ikb("🎬 فتح بالتطبيق", { web_app: { url: `${webappUrl}?media_id=${item.id}&uid=${uid}` }, style: "danger" })]);
        const cap = `🎬 <b>${escapeHtml(item.title)}</b> (${escapeHtml(item.year || "")})\n★ التقييم: <b>${item.rating}</b> · ${escapeHtml(item.type_ar)}\n\n${escapeHtml(String(item.overview || "").slice(0, 350))}`;
        if (item.poster_url) {
          await tgCall(env.MAIN_BOT_TOKEN, "sendPhoto", {
            chat_id: msg.chat.id,
            photo: item.poster_url,
            caption: cap,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
          });
        } else {
          await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
            chat_id: msg.chat.id,
            text: cap,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
          });
        }
        return;
      }
    }

    const welcomeText = (
      `🎬 <b>أهلاً بك في ${escapeHtml(brand.app_name_ar)} | ${escapeHtml(brand.app_name_en)}</b>\n` +
      `━━━━━━━━━━━━━━\n` +
      `${escapeHtml(brand.app_tagline)}\n\n` +
      `اضغط الزر أدناه لفتح المكتبة الكاملة للأفلام والمسلسلات والأنمي المترجمة بأعلى دقة:`
    );
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: welcomeText,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [ikb(`🎬 فتح تطبيق ${brand.app_name_ar}`, { web_app: { url: `${webappUrl}?uid=${uid}` }, style: "danger" })],
          [ikb("📢 القناة الرسمية", { url: sub.channel_link || "https://t.me/Vortexeo", style: "primary" })],
        ],
      },
    });
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: "▾ استخدم القائمة السفلية للتنقل السريع:",
      reply_markup: getMainReplyKeyboard(webappUrl, uid),
    });
    return;
  }

  if (text.includes("طلباتي")) {
    const reqs = Object.values(asObj(cache.media_requests))
      .filter((r) => Number(r.user_id || 0) === uid)
      .slice(-10)
      .reverse();
    const lines = reqs.length
      ? reqs.map((r) => `• <b>${escapeHtml(r.request_text)}</b> (${escapeHtml(r.prod_year || "")}) — ${r.status === "fulfilled" ? "✅ تم النشر" : r.status === "rejected" ? "❌ مرفوض" : "⏳ قيد المراجعة"}`).join("\n")
      : "لا توجد طلبات مسجلة لك حتى الآن.";
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `📋 <b>سجل طلباتك الأخيرة:</b>\n\n${lines}`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[ikb("＋ إرسال طلب جديد بالتطبيق", { web_app: { url: `${webappUrl}?open_requests=1&uid=${uid}` }, style: "primary" })]],
      },
    });
    return;
  }

  if (text.includes("نقاطي")) {
    const pts = Number((uRec && uRec.points) || 0);
    const refs = Number((uRec && uRec.referrals_count) || 0);
    const refLink = `https://t.me/${mainBot}?start=ref_${uid}`;
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `🏆 <b>رصيدك ودعواتك:</b>\n\n✦ النقاط: <b>${pts}</b>\n👥 الدعوات الناجحة: <b>${refs}</b>\n\n🔗 <b>رابط دعوتك الخاص:</b>\n<code>${refLink}</code>\n\nشارك الرابط مع أصدقائك واحصل على نقاط مجانية تفتح لك اشتراك PRO!`,
      parse_mode: "HTML",
    });
    return;
  }

  if (text.includes("VIP")) {
    const nowSec = Math.floor(Date.now() / 1000);
    const vipUntil = Number((uRec && uRec.vip_until) || 0);
    const daysLeft = vipUntil > nowSec ? Math.ceil((vipUntil - nowSec) / 86400) : 0;
    const starsPrice = getSetting(settings, "vip_stars_price", "50");
    const ptsPrice = getSetting(settings, "vip_points_price", "100");
    await tgCall(env.MAIN_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: `👑 <b>عضوية VIP PRO</b>\n\nحالتك: <b>${daysLeft > 0 ? `مشترك PRO (${daysLeft} يوم متبقي)` : "الخطة المجانية"}</b>\n\n✦ استلام فوري بدون إعلانات أو انتظار\n✦ سعر الاشتراك: <b>${starsPrice} نجمة ★</b> أو <b>${ptsPrice} نقطة</b>\n\nافتح تبويب <b>حسابي</b> داخل التطبيق للتفعيل الفوري:`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[ikb("👑 تفعيل VIP PRO بالتطبيق", { web_app: { url: `${webappUrl}?uid=${uid}` }, style: "danger" })]],
      },
    });
  }
}

export async function deliverFileViaSender(env, cache, chatId, uid, fileId, originUrl) {
  const settings = cache.settings || {};
  const filesMap = asObj(cache.media_files);
  const fRec = filesMap[String(fileId)];
  if (!fRec) {
    await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "❌ عذراً، هذا الملف غير موجود أو تم حذفه.",
    });
    return;
  }

  const isAdm = isUserAdmin(env, uid, cache.admins);
  const uRec = (cache.users && cache.users[String(uid)]) || {};
  const isVip = Number(uRec.vip_until || 0) > Math.floor(Date.now() / 1000);

  if (!isAdm) {
    const sub = await checkUserSubscription(env, settings, uid, cache.admins, false);
    if (!sub.is_subscribed) {
      const kb = [];
      if (sub.channel_link) kb.push([ikb("📢 اشترك في القناة أولاً", { url: sub.channel_link, style: "danger" })]);
      kb.push([ikb("🔄 أعد محاولة الاستلام", { url: `https://t.me/${EDGE_CACHE.botInfo.sender_username}?start=file_${fileId}`, style: "success" })]);
      await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: `🔒 اشترك في <b>${escapeHtml(sub.channel_title)}</b> أولاً لاستلام الفيديو مجاناً:`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: kb },
      });
      return;
    }

    if (!isVip && getBoolSetting(settings, "ads_enabled", false)) {
      const tasks = Object.values(asObj(cache.ad_tasks)).filter((t) => t && Number(t.is_enabled ?? 1) !== 0 && t.task_type === "channel");
      for (const t of tasks) {
        if (t.target_channel_id) {
          const ok = await checkChannelMembership(env.MAIN_BOT_TOKEN, t.target_channel_id, uid);
          if (!ok) {
            await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
              chat_id: chatId,
              text: `🔒 <b>مهمة مطلوبة لفتح الفيديو:</b>\nاشترك في <b>${escapeHtml(t.title || "قناة الراعي")}</b> ثم اضغط إعادة المحاولة:`,
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [ikb("📢 الاشتراك بالقناة", { url: t.target_url || "https://t.me/Vortexeo", style: "danger" })],
                  [ikb("✅ اشتركت — أرسل الفيديو", { url: `https://t.me/${EDGE_CACHE.botInfo.sender_username}?start=file_${fileId}`, style: "success" })],
                ],
              },
            });
            return;
          }
        }
      }
    }
  }

  const mRec = (cache.media && cache.media[String(fRec.media_id)]) || {};
  const title = String(mRec.title || "عمل فورتكس");
  const q = normalizeQuality(fRec.quality || "720");
  const qDisp = q === "2160" ? "4K" : `${q}p`;
  const epLine = Number(fRec.episode || 0) > 0 ? `\n📺 الموسم ${fRec.season || 1} · الحلقة ${fRec.episode}` : "";
  const brand = getBrandConfig(settings);
  const webappUrl = getSetting(settings, "webapp_url", originUrl) || originUrl;
  const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";
  const chLink = getSetting(settings, "force_sub_channel_link", "https://t.me/Vortexeo") || "https://t.me/Vortexeo";

  const caption = (
    `🎬 <b>${escapeHtml(title)}</b>${epLine}\n` +
    `✦ الدقة: <b>${qDisp}</b>\n\n` +
    `⏳ <i>ملاحظة: سيتم حذف هذه الرسالة تلقائياً بعد 6 ساعات لتخفيف الحمل على السيرفر (يمكنك إعادة استلامها بأي وقت).</i>`
  );

  const reply_markup = {
    inline_keyboard: [
      [ikb(`🎬 فتح في ${brand.app_name_ar}`, { url: `https://t.me/${mainBot}?start=watch_${fRec.media_id}`, style: "danger" })],
      [ikb("📢 القناة الرسمية", { url: chLink, style: "primary" })],
    ],
  };

  const srcChat = normalizeChatId(fRec.storage_chat_id || fRec.storage_channel_id || "");
  const srcMsg = Number(fRec.storage_message_id || fRec.storage_msg_id || 0);
  const secMsg = Number(fRec.secret_message_id || fRec.secret_msg_id || 0);
  const rawFileId = String(fRec.video_file_id || fRec.file_id || "");

  let sentRes = null;

  // 1) Direct copyMessage from storage channel via Sender Bot
  if (srcChat && srcMsg > 0) {
    sentRes = await tgCall(env.SENDER_BOT_TOKEN, "copyMessage", {
      chat_id: chatId,
      from_chat_id: srcChat,
      message_id: srcMsg,
      caption,
      parse_mode: "HTML",
      reply_markup,
    });
  }

  // 2) Fallback: copyMessage from silent secret archive channel
  if ((!sentRes || !sentRes.ok) && secMsg > 0) {
    sentRes = await tgCall(env.SENDER_BOT_TOKEN, "copyMessage", {
      chat_id: chatId,
      from_chat_id: Number(SECRET_ARCHIVE_CHANNEL_ID),
      message_id: secMsg,
      caption,
      parse_mode: "HTML",
      reply_markup,
    });
  }

  // 3) Fallback: direct sendVideo / sendDocument with video_file_id + unified cover
  if ((!sentRes || !sentRes.ok) && rawFileId) {
    const payload = {
      chat_id: chatId,
      video: rawFileId,
      caption,
      parse_mode: "HTML",
      supports_streaming: true,
      reply_markup,
    };
    if (brand.cover_enabled && brand.cover_file_id) {
      payload.cover = brand.cover_file_id;
    }
    sentRes = await tgCall(env.SENDER_BOT_TOKEN, "sendVideo", payload);
    if (!sentRes || !sentRes.ok) {
      sentRes = await tgCall(env.SENDER_BOT_TOKEN, "sendDocument", {
        chat_id: chatId,
        document: rawFileId,
        caption,
        parse_mode: "HTML",
        reply_markup,
      });
    }
  }

  // 4) Fallback: Multi-Bot Relay (Admin Bot / Main Bot -> Secret Archive -> Sender Bot)
  if ((!sentRes || !sentRes.ok) && srcChat && srcMsg > 0) {
    for (const helperTok of [env.ADMIN_BOT_TOKEN, env.MAIN_BOT_TOKEN]) {
      const relayed = await tgCall(helperTok, "copyMessage", {
        chat_id: Number(SECRET_ARCHIVE_CHANNEL_ID),
        from_chat_id: srcChat,
        message_id: srcMsg,
      });
      if (relayed && relayed.ok && relayed.result && relayed.result.message_id) {
        const newSecId = relayed.result.message_id;
        await fbPatch(env, `media_files/${fileId}`, { secret_message_id: newSecId, secret_msg_id: newSecId });
        sentRes = await tgCall(env.SENDER_BOT_TOKEN, "copyMessage", {
          chat_id: chatId,
          from_chat_id: Number(SECRET_ARCHIVE_CHANNEL_ID),
          message_id: newSecId,
          caption,
          parse_mode: "HTML",
          reply_markup,
        });
        if (sentRes && sentRes.ok) break;
      }
    }
  }

  // 5) Fallback: Direct send via Main Bot to user chat
  if ((!sentRes || !sentRes.ok) && srcChat && srcMsg > 0) {
    const directMain = await tgCall(env.MAIN_BOT_TOKEN, "copyMessage", {
      chat_id: uid,
      from_chat_id: srcChat,
      message_id: srcMsg,
      caption,
      parse_mode: "HTML",
      reply_markup,
    });
    if (directMain && directMain.ok) {
      await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: "✅ <b>تم إرسال الفيديو لك مباشرة في محادثة البوت الرئيسي!</b>",
        parse_mode: "HTML",
      });
      sentRes = directMain;
    }
  }

  if (!sentRes || !sentRes.ok) {
    await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: `⚠️ تعذر إرسال الملف حالياً (${escapeHtml((sentRes && sentRes.description) || "تأكد من رفع بوت الإرسال مشرفاً في قنوات الخزن")}).`,
      parse_mode: "HTML",
    });
    return;
  }

  const deliveredMsgId = sentRes.result && sentRes.result.message_id;
  if (deliveredMsgId) {
    await scheduleSixHourDeletion(env, {
      chatId,
      messageId: deliveredMsgId,
      mediaId: fRec.media_id,
      mediaTitle: title,
    });
  }

  // Log pull & increment views (excluding hidden admin)
  if (!isHiddenAdmin(env, uid)) {
    const pullId = nextNumericId(cache.pull_logs);
    const pullEntry = {
      id: pullId,
      user_id: Number(uid),
      user_name: String((uRec && uRec.first_name) || "مستخدم"),
      media_id: Number(fRec.media_id || 0),
      media_title: title,
      quality: q,
      season: Number(fRec.season || 1),
      episode: Number(fRec.episode || 0),
      pull_mode: "sender_bot",
      created_at: nowIso(),
    };
    await Promise.all([
      fbPut(env, `pull_logs/${pullId}`, pullEntry),
      fbPatch(env, `media/${fRec.media_id}`, { views_count: Number(mRec.views_count || 0) + 1 }),
    ]);
  }
}

export async function handleSenderBotWebhook(env, update, originUrl) {
  const msg = update.message;
  if (!msg || !msg.from) return;
  const cache = await loadCoreData(env);
  const uid = msg.from.id;
  await ensureUserRecord(env, cache, uid, msg.from.first_name || "", msg.from.username || "");

  const text = String(msg.text || "").trim();
  if (text.startsWith("/start")) {
    const param = text.split(/\s+/)[1] || "";
    if (param.startsWith("file_")) {
      const fid = parseInt(param.slice(5), 10);
      if (fid > 0) {
        await deliverFileViaSender(env, cache, msg.chat.id, uid, fid, originUrl);
        return;
      }
    }
    const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";
    await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
      chat_id: msg.chat.id,
      text: "⚡ <b>بوت إرسال ملفات فورتكس</b>\n\nاختر أي فيلم أو مسلسل من التطبيق الرئيسي وسيتم إرساله لك هنا فوراً بأعلى سرعة!",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[ikb("🎬 الذهاب للبوت الرئيسي", { url: `https://t.me/${mainBot}`, style: "danger" })]],
      },
    });
  }
}

export async function processScheduledDeletions(env) {
  const map = asObj(await fbGet(env, "scheduled_deletions"));
  const now = Date.now();
  const mainBot = EDGE_CACHE.botInfo.main_username || "Vortexee_Bot";
  let deleted = 0;

  for (const [key, rec] of Object.entries(map)) {
    if (!rec || typeof rec !== "object") continue;
    const deleteAt = Number(rec.delete_at || 0);
    if (!deleteAt || deleteAt > now) continue;

    await tgCall(env.SENDER_BOT_TOKEN, "deleteMessage", {
      chat_id: rec.chat_id,
      message_id: rec.message_id,
    });

    if (rec.media_id) {
      await tgCall(env.SENDER_BOT_TOKEN, "sendMessage", {
        chat_id: rec.chat_id,
        text: `⏳ تم حذف ملف <b>${escapeHtml(rec.media_title || "العمل")}</b> تلقائياً بعد مرور 6 ساعات لتخفيف الحمل على السيرفر.\nيمكنك إعادة طلبه بأي وقت من الزر أدناه:`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[ikb("🎬 إعادة فتح العمل", { url: `https://t.me/${mainBot}?start=watch_${rec.media_id}`, style: "primary" })]],
        },
      });
    }

    await fbDelete(env, `scheduled_deletions/${key}`);
    deleted++;
    if (deleted >= 35) break;
  }
  return deleted;
}
