"use strict";

/* global readEnabled, writeEnabled */

const STATS_KEY = "stats";

const toggle = document.getElementById("toggle");
const hint = document.getElementById("hint");

function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function renderStats() {
  let stats = null;
  try {
    const stored = await browser.storage.local.get(STATS_KEY);
    stats = stored[STATS_KEY] || null;
  } catch {
    stats = null;
  }
  const today = stats && stats.date === todayKey() ? Number(stats.count) || 0 : 0;
  document.getElementById("today").textContent = String(today);
  document.getElementById("total").textContent = String(Number(stats && stats.total) || 0);
}

function renderEnabled(enabled) {
  toggle.checked = enabled;
  document.body.classList.toggle("off", !enabled);
  hint.textContent = enabled
    ? "拦截已开启：打开 B 站首页会被拦下"
    : "拦截已暂停：B 站首页照常打开";
}

toggle.addEventListener("change", async () => {
  renderEnabled(await writeEnabled(toggle.checked));
});

document.getElementById("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

document.getElementById("reset").addEventListener("click", async () => {
  await browser.storage.local.set({ [STATS_KEY]: { date: todayKey(), count: 0, total: 0 } });
  await browser.action.setBadgeText({ text: "" });
  await renderStats();
});

void (async () => {
  renderEnabled(await readEnabled());
  await renderStats();
})();
