# G5 发布前门禁报告

- 状态：本地发布候选已通过，待人工确认部署（G5 仍为进行中）
- 开始时间：2026-08-21 11:56 +0800
- 本地候选完成时间：2026-08-21 12:21:51 +0800
- 修改前 Git 回滚点：`74784b0`
- 候选源码提交 / GitHub：`9ab2092e91ff90e24dff2ad782cd067916afc1e8`，已推送 `origin/main`
- 当前线上发行：`20260821-dialog-hotfix-v1`（未改动）
- 本地候选：`20260821-g5-rc7`（未上传、未部署）
- 下一动作：等待人工确认后才允许上传 Web 归档并原子切换线上版本

## 1. 发布前结论

G5 的本地发布候选与完整门禁已经通过。唯一入口 `scripts/run-release-gate.mjs` 在同一次执行中完成 Git/GitHub 一致性、当前 SimC 上游扫描与语义 review、七组生成器幂等、77 项单元及架构测试、本地原生 SimC 1/3/5 目标矩阵、JavaScript/MJS/Shell/Python/diff 语法、三平台打包与完整性、开源声明、HTTP 缓存头、桌面/H5 Chrome、Profile 迁移，以及真实发布/回滚脚本的本地隔离演练。只有所有步骤通过后，隐藏暂存目录才会重命名为最终候选目录；失败执行均清理暂存目录且不产生最终发行。

候选对应源码 `9ab2092e91ff90e24dff2ad782cd067916afc1e8` 已在 GitHub `main`。2026-08-21 发布前只读复核确认，线上 live 仍指向 `20260821-dialog-hotfix-v1`，上一回滚版本仍为 `20260821-simc-import-v1`，8787 本机健康检查通过。本报告生成前后均未上传候选、未切换符号链接、未重启服务。

## 2. 计划基线差异与 SimC 上游事实

G5 开始后，官方 SimulationCraft `midnight` 从最初复核的 `fefb8816...` 前进到 `69a46e15b4b0b364e837998ce329801c5525a968`。门禁按设计拒绝旧目标；新增绑定完整 commit 的 review 与报告后重新执行。当前目标版本仍为 `12.1.0.69404`，七个扫描文件与前一目标逐字节相同，产品版本锁仍保持 Build 69299 mixed snapshot，扫描目标没有被提升为产品版本。

当前扫描结果：7 文件、5 变更、2 不变、15015 个增删行；`unknownChangeLineCount=0`、`reviewedMechanismCount=17`、`unreviewedMechanismCount=0`、`silentUnsupportedDropCount=0`、`aplReferencesMissingActionCount=0`。分类为 version 24、talent 0、action/resource 12234、timing 1、aura/dot 17、APL 0、tier 0、gear 2722、new generic 10、custom candidate 7、unknown 0。

审计同时发现 G4 报告把完整 Profile 的 `unsupportedEffects` 误写为 70。当前生成型架构证据与 G5 门禁均为 52；70 是 Profile 中 action-list 的总数（15 compiled + 1 filtered + 54 structured unsupported），不是 effect 数。本提交已把 G4 报告两处笔误从 70 更正为 52，不改变任何运行时或验收结果。

## 3. ResolvedProfile diff 与 unsupported

首个测试构筑到 Primal Wrath 测试构筑的 diff 保持不变：

- Talent：`lunar_inspiration 1→0`、`primal_wrath 0→1`；
- Action：`moonfire true→false`、`primalWrath false→true`；
- internal action、effect、装备、基础/派生属性、套装、物品效果、资源、战斗属性和 modifier diff 均为空；
- 两侧 `unsupportedFields`：0 → 0；`unsupportedEffects`：45 → 45；`unsupportedAplRules`：0 → 0。

六个候选构筑的当前结构化计数：

| Profile | unsupportedFields | unsupportedEffects | unsupportedAplRules |
| --- | ---: | ---: | ---: |
| `feral-user-validation-4pc` | 0 | 45 | 0 |
| `feral-primal-wrath-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-twin-sprouts-4pc` | 0 | 45 | 0 |
| `feral-simc-wildstalker-root-network-4pc` | 0 | 46 | 0 |
| `feral-simc-wildstalker-full-profile-4pc` | 6 | 52 | 54 |

未支持项继续保存在结构化结果中，没有静默丢弃。G5 没有增加固定天赋构筑、没有复制战斗引擎，也没有向 UI 或 `InteractiveController` 增加技能/天赋机制判断。

## 4. 候选、缓存与开源声明

| 字段 | 值 |
| --- | --- |
| releaseId | `20260821-g5-rc7` |
| sourceCommit | `9ab2092e91ff90e24dff2ad782cd067916afc1e8` |
| runtimeHash | `db33b954554793451163bfb3df1fe92abf5eeed100892233dc3ef2796f820928` |
| catalogHash | `66d087833cf788ae64adc08e44b49038c77e5ce97934c41d134efc6b5e011275` |
| aplHash | `c3cb3bda4ce62eeda8389fb131b3ae57e23fe3ac3d8395fe746d3cd37e17a694` |
| iconManifestHash | `f46a3ae87c141080e3e68af5fd847213a26997c07f33f898f4b6385e5984396b` |
| Profile namespace | `wow-feral:69299:e71acf35764e:p1:66d087833cf7` |

| 归档 | SHA-256 |
| --- | --- |
| macOS | `69259b08e2ad98bcc6c15760650d33288153037a72ae7e4a37745a6e3b1fee8b` |
| Web | `226b1c9d1aa89a1ca94e255df359715818594fa0892a750ebf4d1fcd0a137fb8` |
| Windows | `c185f8437e8fe521f252f61e18b4a47b022e902ae7cc7d25f4da29b84e4e1b96` |

三包和全部解包 `FILES.sha256` 均通过。每个平台包均包含项目 `LICENSE`、`THIRD_PARTY_NOTICES.md`、SimulationCraft `COPYING` 与 LICENSE；每包检测到 8 个 SimC license 文件。包内 HTTP 实测为：`index.html` / `release.json` 使用 `no-cache, no-store, must-revalidate`，哈希资源使用 `public, max-age=31536000, immutable`。

## 5. 门禁测试与失败封闭证据

| 门禁 | 结果 |
| --- | --- |
| Git / GitHub | 干净提交；本地 HEAD、`origin/main`、GitHub `main` 均为候选源码提交 |
| 当前 SimC 上游 | `69a46e15...` 扫描与 17 条语义 review 通过；目标未晋升 |
| 生成型事实 | 7 个生成器重跑幂等 |
| Unit / architecture | 77/77 通过，0 失败 |
| 原生 SimC | 1/3/5 目标，各 60 秒，通过 |
| 语法 / diff | JavaScript/MJS、Shell、Python AST、`git diff --check` 全部通过 |
| 三平台成品 | 归档 SHA-256、解包 `FILES.sha256`、白名单与开源声明全部通过 |
| 浏览器 | 桌面 1828×1028、H5 390×844、1/3/5 目标、构筑切换、图标、无裁切均通过 |
| Profile | 合法/非法/持久化/XSS 纯文本、原生与回退弹窗、旧键迁移事件/提示均通过 |
| 回滚演练 | 成功发布保留 previous；健康失败保留 failed 并恢复原 live；未触碰生产服务器 |

门禁在 rc1～rc6 依次真实拦截了：错误 Node 文件系统导入、SimC 上游前进、Node 26 测试汇总格式、macOS `/var` 路径规范化、迁移反馈竞态和初始双导航竞态。每次失败均没有生成最终候选，修复后增加回归覆盖；rc7 才完整通过。

## 6. 变更文件与报告

G5 自 `74784b0` 起的受控变更：

- `.gitignore`
- `README.md`
- `demo/browser-smoke.mjs`
- `demo/tests/release-gate.test.mjs`
- `demo/tests/simc-version-lock.test.mjs`
- `scripts/build-offline-release.mjs`
- `scripts/lib/release-gate.mjs`
- `scripts/promote-remote-release.sh`
- `scripts/run-release-gate.mjs`
- `validation/updates/12.1.0.69404-fefb8816/simc-update-report.json`
- `validation/updates/12.1.0.69404-69a46e15/simc-update-report.json`
- `versions/simc-update-reviews/12.1.0.69404-fefb8816.json`
- `versions/simc-update-reviews/12.1.0.69404-69a46e15.json`
- `validation/G4_BROWSER_UPDATE_PROFILE_MIGRATION_REPORT.md`（仅纠正 unsupportedEffects 计数笔误）
- `validation/G5_RELEASE_GATE_REPORT.md`

## 7. 主要执行命令

```bash
node scripts/run-release-gate.mjs \
  --release-id 20260821-g5-rc7 \
  --simc-target-root /private/tmp/wow-feral-simc-g5-69a46e15 \
  --simc-target-commit 69a46e15b4b0b364e837998ce329801c5525a968 \
  --simc-target-version 12.1.0.69404 \
  --simc-review-file versions/simc-update-reviews/12.1.0.69404-69a46e15.json \
  --simc-report validation/updates/12.1.0.69404-69a46e15/simc-update-report.json

node --test demo/tests/*.test.mjs
shasum -a 256 releases/20260821-g5-rc7/wow-feral-trainer-*
git diff --check
git ls-remote https://github.com/0xGuabao/feral-tainer.git refs/heads/main
ssh jiemu-server 'readlink -f /home/ubuntu/sites/wow-feral-trainer; curl --fail http://127.0.0.1:8787/'
```

## 8. 已知风险、回滚点与下一动作

- Windows 包已通过 PowerShell/结构/归档/浏览器成品门禁，但 Windows 10/11 实机双击仍未执行。
- 线上当前是原生 `python -m http.server`，不会产生 G4 的缓存策略；仅切换 Web 目录不足以通过公网缓存验收。正式发布必须同时应用经审计的宿主缓存配置（或切换到包内等价缓存服务器）并验证回滚，之后才能把公网缓存头判为通过。
- 完整 Profile 仍有 6 个字段、52 个效果和 54 条 APL 未支持；它们已结构化输出，但训练推荐不是完整 SimC 等价实现。
- SimC `midnight` 会继续前进；正式部署前若上游 HEAD 改变，门禁会再次 fail-closed，必须产生绑定新 commit 的扫描与 review。
- Profile 使用 localStorage；超大历史记录或浏览器配额不足时会走已测试的保留旧缓存/兼容回退路径。

源码回滚点为 G5 修改前 `74784b0`，当前候选源码为 `9ab2092e91ff90e24dff2ad782cd067916afc1e8`。撤销代码必须使用可审计反向提交或按文件选择性恢复，不执行破坏性 reset。本地成品回滚点为 `releases/20260821-g5-rc7`。线上尚未改变：live 为 `20260821-dialog-hotfix-v1`，previous 为 `20260821-simc-import-v1`；正式发布脚本在切换后健康失败时会把候选保留为 failed 并恢复原 live。

下一动作不是自动部署。必须先向用户报告本报告中的验证结果并等待明确确认；确认后才上传 SHA-256 已锁定的 Web 归档、在远端复验包内清单、应用可回滚的宿主缓存配置、执行原子切换，再做服务器本机与公网桌面/H5/缓存头验收。只有部署和线上验收通过后，才能把 G5 标记为已完成。
