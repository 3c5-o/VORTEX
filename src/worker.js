import {
  APP_VERSION,
  EDGE_CACHE,
  fbPatch,
  fbPut,
  invalidateEdgeCache,
  isOwnerId,
  loadCoreData,
} from "./db.js";
import {
  handleMainBotWebhook,
  handleSenderBotWebhook,
  processScheduledDeletions,
  tgCall,
} from "./bots.js";
import { handleAdminBotWebhook } from "./admin.js";
import { handleApiRequest, jsonResp } from "./api.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = url.origin;

    if (request.method === "OPTIONS") {
      return jsonResp({ ok: true });
    }

    if (path === "/health" || path === "/ping") {
      return jsonResp({ ok: true, version: APP_VERSION, edge: "cloudflare-workers" });
    }

    if (path === "/setup-webhooks") {
      const key = url.searchParams.get("key") || "";
      if (!isOwnerId(env, key)) {
        return jsonResp({ ok: false, error: "Unauthorized key" }, 403);
      }

      const [mainMe, adminMe, senderMe] = await Promise.all([
        tgCall(env.MAIN_BOT_TOKEN, "getMe"),
        tgCall(env.ADMIN_BOT_TOKEN, "getMe"),
        tgCall(env.SENDER_BOT_TOKEN, "getMe"),
      ]);

      const mainUn = (mainMe && mainMe.ok && mainMe.result && mainMe.result.username) || "Vortexee_Bot";
      const adminUn = (adminMe && adminMe.ok && adminMe.result && adminMe.result.username) || "Vortexeadmin_Bot";
      const senderUn = (senderMe && senderMe.ok && senderMe.result && senderMe.result.username) || "Vortexeeserver_Bot";

      const [wMain, wAdmin, wSender] = await Promise.all([
        tgCall(env.MAIN_BOT_TOKEN, "setWebhook", {
          url: `${origin}/webhook/main`,
          allowed_updates: ["message", "callback_query", "pre_checkout_query"],
          drop_pending_updates: true,
        }),
        tgCall(env.ADMIN_BOT_TOKEN, "setWebhook", {
          url: `${origin}/webhook/admin`,
          allowed_updates: ["message", "callback_query", "channel_post"],
          drop_pending_updates: true,
        }),
        tgCall(env.SENDER_BOT_TOKEN, "setWebhook", {
          url: `${origin}/webhook/sender`,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: true,
        }),
      ]);

      await Promise.all([
        fbPatch(env, "settings", {
          webapp_url: origin,
          bot_main_username: mainUn,
          bot_admin_username: adminUn,
          bot_sender_username: senderUn,
        }),
        fbPut(env, "meta/live_api_url", origin),
      ]);

      EDGE_CACHE.botInfo.main_username = mainUn;
      EDGE_CACHE.botInfo.admin_username = adminUn;
      EDGE_CACHE.botInfo.sender_username = senderUn;
      invalidateEdgeCache();

      return jsonResp({
        ok: true,
        version: APP_VERSION,
        webapp_url: origin,
        main_bot: { username: mainUn, webhook: wMain },
        admin_bot: { username: adminUn, webhook: wAdmin },
        sender_bot: { username: senderUn, webhook: wSender },
      });
    }

    if (request.method === "POST" && path.startsWith("/webhook/")) {
      const update = await request.json().catch(() => null);
      if (update) {
        const task = (async () => {
          try {
            if (path === "/webhook/main") await handleMainBotWebhook(env, update, origin);
            else if (path === "/webhook/sender") await handleSenderBotWebhook(env, update, origin);
            else if (path === "/webhook/admin") await handleAdminBotWebhook(env, update, origin);
          } catch (err) {
            console.error("Webhook error:", path, err);
          }
        })();
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
        else await task;
      }
      return jsonResp({ ok: true });
    }

    if (path.startsWith("/api/")) {
      const apiRes = await handleApiRequest(request, env, url);
      if (apiRes) return apiRes;
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("VORTEX Edge V3.0", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const task = (async () => {
      try {
        await loadCoreData(env);
        await processScheduledDeletions(env);
      } catch (err) {
        console.error("Cron scheduled_deletions error:", err);
      }
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
    else await task;
  },
};
