#!/bin/bash
# NimDaydu setup for macOS on Apple Silicon. Usage: bash setup.sh [hybrid|small|medium]
# Everything is installed inside this project folder; no sudo or Homebrew needed.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT="$PWD"
MODEL="${1:-}"
UV_VERSION=0.11.6
UV_SHA256=4b69a4e366ec38cd5f305707de95e12951181c448679a00dce2a78868dfc9f5b
NODE_VERSION=24.22.1
NODE_SHA256=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7

fail() { echo "安装失败：$*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || fail '这个脚本只用于 macOS；Windows 请运行 setup.ps1。'
[ "$(uname -m)" = arm64 ] || fail '需要 Apple 芯片（M1 及以后）的 Mac。'
macos_major="$(sw_vers -productVersion | cut -d. -f1)"
[ "$macos_major" -ge 15 ] || fail '需要 macOS 15 或更新版本。'
case "$MODEL" in ''|hybrid|small|medium) ;; *) fail '识别方式只能是 hybrid、small 或 medium。' ;; esac

TOOLS="$PROJECT/.tools"
mkdir -p "$TOOLS/downloads" "$PROJECT/.nimdaydu"

# Download into .tools/downloads and refuse anything whose checksum differs.
fetch() {
  local url="$1" target="$2" sha="$3"
  if [ ! -f "$target" ] || [ "$(shasum -a 256 "$target" | cut -d' ' -f1)" != "$sha" ]; then
    echo "下载 $(basename "$target") …"
    curl -fL --retry 3 -o "$target.part" "$url" || fail "无法下载 $url"
    mv "$target.part" "$target"
  fi
  [ "$(shasum -a 256 "$target" | cut -d' ' -f1)" = "$sha" ] || { rm -f "$target"; fail "$(basename "$target") 校验失败，请重新运行。"; }
}

UV="$TOOLS/uv-$UV_VERSION/uv"
if [ ! -x "$UV" ]; then
  archive="$TOOLS/downloads/uv-aarch64-apple-darwin-$UV_VERSION.tar.gz"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-aarch64-apple-darwin.tar.gz" "$archive" "$UV_SHA256"
  mkdir -p "$TOOLS/uv-$UV_VERSION"
  tar -xzf "$archive" -C "$TOOLS/uv-$UV_VERSION" --strip-components 1
fi

NODE_HOME="$TOOLS/node-v$NODE_VERSION-darwin-arm64"
if [ ! -x "$NODE_HOME/bin/node" ]; then
  archive="$TOOLS/downloads/node-v$NODE_VERSION-darwin-arm64.tar.gz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz" "$archive" "$NODE_SHA256"
  tar -xzf "$archive" -C "$TOOLS"
fi
export PATH="$NODE_HOME/bin:$PATH"
export UV_PYTHON_INSTALL_DIR="$TOOLS/python"
export PYTHONUTF8=1

cd "$PROJECT/local-service"
"$UV" sync --python 3.12 --frozen || fail 'Python 依赖安装失败。'
PY="$PROJECT/local-service/.venv/bin/python"
selected="${MODEL:-hybrid}"
if [ -z "$MODEL" ] && [ -f "$PROJECT/.nimdaydu/asr-model.json" ]; then
  selected="$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8-sig")).get("model") or "hybrid")' "$PROJECT/.nimdaydu/asr-model.json")"
fi
draft="$selected"; [ "$draft" = hybrid ] && draft=small
"$PY" download_models.py --models "$draft" || fail '语音模型下载失败，重新运行 setup.sh 可以续传。'
if [ "$selected" = hybrid ]; then
  "$PY" download_refiner.py || fail '整句复核模型下载失败。'
fi
"$PY" download_translation.py || fail '备用离线翻译模型下载失败。'
"$PY" download_llm.py || fail '本机翻译模型下载失败。'

cd "$PROJECT/extension"
npm ci --registry https://registry.npmjs.org || fail '扩展依赖安装失败。'
npm run build || fail '扩展构建失败。'

if [ -n "$MODEL" ] || [ ! -f "$PROJECT/.nimdaydu/asr-model.json" ]; then
  printf '{"model": "%s"}\n' "$selected" > "$PROJECT/.nimdaydu/asr-model.json"
fi
chmod +x "$PROJECT/start.sh" "$PROJECT/stop.sh" "$PROJECT/Start-NimDaydu.command" "$PROJECT/Stop-NimDaydu.command" 2>/dev/null || true
echo
echo '安装完成。'
echo '1. 双击 Start-NimDaydu.command 启动本机服务。'
echo "2. 在 Chrome 打开 chrome://extensions，开启开发者模式，加载 $PROJECT/extension/.output/chrome-mv3"
