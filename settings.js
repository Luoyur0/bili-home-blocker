"use strict";

/* global isBilibiliHome */

/**
 * 扩展的全部本地设置，都存在 storage.local：
 *
 *   enabled            拦截总开关；只有明确存成 false 才算关闭
 *   lastTabRedirect    空标签页里打开首页时跳去的网址；空串 = 关掉标签页 / 显示拦截提示页
 *   videoHomeRedirect  看视频时点回首页跳去的网址；空串 = 拦下跳转、留在原页
 *   whitelistDays      不拦截的星期，0 = 周日 … 6 = 周六
 *
 * 读的时候一律走 normalize*，所以旧版本留下的缺键、脏值、手改过的
 * storage 都不会把界面或后台脚本弄崩。
 */

const ENABLED_KEY = "enabled";
const ENABLED_DEFAULT = true;
const LAST_TAB_REDIRECT_KEY = "lastTabRedirect";
const VIDEO_HOME_REDIRECT_KEY = "videoHomeRedirect";
const WHITELIST_DAYS_KEY = "whitelistDays";

const SETTINGS_KEYS = [ENABLED_KEY, LAST_TAB_REDIRECT_KEY, VIDEO_HOME_REDIRECT_KEY, WHITELIST_DAYS_KEY];

// 只认带 "://" 的写法算自带协议；"localhost:8080" 这类按无协议处理，补 https。
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function normalizeEnabled(value) {
  return value !== false;
}

/**
 * 校验用户填的跳转网址。
 * @param {unknown} value 输入框里的原文
 * @returns {{value: string, error: string}}
 *   value 是规范化后的绝对网址，空串表示「用默认逻辑」；
 *   error 非空时 value 一定为空串。
 */
function validateRedirect(value) {
  if (typeof value !== "string") return { value: "", error: "" };
  const raw = value.trim();
  if (raw === "") return { value: "", error: "" };

  // 只写了 example.com 这种，按 https 补全
  const withScheme = SCHEME_RE.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { value: "", error: "不是有效的网址" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { value: "", error: "只支持 http / https 网址" };
  }

  // 跳去 B 站首页会立刻再触发一次拦截，变成死循环
  if (typeof isBilibiliHome === "function" && isBilibiliHome(url.href)) {
    return { value: "", error: "不能指向 B 站首页，会再次触发拦截" };
  }

  return { value: url.href, error: "" };
}

function normalizeRedirect(value) {
  return validateRedirect(value).value;
}

function normalizeWhitelistDays(value) {
  if (!Array.isArray(value)) return [];
  const days = new Set();
  for (const item of value) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 0 && n <= 6) days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}

/** 今天是不是白名单里的星期（0 = 周日）。 */
function isWhitelistedDay(days, date = new Date()) {
  return Array.isArray(days) && days.includes(date.getDay());
}

function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: normalizeEnabled(src[ENABLED_KEY]),
    lastTabRedirect: normalizeRedirect(src[LAST_TAB_REDIRECT_KEY]),
    videoHomeRedirect: normalizeRedirect(src[VIDEO_HOME_REDIRECT_KEY]),
    whitelistDays: normalizeWhitelistDays(src[WHITELIST_DAYS_KEY])
  };
}

async function readSettings() {
  let stored = {};
  try {
    stored = await browser.storage.local.get(SETTINGS_KEYS);
  } catch {
    stored = {};
  }
  return normalizeSettings(stored);
}

/**
 * 合并写入若干设置项，返回写完之后生效的完整设置。
 * 传进来的值会先规范化，存储里不会留下半截网址或非法星期。
 */
async function writeSettings(patch) {
  const current = await readSettings();
  const next = normalizeSettings({ ...current, ...(patch || {}) });
  try {
    await browser.storage.local.set(next);
  } catch {
    /* 存不下也不该让设置页崩掉 */
  }
  return next;
}

async function readEnabled() {
  try {
    const stored = await browser.storage.local.get(ENABLED_KEY);
    return normalizeEnabled(stored[ENABLED_KEY]);
  } catch {
    return ENABLED_DEFAULT;
  }
}

async function writeEnabled(enabled) {
  const next = normalizeEnabled(enabled);
  try {
    await browser.storage.local.set({ [ENABLED_KEY]: next });
  } catch {
    /* 存不下也不该让弹窗崩掉 */
  }
  return next;
}

globalThis.ENABLED_KEY = ENABLED_KEY;
globalThis.ENABLED_DEFAULT = ENABLED_DEFAULT;
globalThis.LAST_TAB_REDIRECT_KEY = LAST_TAB_REDIRECT_KEY;
globalThis.VIDEO_HOME_REDIRECT_KEY = VIDEO_HOME_REDIRECT_KEY;
globalThis.WHITELIST_DAYS_KEY = WHITELIST_DAYS_KEY;
globalThis.SETTINGS_KEYS = SETTINGS_KEYS;
globalThis.normalizeEnabled = normalizeEnabled;
globalThis.validateRedirect = validateRedirect;
globalThis.normalizeRedirect = normalizeRedirect;
globalThis.normalizeWhitelistDays = normalizeWhitelistDays;
globalThis.isWhitelistedDay = isWhitelistedDay;
globalThis.normalizeSettings = normalizeSettings;
globalThis.readSettings = readSettings;
globalThis.writeSettings = writeSettings;
globalThis.readEnabled = readEnabled;
globalThis.writeEnabled = writeEnabled;
