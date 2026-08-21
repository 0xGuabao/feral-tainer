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
- Keeps the UI and `InteractiveController` free of talent/ability-specific
  mechanism branches.

The trainer models rotation state and recommendation behavior; it is not a full
damage simulator and does not replace SimulationCraft.

## Quick start

No package installation is required:

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173/demo/>.

## Tests

```bash
cd demo
npm test
```

The current suite contains 60 deterministic unit and architecture tests. The
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
- `scripts/`: version generation, oracle generation, architecture reports, and
  SimC update scanning.
- `versions/`: immutable local snapshot lock and commit-bound mechanism reviews.
- `validation/`: public architecture/oracle evidence and reproducible inputs.
- `vendor/simc/`: minimal licensed upstream subset, not a complete checkout.
- `packaging/`: loopback-only macOS and Windows launchers.

## Offline packages

Create local macOS, Windows, and web archives with:

```bash
node scripts/build-offline-release.mjs
```

Generated packages are written under `releases/`, which is intentionally not
tracked. Review third-party asset obligations before redistributing a package.

## License

Original project code is licensed under GPL-3.0-or-later. SimulationCraft files
retain their upstream licenses. Blizzard-owned names, data, trademarks, and icon
assets are not relicensed. Read [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistribution.

Contributions are covered by [CONTRIBUTING.md](CONTRIBUTING.md); security reports
should follow [SECURITY.md](SECURITY.md).
