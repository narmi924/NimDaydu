#!/bin/bash
# Stop the NimDaydu local service on macOS, releasing model memory.
set -euo pipefail
cd "$(dirname "$0")"
RECORD="$PWD/.nimdaydu/process.json"
[ -f "$RECORD" ] || { echo '没有 NimDaydu 进程记录。'; exit 0; }
pid="$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$RECORD")"
started="$(sed -n 's/.*"startTime": *"\([^"]*\)".*/\1/p' "$RECORD")"
if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then echo 'NimDaydu 已停止。'; exit 0; fi
# Refuse to signal a recycled PID that now belongs to another program.
command="$(ps -o command= -p "$pid" || true)"
current="$(ps -o lstart= -p "$pid" | sed 's/^ *//')"
case "$command" in
  *"nimdaydu.app:app --host 127.0.0.1 --port 8765"*) ;;
  *) echo '进程身份与本项目不符，未停止任何程序。' >&2; exit 1 ;;
esac
[ "$current" = "$started" ] || { echo '进程启动时间与记录不符，未停止任何程序。' >&2; exit 1; }
# The translator runs as a child process; collect it before the parent exits.
children="$(pgrep -P "$pid" || true)"
kill -TERM "$pid"
for _ in $(seq 1 50); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.2
done
kill -0 "$pid" 2>/dev/null && kill -KILL "$pid"
for child in $children; do
  case "$(ps -o command= -p "$child" 2>/dev/null || true)" in
    *llama-server*) kill -TERM "$child" 2>/dev/null || true ;;
  esac
done
echo 'NimDaydu 本机服务已停止。'
