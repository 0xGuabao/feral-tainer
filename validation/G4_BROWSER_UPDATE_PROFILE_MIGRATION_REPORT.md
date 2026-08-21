# G4 浏览器哈希更新与 Profile 迁移验收报告

- 状态：已完成
- 开始时间：2026-08-21 11:28 +0800
- 完成时间：2026-08-21 11:49 +0800
- 修改前 Git 回滚点：`2bc5d02e938a8f4cf0c2afa9514b8e0a784363a0`
- G4 完成提交 / GitHub：`1f123472f194bdf39bfedfb4779f251d19ff5722`，已推送 `origin/main`
- 当前线上发行：`20260821-dialog-hotfix-v1`（未改动）
- 下一目标：G5 发布验收与经人工确认后的部署

## 1. 结论

G4 验收通过。浏览器发布现在由 `release.json`、`release.generated.js` 和生成型 import map 共同锁定：92 个部署资源按 runtime/catalog/APL/icon/metadata 分组并逐文件记录 SHA-256，JavaScript、CSS 和图标均使用 `?h=<sha256>` 内容地址。`index.html` 与 `release.json` 使用 no-cache，哈希资源使用一年 immutable；第一阶段没有注册 Service Worker。

Profile 缓存已从两个全局旧键迁移为 `game build + SimC vendor fingerprint + cache schema + catalogHash` 命名空间。每条记录保存原始 SimC、ResolvedProfile、版本事实、三类 unsupported 和迁移历史。版本/目录变化时只从原始 SimC 重解析；成功后写新命名空间并保留旧记录，解析或 localStorage 写入失败不会覆盖旧记录，兼容的旧 ResolvedProfile 可继续训练。更新发现只展示刷新按钮，不改变当前训练会话。

源码目录和最终 Web 解包包均完成桌面 1828×1028 与 H5 390×844 烟测。旧键迁移、刷新后持久化、1/3/5 目标、构筑切换、非法 Profile 不覆盖、XSS 纯文本、弹窗回退和无横向溢出全部通过。完成提交已按用户此前明确授权推送到 GitHub；没有部署或覆盖线上。

## 2. 发布清单与缓存契约

本地源码候选 `20260821-g4-local-v1`：

| 字段 | 值 |
| --- | --- |
| gameVersion / gameBuild | `12.1.0.69299` / `69299` |
| simcCommit | `5b82654ba96c9dc7f611f527a41584dc94e17677` |
| runtimeHash | `db33b954554793451163bfb3df1fe92abf5eeed100892233dc3ef2796f820928` |
| catalogHash | `66d087833cf788ae64adc08e44b49038c77e5ce97934c41d134efc6b5e011275` |
| aplHash | `c3cb3bda4ce62eeda8389fb131b3ae57e23fe3ac3d8395fe746d3cd37e17a694` |
| iconManifestHash | `f46a3ae87c141080e3e68af5fd847213a26997c07f33f898f4b6385e5984396b` |
| minimumCompatibleProfileSchema | `1` |
| profileCacheNamespace | `wow-feral:69299:e71acf35764e:p1:66d087833cf7` |
| `release.json` SHA-256 | `1fb95bde2e05d41bd8cf85c89e8a2ade53309e641e6ed7b6829ae4b1a3fb6719` |
| 资源分组 | APL 5、runtime 29、catalog 20、icon 37、metadata 1 |

单资源隔离测试只修改 `wow-hud.css`：该文件、`release.generated.js` 和 runtime 组哈希变化，catalog/APL/icon 三组哈希及其全部资源 URL 保持不变。实际 Chrome 网络记录中，除 `index.html` 与 no-store 获取的 `release.json` 外，所有加载到的本地 JS/CSS/图标均带 64 位内容哈希。

HTTP 实测：

- `/demo/`：`Cache-Control: no-cache, no-store, must-revalidate`；
- `/demo/release.json`：`Cache-Control: no-cache, no-store, must-revalidate`；
- `/demo/app.js?h=<sha256>`：`Cache-Control: public, max-age=31536000, immutable`；
- 三者均有 `X-Content-Type-Options: nosniff`。

## 3. Profile 迁移、diff 与失败回退

缓存记录包含：`schemaVersion`、namespace/releaseId、原始 SimC、ResolvedProfile、gameBuild、catalogHash、ResolvedProfile schema、`unsupportedFields`、`unsupportedEffects`、`unsupportedAplRules`、migrationHistory 和 savedAt。代表性 MID1 完整装备 Profile 的序列化缓存为 328,960 bytes。

专项门禁覆盖：

1. 旧 `ashamane-lab-simc-profile-v1` / `ashamane-lab-selected-build-v1` 迁移成功，新命名空间记录和选择键写入，旧键保留；
2. catalog namespace 变化会重解析原始 SimC，并同时返回 `resolvedProfileDiff` 与三类 unsupported added/removed/count diff；
3. 模拟 Resolver 失败时不创建/覆盖新命名空间，旧记录逐字节保持，兼容 ResolvedProfile 回退；
4. 模拟第二步 localStorage 配额失败时，第一步 Profile 写入被事务式恢复；
5. 用户主动清除时才删除旧键和所有命名空间记录；
6. 浏览器实测迁移后构筑仍为 `__simc_import__`，旧键存在，刷新后 PC/H5 都能读取新缓存。

G4 没有修改 Resolver、Catalog、APL 或战斗运行时语义，因此同一原始 Profile 在旧/新 release facts 下的 `ResolvedProfile diff` 为全空；unsupported 数量与标识均无变化。现有架构验收 SHA-256 仍为 `f8f5e06f...56b03`，G3 APL 验收仍为 `dd25c253...9ee1a`：

- 首个测试构筑 → Primal Wrath：Talent `lunar_inspiration 1→0`、`primal_wrath 0→1`；Action `moonfire true→false`、`primalWrath false→true`；其他 diff 空；
- 两构筑 `unsupportedEffects`：45 → 45；`unsupportedAplRules`：0 → 0；
- 完整 Profile APL：70 = 15 compiled + 1 filtered + 54 structured unsupported，核算差 0；
- 完整 Profile 普通 `unsupportedFields` 仍为 6，`unsupportedEffects` 仍为 70，`unsupportedAplRules` 仍为 54。

## 4. 变更文件与报告

浏览器发布与更新发现：

- `scripts/lib/browser-release.mjs`
- `scripts/generate-browser-release.mjs`
- `demo/release.json`
- `demo/release.generated.js`
- `demo/index.html`
- `demo/core/release-update.js`
- `demo/app.js`
- `demo/trainer-controller.js`
- `demo/wow-hud.css`

Profile 缓存与迁移：

- `demo/core/profile-cache.js`
- `demo/tests/profile-cache.test.mjs`

发布/缓存门禁与成品打包：

- `demo/tests/browser-release.test.mjs`
- `demo/browser-smoke.mjs`
- `packaging/cache_server.py`
- `packaging/macos/启动训练器.command`
- `packaging/windows/server.ps1`
- `packaging/使用说明.txt`
- `scripts/build-offline-release.mjs`

架构、使用说明与报告：

- `README.md`
- `docs/ARCHITECTURE.md`
- `validation/G4_BROWSER_UPDATE_PROFILE_MIGRATION_REPORT.md`

## 5. 执行命令与结果

```bash
node scripts/generate-browser-release.mjs --release-id=20260821-g4-local-v1 --created-at=2026-08-21T03:28:00.000Z
node --test demo/tests/*.test.mjs
find demo scripts validation/wasm-smoke -type f \( -name '*.js' -o -name '*.mjs' \) -exec node --check {} \;
find scripts validation -type f -name '*.sh' -exec bash -n {} \;
python3 -c 'import ast, pathlib; ast.parse(pathlib.Path("packaging/cache_server.py").read_text())'
git diff --check

node scripts/generate-simc-version-module.mjs
node scripts/generate-druid-talent-tree.mjs
node scripts/generate-feral-tier-set-catalog.mjs
node scripts/generate-simc-profile-oracle.mjs
node scripts/generate-apl-ir-acceptance.mjs
node scripts/generate-architecture-acceptance.mjs

RELEASE_ID=20260821-g4-final-gate-v2 node scripts/build-offline-release.mjs
shasum -a 256 -c SHA256SUMS.txt --status
shasum -a 256 -c FILES.sha256 --status
cd demo && npm run test:browser
git push origin main
```

| 验证 | 结果 |
| --- | --- |
| Unit / architecture | 70/70 通过，0 失败 |
| G4 专项 | browser release 4/4；Profile cache 6/6 |
| JS/MJS / Shell / Python syntax / diff | 全部通过 |
| generated facts 与 G3 验收重生成 | SHA-256 与 G3 完全一致 |
| HTTP 缓存头 | index/release no-cache；哈希资源 immutable |
| 源码 PC/H5 | 通过 |
| 最终 Web 解包包 PC/H5 | 通过；一次 reload 观察竞态导致迁移提示断言过早，增加 100ms 导航稳定等待后连续复跑通过；产品代码无需降级 |
| 三平台解包 `FILES.sha256` | 全部通过 |
| 三归档 `SHA256SUMS.txt` | 全部通过 |
| 开源声明 | 每个平台包均包含根 LICENSE、THIRD_PARTY_NOTICES.md 和 `vendor/simc/COPYING` + 全部 `LICENSE*` |
| GitHub | `origin/main` 已前进到 `1f123472f194bdf39bfedfb4779f251d19ff5722`；仓库开源声明随提交发布 |

最终本地门禁包（未部署、`releases/` 不跟踪）：

| 归档 | SHA-256 |
| --- | --- |
| macOS | `cc842d75ba681e0ebcadfbf7132da5a04f40e22622bf159d1e92d6b9d675bb5a` |
| Web | `8b4284e88501a98675edf084a8f65d0e351f5729d1579e53c7808f69c2cee483` |
| Windows | `1202ae328289c879638e9d06f11857717bc76fd45f7c47da64208ba5a42b8969` |

## 6. 已知风险、回滚点与下一目标

- 当前线上 `20260821-dialog-hotfix-v1` 仍使用旧的固定查询参数和既有服务器缓存配置；G4 只完成本地代码与成品门禁，远端 Nginx/静态服务头尚未变更。
- 浏览器更新发现依赖宿主正确发布新的 `index.html`/`release.json` 并采用本报告缓存头；部署前必须在暂存目录和公网分别复验。
- 第一阶段明确不使用 Service Worker。内容哈希只避免变更资源混用，不提供离线预缓存或后台安装。
- 兼容旧 ResolvedProfile 的失败回退要求其 schema 不低于 `minimumCompatibleProfileSchema`；不兼容时会保留原始/旧缓存并回退首个测试构筑，不会猜测迁移。
- localStorage 容量由浏览器决定；代表性记录 328,960 bytes 已通过，接近浏览器配额的超大历史仍可能触发写入回退。
- Windows PowerShell 服务通过静态审计和打包校验，但 Windows 10/11 实机双击与响应头验收仍属于 G5 发布门禁。
- 完整 Profile 仍有 54 条 APL 和 70 项效果未支持；G4 不改变该真实性边界。

本阶段修改前 Git 回滚点为 `2bc5d02e938a8f4cf0c2afa9514b8e0a784363a0`。如需撤销，使用可审计的反向提交或按本报告文件清单选择性恢复，不执行破坏性 reset。G0 灾备快照继续作为文件级恢复依据。由于 G4 未部署，线上无需回滚，仍保留 `20260821-dialog-hotfix-v1` 的既有回滚方法。

下一目标为 G5：先把腾讯文档状态改为“进行中”，复验版本锁、三平台发行包、暂存/线上缓存头、Profile 迁移和回滚脚本；任何部署或覆盖线上版本前，必须先报告完整验证结果并等待人工确认。
