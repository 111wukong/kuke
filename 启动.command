#!/bin/bash
# 库课 · 双击启动
#
# 首次使用需要先装依赖并构建前端（各一次）：
#   npm install && npm run build
#
# 之后双击这个文件就能起服务并打开浏览器。

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-5180}"

if [ ! -d node_modules ]; then
  echo "还没有装依赖，先跑："
  echo "  npm install"
  exit 1
fi

if [ ! -f web/dist/index.html ]; then
  echo "前端还没构建，先跑："
  echo "  npm run build"
  exit 1
fi

if [ ! -f .env ]; then
  echo "提示：还没有 .env，AI 课堂会用不了（其余功能正常）。"
  echo "      要开 AI：cp .env.example .env，把 DEEPSEEK_API_KEY 填进去。"
fi

# 等端口起来再开浏览器，别让用户看到一个「无法连接」
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://127.0.0.1:${PORT}/api/health"; then
      open "http://127.0.0.1:${PORT}" 2>/dev/null
      exit 0
    fi
    sleep 0.5
  done
) &

echo "库课启动中 · http://127.0.0.1:${PORT}"
echo "（Ctrl+C 停止）"
PORT="$PORT" node server/src/index.js
