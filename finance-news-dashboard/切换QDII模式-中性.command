#!/bin/zsh

cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "切换 QDII 轮动策略为：中性 neutral"
echo "含义：不主动押注 159612 弹性，按原始高切低思路执行。"
echo
npm run qdii:mode:neutral
status=$?
echo
read -r "?按回车关闭窗口..."
exit $status
