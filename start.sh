#!/bin/bash
# Start the NimDaydu local service on macOS. Logs: .nimdaydu/service.err.log
set -euo pipefail
cd "$(dirname "$0")"
PROJECT="$PWD"
PY="$PROJECT/local-service/.venv/bin/python"
STATE="$PROJECT/.nimdaydu"
[ -x "$PY" ] || { echo '请先运行 setup.sh。' >&2; exit 1; }
mkdir -p "$STATE"
export PYTHONUTF8=1

# Prints ready / loading / error:<message> / other / none for whatever answers on port 8765.
health() {
  local body
  body="$(curl -s -m 2 http://127.0.0.1:8765/health 2>/dev/null || true)"
  printf '%s' "$body" | "$PY" -c '
import json, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    data = None
if data is None: print("none")
elif data.get("app") != "NimDaydu": print("other")
elif data.get("error"): print("error:" + data["error"])
else: print("ready" if data.get("ready") else "loading")'
}

state="$(health)"
case "$state" in
  ready) echo 'NimDaydu 已在运行。'; exit 0 ;;
  other) echo '端口 8765 被其他程序占用。' >&2; exit 1 ;;
  loading|error:*) echo 'NimDaydu 正在运行但模型未就绪。请先运行 Stop-NimDaydu.command，再重新启动；详情见 .nimdaydu/service.err.log。' >&2; exit 1 ;;
esac

# A new session detaches the service from this Terminal window, so closing
# the window neither prompts nor stops captions.
pid="$(cd "$PROJECT/local-service" && "$PY" -c '
import subprocess, sys
state = sys.argv[1]
process = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "nimdaydu.app:app", "--host", "127.0.0.1", "--port", "8765",
     "--ws-max-size", "262144", "--no-access-log"],
    stdin=subprocess.DEVNULL, stdout=open(state + "/service.out.log", "w"),
    stderr=open(state + "/service.err.log", "w"), start_new_session=True)
print(process.pid)' "$STATE")"
printf '{"pid": %s, "startTime": "%s", "executable": "%s"}\n' "$pid" "$(ps -o lstart= -p "$pid" | sed 's/^ *//')" "$PY" > "$STATE/process.json"

# The first start after setup also compiles the translator's Metal kernels.
for _ in $(seq 1 300); do
  sleep 0.3
  if ! kill -0 "$pid" 2>/dev/null; then
    echo '服务已退出，请查看 .nimdaydu/service.err.log。' >&2; exit 1
  fi
  state="$(health)"
  case "$state" in
    ready)
      summary="$(curl -s -m 2 http://127.0.0.1:8765/health | "$PY" -c 'import json,sys; d=json.load(sys.stdin); print("识别", d["model"], "· 翻译", d.get("translationEngine") or "未就绪")')"
      echo "NimDaydu 已就绪：$summary。音频只在这台 Mac 上处理。"
      echo 'Chrome 扩展会自动连接，无需配对码。可以关闭这个窗口。'
      exit 0 ;;
    error:*) echo "${state#error:}" >&2; exit 1 ;;
  esac
done
echo '启动超时，请查看 .nimdaydu/service.err.log。' >&2
exit 1
