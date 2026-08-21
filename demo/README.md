# Ashamane Lab 浏览器 Demo

可玩的 WoW 12.1 野性德鲁伊交互训练器，支持：

- 从 12.1 天赋代码解析并切换构筑；
- 在网页中粘贴完整 `/simc` Profile，解析、保存并切换为独立训练构筑；
- MID2 两件套与四件套、1/3/5 个静止木桩；
- 动态技能栏、可配置并持久化的键位、键盘与鼠标施法；
- 推荐技能、能量、连击点、GCD、DoT、Buff 与概率触发；
- 茁壮生长累加器、可重叠血棘藤蔓、Twin Sprouts 与 Implant 构筑联动；
- 中上部施法顺序、左下战斗记录和参考 WoW HUD 的布局。

UI 只消费 `ResolvedProfile` 的 Catalog、控制器 Snapshot 与 Events。构筑是否启用技能、效果和 APL 规则由 `TalentDecoder + BuildResolver` 推导，固定天赋码仅作为验收样本。

## 启动

从项目根目录运行：

```bash
python3 -m http.server 4173
```

打开 <http://localhost:4173/demo/>。

## 测试

```bash
cd demo
npm test
npm run test:browser
```

浏览器烟雾测试需要 Chrome 以调试端口 `9223` 启动，并已打开 Demo。它验证施法、改键、1/3/5 目标、构筑切换、血棘藤蔓/Implant 的真实图标与监控状态，以及 390px H5 的控件命中、无横向裁切、触控尺寸、自定义时长和增益选择功能。

## 导入 SimC Profile

点击训练控制栏中的“导入 SimC”，粘贴游戏内 `/simc` 导出的完整文本后选择“解析并使用”。Profile 必须包含 `talents=`，且 `spec` 必须为 `feral`；成功导入后会保存在当前浏览器，并出现在“天赋构筑”下拉框中。

导入器会同时显示可用技能、未应用字段和未实现效果数量，并列出前 8 项原因。解析失败不会覆盖当前构筑或先前保存的 Profile。当前支持的是统一 Profile 输入与已登记角色/装备/效果解析，不代表所有 SimC 字段、APL 或伤害公式均已实现。

当前真实性边界是资源、技能可用性、DoT/Buff 时间、通用触发和交互式 APL 子集；不计算伤害，也不等价于完整 SimulationCraft。详细模块边界与换天赋门禁见 [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)。
