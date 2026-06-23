#!/bin/zsh

# 双击这个文件时，macOS 会打开终端并执行本脚本。
# 目标：
# 1. 查找本地财经早报服务使用的端口。
# 2. 结束监听该端口的 Next.js / Node 进程。
# 3. 清理 Next.js dev server 残留锁文件，避免下次启动误报已有服务。

PROJECT_DIR="/Users/zhangtianyue/Documents/金融/finance-news-dashboard"
PORT="${MORNING_REPORT_PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
LOCK_FILE="${PROJECT_DIR}/.next/dev/lock"

cd "$PROJECT_DIR" || {
  echo "进入项目目录失败：$PROJECT_DIR"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "开盘财经早报服务关闭器"
echo "项目目录：$PROJECT_DIR"
echo "本地地址：$BASE_URL"
echo

if ! command -v lsof >/dev/null 2>&1; then
  echo "没有找到 lsof，无法检查端口占用。"
  read -r "?按回车关闭窗口..."
  exit 1
fi

listening_pids() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null
}

cleanup_lock() {
  if [ -f "$LOCK_FILE" ]; then
    rm -f "$LOCK_FILE"
    echo "已清理 Next.js 残留锁文件：$LOCK_FILE"
  fi
}

stop_pid() {
  local pid="$1"
  local command_line

  command_line="$(ps -p "$pid" -o command= 2>/dev/null)"
  if [ -z "$command_line" ]; then
    return
  fi

  # 避免误杀非 Node/Next 服务。如果 3000 端口被别的工具占用，只提示不处理。
  if [[ "$command_line" != *"node"* && "$command_line" != *"next"* ]]; then
    echo "跳过 PID $pid：看起来不是 Node/Next 服务。"
    echo "命令：$command_line"
    return
  fi

  echo "正在结束 PID $pid"
  echo "命令：$command_line"
  kill "$pid" 2>/dev/null
}

pids="$(listening_pids)"

if [ -z "$pids" ]; then
  echo "没有发现监听 ${PORT} 端口的服务。"
  cleanup_lock
  echo "完成。"
  echo
  read -r "?按回车关闭窗口..."
  exit 0
fi

echo "当前监听 ${PORT} 端口的进程："
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
echo

for pid in ${(f)pids}; do
  stop_pid "$pid"
done

sleep 2

remaining="$(listening_pids)"
if [ -n "$remaining" ]; then
  echo
  echo "仍有进程占用 ${PORT} 端口，尝试强制结束 Node/Next 进程..."
  for pid in ${(f)remaining}; do
    command_line="$(ps -p "$pid" -o command= 2>/dev/null)"
    if [[ "$command_line" == *"node"* || "$command_line" == *"next"* ]]; then
      echo "强制结束 PID $pid"
      kill -9 "$pid" 2>/dev/null
    else
      echo "仍跳过 PID $pid：$command_line"
    fi
  done
fi

sleep 1

if curl -fsS "${BASE_URL}/api/reports/latest" >/dev/null 2>&1; then
  echo
  echo "服务仍然有响应，请手动检查："
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
else
  echo
  echo "服务已关闭。"
fi

cleanup_lock

echo
read -r "?按回车关闭窗口..."
