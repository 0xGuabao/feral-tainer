# M12 鼠标按键绑定验收报告

- 状态：已完成并部署
- 完成时间：2026-08-21 14:09 +0800
- 修改前 Git 回滚点：`912d70d`
- 发行源码 / GitHub：`05464388216072b96633809500125f63ffad7c66`
- 当前线上版本：`20260821-mouse-bindings-v1`
- 公网入口：<http://118.24.78.126:8787/?v=20260821-mouse-bindings-v1>
- 线上回滚版本：`20260821-g5-v3`

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

CDP_PORT=9324 node demo/browser-smoke.mjs
desktop 1828×1028: passed
mobile 390×844: passed
trusted Chrome back-button input in keybind dialog: captured, dialog open, URL unchanged
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

node scripts/run-release-gate.mjs --release-id 20260821-mouse-bindings-v1 ...
Git/GitHub, live SimC scan, generators, 80 tests, native SimC 1/3/5,
syntax, three archives, FILES.sha256, legal notices, desktop/H5: passed

CDP_PORT=9361 CDP_TARGET_ID=<public-page> PAGE_READY_TIMEOUT_MS=30000 node demo/browser-smoke.mjs
public cold start desktop/H5: passed
public trusted back-button input: captured, dialog open, URL unchanged
```

## 4. ResolvedProfile 与 unsupported 对账

本次没有修改 Profile 输入、Catalog、APL、构筑、装备或运行时机制；`catalogHash`、`aplHash`、`profileCacheNamespace` 均保持不变。因此 ResolvedProfile diff 为空，既有 `unsupportedFields`、`unsupportedEffects` 与 `unsupportedAplRules` 数量不变，未出现静默丢弃。

线上版本仅因通用输入层与资源清单变化，`runtimeHash` 更新为 `d745166c88bed9fdbf41662dc674440997850d1504d44ef921a1f757bec57bfc`。

## 5. 开源与发布边界

本次没有引入依赖、第三方代码、图片或其他资产。项目继续使用 `GPL-3.0-or-later`，SimulationCraft 与 Blizzard 相关权属边界仍由 `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 声明。

完整发行门禁已生成并验证 macOS、Web、Windows 三个平台包。每个包均包含项目 `LICENSE`、`THIRD_PARTY_NOTICES.md` 和 SimulationCraft 完整许可证集合；解包 `FILES.sha256` 全部通过。

| 归档 | SHA-256 |
| --- | --- |
| macOS | `95f44b40327544277eaa478e1f16097e53abcecd9de3a4ea91f2cd821cd074a0` |
| Web | `e7a66c15b5c01c0302b6ac31c1cde065fd94efb0f9f69f2f3b60c0b39f951dae` |
| Windows | `6265c2c52678708aedd1449c60952f66f9dbb22d0bfd13306cb21b3bac906df4` |

远端归档 SHA-256 与本地清单一致，解包内容复验全部通过。生产 live 已原子切换到：

```text
/home/ubuntu/releases/wow-feral-trainer/20260821-mouse-bindings-v1/wow-feral-trainer-web-20260821-mouse-bindings-v1/demo
```

公网 `release.json` 使用 `no-cache, no-store, must-revalidate`，带内容哈希的 `app.js` 使用 `public, max-age=31536000, immutable`。

## 6. 已知风险、回滚与下一目标

- Chromium 已验证标准按钮编号：滚轮按下 `1`、后退 `3`、前进 `4`；不同鼠标驱动若把侧键改映射为键盘快捷键，将按驱动输出的键盘码处理。
- 滚轮输入使用 250ms 节流，避免单次滚动事件簇连续施法；高分辨率滚轮和触控板仍建议在目标设备上人工抽验手感。
- Windows 包已通过结构、校验和浏览器成品门禁，但 Windows 10/11 实机鼠标驱动组合仍需后续抽验。

线上 `20260821-g5-v3` 完整保留在：

```text
/home/ubuntu/sites/wow-feral-trainer.previous-20260821-mouse-bindings-v1
```

需要回滚时，将当前 live 保留为 failed，再把上述目录原子恢复为 `/home/ubuntu/sites/wow-feral-trainer` 并执行本机与公网健康检查。最终复核服务为 `active`、没有 `failed-20260821-mouse-bindings-v1` 残留。

下一目标：由用户使用真实鼠标在公网版本抽验侧键和滚轮手感；若特定驱动输出非标准按钮码，记录实际事件后只扩展通用输入映射。
