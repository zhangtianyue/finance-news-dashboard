#!/bin/zsh

# 只在券商账户确实没有 513500 和 159612 持仓时使用这个启动器。
# 它会把当前持仓明确设为 none，再根据卖一价计算的可成交溢价选择首次建仓标的。
cd "/Users/zhangtianyue/Documents/金融/finance-news-dashboard" || {
  echo "进入项目目录失败"
  read -r "?按回车关闭窗口..."
  exit 1
}

echo "正在按空仓首次建仓规则比较 513500 / 159612..."
echo "直接选可成交买入溢价更低的一只；两者完全相同时选择 513500。"
echo

npm run qdii:rotation:empty
status=$?

echo
echo "脚本退出码：$status"
read -r "?按回车关闭窗口..."
exit $status
