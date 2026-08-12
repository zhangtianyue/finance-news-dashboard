export type DatedCashFlow = {
  date: Date;
  amount: number;
};

const millisecondsPerYear = 365.25 * 24 * 60 * 60 * 1000;
const minimumRate = -0.999999;
const maximumRate = 1_000_000;

function xnpv(rate: number, cashFlows: DatedCashFlow[], firstTime: number) {
  return cashFlows.reduce((total, cashFlow) => {
    const years = (cashFlow.date.getTime() - firstTime) / millisecondsPerYear;
    return total + cashFlow.amount / Math.pow(1 + rate, years);
  }, 0);
}

export function calculateXirr(cashFlows: DatedCashFlow[]) {
  const flows = cashFlows
    .filter(
      (cashFlow) =>
        Number.isFinite(cashFlow.amount) && Number.isFinite(cashFlow.date.getTime()),
    )
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  if (
    flows.length < 2 ||
    !flows.some((cashFlow) => cashFlow.amount < 0) ||
    !flows.some((cashFlow) => cashFlow.amount > 0)
  ) {
    return null;
  }

  const firstTime = flows[0].date.getTime();
  if (flows.at(-1)?.date.getTime() === firstTime) return null;

  let low = minimumRate;
  let high = 1;
  let lowValue = xnpv(low, flows, firstTime);
  let highValue = xnpv(high, flows, firstTime);

  while (Math.sign(lowValue) === Math.sign(highValue) && high < maximumRate) {
    high = high * 2 + 1;
    highValue = xnpv(high, flows, firstTime);
  }
  if (Number.isNaN(lowValue) || Number.isNaN(highValue)) return null;
  if (Math.sign(lowValue) === Math.sign(highValue)) return null;

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const mid = (low + high) / 2;
    const midValue = xnpv(mid, flows, firstTime);
    if (Number.isNaN(midValue)) return null;
    if (Math.abs(midValue) < 1e-8) return mid;

    if (Math.sign(midValue) === Math.sign(lowValue)) {
      low = mid;
      lowValue = midValue;
    } else {
      high = mid;
      highValue = midValue;
    }
  }

  return (low + high) / 2;
}
