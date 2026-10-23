# B站首页拦截器（Firefox / Chrome / Edge）

一个浏览器扩展：**打开 B 站首页时把它拦下来，其余 B 站功能一律不碰。**

看视频、逛个人空间、搜索、动态、专栏、番剧、稍后再看——全部照常，只有「首页」这一个入口会被拦。工具栏弹窗里有开关，随时可以暂停；设置页能把拦截改成跳转到你自己指定的网址，也能挑出整天不拦截的星期。

## 两个版本

同一套功能写了两个版本，分在仓库的两条分支里，**分支根目录就是扩展目录**（点开分支直接看到 `manifest.json`）：

| 分支 | 对应浏览器 | 说明 |
| --- | --- | --- |
| [`main`](../../tree/main) | Firefox 115+ | 按 Firefox 的 WebExtension 接口实现 |
| [`chrome`](../../tree/chrome) | Chrome / Edge 102+ | 同一套功能，按 Chromium 内核重写 |

两个版本共用同一个版本号（当前 **1.2.1**），功能一致：同一个开关、同一套设置、同一张拦截提示页、同一套计数角标。`settings.js` 与 `home-url.js` 是**同一份文件**（两边逐字节相同），只有跟浏览器打交道的那一层按各自的内核重写，具体差别见[两个版本的实现差别](#两个版本的实现差别)。

## 行为

| 场景 | 结果 |
| --- | --- |
| 新标签页 / 空标签里打开 `www.bilibili.com/` | 关掉这个标签页；设置里填了网址就跳过去 |
| 窗口里只剩这一个标签页时打开首页 | 显示「B 站首页已被拦截」提示页；填了网址就跳过去 |
| 正在看视频，点顶部 logo 回首页 | 拦下跳转，**留在视频页，视频继续播**；填了网址就跳过去 |
| 正在看视频，在地址栏重新导航到首页 | Firefox 版拦下这次导航、页面原地不动；Chrome / Edge 版退回上一页（视频重新加载）。填了网址就跳过去 |
| 视频页 → 另一个视频页 | 完全不干预 |
| 视频、个人空间、搜索、动态、专栏、番剧、稍后再看…… | 完全不干预 |
| 今天是白名单日期 | 以上规则全部暂停，B 站首页照常打开 |
| 开关关闭 | 以上规则全部暂停，B 站首页照常打开 |

## 开关

- 位置：工具栏图标 → 弹窗右上角的拨动开关。
- 默认开启；关闭后所有 B 站页面照常打开，工具栏角标也不再显示数字。
- 状态存在扩展的 `storage.local` 的 `enabled` 键里，重启浏览器仍然有效；没存过值（含旧版本升级上来）时按开启处理。
- 只管之后的导航：关掉开关那一刻已经打开的首页不会被追溯处理，重新打开也不会补刀。

## 设置

入口有两个：弹窗底部的「设置…」，或浏览器扩展管理页里本扩展的「选项」。改完立刻生效，不用重启浏览器。

### 空标签页里打开 B 站首页时

原来会直接关掉这个标签页；如果窗口里只剩它一个，关掉会让整个窗口消失，于是改成显示一张「B 站首页已被拦截」提示页。

- **留空（默认）**：按原来的方式处理——还有别的标签页就关掉这个标签页，只剩它一个就显示提示页。
- **填网址**：不管窗口里还有没有别的标签页，都跳到那个网址。

### 看视频时点回首页

在视频页点顶部 logo 跳回首页时，原来会拦下跳转、留在视频页继续播。

- **留空（默认）**：拦下跳转，页面原地不动。
- **填网址**：改成跳到那个网址。

整页导航到首页（地址栏输入、点链接刷新整页）也按这条走：先拦下这次导航，再决定退回上一页还是跳到配置的网址。

### 网址怎么写

- 只支持 `http` / `https`；没写协议时按 https 补全（`example.com` → `https://example.com/`）。
- 不能填 B 站首页（`www.bilibili.com/`、`/index.html`、带 `spm_id_from` 的变体都算）：跳过去会立刻再触发一次拦截，变成死循环，所以填了会提示并拒绝保存。
- 非法值不会写进存储；输入框失焦时校验并保存，按回车也算。

### 白名单日期

七个按钮对应周一到周日，点亮 = 那一整天不拦截，再点一下取消。

- 白名单当天三条拦截路径全部不触发，工具栏角标也不显示计数。
- 判断用浏览器本地时间，跨过午夜自动切换。
- 页面底部会写明今天在不在白名单里。

## 为什么不能只匹配 `https://www.bilibili.com/`

首页的 URL 有好几种形态，而且站内跳回首页不一定产生网络请求：

1. **URL 变体多**：`/`、`/?spm_id_from=333.40164.0.0`、`/?spm_id_from=333.1007.tianma.1-1-1.click`、`/index.html`。`spm_id_from` 的值每次都不一样，所以判定**只比 host + pathname，忽略 query 和 hash**。
2. **跳转方式有两种**：
   - 整页导航（地址栏输入、点链接刷新整页）→ 拦下这次主文档导航；
   - 站内 SPA 用 `history.pushState` 把地址改成 `/`（顶部 logo 那一下）→ 没有新请求，只能靠 `webNavigation.onHistoryStateUpdated` 捕获，然后退回上一页。
3. **会话恢复 / bfcache** 恢复出来的首页不触发网络请求 → `webNavigation.onCommitted` 兜底。

三条路径都在入口处检查「开关开着 且 今天不在白名单里」。

## 两个版本的实现差别

| 环节 | Firefox 版 | Chrome / Edge 版 |
| --- | --- | --- |
| 整页导航拦下 | `webRequest.onBeforeRequest` 直接 `cancel`，页面原地不动 | MV3 没有 `webRequestBlocking`，改用 `declarativeNetRequest` 把主文档重定向到 `blocked.html` |
| 拦下后怎么收场 | 后台自己判断，直接 `tabs.update` / `tabs.remove` | `blocked.html` 加载后 `sendMessage` 问后台，后台回 `close` / `navigate` / `back` / `show` |
| 站内 SPA 回首页 | 注入脚本调 `history.back()` | `tabs.goBack()`；页面还在加载时历史条目可能没进栈，隔 400ms 重试一次 |
| 空标签页判定 | 拦截时读 `tab.url` | `tabs.onCreated` 记一笔，存进 `storage.session`（service worker 随时会被回收） |
| 开关 / 白名单 | 每次触发时同步判断 | 直接决定 DNR 规则装不装，跨午夜靠 `alarms` 重新评估 |

Chrome 版把「取消请求」换成了「重定向到自己的页面」，好处是 B 站首页一个字节都不会被下载；代价是「看视频时整页导航回首页」这条无法保住正在播的视频——只能退回上一页重新加载（点 logo 那条 SPA 路径不受影响）。

## 安装

去 [Releases](../../releases) 下载对应版本的产物——两个版本共用同一个版本号（当前 **1.2.1**）：

| 浏览器 | 下载 | 装法 |
| --- | --- | --- |
| Firefox 115+ | `bili-home-blocker-firefox-<version>.xpi` | 临时载入（重启失效）或签名后长期安装，见下 |
| Chrome / Edge 102+ | `bili-home-blocker-chrome-<version>.zip` | 解压后「加载已解压的扩展程序」，见下 |

### Firefox

1. 到 [Releases](../../releases) 下载 `bili-home-blocker-firefox-<version>.xpi`。
2. **临时载入（最快，先这么试就行）**：地址栏打开 `about:debugging#/runtime/this-firefox` → 点「临时载入附加组件…」→ 选刚下载的那个 `.xpi`。立刻生效，但**重启 Firefox 后就没了**，下次要再载一次。
3. **长期安装**：正式版 Firefox 只认签名过的扩展，未签名的 xpi 直接拖进去会被拒，两条路——
   - **AMO 自签名（免费）**：把这个 xpi 上传到 [addons.mozilla.org](https://addons.mozilla.org/developers/)，提交时选 “On your own” / unlisted（自发行），等自动审核通过后下载签名版，点一下就能装进 Firefox；
   - **开发版 Firefox**：在 Developer Edition / Nightly 里把 `about:config` 的 `xpinstall.signatures.required` 设为 `false`，再把 xpi 拖进浏览器。
4. 装好后工具栏出现图标，点开就是开关。

### Chrome

1. 到 [Releases](../../releases) 下载 `bili-home-blocker-chrome-<version>.zip`，**解压到一个固定的目录**——Chrome 是从这个目录加载的，解压完别删。
2. 地址栏打开 `chrome://extensions`，右上角打开「开发者模式」。
3. 点「加载已解压的扩展程序」，选**解压出来的目录**（里面能直接看到 `manifest.json`）。

Chrome 不接受直接拖 zip / 未签名的 crx。要上架 Chrome 应用商店需要开发者账号；只想自己用的话「加载已解压」就够了，代价是每次启动会提示「已停用开发者模式扩展」，点掉即可。

### Edge

和 Chrome 一样：产物还是那个 zip，地址换成 `edge://extensions`，在左下角打开「开发人员模式」后「加载解压缩的扩展」，选解压出来的目录。Edge 的扩展商店也接受 Chromium 的 MV3 包。

### 改代码时不用发版

不想下产物、想直接跑当前源码：Firefox 在 `about:debugging#/runtime/this-firefox` 里「临时载入附加组件…」选分支根目录的 `manifest.json`（同样重启失效）；Chrome / Edge 把「加载已解压」直接指向仓库目录。验证没问题再打包发版。

## 文件

Firefox 版（`main` 分支）：

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单，权限：webNavigation / webRequest / webRequestBlocking / tabs / scripting / storage |
| `background.js` | 三条触发路径 + 关标签 / 换页 / 退回 + 计数角标 + 开关与白名单门控 |
| `settings.js` | 开关与设置的读写（两版共用同一份） |
| `home-url.js` | 「是不是 B 站首页」的判定（两版共用同一份） |
| `options.html` `options.js` | 设置页：两个跳转网址、七个白名单日期按钮、恢复默认 |
| `blocked.html` `blocked.js` | 唯一标签页时的提示页（也带设置入口） |
| `popup.html` `popup.js` | 工具栏弹窗：开关、今日 / 累计拦截数、清零、设置入口 |
| `icons/icon.svg` | 图标 |

Chrome / Edge 版（`chrome` 分支）：

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

- **只想拦不关**：Firefox 版把 `background.js` 里 `onMainFrameHome` 的 `await retireTab(tabId);` 换成 `return;`；Chrome 版把 `chrome-rules.js` 的 `decideIntercept` 里 `{ action: "retire" }` 改成 `{ action: "show" }`。
- **想连子域名一起管**（比如 `space.bilibili.com/`）：Firefox 版改 `home-url.js` 的 `BILI_HOME_HOSTS`；Chrome 版还要同步改 `chrome-rules.js` 的 `HOME_URL_REGEX`，两边判定要保持一致。
- **B 站改了首页路径**：同步改 `BILI_HOME_PATHS`（以及 `HOME_URL_REGEX`）。
- **想让开关常驻关闭**：把 `settings.js` 的 `ENABLED_DEFAULT` 改成 `false`。
- **想改默认跳转网址**：设置页填一次就行，不用动代码。

## 已知边界

- 关标签页是浏览器级操作，无法撤销，也不会有确认框。
- SPA 回退会让视频页重新挂载一次，可能有短暂缓冲；填了「看视频时点回首页」的网址就不会走这条路。
- 跳转网址不能指向 B 站首页，但指向 B 站其它页面（比如 `space.bilibili.com`）是可以的。
- Chrome 版靠「重定向到自己的页面」实现拦截，所以「看视频时整页导航回首页」（地址栏重输，不是点 logo）保不住正在播的视频，只能退回上一页重新加载。
- Chrome 版的拦截规则要跟着开关和白名单装 / 撤；跨过午夜由 `alarms` 重新评估，闹钟响之前的那几秒会按昨天的规则走（那一瞬间被拦下的导航会自己放回去，不算拦截）。
- 开关与设置都在 `storage.local` 里，清空扩展数据会把它们恢复成默认值。
- 白名单按浏览器本地时区判断，跨时区旅行时以系统时间为准。

## 说明

本仓库只放扩展源码，打包产物都在 [Releases](../../releases)：每个版本同时给出 `bili-home-blocker-firefox-<version>.xpi`（Firefox）与 `bili-home-blocker-chrome-<version>.zip`（Chrome / Edge），两个版本共用同一个版本号，发版时一起出。

自己打包：把分支根目录的文件压成 zip 容器即可，Firefox 那份把后缀改成 `.xpi`（要装进正式版 Firefox 还得先过 AMO 签名，见[安装](#安装)）。打包只是套一层 zip 容器，不改写、不合并、不压缩代码，所以包里的文件与源码逐字节相同。
