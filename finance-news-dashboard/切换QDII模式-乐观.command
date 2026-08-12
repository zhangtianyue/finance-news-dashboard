#!/bin/zsh

cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "切换 QDII 轮动策略为：乐观 risk_on"
echo "含义：更愿意持有 159612，赚小盘溢价弹性。"
echo
npm run qdii:mode:risk-on
status=$?
echo
read -r "?按回车关闭窗口..."
exit $status
