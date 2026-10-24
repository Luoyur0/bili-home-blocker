"use strict";

importScripts("platform.js", "settings.js", "home-url.js", "chrome-rules.js");

/* global readSettings, normalizeSettings, isWhitelistedDay, isBilibiliHome, SETTINGS_KEYS,
          BLOCKED_PAGE, DNR_RULE_ID, buildDnrRule, isBlankTabUrl, decideIntercept */

const STATS_KEY = "stats";
const BADGE_COLOR = "#FB7299";
const TAB_STATE_KEY = "tabs";
const DAY_ALARM = "day-rollover";

const LOOP_WINDOW_MS = 2000;
const LOOP_LIMIT = 3;
const PENDING_TTL_MS = 15000;

const recentHits = new Map();

// 设置的内存副本。service worker 随时会被回收，醒来后由 getSettings() 重新读，
// 所以任何用到设置的地方都不能直接读 settings 变量。
let settings = null;

// 每个标签页的来路：{ blank, url, pending, pendingAt, settled }
//   blank   —— 上一次提交时它还是个空标签页（新标签页 / 空白页）
//   url     —— 上一次提交的网址（跳过扩展自己的页面）
//   pending —— 正在发起、可能被拦下的那次首页导航的网址
//   settled —— 刚把它换成提示页的时刻，免得那张页面回头又问一遍被算两次
let tabState = new Map();
let stateLoaded = false;

/* ---------------- 设置 ---------------- */

async function getSettings() {
  if (!settings) settings = await readSettings();
  return settings;
}

/** 此刻要不要拦：开关开着，且今天不在白名单里。 */
function blockingNow(s) {
  return s.enabled && !isWhitelistedDay(s.whitelistDays);
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
  const s = await getSettings();
  const count = blockingNow(s) && stats && stats.date === todayKey() ? Number(stats.count) || 0 : 0;
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

async function refreshBadge() {
  await renderBadge(await readStats());
}

/* ---------------- 标签页来路（storage.session，service worker 重启后仍在） ---------------- */

async function ensureTabState() {
  if (stateLoaded) return tabState;
  stateLoaded = true;
  try {
    const session = browser.storage.session;
    if (!session) return tabState;
    const stored = await session.get(TAB_STATE_KEY);
    const raw = stored && stored[TAB_STATE_KEY];
    if (!raw || typeof raw !== "object") return tabState;
    for (const [key, value] of Object.entries(raw)) {
      const id = Number(key);
      if (!Number.isInteger(id) || !value || typeof value !== "object") continue;
      tabState.set(id, {
        blank: value.blank === true,
        url: typeof value.url === "string" ? value.url : "",
        pending: typeof value.pending === "string" ? value.pending : "",
        pendingAt: Number(value.pendingAt) || 0,
        settled: Number(value.settled) || 0
      });
    }
  } catch {
    /* 读不到就当没有记录，后面按「非空标签页」处理 */
  }
  return tabState;
}

function persistTabState() {
  const session = browser.storage.session;
  if (!session) return;
  const raw = {};
  for (const [id, rec] of tabState) raw[id] = rec;
  Promise.resolve(session.set({ [TAB_STATE_KEY]: raw })).catch(() => {});
}

async function recordTab(tabId, patch) {
  if (typeof tabId !== "number" || tabId < 0) return;
  const map = await ensureTabState();
  const prev = map.get(tabId) || { blank: false, url: "", pending: "", pendingAt: 0, settled: 0 };
  map.set(tabId, { ...prev, ...patch });
  persistTabState();
}

async function forgetTab(tabId) {
  const map = await ensureTabState();
  if (map.delete(tabId)) persistTabState();
}

/** 把已经在开的标签页补进记录（service worker 睡着的这段时间里新建的）。 */
async function seedOpenTabs() {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch {
    return;
  }
  const map = await ensureTabState();
  let touched = false;
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || tab.id < 0 || map.has(tab.id)) continue;
    const url = typeof tab.url === "string" ? tab.url : "";
    if (isOwnPage(url)) continue;
    map.set(tab.id, { blank: isBlankTabUrl(url || tab.pendingUrl), url, pending: "", pendingAt: 0 });
    touched = true;
  }
  if (touched) persistTabState();
}

/* ---------------- 标签页操作 ---------------- */

function isOwnPage(url) {
  return typeof url === "string" && url.startsWith(browser.runtime.getURL(""));
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 退回上一页；标签页没有上一页时返回 false。
 * 页面还在加载中时，刚被 pushState 顶掉的那一条可能还没进历史，
 * 所以失败后隔一会儿再试一次 —— 站内跳首页经常就发生在加载过程中。
 */
async function goBack(tabId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await browser.tabs.goBack(tabId);
      return true;
    } catch {
      if (attempt === 0) await sleep(400);
    }
  }
  return false;
}

/**
 * 收尾：能关就关；关掉会带走整个窗口时换成一张页面 ——
 * 优先用设置里填的 lastTabRedirect，没填就是拦截提示页。
 * @returns {Promise<boolean>} true = 已经关掉了标签页
 */
async function retireTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab) return false;

  let siblingCount = 1;
  try {
    siblingCount = (await browser.tabs.query({ windowId: tab.windowId })).length;
  } catch {
    siblingCount = 1;
  }

  if (siblingCount > 1) {
    try {
      await browser.tabs.remove(tabId);
      return true;
    } catch (err) {
      console.warn("[bili-home-blocker] 关闭标签页失败：", err);
      return false;
    }
  }

  if (isOwnPage(tab.url)) return false;
  const s = await getSettings();
  const target = s.lastTabRedirect || browser.runtime.getURL(BLOCKED_PAGE);
  await recordTab(tabId, { settled: Date.now() });
  return navigateTab(tabId, target);
}

function hitCount(tabId) {
  const t = Date.now();
  const list = (recentHits.get(tabId) || []).filter((x) => t - x < LOOP_WINDOW_MS);
  list.push(t);
  recentHits.set(tabId, list);
  return list.length;
}

/* ---------------- 三条触发路径 ---------------- */

/**
 * A. 整页导航去首页：DNR 已经把这次导航换成 blocked.html，页面加载后
 *    通过 runtime.sendMessage 过来问「这次该怎么收场」。
 */
async function resolveIntercept(tabId) {
  const s = await getSettings();
  const map = await ensureTabState();
  const rec = map.get(tabId) || null;

  // 刚把这一页换成提示页，提示页自己又问了一遍：只让它显示，不重复计数。
  if (rec && rec.settled && Date.now() - rec.settled < 5000) return { action: "show" };

  // 规则没来得及撤掉（跨过午夜、刚关开关）：把这次导航放回去，不算拦截。
  if (!blockingNow(s)) return await passThrough(tabId, rec);

  await bumpStats();
  const result = await applyIntercept(tabId, rec, s);
  // 留着提示页时记一下时间：那张页面自己再问一遍不该被算第二次。
  if (result.action === "show") await recordTab(tabId, { settled: Date.now() });
  return result;
}

/**
 * 让提示页把「自己这条历史」换成 url，而不是由后台去碰标签页。
 *
 * DNR 的重定向会把被拦下的那条导航并进提示页这条历史里，所以从提示页
 * 调 tabs.goBack 退过的往往不是刚才那一页，而是更早的页面。改成让页面
 * 自己 location.replace，落点是确定的，历史里也不会白白多出一条提示页。
 */
function redirectTo(url) {
  return { action: "redirect", url };
}

/** 上一次提交的、值得回去的网址；没有就是空串。 */
function previousUrl(rec) {
  if (!rec || typeof rec.url !== "string" || !rec.url) return "";
  return isBilibiliHome(rec.url) ? "" : rec.url;
}

/**
 * 真正动手的那一步，返回 {action:"redirect", url} / "close" / "show"。
 * 只有关标签页和「留提示页」这两件事必须后台来做。
 */
async function applyIntercept(tabId, rec, s) {
  const decision = decideIntercept({ blank: rec ? rec.blank : false, settings: s });

  if (decision.action === "navigate") return redirectTo(decision.url);

  if (decision.action === "back") {
    const prev = previousUrl(rec);
    return prev ? redirectTo(prev) : { action: "show" };
  }

  return (await retireTab(tabId)) ? { action: "close" } : { action: "show" };
}

async function passThrough(tabId, rec) {
  await syncRules();
  // 规则没拦住这一次，说明它本来就不该被拦：优先真把它放回去（用户想去的首页），
  // 再不行才退回上一页。
  if (rec && rec.pending && Date.now() - rec.pendingAt < PENDING_TTL_MS) return redirectTo(rec.pending);
  const prev = previousUrl(rec);
  if (prev) return redirectTo(prev);
  return { action: "show" };
}

// B/C. 页面已经落到首页了（SPA 的 pushState，或 bfcache / 会话恢复）：
//      配置了 videoHomeRedirect 就去那儿，否则退回去。
async function onLandedHome(tabId) {
  if (hitCount(tabId) > LOOP_LIMIT) {
    await retireTab(tabId);
    return;
  }
  const s = await getSettings();
  await bumpStats();
  if (s.videoHomeRedirect && (await navigateTab(tabId, s.videoHomeRedirect))) return;
  if (await goBack(tabId)) return;
  const rec = (await ensureTabState()).get(tabId);
  if (rec && rec.url && !isBilibiliHome(rec.url) && (await navigateTab(tabId, rec.url))) return;
  await retireTab(tabId);
}

/* ---------------- 拦截规则（declarativeNetRequest） ---------------- */

async function syncRules() {
  const s = await getSettings();
  const want = blockingNow(s);

  let current = [];
  try {
    current = await browser.declarativeNetRequest.getDynamicRules();
  } catch (err) {
    console.warn("[bili-home-blocker] 读不到动态规则：", err);
    return;
  }

  const installed = current.some((rule) => rule.id === DNR_RULE_ID);
  if (want === installed) return;

  try {
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: want ? [buildDnrRule()] : []
    });
  } catch (err) {
    console.warn("[bili-home-blocker] 更新拦截规则失败：", err);
  }
}

/* ---------------- 白名单跨过午夜要重新评估规则 ---------------- */

function msUntilNextMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleDayAlarm() {
  try {
    browser.alarms.create(DAY_ALARM, { when: Date.now() + msUntilNextMidnight() });
  } catch {
    /* 没有 alarms 也还能用：设置一改就会重新同步规则 */
  }
}

/* ---------------- 启动 / 安装时清掉已经开着的首页 ---------------- */

async function sweepOpenTabs() {
  const s = await getSettings();
  if (!blockingNow(s)) return;
  let tabs = [];
  try {
    tabs = await browser.tabs.query({ url: ["*://*.bilibili.com/*"] });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || !isBilibiliHome(tab.url)) continue;
    await bumpStats();
    if (await goBack(tab.id)) continue;
    await retireTab(tab.id);
  }
}

async function boot(sweep) {
  await getSettings();
  await ensureTabState();
  await seedOpenTabs();
  await syncRules();
  await refreshBadge();
  scheduleDayAlarm();
  if (sweep) await sweepOpenTabs();
}

/* ---------------- 事件 ---------------- */

// 记下这次导航想去哪：规则没拦住时的兜底要靠它。
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isBilibiliHome(details.url)) return;
  void recordTab(details.tabId, { pending: details.url, pendingAt: Date.now() });
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void (async () => {
    const s = await getSettings();
    if (!isOwnPage(details.url)) {
      await recordTab(details.tabId, {
        blank: isBlankTabUrl(details.url),
        url: details.url,
        pending: "",
        pendingAt: 0
      });
    }
    if (!blockingNow(s) || !isBilibiliHome(details.url)) return;
    await onLandedHome(details.tabId);
  })();
});

browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!isBilibiliHome(details.url)) return;
  void (async () => {
    const s = await getSettings();
    if (!blockingNow(s)) return;
    await onLandedHome(details.tabId);
  })();
});

browser.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  const url = typeof tab.url === "string" ? tab.url : "";
  // 刚建出来的标签页就算「空」——它还没有任何内容。只有复制标签页、或者
  // 一建出来就直接去某个具体页面时，url 才是真实页面；而「一建出来就去
  // 首页」这种（外部程序拉起、Ctrl+点首页链接）仍然算想刷首页。
  const blank = isBlankTabUrl(url || tab.pendingUrl) || isBilibiliHome(url || tab.pendingUrl || "");
  void recordTab(tab.id, { blank, url, pending: "", pendingAt: 0 });
});

browser.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId));

browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void (async () => {
    const map = await ensureTabState();
    const rec = map.get(removedTabId);
    if (!rec) return;
    map.set(addedTabId, rec);
    map.delete(removedTabId);
    persistTabState();
  })();
});

// blocked.html 加载后过来问：这次该关掉、该退回，还是留着这张提示页。
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "resolve-intercept") return undefined;
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (typeof tabId !== "number") {
    sendResponse({ action: "show" });
    return undefined;
  }
  resolveIntercept(tabId)
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.warn("[bili-home-blocker] 处理拦截失败：", err);
      sendResponse({ action: "show" });
    });
  return true;
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const patch = {};
  let touched = false;
  for (const key of SETTINGS_KEYS) {
    if (key in changes) {
      patch[key] = changes[key].newValue;
      touched = true;
    }
  }
  if (!touched) return;
  void (async () => {
    const prev = await getSettings();
    const wasBlocking = blockingNow(prev);
    settings = normalizeSettings({ ...prev, ...patch });
    // 重新开始拦截时清掉旧的命中记录，免得刚开就撞上「循环」判定被误关。
    if (!wasBlocking && blockingNow(settings)) recentHits.clear();
    await syncRules();
    await refreshBadge();
    scheduleDayAlarm();
  })();
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DAY_ALARM) return;
  void (async () => {
    await syncRules();
    await refreshBadge();
    scheduleDayAlarm();
  })();
});

browser.runtime.onStartup.addListener(() => void boot(true));
browser.runtime.onInstalled.addListener(() => void boot(true));

void boot(false);
