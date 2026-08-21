# G2 Catalog 事实层与语义层分离报告

- 状态：已完成
- 开始时间：2026-08-21 10:30 +0800
- 完成时间：2026-08-21 10:50 +0800
- 修改前 Git 回滚点：`132b4e4f0d9be3559f57867e2adc486c7165978b`
- 当前线上发行：`20260821-dialog-hotfix-v1`（未改动）
- 下一目标：G3 用第二套差异天赋证明复用能力

## 1. 结论

G2 验收通过。`demo/data/12.1/` 已物理分为 `generated/` 事实层和 `authored/` 训练器语义层；原有顶层导入路径全部保留为纯 re-export Facade，因此 Resolver、Runtime、UI 与 `InteractiveController` 的公开依赖没有改变。四个生成器现在只写入 `generated/`，手写 Action/Effect/APL、装备机制、属性映射和构筑验收输入位于 `authored/`。

本轮没有新增技能、天赋或装备机制，没有为第二套天赋复制战斗引擎，没有修改 `app.js`、`trainer-controller.js`、`InteractiveController`、Resolver 或 Runtime。固定天赋码仍只作为首个测试构筑；未支持机制继续使用现有结构化输出。

新增 `CATALOG_LAYER_MANIFEST` 作为机器可读边界，新增 `FERAL_SEMANTIC_PROVENANCE` 为 190 条手写运行时规则建立版本、来源、业务 ID 和验证测试索引。92 条规则具有条目级或直接关联条目的显式证据；98 条仅能诚实标记为 `catalog-default` 目录级证据，没有伪造精确行号。

## 2. 分层结果

| 层 | 文件数 | 内容 | 约束 |
| --- | ---: | --- | --- |
| `generated/` | 4 | SimC 版本锁、天赋树、Feral 套装 DBC、Profile Oracle | 只由对应生成器写入；不得依赖 authored 层 |
| `authored/` | 6 | 战斗语义、装备语义、属性语义、验收输入、分层清单、规则追溯 | 可读取锁定 generated facts；不得保存构筑专用启用状态 |
| 顶层 Facade | 10 | 保留全部原导入路径以及两项新索引的公开路径 | 只允许 re-export，不得定义数据或行为 |

四项 generated 文件和架构验收产物在迁移前后 SHA-256 完全一致：

| 产物 | SHA-256 |
| --- | --- |
| `generated/druid-talent-tree.generated.js` | `04fd0fd338986226e3d77f5dea6e996c1fcc035f0cc08e8f7527b4867f0b03e0` |
| `generated/feral-tier-sets.generated.js` | `326d2d9a6ff9bd7260b6f8ecda4dba8f0e313cbbd8fe74f3b01f688b453eb4e6` |
| `generated/simc-oracle-catalog.generated.js` | `345d4e5ef9169eba43612181a548c36fb34455f507800d81ea9c231d8774d8f4` |
| `generated/version.generated.js` | `57cb726d3accc8c7a8b37e2ae21610940fa0bfb4115c0680b93820726c95b430` |
| `validation/architecture/build-switch-acceptance.json` | `cbaf26388f618fe8f3928f581223368676fa5e35202924c4655abb5013ffaf38` |

`app.js` 仍为 `782771d0...7edc`，`core/interactive-controller.js` 仍为 `41c7c016...4012`，与 G0/G1 基线一致。

## 3. 规则追溯

`FERAL_SEMANTIC_PROVENANCE.records` 共 190 条：

| Catalog | 数量 |
| --- | ---: |
| Set Bonus | 2 |
| Action | 12 |
| Internal Action | 13 |
| Effect | 35 |
| Talent Coverage | 88 |
| APL | 16 |
| Custom Handler | 2 |
| Item Action | 1 |
| Item Effect | 7 |
| Equipment Implementation | 11 |
| Equipment Static Modifier | 3 |

每条记录均包含锁定的 WoW/SimC 版本和 commit、来源引用、Catalog ID、可解析的 Spell/Talent/Item/Enchant/Set 标识以及验证测试。88 条 Talent Coverage 均能解析到 generated 天赋树中的 `nodeId`、`entryId`、`definitionId` 和 `spellId`。证据精度分为 `explicit=92` 与 `catalog-default=98`，架构门禁禁止缺失来源、缺失测试、未解析 Talent ID 或重复 `ruleId`。

## 4. ResolvedProfile diff 与 unsupported 变化

迁移前后 `build-switch-acceptance.json` 的 SHA-256 完全一致，因此全部 ResolvedProfile、diff 与验收证据逐字节不变。首个测试构筑到原始之怒测试构筑的 diff 仍为：

- Action：`moonfire true→false`、`primalWrath false→true`；
- Internal Action、Effect、Resource、Combat Stat、Modifier：无变化；
- 两侧 `unsupportedEffects`：45 → 45，变化量 0；
- 两侧 `unsupportedAplRules`：0 → 0，变化量 0；
- 完整 Profile 中未消费的 SimC APL 仍保存在结构化 `unsupportedFields`，没有被解释为已支持或静默丢弃。

G2 新门禁还逐项检查：Talent Coverage 的 `unsupported` / `out_of_scope` / `partially_supported` 字段保持 `mechanism + reason + impact`，装备的 `partially-supported` / `out-of-scope` 项保持结构化 `unsupportedEffects`。

## 5. 变更文件与报告

移动到 generated 层：

- `demo/data/12.1/generated/version.generated.js`
- `demo/data/12.1/generated/druid-talent-tree.generated.js`
- `demo/data/12.1/generated/feral-tier-sets.generated.js`
- `demo/data/12.1/generated/simc-oracle-catalog.generated.js`

移动到 authored 层：

- `demo/data/12.1/authored/feral-game-data.js`
- `demo/data/12.1/authored/feral-item-effect-data.js`
- `demo/data/12.1/authored/feral-stat-data.js`
- `demo/data/12.1/authored/build-fixtures.js`

新增分层与追溯：

- `demo/data/12.1/authored/catalog-layer-manifest.js`
- `demo/data/12.1/authored/feral-semantic-provenance.js`
- `demo/data/12.1/catalog-layer-manifest.js`
- `demo/data/12.1/feral-semantic-provenance.js`
- `demo/tests/catalog-layering.test.mjs`
- `validation/G2_CATALOG_LAYERING_REPORT.md`

保留为兼容 Facade：原有 8 个 `demo/data/12.1/*.js` 导入路径。同步修改四个生成器的输出路径、`docs/ARCHITECTURE.md`、`README.md` 和发行清单中的当前测试数量。没有修改产品行为文件。

## 6. 执行命令与结果

```bash
node scripts/generate-simc-version-module.mjs
node scripts/generate-druid-talent-tree.mjs
node scripts/generate-feral-tier-set-catalog.mjs
node scripts/generate-simc-profile-oracle.mjs
node scripts/generate-architecture-acceptance.mjs
cd demo && npm test
find demo scripts -type f \( -name '*.js' -o -name '*.mjs' \) -not -path '*/node_modules/*' -print0 | xargs -0 -n 1 node --check
find scripts -type f -name '*.sh' -print0 | xargs -0 -n 1 bash -n
git diff --check
python3 -m http.server 4173 --bind 127.0.0.1
cd demo && npm run test:browser
```

| 验证 | 结果 |
| --- | --- |
| generated 重生成与迁移前后哈希 | 通过；4 个模块全部逐字节一致 |
| 架构验收重生成与迁移前后哈希 | 通过；逐字节一致 |
| Unit / architecture | 54/54 通过，0 失败 |
| Catalog 分层新门禁 | 6/6 通过 |
| JS/MJS `node --check` | 通过 |
| Shell `bash -n` | 通过 |
| `git diff --check` | 通过 |
| PC/H5 浏览器烟测 | 通过；1/3/5 目标、构筑切换、SimC 导入、非法 Profile 保留、XSS 纯文本、原生/回退弹窗、390×844 布局全部通过 |

浏览器临时页和本地静态服务均已关闭。

## 7. 已知风险、回滚点与下一目标

- 98 条规则目前只有目录级权威来源，后续语义变更应逐步补为条目级证据；这是证据精度债务，不是静默支持。
- Facade 在原生浏览器 ESM 下会增加一次很小的模块请求；浏览器烟测已覆盖，离线包会完整复制嵌套目录。若未来引入 bundler，可在不改变公开路径的前提下消除此请求。
- generated facts 仍锁定本地 12.1.0.69299 mixed snapshot；G1 扫描通过的 12.1.0.69404 尚未晋升。
- Windows 10/11 实机双击验收仍属于后续发行门禁。
- 本阶段未构建发行包、未部署、未覆盖线上，也未推送远端。线上仍为 `20260821-dialog-hotfix-v1`。

本阶段修改前 Git 回滚点为 `132b4e4f0d9be3559f57867e2adc486c7165978b`。如需撤销，应使用可审计的反向提交或按本报告文件清单选择性恢复，不执行破坏性 reset。G0 灾备快照仍为最终文件级恢复依据。由于 G2 没有部署，无需远端回滚。

下一目标为 G3：用第二套差异天赋证明复用能力。开始 G3 前必须先更新腾讯文档状态；第二套差异天赋只能作为复用验收输入，不得复制战斗引擎、不得向 UI/Controller 添加具体机制判断，也不得静默忽略未支持项。
