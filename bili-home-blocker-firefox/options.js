"use strict";

/* global readSettings, writeSettings, validateRedirect, isWhitelistedDay, LAST_TAB_REDIRECT_DEFAULT */

// 周一在前、周日在后，和中文习惯一致；day 用 Date#getDay() 的编号（0 = 周日）。
const DAY_LABELS = [
  { day: 1, label: "周一" },
  { day: 2, label: "周二" },
  { day: 3, label: "周三" },
  { day: 4, label: "周四" },
  { day: 5, label: "周五" },
  { day: 6, label: "周六" },
  { day: 0, label: "周日" }
];

const REDIRECT_INPUTS = {
  lastTabRedirect: document.getElementById("last-tab"),
  videoHomeRedirect: document.getElementById("video-home")
};

const REDIRECT_ERRORS = {
  lastTabRedirect: document.getElementById("last-tab-err"),
  videoHomeRedirect: document.getElementById("video-home-err")
};

const daysEl = document.getElementById("days");
const todayEl = document.getElementById("today");
const statusEl = document.getElementById("status");
const resetBtn = document.getElementById("reset");

let current = {
  enabled: true,
  lastTabRedirect: LAST_TAB_REDIRECT_DEFAULT,
  videoHomeRedirect: "",
  whitelistDays: []
};
let statusTimer = 0;

function setStatus(text, kind = "ok") {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
  clearTimeout(statusTimer);
  if (kind === "ok" && text) {
    statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 2600);
  }
}

/* ---------------- 白名单 ---------------- */

const dayButtons = new Map();

for (const { day, label } of DAY_LABELS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "day";
  btn.textContent = label;
  btn.dataset.day = String(day);
  btn.addEventListener("click", () => void toggleDay(day));
  daysEl.appendChild(btn);
  dayButtons.set(day, btn);
}

function renderDays() {
  for (const [day, btn] of dayButtons) {
    const on = current.whitelistDays.includes(day);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const now = new Date();
  const todayLabel = (DAY_LABELS.find((x) => x.day === now.getDay()) || {}).label || "";
  todayEl.textContent = isWhitelistedDay(current.whitelistDays, now)
    ? `今天是${todayLabel}，已在白名单里 —— 今天不会拦截。`
    : `今天是${todayLabel}，不在白名单里 —— 照常拦截。`;
}

async function toggleDay(day) {
  const next = current.whitelistDays.includes(day)
    ? current.whitelistDays.filter((d) => d !== day)
    : [...current.whitelistDays, day];
  current = await writeSettings({ whitelistDays: next });
  renderDays();
  setStatus("已保存");
}

/* ---------------- 跳转网址 ---------------- */

async function saveRedirect(key) {
  const input = REDIRECT_INPUTS[key];
  const { value, error } = validateRedirect(input.value);

  REDIRECT_ERRORS[key].textContent = error;
  if (error) {
    setStatus("没有保存", "error");
    return;
  }

  current = await writeSettings({ [key]: value });
  input.value = current[key];
  const clearedHint =
    key === "lastTabRedirect" ? "已清空，改为关掉标签页 / 显示提示页" : "已清空，改为拦下跳转、留在视频页";
  setStatus(value ? "已保存" : clearedHint);
}

for (const [key, input] of Object.entries(REDIRECT_INPUTS)) {
  input.addEventListener("change", () => void saveRedirect(key));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
}

/* ---------------- 恢复默认 ---------------- */

resetBtn.addEventListener("click", async () => {
  current = await writeSettings({
    lastTabRedirect: LAST_TAB_REDIRECT_DEFAULT,
    videoHomeRedirect: "",
    whitelistDays: []
  });
  for (const [key, input] of Object.entries(REDIRECT_INPUTS)) {
    input.value = current[key];
    REDIRECT_ERRORS[key].textContent = "";
  }
  renderDays();
  setStatus("已恢复默认");
});

/* ---------------- 初始化 ---------------- */

void (async () => {
  current = await readSettings();
  for (const [key, input] of Object.entries(REDIRECT_INPUTS)) input.value = current[key];
  renderDays();
})();
