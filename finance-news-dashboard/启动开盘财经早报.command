#!/bin/zsh

# 双击这个文件时，macOS 会打开终端并执行本脚本。
# 目标：
# 1. 进入 finance-news-dashboard 项目目录。
# 2. 确保本地 Next.js 服务已经启动。
# 3. 调用 /api/reports/generate 生成最新开盘财经早报。
# 4. 自动打开网页，方便直接查看早报。

PROJECT_DIR="/Users/zhangtianyue/Documents/金融/finance-news-dashboard"
PORT="${MORNING_REPORT_PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
RUNTIME_DIR="${PROJECT_DIR}/data/runtime"
LOG_FILE="${RUNTIME_DIR}/morning-report-dev.log"
OUTPUT_FILE="${RUNTIME_DIR}/morning-report-latest.json"

cd "$PROJECT_DIR" || {
  echo "进入项目目录失败：$PROJECT_DIR"
  read -r "?按回车关闭窗口..."
  exit 1
}

mkdir -p "$RUNTIME_DIR"

echo "开盘财经早报启动器"
echo "项目目录：$PROJECT_DIR"
echo "本地地址：$BASE_URL"
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "没有找到 npm。请先安装 Node.js / npm。"
  read -r "?按回车关闭窗口..."
  exit 1
fi

# 先检查指定端口是否已经是本项目的 Next 服务。
# /api/reports/latest 是项目内已有接口；能返回 HTTP 响应就说明服务可用。
if curl -fsS "${BASE_URL}/api/reports/latest" >/dev/null 2>&1; then
  echo "本地服务已运行，直接生成早报。"
else
  echo "本地服务未运行，正在启动 Next.js..."
  echo "日志文件：$LOG_FILE"

  # 使用和日常访问一致的 3000 端口；如果服务已运行，上面的检查会直接复用。
  # 输出写入日志文件，终端窗口只保留关键结果。
  npm run dev -- -p "$PORT" >"$LOG_FILE" 2>&1 &
  DEV_PID=$!

  echo "Next.js 进程 PID：$DEV_PID"
  echo "等待服务就绪..."

  READY=0
  for _ in {1..45}; do
    if curl -fsS "${BASE_URL}/api/reports/latest" >/dev/null 2>&1; then
      READY=1
      break
    fi
    sleep 1
  done

  if [ "$READY" -ne 1 ]; then
    echo "服务启动超时。请查看日志：$LOG_FILE"
    read -r "?按回车关闭窗口..."
    exit 1
  fi
fi

echo
echo "正在抓取新闻源并生成最新早报..."

# 生成接口会写入 data/reports/latest.json。
# 同时把本次接口返回另存一份到 data/runtime，方便你排查或接入其他工具。
if curl -fsS -X POST "${BASE_URL}/api/reports/generate" -o "$OUTPUT_FILE"; then
  echo "早报生成成功。"
  echo "接口输出：$OUTPUT_FILE"
  echo "页面地址：$BASE_URL"
  echo

  # 打开默认浏览器查看页面。页面默认就是“开盘前财经早报”。
  open "$BASE_URL"
else
  echo "早报生成失败。请查看服务日志：$LOG_FILE"
  read -r "?按回车关闭窗口..."
  exit 1
fi

echo
read -r "?按回车关闭窗口..."
