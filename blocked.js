"use strict";

const closeBtn = document.getElementById("close-tab");
const optionsBtn = document.getElementById("open-options");

optionsBtn.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
});

closeBtn.addEventListener("click", async () => {
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

// 这张页面有两个身份：被拦截规则重定向过来时的「中转站」，以及
// 关不掉 / 退不回时的「最终提示页」。先问后台这一页该怎么收场：
//   redirect —— 后台给了目标网址，由这一页自己替换掉（比后台按标签页
//               历史后退可靠：这条历史本来就是拦截规则换出来的）
//   close    —— 后台已经把标签页关掉了
//   show     —— 留着，把提示内容显示出来
void (async () => {
  let result = null;
  try {
    result = await browser.runtime.sendMessage({ type: "resolve-intercept" });
  } catch {
    /* 后台没响应就当提示页 */
  }

  const action = result && typeof result.action === "string" ? result.action : "show";
  if (action === "redirect" && typeof result.url === "string" && result.url) {
    location.replace(result.url);
    return;
  }
  if (action === "close") return;

  document.body.classList.remove("pending");
})();
