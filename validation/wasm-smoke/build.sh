#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

em++ \
  "${script_dir}/trainer_smoke.cpp" \
  -O2 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_trainer_smoke,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=stringToNewUTF8,UTF8ToString \
  -o "${script_dir}/trainer-smoke.mjs"

node "${script_dir}/run-smoke.mjs"
