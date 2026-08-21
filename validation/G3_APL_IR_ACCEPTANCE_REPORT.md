# G3 APL IR 与两构筑复用验收报告

- 状态：已完成
- 开始时间：2026-08-21 10:59 +0800
- 完成时间：2026-08-21 11:24 +0800
- 修改前 Git 回滚点：`09893c396396daeaffe7369f54ff96be7c2ed5c3`
- 当前线上发行：`20260821-dialog-hotfix-v1`（未改动）
- 下一目标：G4 网页增量更新和 Profile 安全迁移

## 1. 结论

G3 验收通过。原先位于 `feral-apl-adapter.js` 的 16 个具名条件函数已迁移为版本化 authored APL AST；同一个通用解释器、Profile 编译器、`BuildResolver`、`FeralAPLAdapter` 和 `InteractiveController` 同时服务首个 Lunar Inspiration 测试构筑与第二个 Primal Wrath 差异构筑，没有复制战斗引擎。

验收覆盖两套构筑各 1/3/5 个目标、每组 20 次确定性决策，共 120 次 recommendation/cast。所有推荐技能均存在于当前 `ResolvedProfile.actionById`，首构筑 trace 出现 `moonfire` 且不出现 `primalWrath`，第二构筑的 3/5 目标 trace 出现 `primalWrath` 且不出现 `moonfire`。

完整 MID1 SimC Profile 的 70 条 APL 已严格核算为：15 条精确绑定并编译、1 条因当前构筑动作不可用而过滤、54 条结构化 `unsupportedAplRules`。核算差为 0；未进入白名单的规则没有被猜测执行或静默忽略。54 条 unsupported 不代表已获得行为支持。

## 2. 变更边界与模块职责

- `authored/feral-apl-ir.js`：保存白名单 AST、目标选择器及 SimC `list + action + condition + target_if` 精确来源绑定；具体技能/天赋标识只存在于 Catalog 数据。
- `apl/apl-ir.js`：只解释受控运算符、状态值与目标选择器，不含任何具体技能或天赋分支。
- `apl/apl-compiler.js`：精确匹配 Profile APL，按可用动作过滤，未匹配项输出带行号、原文、原因码、影响和证据引用的 `unsupportedAplRules`。
- `BuildResolver`：将编译结果写入统一 `ResolvedProfile.apl`，并把已核算的 action-list 从普通 `unsupportedFields` 移除。
- `FeralAPLAdapter`：只解释已编译 IR；旧 `CONDITIONS` 分派表已删除。
- UI 与 `InteractiveController`：只增加通用 unsupported APL 数量和列表透传/展示，没有增加任何具体技能或天赋机制判断。

固定天赋码仍只是首个测试构筑；Primal Wrath 构筑只作为差异输入与验收样本。G3 没有新增战斗机制，没有修改 generated SimC/DBC facts，没有构建发行包、部署或覆盖线上版本。

## 3. Profile APL 编译与结构化 unsupported

完整 Profile 核算：

| 类别 | 数量 | 说明 |
| --- | ---: | --- |
| Profile APL 总数 | 70 | 所有 `actions` / `actions.*` 赋值 |
| 已编译 | 15 | 四元组精确匹配 authored source binding |
| 已过滤 | 1 | `aoe.primal_wrath`；当前 Profile 不提供 `primalWrath` 动作 |
| `unsupportedAplRules` | 54 | 保留原始行与结构化原因 |
| 已核算总数 | 70 | 15 + 1 + 54 |
| 核算差 | 0 | 契约硬门禁通过 |

54 条 unsupported 的原因分布：

| reasonCode | 数量 |
| --- | ---: |
| `action_or_command_not_supported` | 27 |
| `control_flow_not_whitelisted` | 21 |
| `condition_not_whitelisted` | 6 |

新增漂移测试会修改一条原本精确匹配的 Profile 条件。结果必须由 15/1/54 变为 14/1/55，且新增项原因是 `condition_not_whitelisted`；这证明 SimC 条件变化不会继续套用旧 authored 行为。

机器证据：

- `validation/apl/g3-apl-ir-acceptance.json`，SHA-256 `dd25c253303284f59fd25f2faee7932c954f26f4e6ca25c5e42b4e60b999ee1a`
- `validation/architecture/build-switch-acceptance.json`，schema v3，SHA-256 `f8f5e06f0a4e099959ac574fefb937e25af1d25f7ab9cf87a40c4f0a5f856b03`

## 4. ResolvedProfile diff 与 unsupported 变化

首个测试构筑 → Primal Wrath 差异构筑：

- Talent：`lunar_inspiration 1→0`、`primal_wrath 0→1`；
- Action：`moonfire true→false`、`primalWrath false→true`；
- Internal Action、Effect、Resource、Combat Stat、Modifier：无变化；
- `unsupportedEffects`：45 → 45，变化量 0；
- `unsupportedAplRules`：0 → 0，变化量 0；
- APL 过滤：首构筑 15 条启用、1 条过滤；第二构筑 14 条启用、2 条过滤。

相对 G2，完整 Profile 的普通 `unsupportedFields` 从 76 降为 6，因为 70 条 action-list 已由专门 APL 核算接管；其中 54 条转入结构化 `unsupportedAplRules`，15 条进入受控 IR，1 条进入构筑过滤。剩余 6 个普通字段为 5 个 consumable 与 1 个 simulation-option。`unsupportedEffects` 未因本阶段发生变化。

## 5. 变更文件与报告

受控 APL IR 与编译：

- `demo/apl/apl-ir.js`
- `demo/apl/apl-compiler.js`
- `demo/apl/feral-apl-adapter.js`
- `demo/data/12.1/authored/feral-apl-ir.js`
- `demo/data/12.1/feral-apl-ir.js`
- `demo/data/12.1/authored/feral-game-data.js`
- `demo/core/build-resolver.js`
- `demo/core/contracts.js`

结构化输出与兼容适配：

- `demo/core/resolved-profile-compat.js`
- `demo/core/interactive-controller.js`
- `demo/app.js`

分层、追溯与测试：

- `demo/data/12.1/authored/catalog-layer-manifest.js`
- `demo/data/12.1/authored/feral-semantic-provenance.js`
- `demo/tests/apl-ir.test.mjs`
- `demo/tests/catalog-layering.test.mjs`
- `demo/tests/resolved-profile-v2.test.mjs`
- `demo/tests/simc-profile-parser.test.mjs`

生成器、文档与验收产物：

- `scripts/lib/apl-ir-acceptance.mjs`
- `scripts/generate-apl-ir-acceptance.mjs`
- `scripts/generate-architecture-acceptance.mjs`
- `scripts/build-offline-release.mjs`
- `validation/apl/g3-apl-ir-acceptance.json`
- `validation/architecture/build-switch-acceptance.json`
- `validation/G3_APL_IR_ACCEPTANCE_REPORT.md`
- `docs/ARCHITECTURE.md`
- `README.md`

## 6. 执行命令与结果

```bash
node scripts/generate-apl-ir-acceptance.mjs
node scripts/generate-architecture-acceptance.mjs
node scripts/generate-simc-version-module.mjs
node scripts/generate-druid-talent-tree.mjs
node scripts/generate-feral-tier-set-catalog.mjs
node scripts/generate-simc-profile-oracle.mjs
cd demo && npm test
find demo scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
find scripts -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
git diff --check
python3 -m http.server 4173 --bind 127.0.0.1
cd demo && npm run test:browser
```

| 验证 | 结果 |
| --- | --- |
| Unit / architecture | 60/60 通过，0 失败 |
| G3 APL IR 新门禁 | 6/6 通过 |
| 1/3/5 trace | 6 组、120 次决策；不可用技能推荐 0 |
| 完整 Profile APL 核算 | 70/70；核算差 0；action-list 遗留字段 0 |
| generated facts 重生成 | 4 个文件 SHA-256 与 G2 完全一致 |
| JS/MJS `node --check` | 通过 |
| Shell `bash -n` | 通过 |
| `git diff --check` | 通过 |
| PC/H5 浏览器烟测 | 通过；构筑切换、1/3/5、导入保护、XSS、弹窗兼容和 390×844 布局均通过 |

浏览器临时页面、隔离 Chrome、临时用户目录与本地静态服务均已关闭。

## 7. 已知风险、回滚点与下一目标

- 当前只将 16 条经过测试的规则翻译为受控 IR；完整 Profile 仍有 54 条 APL 未支持，推荐忠实度仍是明确的部分覆盖。
- 已编译规则中的 `exact` / `subset` / `simplified` fidelity 标记继续生效；精确 source binding 只证明来源未漂移，不代表所有 SimC 控制流上下文都已复现。未支持的 `call_action_list`、变量、物品和外部增益仍会影响完整优先级等价性。
- 当前 IR 解释器仅面向本地 authored Catalog，不执行任意 Profile 表达式；未来扩充运算符必须同时增加结构校验、行为测试与漂移测试。
- generated facts 仍锁定本地 12.1.0.69299 mixed snapshot；G1 扫描通过的 12.1.0.69404 尚未晋升。
- Windows 10/11 实机双击验收仍属于后续发行门禁。
- 本阶段未构建发行包、未部署、未覆盖线上，也未推送远端。线上仍为 `20260821-dialog-hotfix-v1`。

本阶段修改前 Git 回滚点为 `09893c396396daeaffe7369f54ff96be7c2ed5c3`。如需撤销，应使用可审计的反向提交或按本报告文件清单选择性恢复，不执行破坏性 reset。G0 灾备快照仍为最终文件级恢复依据。由于 G3 没有部署，无需远端回滚。

下一目标为 G4：网页增量更新和 Profile 安全迁移。开始 G4 前必须先更新腾讯文档状态；本阶段完成后仍不允许直接部署或覆盖 `20260821-dialog-hotfix-v1`，任何上线动作都必须先报告验证结果并等待确认。
