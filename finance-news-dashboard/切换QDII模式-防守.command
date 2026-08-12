#!/bin/zsh

cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "切换 QDII 轮动策略为：防守 risk_off"
echo "含义：更偏向 513500，159612 必须明显便宜才持有。"
echo
npm run qdii:mode:risk-off
status=$?
echo
read -r "?按回车关闭窗口..."
exit $status
