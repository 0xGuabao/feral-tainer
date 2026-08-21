# Contributing

Contributions are welcome through GitHub issues and pull requests.

## Development checks

Run the deterministic unit and architecture suite:

```bash
cd demo
npm test
```

Run syntax checks from the repository root:

```bash
find demo scripts validation/wasm-smoke -type f \
  \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n 1 node --check
bash -n validation/run-matrix.sh validation/wasm-smoke/build.sh
```

Browser smoke tests additionally require a local server and a Chromium instance
with the DevTools protocol available on port 9223. See `demo/browser-smoke.mjs`.

## Architecture constraints

- Keep build-specific facts in generated data or authored semantic catalogs.
- Do not add ability or talent-name branches to the UI or
  `InteractiveController`.
- Do not duplicate the combat engine for a second talent build.
- Preserve unsupported mechanics as structured output; never silently drop
  them.
- Update `versions/simc.lock.json` and run the SimC update scanner when an
  upstream input changes.

## Licensing and assets

By submitting code, you agree that your contribution may be distributed under
GPL-3.0-or-later. Do not submit copyrighted game assets, private profiles,
credentials, deployment details, or third-party code without a compatible
license and attribution. Read `THIRD_PARTY_NOTICES.md` before changing vendored
files or visual assets.
