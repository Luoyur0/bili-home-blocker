# B站首页拦截器（Chrome / Edge 版）

一个 Chromium 扩展：**打开 B 站首页时把它拦下来，其余 B 站功能一律不碰。**

看视频、逛个人空间、搜索、动态、专栏、番剧、稍后再看——全部照常。只有「首页」这一个入口会被拦。工具栏弹窗里有开关，随时可以暂停；设置页能把拦截改成跳转到你自己指定的网址，也能挑出整天不拦截的星期。

> 用 Firefox？Firefox 版在 [`main` 分支](../../tree/main)，本分支是同一套功能按 Chromium 内核重写的版本。

## 分支

| 分支 | 内容 | 对应浏览器 |
| --- | --- | --- |
| [`main`](../../tree/main) | 同一套功能，按 Firefox 的 WebExtension 接口实现 | Firefox 115+ |
| `chrome`（本分支） | 扩展源码，根目录即扩展目录 | Chrome / Edge 102+ |

两个版本功能一致：同一个开关、同一套设置、同一张拦截提示页、同一套计数角标。`settings.js` 与 `home-url.js` 两边是**同一份文件**（逐字节相同），只有跟浏览器打交道的那一层按各自内核重写。

## 行为

| 场景 | 结果 |
| --- | --- |
| 新标签页 / 空标签里打开 `www.bilibili.com/` | 关掉这个标签页；设置里填了网址就跳过去 |
| 窗口里只剩这一个标签页时打开首页 | 显示「B 站首页已被拦截」提示页；填了网址就跳过去 |
| 正在看视频，点顶部 logo 回首页 | 拦下跳转，**留在视频页，视频继续播**；填了网址就跳过去 |
| 正在看视频，在地址栏重新导航到首页 | 退回上一页（视频会重新加载）；填了网址就跳过去 |
| 视频页 → 另一个视频页 | 完全不干预 |
| 视频、个人空间、搜索、动态、专栏、番剧、稍后再看…… | 完全不干预 |
| 今天是白名单日期 | 以上规则全部暂停，B 站首页照常打开 |
| 开关关闭 | 以上规则全部暂停，B 站首页照常打开 |

## 开关与设置

- **开关**：工具栏图标 → 弹窗右上角的拨动开关。默认开启；关闭后所有 B 站页面照常打开，工具栏角标也不再显示数字。状态存在 `storage.local` 的 `enabled` 键里，重启浏览器仍然有效。
- **空标签页里打开首页时**：留空（默认）= 还有别的标签页就关掉这个标签页，只剩它一个就显示提示页；填网址 = 不管窗口里还有没有别的标签页都跳过去。
- **看视频时点回首页**：留空（默认）= 拦下跳转，页面原地不动；填网址 = 跳到那个网址。
- **白名单日期**：七个按钮对应周一到周日，点亮 = 那一整天不拦截。判断用浏览器本地时间，跨过午夜自动切换。
- **网址怎么写**：只支持 `http` / `https`，没写协议时按 https 补全；不能填 B 站首页（`www.bilibili.com/`、`/index.html`、带 `spm_id_from` 的变体都算），否则会死循环，填了会提示并拒绝保存。

入口有两个：弹窗底部的「设置…」，或扩展管理页里本扩展的「选项」。改完立刻生效，不用重启浏览器。

## 安装

### Chrome

1. 地址栏打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选本目录

### Edge

和 Chrome 一样，只是地址换成 `edge://extensions`，同样在左下角打开「开发人员模式」后「加载解压缩的扩展」。

Chrome 不接受直接拖 zip / 未签名的 crx。要上架 Chrome 应用商店需要开发者账号；只想自己用的话「加载已解压」就够了，缺点是每次启动会提示「已停用开发者模式扩展」。

## 为什么不能只匹配 `https://www.bilibili.com/`

首页的 URL 有好几种形态，而且站内跳回首页不一定产生网络请求：

1. **URL 变体多**：`/`、`/?spm_id_from=333.40164.0.0`、`/?spm_id_from=333.1007.tianma.1-1-1.click`、`/index.html`。`spm_id_from` 的值每次都不一样，所以判定**只比 host + pathname，忽略 query 和 hash**（`chrome-rules.js` 里的 `HOME_URL_REGEX`）。
2. **跳转方式有两种**：
   - 整页导航（地址栏输入、点链接刷新整页）→ MV3 没有 `webRequestBlocking`，改用 `declarativeNetRequest` 把主文档重定向到扩展自己的 `blocked.html`；
   - 站内 SPA 用 `history.pushState` 把地址改成 `/`（顶部 logo 那一下）→ 没有新请求，只能靠 `webNavigation.onHistoryStateUpdated` 捕获，然后 `tabs.goBack()` 退回上一页。
3. **会话恢复 / bfcache** 恢复出来的首页不触发网络请求 → `webNavigation.onCommitted` 兜底。

DNR 规则装不装，直接由「开关开着 且 今天不在白名单里」决定；跨过午夜由 `alarms` 重新评估。

## 与 Firefox 版的实现差别

| 环节 | Firefox 版 | Chrome / Edge 版（本分支） |
| --- | --- | --- |
| 整页导航拦下 | `webRequest.onBeforeRequest` 直接 `cancel`，页面原地不动 | 用 `declarativeNetRequest` 把主文档重定向到 `blocked.html` |
| 拦下后怎么收场 | 后台自己判断，直接 `tabs.update` / `tabs.remove` | `blocked.html` 加载后 `sendMessage` 问后台，后台回 `close` / `navigate` / `back` / `show` |
| 站内 SPA 回首页 | 注入脚本调 `history.back()` | `tabs.goBack()`；页面还在加载时历史条目可能没进栈，隔 400ms 重试一次 |
| 空标签页判定 | 拦截时读 `tab.url` | `tabs.onCreated` 记一笔，存进 `storage.session`（service worker 随时会被回收） |
| 开关 / 白名单 | 每次触发时同步判断 | 直接决定 DNR 规则装不装，跨午夜靠 `alarms` 重新评估 |

Chrome 版把「取消请求」换成了「重定向到自己的页面」，好处是 B 站首页一个字节都不会被下载；代价是「看视频时整页导航回首页」这条无法保住正在播的视频——只能退回上一页重新加载（点 logo 那条 SPA 路径不受影响）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单，权限：declarativeNetRequest / webNavigation / tabs / storage / alarms |
| `platform.js` | 把 `chrome.*` 别名成 `browser.*`，让共享脚本两边通用；每个页面都第一个加载它 |
| `settings.js` `home-url.js` | 与 Firefox 版逐字节相同的共享代码 |
| `chrome-rules.js` | DNR 规则（`HOME_URL_REGEX`）、空标签页判定、拦下之后怎么收场 |
| `background.js` | service worker：装 / 撤 DNR 规则、记标签页来路、处理 `blocked.html` 的询问、计数角标、跨午夜闹钟 |
| `blocked.html` `blocked.js` | 拦截中转 + 提示页（同一个页面，先问后台再决定显示） |
| `options.html` `options.js` | 设置页：两个跳转网址、七个白名单日期按钮、恢复默认 |
| `popup.html` `popup.js` | 工具栏弹窗：开关、今日 / 累计拦截数、清零、设置入口 |
| `icons/icon-16.png` `icon-32.png` `icon-48.png` `icon-128.png` | 图标（Chrome 的 manifest 不认 SVG） |
| `icons/icon.svg` | 图标源文件，不进包 |

## 想改规则

- **只想拦不关**：把 `chrome-rules.js` 的 `decideIntercept` 里 `{ action: "retire" }` 改成 `{ action: "show" }`。
- **想连子域名一起管**（比如 `space.bilibili.com/`）：同步改 `home-url.js` 的 `BILI_HOME_HOSTS` 和 `chrome-rules.js` 的 `HOME_URL_REGEX`，两边判定必须一致。
- **B 站改了首页路径**：同步改 `BILI_HOME_PATHS` 和 `HOME_URL_REGEX`。
- **想让开关常驻关闭**：把 `settings.js` 的 `ENABLED_DEFAULT` 改成 `false`。
- **想改默认跳转网址**：设置页填一次就行，不用动代码。

## 已知边界

- 关标签页是浏览器级操作，无法撤销，也不会有确认框。
- 靠「重定向到自己的页面」实现拦截，所以「看视频时整页导航回首页」（地址栏重输，不是点 logo）保不住正在播的视频，只能退回上一页重新加载。
- 拦截规则要跟着开关和白名单装 / 撤；跨过午夜由 `alarms` 重新评估，闹钟响之前的那几秒会按昨天的规则走（那一瞬间被拦下的导航会自己放回去，不算拦截）。
- 跳转网址不能指向 B 站首页，但指向 B 站其它页面（比如 `space.bilibili.com`）是可以的。
- 开关与设置都在 `storage.local` 里，清空扩展数据会把它们恢复成默认值。
- 白名单按浏览器本地时区判断，跨时区旅行时以系统时间为准。

## 说明

本仓库只放扩展源码，不含打包产物。改完代码直接在「加载已解压的扩展程序」里重新加载验证，稳定后再打包上传商店。
