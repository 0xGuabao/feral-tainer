# Feral Trainer

A browser-native World of Warcraft 12.1 Feral Druid rotation trainer backed by
version-locked SimulationCraft evidence.

> Non-commercial fan project. Not affiliated with or endorsed by Blizzard
> Entertainment or the SimulationCraft project. World of Warcraft names,
> trademarks, game data, and icon artwork belong to Blizzard Entertainment.
> See [Third-party notices](THIRD_PARTY_NOTICES.md).

## Features

- Decodes WoW 12.1 Druid talent export strings.
- Imports a full Feral `/simc` profile locally in the browser.
- Resolves talents, equipment, static stats, set bonuses, item effects, actions,
  resources, tracked auras/DoTs, and an APL subset into one `ResolvedProfile`.
- Supports 1, 3, and 5 stationary targets, configurable keybinds, deterministic
  proc seeds, desktop layouts, and a 390×844 mobile layout.
- Preserves unsupported fields, mechanics, and unmatched Profile APL rules as
  structured output.
- Publishes a version-locked `release.json`, content-hashed browser resources,
  and namespaced Profile cache migration with rollback-on-failure.
- Keeps the UI and `InteractiveController` free of talent/ability-specific
  mechanism branches.

The trainer models rotation state and recommendation behavior; it is not a full
damage simulator and does not replace SimulationCraft.

## Quick start

No package installation is required:

```bash
python3 packaging/cache_server.py --port 4173 --directory .
```

Open <http://localhost:4173/demo/>.

## Tests

```bash
cd demo
npm test
```

The current suite contains 76 deterministic unit and architecture tests. The
local browser smoke test is documented in `demo/browser-smoke.mjs` and requires
Chromium DevTools on port 9223.

## Versioned SimulationCraft evidence

`versions/simc.lock.json` is the single source of truth for the local SimC/WoW
snapshot. It records the SimC version, WoW build, hotfix facts, snapshot type,
seven input hashes, and a combined vendor fingerprint.

The public repository includes only the minimal SimC source/data subset needed
by the generators, update scanner, and tests. It intentionally excludes the
locally built SimC executable, object files, broad upstream checkout, generated
run results, and deployment artifacts.

Scan a separately acquired upstream tree with:

```bash
node scripts/scan-simc-update.mjs \
  --target-root /path/to/simc \
  --target-commit FULL_40_CHARACTER_SHA \
  --target-version 12.1.0.BUILD \
  --review-file versions/simc-update-reviews/REVIEW.json
```

See [the G1 report](validation/G1_SIMC_UPDATE_REPORT.md) for the current scan and
review evidence.

The native SimC executable is intentionally not committed. To regenerate native
oracles or the 1/3/5-target matrix, build/download a compatible SimulationCraft
binary and provide it explicitly:

```bash
SIMC_BIN=/path/to/simc node scripts/generate-simc-profile-oracle.mjs
SIMC_BIN=/path/to/simc bash validation/run-matrix.sh
```

## Project layout

- `demo/`: browser application, runtime, tests, generated SimC facts under
  `data/12.1/generated/`, and reviewed trainer semantics under
  `data/12.1/authored/`; stable top-level data modules are compatibility facades.
- `scripts/`: version/release generation, oracle generation, architecture
  reports, and SimC update scanning.
- `versions/`: immutable local snapshot lock and commit-bound mechanism reviews.
- `validation/`: public architecture/oracle evidence and reproducible inputs.
- `vendor/simc/`: minimal licensed upstream subset, not a complete checkout.
- `packaging/`: loopback-only macOS and Windows launchers.

## Offline packages

The G5 release gate is the supported way to create a distributable candidate.
It requires a clean commit already present on GitHub, a Git checkout of the
currently reviewed SimulationCraft `midnight` commit, and a local compatible
SimC binary. One command rechecks the live upstream branch, scans the seven
inputs, regenerates all facts, proves generation is idempotent, runs tests and
syntax gates, stages all packages, verifies checksums and legal notices, then
runs the packaged web build in desktop and 390×844 mobile Chromium:

```bash
node scripts/run-release-gate.mjs \
  --release-id 20260821-g5-rc1 \
  --simc-target-root /path/to/simc-midnight-checkout \
  --simc-target-commit 69a46e15b4b0b364e837998ce329801c5525a968 \
  --simc-target-version 12.1.0.69404 \
  --simc-review-file versions/simc-update-reviews/12.1.0.69404-69a46e15.json \
  --simc-report validation/updates/12.1.0.69404-69a46e15/simc-update-report.json
```

The final `releases/RELEASE_ID` directory appears only after every gate passes.
Failure removes the hidden staging directory and never publishes a partial
candidate. This command does not upload files or deploy the public site.

For packaging diagnostics only, without a release claim, create local macOS,
Windows, and web archives with:

```bash
node scripts/build-offline-release.mjs
```

Generated packages are written under `releases/`, which is intentionally not
tracked. A package-only manifest is explicitly marked pending until the G5 gate
replaces it with actual verification evidence. Every package carries the
project license, third-party notices, and the SimulationCraft license set.
Review third-party asset obligations before redistributing a package. Windows
10/11 launcher double-click validation remains a separate real-machine gate.

## License

Original project code is licensed under GPL-3.0-or-later. SimulationCraft files
retain their upstream licenses. Blizzard-owned names, data, trademarks, and icon
assets are not relicensed. Read [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistribution.

Contributions are covered by [CONTRIBUTING.md](CONTRIBUTING.md); security reports
should follow [SECURITY.md](SECURITY.md).
