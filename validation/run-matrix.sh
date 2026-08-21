#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
simc_bin="${SIMC_BIN:-${project_dir}/vendor/simc/engine/simc}"
profile="${project_dir}/validation/profiles/feral-12.1-base.simc"
results_dir="${project_dir}/validation/results"

mkdir -p "${results_dir}"

if [[ ! -x "${simc_bin}" ]]; then
  echo "SimulationCraft CLI not found: ${simc_bin}" >&2
  exit 1
fi

for target_count in 1 3 5; do
  output_prefix="${results_dir}/feral-${target_count}t-4pc"
  echo "Validating ${target_count} target(s), fixed 4pc"

  "${simc_bin}" \
    "${profile}" \
    "set_bonus=latest_2pc=1/latest_4pc=1" \
    "desired_targets=${target_count}" \
    "json=${output_prefix}.json" \
    "output=${output_prefix}.txt"
done

echo "Validation matrix written to ${results_dir}"
