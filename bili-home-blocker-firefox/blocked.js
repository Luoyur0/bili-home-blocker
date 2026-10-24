"use strict";

document.getElementById("open-options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

document.getElementById("close-tab").addEventListener("click", async () => {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab && typeof tab.id === "number") {
      await browser.tabs.remove(tab.id);
      return;
    }
  } catch {
    // 落到下面
  }
  window.close();
});
