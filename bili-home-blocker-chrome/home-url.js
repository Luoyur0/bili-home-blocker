"use strict";

/**
 * B 站「首页」判定。
 *
 * 只看 主机 + 路径，query 与 hash 一律忽略：
 *   https://www.bilibili.com/
 *   https://www.bilibili.com/?spm_id_from=333.40164.0.0
 *   https://www.bilibili.com/index.html
 * 全部视为首页。
 *
 * 而 /video/BVxxx、/search、/read/cvxxx、/list/... 这些路径放行；
 * space.bilibili.com、search.bilibili.com 等子域也放行。
 */

const BILI_HOME_HOSTS = ["bilibili.com", "www.bilibili.com", "m.bilibili.com"];
const BILI_HOME_PATHS = ["/", "/index.html", "/index.htm"];

// 老式 hash 路由里只有首页形态算首页，#/video/av123 之类放行
const HOME_HASH_RE = /^#\/?(index(\.html)?)?\/?$/i;

function isBilibiliHome(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return false;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!BILI_HOME_HOSTS.includes(url.hostname.toLowerCase())) return false;

  const path = url.pathname.replace(/\/{2,}/g, "/").toLowerCase();
  if (!BILI_HOME_PATHS.includes(path)) return false;

  const hash = url.hash;
  if (hash.length > 1 && !HOME_HASH_RE.test(hash)) return false;

  return true;
}

globalThis.isBilibiliHome = isBilibiliHome;
