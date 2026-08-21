#!/usr/bin/env bash

set -euo pipefail

release_id="${1:?release id is required}"
expected_sha256="${2:?archive sha256 is required}"

if [[ ! "$release_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid release id: $release_id" >&2
  exit 2
fi
if [[ ! "$expected_sha256" =~ ^[a-f0-9]{64}$ ]]; then
  echo "invalid sha256: $expected_sha256" >&2
  exit 2
fi

release_base="${FERAL_RELEASE_BASE:-/home/ubuntu/releases/wow-feral-trainer}"
site_base="${FERAL_SITE_BASE:-/home/ubuntu/sites}"
health_url="${FERAL_HEALTH_URL:-http://127.0.0.1:8787/}"

if [[ "$release_base" != /* || "$site_base" != /* ]]; then
  echo "release and site base paths must be absolute" >&2
  exit 2
fi

release_root="$release_base/$release_id"
archive="$release_root/wow-feral-trainer-web-$release_id.tar.gz"
expanded_root="$release_root/wow-feral-trainer-web-$release_id"
target="$expanded_root/demo"
live="$site_base/wow-feral-trainer"
previous="$site_base/wow-feral-trainer.previous-$release_id"
failed="$site_base/wow-feral-trainer.failed-$release_id"

[[ -f "$archive" ]] || { echo "archive missing: $archive" >&2; exit 3; }
actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$actual_sha256" == "$expected_sha256" ]] || { echo "archive sha256 mismatch" >&2; exit 4; }
[[ ! -e "$expanded_root" ]] || { echo "expanded release already exists: $expanded_root" >&2; exit 5; }
[[ -d "$live" ]] || { echo "live path is not a valid site directory or symlink" >&2; exit 6; }
[[ ! -e "$previous" ]] || { echo "rollback path already exists: $previous" >&2; exit 7; }
[[ ! -e "$failed" ]] || { echo "failed path already exists: $failed" >&2; exit 8; }

tar -xzf "$archive" -C "$release_root"
[[ -f "$target/index.html" ]] || { echo "release entry missing" >&2; exit 9; }
(cd "$expanded_root" && sha256sum -c FILES.sha256)

mv "$live" "$previous"
if ! ln -s "$target" "$live"; then
  mv "$previous" "$live"
  exit 10
fi

if ! curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
  mv "$live" "$failed"
  mv "$previous" "$live"
  exit 11
fi

printf 'release_id=%s\narchive_sha256=%s\nlive=%s\nrollback=%s\n' \
  "$release_id" "$actual_sha256" "$target" "$previous" \
  > "$release_root/deployment.txt"

echo "promoted $release_id"
echo "live=$live"
echo "rollback=$previous"
