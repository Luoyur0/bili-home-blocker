"use strict";

/**
 * Chrome / Edge 只提供 chrome.*，没有 WebExtension 的 browser.* 别名。
 * 其余脚本按 browser.* 写（与 Firefox 版共用同一份 settings.js / home-url.js），
 * 所以在任何上下文里都要先加载本文件。
 */
if (typeof globalThis.browser === "undefined") globalThis.browser = globalThis.chrome;
