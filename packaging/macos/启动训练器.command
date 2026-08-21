#!/bin/zsh

set -eu

SCRIPT_DIR="${0:A:h}"
SITE_DIR="$SCRIPT_DIR/site"
TRAINER_PORT="${FERAL_TRAINER_PORT:-8787}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，无法启动本地网页服务。"
  echo "请先安装 Python 3，然后再次双击本文件。"
  echo
  read "?按回车键关闭..."
  exit 1
fi

if ! [[ "$TRAINER_PORT" == <-> ]] || (( TRAINER_PORT < 1024 || TRAINER_PORT > 65535 )); then
  echo "FERAL_TRAINER_PORT 必须是 1024–65535 的端口号。"
  exit 1
fi

echo "Ashamane Lab 正在启动：http://127.0.0.1:${TRAINER_PORT}/demo/"
echo "关闭此终端窗口即可停止本地服务。"

python3 "$SCRIPT_DIR/cache_server.py" --port "$TRAINER_PORT" --directory "$SITE_DIR" &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

sleep 0.8
if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo "本地服务启动失败，端口 ${TRAINER_PORT} 可能已被占用。"
  exit 1
fi

if [[ "${FERAL_TRAINER_NO_OPEN:-0}" != "1" ]]; then
  open "http://127.0.0.1:${TRAINER_PORT}/demo/"
fi

wait "$SERVER_PID"
