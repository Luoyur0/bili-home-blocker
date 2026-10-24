"use strict";

/* global isBilibiliHome */

/**
 * Chrome / Edge 侧的拦截规则与判定。
 *
 * MV3 在 Chrome 里没有 webRequestBlocking（只有企业策略安装的扩展才有），
 * 所以「整页导航去首页」这条改用 declarativeNetRequest：命中的主文档导航
 * 直接重定向到扩展自己的拦截提示页，再由那个页面问后台「这次该关掉、
 * 该退回上一页，还是留着这张提示页」。站内 SPA（history.pushState）不产生
 * 网络请求，仍旧走 webNavigation.onHistoryStateUpdated + tabs.goBack。
 */

const BLOCKED_PAGE = "blocked.html";

// DNR 的 regexFilter 走 RE2：大小写默认不敏感，但没有 lookaround，
// 所以 hash 部分只能把「首页形态」逐条列出来，写不出「不等于 /video/…」。
// 语义与 home-url.js 的 isBilibiliHome 一致：只看 host + pathname，
// query 任意，hash 只认空 / #/ / #/index(.html)。
const HOME_URL_REGEX =
  "^https?://(?:www\\.|m\\.)?bilibili\\.com(?::\\d+)?(?:/{1,}(?:index\\.html?)?)?(?:\\?[^#]*)?(?:#(?:/?(?:index(?:\\.html)?)?/?)?)?$";

const DNR_RULE_ID = 1;

/** 拦下首页主文档导航，重定向到拦截提示页（由它决定最终去哪）。 */
function buildDnrRule() {
  return {
    id: DNR_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: `/${BLOCKED_PAGE}` }
    },
    condition: {
      regexFilter: HOME_URL_REGEX,
      resourceTypes: ["main_frame"]
    }
  };
}

// 说明「这个标签页还没去过任何地方」的 URL：新标签页、空白页、以及
// 标签页刚建出来还没拿到 url 的空串。在它里面打开首页 = 想刷首页。
const BLANK_TAB_RE =
  /^(?:about:(?:blank|newtab|home)|chrome:\/\/newtab\/?|chrome:\/\/new-tab-page\/?|edge:\/\/newtab\/?|chrome-search:\/\/local-ntp\/local-ntp\.html)?$/i;

function isBlankTabUrl(url) {
  if (typeof url !== "string") return true;
  return BLANK_TAB_RE.test(url.trim());
}

/**
 * 拦下之后怎么处理。
 * @param {{blank: boolean, settings: object}} input blank = 导航前这个标签页还是空的
 * @returns {{action: "navigate"|"retire"|"back", url?: string}}
 *   navigate —— 跳到 url；retire —— 关掉标签页（窗口只剩它时换提示页）；back —— 退回上一页
 */
function decideIntercept({ blank, settings }) {
  const s = settings || {};
  if (blank) {
    return s.lastTabRedirect
      ? { action: "navigate", url: s.lastTabRedirect }
      : { action: "retire" };
  }
  return s.videoHomeRedirect
    ? { action: "navigate", url: s.videoHomeRedirect }
    : { action: "back" };
}

globalThis.BLOCKED_PAGE = BLOCKED_PAGE;
globalThis.HOME_URL_REGEX = HOME_URL_REGEX;
globalThis.DNR_RULE_ID = DNR_RULE_ID;
globalThis.buildDnrRule = buildDnrRule;
globalThis.isBlankTabUrl = isBlankTabUrl;
globalThis.decideIntercept = decideIntercept;
