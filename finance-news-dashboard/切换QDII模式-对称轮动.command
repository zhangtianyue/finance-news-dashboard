#!/bin/zsh

cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "切换 QDII 轮动策略为：对称轮动 symmetric"
echo "含义：513500 贵 1 个点切到 159612；159612 贵 1 个点切回 513500。"
echo
npm run qdii:mode:symmetric
status=$?
echo
read -r "?按回车关闭窗口..."
exit $status
