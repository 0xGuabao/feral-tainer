# M6 当前构筑技能与天赋机制验收

验收日期：2026-08-21

## 结论

M6 本地实现与验收通过。固定 MID2 四件套范围内，正式验收构筑的技能启停、资源、DoT、Buff、概率触发与 APL 状态机制没有未分类或静默忽略项。仅影响伤害数值的效果继续以 `damage-only` 留在 `unsupportedEffects`；位移、生存、治疗和控制机制继续以 `out-of-scope` 留存。线上 8787 未更新。

## 本轮补齐

- 修正 Root Network（根系网络）的机制认知：它不是属性 Buff，而是每条活动 Bloodseeker Vine 提供 1 层、每层提高 2% 直接和周期伤害，上限 20 层。
- 新增通用 `on_dot_state_change` hook 与 `aura_sync` operation；运行时可按所有目标上的活动独立 DoT 实例总数同步 Aura，不包含 `root_network`、Root Network 或技能名判断。
- 新增 Root Network Effect/Aura Catalog，使用实际 Blizzard 图标 `ability_creature_poison_04`。
- 从 SimC Wildstalker 样本的同一选择节点把 Resilient Flourishing 切换为 Root Network，得到第三套差异构筑：

```text
CcGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjZwMzMzMmtFPwyMbzYGzMDAAAALBzGMmZUzYWYmZGjZmZAAAAAAAGAAAAAgZbmlmtZ22AzMALmBDAgZGAMA
```

- Root Network 的 Buff 层数与生命周期已经支持；每层 2% 伤害乘区因当前不计算伤害，仍结构化标记为 `damage-only`。

## 验收结果

- 本地 SimulationCraft：`1210-01 / 12.1.0.69299` 接受上述天赋码并完成 5 秒原生模拟。
- 自动测试：`node --test demo/tests/*.test.mjs`，45/45 通过。
- Root Network 运行时：Implant 先产生 1 层，普通藤蔓触发后升至 2 层，Implant 藤蔓结束后降至 1 层，最后一条藤蔓结束后 Aura 移除。
- 架构门禁：UI 与控制器公开接口未因新构筑修改；`InteractiveController` 没有天赋名分支。
- 机器报告：`validation/architecture/build-switch-acceptance.json` 现包含 6 个构筑及 `wildstalkerRootNetworkDiff`。

## unsupportedEffects 审计

| 构筑 | 总数 | damage-only | out-of-scope | 状态真实性缺口 |
| --- | ---: | ---: | ---: | ---: |
| 用户验证四件套 | 45 | 16 | 29 | 0 |
| 原始之怒四件套 | 45 | 16 | 29 | 0 |
| SimC Wildstalker / Implant | 45 | 17 | 28 | 0 |
| SimC Wildstalker / Twin Sprouts | 45 | 17 | 28 | 0 |
| SimC Wildstalker / Root Network | 46 | 18 | 28 | 0 |

完整 MID1 装备 Profile 仍额外报告 MID1 2/4 件套战斗效果未实现，以及艾恩先知的凝视刷新绕过 750ms ICD 的边缘行为；这些不属于当前固定 MID2 四件套构筑，已保留为结构化 `combat-state` / `edge-case-proc-timing`，没有被视作 M6 已支持。

## 证据

- `vendor/simc/SpellDataDump/druid.txt:17008-17049`
- `vendor/simc/engine/class_modules/sc_druid.cpp:11600-11604`
- `vendor/simc/engine/class_modules/sc_druid.cpp:13738-13746`
- `vendor/simc/engine/class_modules/sc_druid.cpp:14254`
- Root Network 图标：Icy Veins 的 Root Network 图片链接解析到 `ability_creature_poison_04`，本地文件来自 Blizzard 官方 `render.worldofwarcraft.com` CDN。
