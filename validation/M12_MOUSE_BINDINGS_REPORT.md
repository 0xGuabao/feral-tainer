# M12 鼠标按键绑定验收报告

- 状态：已完成，待部署确认
- 完成日期：2026-08-21
- 修改前 Git 回滚点：`912d70d`
- 浏览器候选版本：`20260821-mouse-bindings-v1`
- 当前线上版本：`20260821-g5-v3`（本次未覆盖）

## 1. 完成结论

键位配置现支持鼠标后退侧键、前进侧键、滚轮按下、滚轮向上和滚轮向下。侧键在页面内无论是否绑定都会阻止浏览器前进/后退默认行为；滚轮按下和滚轮方向仅在配置捕获或已有技能绑定时阻止默认行为，未绑定滚轮继续保留页面滚动。

鼠标输入统一转换成稳定的通用绑定码，再复用既有键位冲突处理、浏览器持久化和 `castSkill` 入口。没有修改 `InteractiveController`、战斗引擎、APL、技能、天赋或构筑解析逻辑，也没有增加第二套战斗引擎。

## 2. 变更文件

- `demo/core/input-bindings.js`：鼠标按钮/滚轮方向到通用绑定码的映射与显示名称。
- `demo/app.js`：配置捕获、侧键默认行为拦截、鼠标施法和滚轮节流。
- `demo/index.html`：键位配置说明及版本化模块资源映射。
- `demo/tests/input-bindings.test.mjs`：稳定绑定码、方向映射和显示名称测试。
- `demo/browser-smoke.mjs`：五类鼠标输入配置、侧键默认行为和实际施法验证。
- `demo/release.generated.js`、`demo/release.json`：候选版本资源哈希。
- `README.md`、`demo/README.md`：功能、测试和开源边界说明。

## 3. 验收结果

```text
npm test
80 / 80 passed

CDP_PORT=9323 node demo/browser-smoke.mjs
desktop 1828×1028: passed
mobile 390×844: passed
mouse back/forward/middle/wheel up/wheel down capture: passed
unbound side-button mousedown/mouseup/auxclick defaultPrevented: true
bound side-button cast: passed
page URL after side-button cast: unchanged
unbound wheel defaultPrevented: false

node --check demo/app.js
node --check demo/browser-smoke.mjs
node --check demo/core/input-bindings.js
git diff --check
all passed
```

## 4. ResolvedProfile 与 unsupported 对账

本次没有修改 Profile 输入、Catalog、APL、构筑、装备或运行时机制；`catalogHash`、`aplHash`、`profileCacheNamespace` 均保持不变。因此 ResolvedProfile diff 为空，既有 `unsupportedFields`、`unsupportedEffects` 与 `unsupportedAplRules` 数量不变，未出现静默丢弃。

候选版本仅因通用输入层与资源清单变化，`runtimeHash` 更新为 `d745166c88bed9fdbf41662dc674440997850d1504d44ef921a1f757bec57bfc`。

## 5. 开源与发布边界

本次没有引入依赖、第三方代码、图片或其他资产。项目继续使用 `GPL-3.0-or-later`，SimulationCraft 与 Blizzard 相关权属边界仍由 `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 声明。

候选版本只完成源码与本地浏览器验证，尚未运行完整 G5 发行打包门禁，未生成或上传部署包，也未覆盖当前线上 `20260821-g5-v3`。

## 6. 已知风险、回滚与下一目标

- Chromium 已验证标准按钮编号：滚轮按下 `1`、后退 `3`、前进 `4`；不同鼠标驱动若把侧键改映射为键盘快捷键，将按驱动输出的键盘码处理。
- 滚轮输入使用 250ms 节流，避免单次滚动事件簇连续施法；高分辨率滚轮和触控板仍建议在目标设备上人工抽验手感。
- 部署前仍须完成发行包门禁和公网冷启动验收。

回滚方式：源码回退到 `912d70d`；当前线上无需回滚，因为本次尚未部署。下一目标是在用户确认后生成受控发行包、报告结果，再执行线上覆盖与回滚点验证。
