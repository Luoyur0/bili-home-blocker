"use strict";

/* global isBilibiliHome, normalizeSettings, readSettings, isWhitelistedDay, SETTINGS_KEYS */

const BLOCKED_PAGE = "blocked.html";
const STATS_KEY = "stats";
const BADGE_COLOR = "#FB7299";

// 这些 URL 说明「这是个还没去任何地方的空标签页」，
// 在它里面打开首页 = 想刷首页，所以直接关掉标签页。
// about:home 故意不在列表里：它自己会跳到主页，关掉会让新标签页永远打不开。
const BLANK_TAB_RE = /^(about:(newtab|blank|privatebrowsing|sessionrestore)|)$/i;

const LOOP_WINDOW_MS = 2000;
const LOOP_LIMIT = 3;
const REQUEST_DEDUPE_MS = 400;

const recentHits = new Map();
const lastRequestHit = new Map();

// 设置的内存副本：webRequest 的回调必须同步返回，不能在里面 await 存储。
// 启动时读一次，之后跟着 storage.onChanged 走。
let settings = normalizeSettings({});

/** 此刻要不要拦：开关开着，且今天不在白名单里。 */
function blockingNow() {
  return settings.enabled && !isWhitelistedDay(settings.whitelistDays);
}

/* ---------------- 计数与角标 ---------------- */

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function readStats() {
  try {
    const stored = await browser.storage.local.get(STATS_KEY);
    const stats = stored[STATS_KEY];
    return stats && typeof stats === "object" ? stats : null;
  } catch {
    return null;
  }
}

async function renderBadge(stats) {
  const count = blockingNow() && stats && stats.date === todayKey() ? Number(stats.count) || 0 : 0;
  const text = count === 0 ? "" : count > 999 ? "999+" : String(count);
  try {
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await browser.action.setBadgeText({ text });
  } catch {
    /* 工具栏不可用时忽略 */
  }
}

async function bumpStats() {
  const prev = await readStats();
  const today = todayKey();
  const next = {
    date: today,
    count: prev && prev.date === today ? (Number(prev.count) || 0) + 1 : 1,
    total: (Number(prev && prev.total) || 0) + 1
  };
  try {
    await browser.storage.local.set({ [STATS_KEY]: next });
  } catch {
    /* 存不下也不影响拦截 */
  }
  await renderBadge(next);
}

/* ---------------- 标签页操作 ---------------- */

function isBlankTabUrl(url) {
  return typeof url !== "string" || BLANK_TAB_RE.test(url.trim());
}

async function getTab(tabId) {
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function navigateTab(tabId, url) {
  try {
    await browser.tabs.update(tabId, { url });
    return true;
  } catch (err) {
    console.warn("[bili-home-blocker] 跳转失败：", err);
    return false;
  }
}

/**
 * 收尾：能关就关；关掉会带走整个窗口时换成一张页面 ——
 * 优先用设置里填的 lastTabRedirect，没填就是拦截提示页。
 * 空标签页那条路在填了网址时不会走到这里（会直接跳过去）。
 */
async function retireTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab) return;

  let siblingCount = 1;
  try {
    siblingCount = (await browser.tabs.query({ windowId: tab.windowId })).length;
  } catch {
    siblingCount = 1;
  }

  try {
    if (siblingCount <= 1) {
      const target = settings.lastTabRedirect || browser.runtime.getURL(BLOCKED_PAGE);
      await browser.tabs.update(tabId, { url: target });
    } else {
      await browser.tabs.remove(tabId);
    }
  } catch (err) {
    console.warn("[bili-home-blocker] 关闭标签页失败：", err);
  }
}

/**
 * 让页面退回上一页（用于 SPA 已经把地址改成首页的情况）。
 * @returns {"back" | "single" | "error"}
 *   back   —— 已执行 history.back()
 *   single —— 这个标签页没有上一页，只能关掉
 *   error  —— 注入失败，什么都不做，避免误伤
 */
async function stepBack(tabId) {
  try {
    const injected = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (history.length > 1) {
          history.back();
          return "back";
        }
        return "single";
      }
    });
    const first = Array.isArray(injected) ? injected[0] : null;
    const value = first && first.result;
    return value === "back" || value === "single" ? value : "error";
  } catch {
    return "error";
  }
}

function hitCount(tabId) {
  const t = Date.now();
  const list = (recentHits.get(tabId) || []).filter((x) => t - x < LOOP_WINDOW_MS);
  list.push(t);
  recentHits.set(tabId, list);
  return list.length;
}

/* ---------------- 三条触发路径 ---------------- */

// A. 整页导航去首页：取消这次请求，页面停在原地不动。
//    如果本来就是个空标签页（新标签 / Ctrl+点击）= 想刷首页：
//      填了 lastTabRedirect 就跳过去（不管窗口里还有没有别的标签页），
//      没填就按原来的方式关掉它（窗口只剩它一个时换成拦截提示页）。
//    非空标签页（比如视频页整页刷新到首页）：填了 videoHomeRedirect 就跳过去。
async function onMainFrameHome(tabId) {
  const tab = await getTab(tabId);
  if (!tab) return;
  await bumpStats();
  if (isBlankTabUrl(tab.url)) {
    if (settings.lastTabRedirect && (await navigateTab(tabId, settings.lastTabRedirect))) return;
    await retireTab(tabId);
    return;
  }
  if (settings.videoHomeRedirect) await navigateTab(tabId, settings.videoHomeRedirect);
}

// B/C. 页面已经落到首页了（SPA 的 pushState，或 bfcache / 会话恢复）：
//      配置了 videoHomeRedirect 就去那儿，否则退回去。
async function onLandedHome(tabId) {
  if (hitCount(tabId) > LOOP_LIMIT) {
    await retireTab(tabId);
    return;
  }
  const tab = await getTab(tabId);
  if (!tab) return;
  await bumpStats();
  if (settings.videoHomeRedirect) {
    await navigateTab(tabId, settings.videoHomeRedirect);
    return;
  }
  const result = await stepBack(tabId);
  if (result === "single") await retireTab(tabId);
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!blockingNow()) return {};
    if (details.tabId < 0) return {};
    if (!isBilibiliHome(details.url)) return {};

    const t = Date.now();
    const prev = lastRequestHit.get(details.tabId) || 0;
    if (t - prev >= REQUEST_DEDUPE_MS) {
      lastRequestHit.set(details.tabId, t);
      void onMainFrameHome(details.tabId);
    }
    return { cancel: true };
  },
  {
    urls: ["*://bilibili.com/*", "*://*.bilibili.com/*"],
    types: ["main_frame"]
  },
  ["blocking"]
);

browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (!blockingNow()) return;
  if (details.frameId !== 0 || !isBilibiliHome(details.url)) return;
  void onLandedHome(details.tabId);
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (!blockingNow()) return;
  if (details.frameId !== 0 || !isBilibiliHome(details.url)) return;
  void onLandedHome(details.tabId);
});

/* ---------------- 启动 / 安装时清掉已经开着的首页 ---------------- */

async function sweepOpenTabs() {
  // 启动/安装事件可能早于顶层的异步初始化，这里直接读一次存储，
  // 顺手把内存副本对齐。
  settings = await readSettings();
  if (!blockingNow()) return;
  let tabs = [];
  try {
    tabs = await browser.tabs.query({ url: ["*://*.bilibili.com/*"] });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !isBilibiliHome(tab.url)) continue;
    await bumpStats();
    const result = await stepBack(tab.id);
    if (result === "single") await retireTab(tab.id);
  }
}

browser.runtime.onStartup.addListener(() => void sweepOpenTabs());
browser.runtime.onInstalled.addListener(() => void sweepOpenTabs());

/* ---------------- 设置变化 ---------------- */

async function refreshBadge() {
  await renderBadge(await readStats());
}

function mergeChangedSettings(changes) {
  const patch = {};
  let touched = false;
  for (const key of SETTINGS_KEYS) {
    if (key in changes) {
      patch[key] = changes[key].newValue;
      touched = true;
    }
  }
  if (touched) settings = normalizeSettings({ ...settings, ...patch });
  return touched;
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const wasBlocking = blockingNow();
  if (!mergeChangedSettings(changes)) return;
  // 重新开始拦截时清掉旧的命中记录，免得刚开就撞上「循环」判定被误关。
  if (!wasBlocking && blockingNow()) {
    recentHits.clear();
    lastRequestHit.clear();
  }
  void refreshBadge();
});

void (async () => {
  settings = await readSettings();
  await refreshBadge();
})();
