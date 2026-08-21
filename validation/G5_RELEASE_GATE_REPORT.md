# G5 自动门禁、发布与回滚报告

- 状态：已完成
- 开始时间：2026-08-21 11:56 +0800
- 完成时间：2026-08-21 13:30 +0800
- 修改前 Git 回滚点：`74784b0`
- 最终发行源码 / GitHub：`35c7745fc14aa6f795b591479d573bd486065f45`，已推送 `origin/main`
- 最终线上发行：`20260821-g5-v3`
- 公网入口：<http://118.24.78.126:8787/?v=20260821-g5-v3>
- 应用回滚点：`20260821-dialog-hotfix-v1`
- 产品 SimC 锁：Build 69299 mixed snapshot；本轮扫描目标 `69a46e15...` 未晋升

## 1. 完成结论

G5 已完成自动门禁、三平台发行包、生产缓存契约、原子发布、失败自动回滚和最终公网验收。唯一发布门禁 `scripts/run-release-gate.mjs` 在同一次执行中完成 Git/GitHub 一致性、当前 SimC 上游扫描与语义 review、七组生成器幂等、78 项单元及架构测试、本地原生 SimC 1/3/5 目标矩阵、JavaScript/MJS/Shell/Python/diff 语法、三平台打包与完整性、开源声明、HTTP 缓存头、离线 `/demo/` 与生产根路径 `/` 双挂载桌面/H5 smoke、Profile 迁移，以及真实发布/回滚脚本的隔离演练。

生产发布经历两次受门禁控制的失败，并均在发现后立即恢复旧 live 和旧 systemd unit：

1. `20260821-g5-v1` 的公网冷加载在旧 10 秒就绪门限处失败；服务日志没有 404。版本保留为 failed，线上恢复 `20260821-dialog-hotfix-v1`。随后门禁增加生产根路径 `/` 完整 smoke，并把可配置页面就绪门限改为 30 秒。
2. `20260821-g5-v2` 在 30 秒公网 smoke 中失败。CDP 失败现场显示页面、控制器及其余 67 个资源均已完成，唯一 `assets/icons/236149.jpg` 的客户端连接在 5 秒后失败、请求未到服务端；该图标复用的 5 个节点 `naturalWidth=0`。版本再次保留为 failed，线上和旧 unit 再次恢复。
3. `20260821-g5-v3` 增加与技能无关的通用图标有限重试（250ms、1s、2.5s），连续三次失败会由门禁输出具体资源 URL，不会静默放行。完整门禁与公网冷启动 smoke 均通过，最终 live 保持 v3。

UI 与 `InteractiveController` 没有增加技能或天赋机制判断；图标重试只处理通用静态资源加载。没有增加固定天赋构筑，也没有复制战斗引擎。

## 2. 当前生产事实与回滚

生产状态最终复核：

```text
/home/ubuntu/sites/wow-feral-trainer
  -> /home/ubuntu/releases/wow-feral-trainer/20260821-g5-v3/wow-feral-trainer-web-20260821-g5-v3/demo

/home/ubuntu/sites/wow-feral-trainer.previous-20260821-g5-v3
  -> /home/ubuntu/releases/wow-feral-trainer/20260821-dialog-hotfix-v1/wow-feral-trainer-web-20260821-dialog-hotfix-v1/demo
```

8787 当前服务命令：

```text
/usr/bin/python3 /home/ubuntu/releases/wow-feral-trainer/cache_server.py --bind 0.0.0.0 --port 8787 --directory /home/ubuntu/sites/wow-feral-trainer
```

根页和 `release.json` 使用 `Cache-Control: no-cache, no-store, must-revalidate`；带 64 位内容哈希的资源使用 `Cache-Control: public, max-age=31536000, immutable`。最终公网根页、app.js 与 `release.json` 均为 HTTP 200，`releaseId=20260821-g5-v3`。

回滚时先把当前 live 保留为 failed，再把 `wow-feral-trainer.previous-20260821-g5-v3` 原子移回 live；同时使用 `/home/ubuntu/releases/wow-feral-trainer/20260821-g5-v3/wow-feral-trainer.before-g5-v3.service` 恢复原 unit，执行 `systemctl daemon-reload`、重启服务和 8787 健康检查。v1、v2 失败现场分别保留在：

- `/home/ubuntu/sites/wow-feral-trainer.failed-postcheck-20260821-g5-v1`
- `/home/ubuntu/sites/wow-feral-trainer.failed-postcheck-20260821-g5-v2`

## 3. SimC 上游、ResolvedProfile diff 与 unsupported

最终发布前官方 SimulationCraft `midnight` 仍为 `69a46e15b4b0b364e837998ce329801c5525a968`，版本 `12.1.0.69404`。7 个扫描文件中 5 个变化、2 个不变、15015 个增删行；`unknownChangeLineCount=0`、`reviewedMechanismCount=17`、`unreviewedMechanismCount=0`、`silentUnsupportedDropCount=0`、`aplReferencesMissingActionCount=0`。扫描目标未晋升，产品仍锁定 Build 69299 mixed snapshot。

首个测试构筑到 Primal Wrath 测试构筑的 ResolvedProfile diff 保持不变：

- Talent：`lunar_inspiration 1→0`、`primal_wrath 0→1`；
- Action：`moonfire true→false`、`primalWrath false→true`；
- internal action、effect、装备、基础/派生属性、套装、物品效果、资源、战斗属性和 modifier diff 均为空；
- 两侧 `unsupportedFields`：0 → 0；`unsupportedEffects`：45 → 45；`unsupportedAplRules`：0 → 0。

| Profile | unsupportedFields | unsupportedEffects | unsupportedAplRules |
| --- | ---: | ---: | ---: |
| `feral-user-validation-4pc` | 0 | 45 | 0 |
| `feral-primal-wrath-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-twin-sprouts-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-root-network-4pc` | 0 | 46 | 0 |
| `feral-simc-wildstalker-full-profile-4pc` | 6 | 52 | 54 |

未支持字段、效果与 APL 继续结构化输出，没有静默忽略。

## 4. 最终制品、缓存与开源声明

| 字段 | 值 |
| --- | --- |
| releaseId | `20260821-g5-v3` |
| sourceCommit | `35c7745fc14aa6f795b591479d573bd486065f45` |
| runtimeHash | `d78dc6c391a8272c6eaddda568c71d223f15d626a47facde9f18d0907f296b87` |
| catalogHash | `66d087833cf788ae64adc08e44b49038c77e5ce97934c41d134efc6b5e011275` |
| aplHash | `c3cb3bda4ce62eeda8389fb131b3ae57e23fe3ac3d8395fe746d3cd37e17a694` |
| iconManifestHash | `f46a3ae87c141080e3e68af5fd847213a26997c07f33f898f4b6385e5984396b` |
| Profile namespace | `wow-feral:69299:e71acf35764e:p1:66d087833cf7` |

| 归档 | SHA-256 |
| --- | --- |
| macOS | `0b63944ab1dec1cdf8c0a19f799a8e4916ecb45fbe9fdac10867a910413041ac` |
| Web | `7b3a3d5f1ed12bfabf86c5cfcc5098bba3453c0a53d48018154a280e6d87593c` |
| Windows | `f82a7d02ce9058c229ff128a377d4d5a36da2f0bb1ad175f6c58ea598d50ebb1` |

三包和全部解包 `FILES.sha256` 均通过。每个平台包均包含项目 `LICENSE`、`THIRD_PARTY_NOTICES.md`、SimulationCraft `COPYING` 与完整 LICENSE 集；没有删除或弱化开源声明。

## 5. 测试与验收结果

| 门禁 | 最终结果 |
| --- | --- |
| Git / GitHub | 本地 HEAD、`origin/main`、GitHub `main` 均含最终发行源码 `35c7745` |
| 当前 SimC 上游 | `69a46e15...` 扫描与 17 条语义 review 通过；目标未晋升 |
| 生成型事实 | 7 个生成器重跑幂等 |
| Unit / architecture | 78/78 通过，0 失败 |
| 原生 SimC | 1/3/5 目标，各 60 秒，通过 |
| 语法 / diff | JavaScript/MJS、Shell、Python AST、`git diff --check` 全部通过 |
| 三平台成品 | 归档 SHA-256、解包 `FILES.sha256`、白名单与开源声明全部通过 |
| 浏览器双挂载 | 离线 `/demo/` 与生产根路径 `/` 的桌面 1828×1028、H5 390×844 全部通过 |
| 图标韧性 | 人工制造一次图标加载失败，有限重试成功；最终公网 `brokenIcons=0` |
| Profile | 合法/非法/持久化/XSS 纯文本、原生与回退弹窗、旧键迁移事件/提示均通过 |
| 公网 | v3 冷启动完整 smoke 通过；1/3/5 目标、构筑切换、交互施法、H5 触控全部通过 |
| 回滚 | v1、v2 线上失败均真实恢复旧 live 和旧 unit；v3 保留旧版 previous |

## 6. 变更文件与报告

G5 自 `74784b0` 起的主要受控变更：

- `.gitignore`
- `README.md`
- `demo/app.js`
- `demo/browser-smoke.mjs`
- `demo/index.html`
- `demo/release.generated.js`
- `demo/release.json`
- `demo/tests/release-gate.test.mjs`
- `demo/tests/simc-version-lock.test.mjs`
- `packaging/cache_server.py`
- `packaging/systemd/wow-feral-trainer.service`
- `scripts/build-offline-release.mjs`
- `scripts/lib/release-gate.mjs`
- `scripts/promote-remote-release.sh`
- `scripts/run-release-gate.mjs`
- `validation/updates/12.1.0.69404-fefb8816/simc-update-report.json`
- `validation/updates/12.1.0.69404-69a46e15/simc-update-report.json`
- `versions/simc-update-reviews/12.1.0.69404-fefb8816.json`
- `versions/simc-update-reviews/12.1.0.69404-69a46e15.json`
- `validation/G4_BROWSER_UPDATE_PROFILE_MIGRATION_REPORT.md`（纠正 unsupportedEffects 计数笔误）
- `validation/G5_RELEASE_GATE_REPORT.md`

关键提交：`faee53f`（发布前门禁报告）、`8714534`（生产缓存服务打包）、`aea4f4f`（生产根路径 smoke）、`35c7745`（瞬时图标加载重试）。

## 7. 主要执行命令

```bash
node scripts/run-release-gate.mjs \
  --release-id 20260821-g5-v3 \
  --simc-target-root /private/tmp/wow-feral-simc-g5-69a46e15 \
  --simc-target-commit 69a46e15b4b0b364e837998ce329801c5525a968 \
  --simc-target-version 12.1.0.69404 \
  --simc-review-file versions/simc-update-reviews/12.1.0.69404-69a46e15.json \
  --simc-report validation/updates/12.1.0.69404-69a46e15/simc-update-report.json

node --test demo/tests/*.test.mjs
git diff --check
scp releases/20260821-g5-v3/wow-feral-trainer-web-20260821-g5-v3.tar.gz jiemu-server:/home/ubuntu/releases/wow-feral-trainer/20260821-g5-v3/
ssh jiemu-server 'sha256sum /home/ubuntu/releases/wow-feral-trainer/20260821-g5-v3/*'
ssh jiemu-server 'bash /home/ubuntu/releases/wow-feral-trainer/20260821-g5-v3/promote-remote-release.sh 20260821-g5-v3 7b3a3d5f1ed12bfabf86c5cfcc5098bba3453c0a53d48018154a280e6d87593c'
CDP_PORT=9360 CDP_TARGET_ID=<public-page> PAGE_READY_TIMEOUT_MS=30000 node demo/browser-smoke.mjs
curl --head 'http://118.24.78.126:8787/?v=20260821-g5-v3'
```

## 8. 已知风险与下一目标

- Windows 包已通过 PowerShell、结构、归档和浏览器成品门禁，但 Windows 10/11 实机双击仍未执行。
- 完整 Profile 仍有 6 个字段、52 个效果和 54 条 APL 未支持；它们已结构化输出，训练推荐不是完整 SimC 等价实现。
- 产品仍为 Build 69299 mixed snapshot；上游扫描目标 12.1.0.69404 未晋升。SimC `midnight` 再次推进时必须重新扫描、review 并 fail-closed。
- Web tar 在 Linux 解包时会提示忽略 macOS `LIBARCHIVE.xattr.com.apple.provenance` 扩展属性；所有 `FILES.sha256` 均通过，不影响内容，但后续可清理打包元数据噪声。
- Profile 使用 localStorage；浏览器配额不足时会走已测试的保留旧缓存/兼容回退路径。

下一目标：G0～G5 计划已闭环，进入维护模式。后续只在 SimC 上游变更或新需求明确进入下一轮时启动新的版本锁、差异扫描与门禁，不继续扩展固定天赋构筑。
