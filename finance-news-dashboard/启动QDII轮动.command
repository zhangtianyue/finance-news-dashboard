#!/bin/zsh

# 双击这个文件时，macOS 会用终端执行它。
# 这里先切到项目目录，确保 npm 能找到 package.json 和 scripts/qdii-sp500-rotation.mjs。
cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "正在运行 QDII 513500 / 159612 溢价轮动脚本..."
echo

npm run qdii:rotation
status=$?

echo
echo "脚本退出码：$status"
echo "状态文件位置：data/runtime/qdii-sp500-rotation-state.json"
echo
read -r "?按回车关闭窗口..."

exit $status
