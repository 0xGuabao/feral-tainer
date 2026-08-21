# G1 版本锁与 SimC 差异扫描报告

- 状态：已完成
- 完成时间：2026-08-21 09:30:28 +0800
- 基线目标：G0 `20260821-g0`
- 当前线上发行：`20260821-dialog-hotfix-v1`（未改动）
- 下一目标：G2 分离版本事实与训练器语义

## 1. 结论

G1 验收通过。项目现在有唯一的 `versions/simc.lock.json`，锁定本地可验证的 SimC 1210-01 / WoW 12.1.0.69299 混合快照、7 个扫描输入的逐文件 SHA-256、hotfix 事实和浏览器侧缓存命名空间元数据。生成脚本、SimC oracle、架构验收报告和未来发行 manifest 都从该锁读取版本，不再各自写死版本号。

差异扫描器已对官方 `midnight` 的 `b458aea6898f3b169310ed243e9934bfa37044bd` / 12.1.0.69404 执行真实扫描。7 个目标文件中 5 个有差异，`sc_druid.cpp` 与 Feral APL 完全未变。扫描出的 18 条机制候选已通过绑定 commit 和精确计数的机读 review 逐段复核，硬门禁结果为：`unreviewedMechanismCount=0`、`silentUnsupportedDropCount=0`、`aplReferencesMissingActionCount=0`、`unknownChangeLineCount=0`。

本轮没有把 12.1.0.69404 覆盖到 `vendor/simc`，没有新增固定天赋构筑，没有修改战斗引擎、UI、`app.js` 或 `InteractiveController`，也没有构建新发行包或部署。扫描通过只表示 G1 的版本事实与差异审查闭环，不表示上游目标已晋升为产品版本。

## 2. 本地版本锁

| 字段 | 锁定值 |
| --- | --- |
| SimC | `1210-01` |
| WoW | `12.1.0.69299` / Build `69299` |
| Hotfix | `2026-08-15` / Build `69299` / `053d0278...2ce7` |
| Feral 源码匹配 commit | `5b82654ba96c9dc7f611f527a41584dc94e17677` |
| commit 可信级别 | `partial-source-match` |
| 快照类型 | `mixed` |
| vendor 指纹 | `e71acf35764e9bbd16f5b0ca17c14e4a0e497e1b49c91ef70256340dbde07341` |
| Profile 缓存命名空间元数据 | `wow-feral:69299:e71acf35764e` |

当前 `vendor/simc` 没有 `.git`。锁中的 commit 只由 `sc_druid.cpp` 和 `feral_apl.inc` 与官方对应 commit 的逐字节匹配证明；generated DBC 与 `unique_gear_midnight.cpp` 由各自 SHA-256 锁定。`simcCommitVerification=partial-source-match` 和 `snapshotKind=mixed` 是硬校验字段，禁止把当前目录伪装成完整 commit checkout。

`profileCacheNamespace` 本轮只作为版本元数据生成，现有 `app.js` 的 localStorage key 未迁移；缓存迁移必须在后续目标中单独设计和回归，不能在 G1 顺带修改 UI 状态逻辑。

## 3. 上游扫描结果

目标：官方 SimulationCraft `midnight`，commit `b458aea6898f3b169310ed243e9934bfa37044bd`，WoW `12.1.0.69404`。

| 分类 | 变更行数 |
| --- | ---: |
| `version_only` | 24 |
| `talent` | 0 |
| `action_number_or_resource` | 12207 |
| `timing_or_cooldown` | 1 |
| `aura_or_dot` | 17 |
| `apl` | 0 |
| `tier_set` | 0 |
| `gear_or_trinket` | 2741 |
| `new_generic_mechanism` | 11 |
| `custom_mechanism_candidate` | 7 |
| `unknown` | 0 |

总计 15008 个增删行。`trait_data.inc` 和 `item_set_bonus.inc` 仅构建号头部变化；`sc_spell_data.inc` 与 `item_effect.inc` 有全局生成数据及索引位移，不能仅按行数推断 Feral 语义变化。Feral APL 的 26 个动作引用保持不变，没有新增或缺失动作。

`unique_gear_midnight.cpp` 的语义差异分三组：SimC 统计归属 bookkeeping、既有装备 Buff 刷新修正、以及新的 `venomcursed_ascendance` 随机属性回调。后者的 `1317036` / `1317582` 不在当前 MID1 Profile、装备 oracle 或训练器目录中；G1 不实现它。未来若采用包含这些标识的构筑，必须先产生结构化 unsupported item-effect，直到有通用机制处理器，禁止静默忽略。

机读 review 会校验目标 commit 及两类候选的精确行数（11 / 7）。上游或分类器发生漂移时扫描会直接失败，旧 review 不能自动放行新差异。

## 4. 门禁与测试

| 门禁 | 结果 |
| --- | --- |
| SimC 锁结构、7 文件哈希、vendor 指纹 | 通过 |
| 目标扫描 | 7 文件；5 变、2 不变；15008 个增删行 |
| 机制候选 review | 18 已审；`unreviewedMechanismCount=0` |
| 静默未支持丢弃 | `silentUnsupportedDropCount=0` |
| APL 缺失动作 | 26→26；新增 0；缺失 0 |
| 未分类变化 | 0 |
| `npm test` | 47/47 通过，0 失败 |
| 全部 JS/MJS `node --check` | 通过 |
| shell `bash -n` | 通过 |
| 桌面/H5 浏览器烟测 | 通过；构筑切换、1/3/5 目标、SimC 导入、非法 Profile 保留、XSS 纯文本、原生/回退弹窗均通过 |
| UI / Controller 边界 | `app.js` 与 `interactive-controller.js` 哈希和 G0 相同 |

浏览器烟测第一次因为 CDP 中没有打开的本地 Demo 页面而停止；打开 `http://127.0.0.1:4173/demo/` 后同一烟测通过，临时页和静态服务均已关闭。

## 5. ResolvedProfile diff 与 unsupported 变化

版本元数据接线后已重新生成 `validation/architecture/build-switch-acceptance.json`，产品解析语义与 G0 一致：

- 首个测试构筑到第二测试构筑仍只有 `lunar_inspiration 1→0`、`primal_wrath 0→1`，以及 `moonfire enabled→disabled`、`primalWrath disabled→enabled`。
- 两侧 `unsupportedEffects` 仍为 45；主要 Wildstalker 构筑 45，Root Network 46，完整 Profile 52。
- 完整 Profile 的 `unsupportedFields` 仍为 76：1 个 simulation-option、5 个 consumable、70 个 action-list。
- `unsupportedEffects` 变化量为 0。
- 独立 `unsupportedAplRules` 仍未建模，变化量为 0；70 条 action-list 继续保存在结构化 `unsupportedFields`，不得解释为“没有未支持 APL”。
- 上游 `venomcursed_ascendance` 没有进入当前 Profile，因此未向当前 `unsupportedEffects` 伪增记录；其未来采用条件与结构化 unsupported 决策保存在 G1 review 和扫描报告中。

## 6. 变更文件与报告

新增的版本与扫描基础设施：

- `versions/simc.lock.json`
- `versions/simc-update-reviews/12.1.0.69404.json`
- `scripts/lib/simc-version-lock.mjs`
- `scripts/lib/simc-update-scan.mjs`
- `scripts/generate-simc-version-module.mjs`
- `scripts/scan-simc-update.mjs`
- `demo/data/12.1/version.generated.js`
- `demo/tests/simc-version-lock.test.mjs`

接入唯一版本锁的现有文件：

- `scripts/generate-druid-talent-tree.mjs`
- `scripts/generate-feral-tier-set-catalog.mjs`
- `scripts/generate-simc-profile-oracle.mjs`
- `scripts/generate-architecture-acceptance.mjs`
- `scripts/build-offline-release.mjs`
- `demo/data/12.1/feral-game-data.js`
- `demo/data/12.1/feral-stat-data.js`
- `demo/package.json`
- `demo/tests/simc-data-pipeline.test.mjs`

重新生成的受控产物与报告：

- `demo/data/12.1/druid-talent-tree.generated.js`
- `demo/data/12.1/feral-tier-sets.generated.js`
- `demo/data/12.1/simc-oracle-catalog.generated.js`
- `validation/architecture/build-switch-acceptance.json`
- `validation/updates/12.1.0.69404/simc-update-report.json`
- `validation/G1_SIMC_UPDATE_REPORT.md`

## 7. 执行命令

```bash
git ls-remote https://github.com/simulationcraft/simc.git HEAD refs/heads/midnight
node scripts/generate-simc-version-module.mjs
node scripts/generate-druid-talent-tree.mjs
node scripts/generate-feral-tier-set-catalog.mjs
node scripts/generate-simc-profile-oracle.mjs
node scripts/generate-architecture-acceptance.mjs
node scripts/scan-simc-update.mjs \
  --target-root /private/tmp/wow-feral-simc-b458aea6898f \
  --target-commit b458aea6898f3b169310ed243e9934bfa37044bd \
  --target-version 12.1.0.69404 \
  --target-source https://github.com/simulationcraft/simc/tree/b458aea6898f3b169310ed243e9934bfa37044bd \
  --review-file versions/simc-update-reviews/12.1.0.69404.json
npm test
find demo scripts validation/wasm-smoke -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n 1 node --check
bash -n scripts/promote-remote-release.sh validation/run-matrix.sh validation/wasm-smoke/build.sh
python3 -m http.server 4173 --bind 127.0.0.1
npm run test:browser
```

## 8. 已知风险、回滚点与下一目标

- 项目和 vendor 仍没有 Git 元数据；恢复依赖 G0 快照，不得声称存在 commit 回滚。
- 本地 SimC 是明确锁定的 mixed snapshot；只改 `simcCommit` 不能完成版本升级。
- 12.1.0.69404 的 generated DBC 有大规模全局索引变化。G1 已保证逐行分类与 Feral 源码/APL 边界，但没有把全局数值变化直接提升为训练器语义。
- 新装备随机属性机制目前只在 review 中登记为“采用时结构化 unsupported”；若未来 Profile 引用它，必须先落实该输出门禁。
- Profile 缓存命名空间尚未接入 localStorage key；当前只生成版本事实，后续迁移需要兼容旧缓存。
- Windows 包仍缺少 Windows 10/11 实机双击验收。
- 本阶段未部署、未覆盖线上发行，远端仍是 `20260821-dialog-hotfix-v1`。

回滚点仍为 `validation/baselines/20260821-g0/project-source.tar.gz`（SHA-256 `354f741c...4c49`）和 `simc-scan-inputs.tar.gz`（SHA-256 `054e0828...0bb5`）。恢复时先解压到临时目录、核对 `project-source.sha256`，再按本报告的变更清单选择性恢复；禁止直接覆盖工作区或删除用户文件。因为 G1 没有部署，不需要远端回滚。

下一目标为 G2：分离版本事实与训练器语义。G2 开始前应先把腾讯文档状态改为“进行中”，继续使用本锁和扫描报告作为输入，不得顺带扩展固定天赋构筑。
