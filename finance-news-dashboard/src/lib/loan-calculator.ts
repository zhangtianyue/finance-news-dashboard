export type LoanRepaymentMethod = "annuity" | "equal-principal" | "interest-only";
export type EarlyRepaymentStrategy = "reduce-payment" | "reduce-term";

export type LoanEarlyRepayment = {
  amount: number;
  month: string;
  strategy: EarlyRepaymentStrategy;
};

export type LoanCalculationInput = {
  principal: number;
  annualRate: number;
  termMonths: number;
  firstPaymentDate: string;
  method: LoanRepaymentMethod;
  fee: number;
  earlyRepayment?: LoanEarlyRepayment | null;
};

export type LoanPaymentRow = {
  period: number;
  date: string;
  regularPayment: number;
  principal: number;
  interest: number;
  extraPrincipal: number;
  totalPayment: number;
  remainingPrincipal: number;
};

export type AppliedEarlyRepayment = {
  period: number;
  date: string;
  amount: number;
  strategy: EarlyRepaymentStrategy;
};

export type LoanCalculationResult = {
  input: LoanCalculationInput;
  monthlyRate: number;
  firstPayment: number;
  lastPayment: number;
  maximumPayment: number;
  monthlyDecrease: number | null;
  totalInterest: number;
  totalRepayment: number;
  totalCost: number;
  actualMonths: number;
  endDate: string;
  schedule: LoanPaymentRow[];
  appliedEarlyRepayment: AppliedEarlyRepayment | null;
};

const balanceEpsilon = 0.005;

function assertFinitePositive(value: number, message: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("请选择有效的首次还款日期。");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("请选择有效的首次还款日期。");
  }
  return date;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addMonthsClamped(date: Date, months: number) {
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth() + months;
  const day = date.getDate();
  const firstOfMonth = new Date(targetYear, targetMonth, 1);
  const lastDay = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth() + 1,
    0,
  ).getDate();
  return new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    Math.min(day, lastDay),
  );
}

function dateMonth(value: string) {
  return value.slice(0, 7);
}

function annuityPayment(principal: number, monthlyRate: number, months: number) {
  if (months <= 0 || principal <= balanceEpsilon) return 0;
  if (Math.abs(monthlyRate) < Number.EPSILON) return principal / months;

  const factor = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function validateInput(input: LoanCalculationInput) {
  assertFinitePositive(input.principal, "贷款金额必须大于 0。");
  if (!Number.isFinite(input.annualRate) || input.annualRate < 0 || input.annualRate > 1) {
    throw new Error("年利率必须在 0% 至 100% 之间。");
  }
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1 || input.termMonths > 600) {
    throw new Error("贷款期限必须在 1 至 600 个月之间。");
  }
  if (!Number.isFinite(input.fee) || input.fee < 0) {
    throw new Error("贷款手续费不能为负数。");
  }
  const firstPaymentDate = parseLocalDate(input.firstPaymentDate);

  if (input.earlyRepayment) {
    assertFinitePositive(input.earlyRepayment.amount, "提前还款金额必须大于 0。");
    const earlyMonthMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(
      input.earlyRepayment.month,
    );
    if (!earlyMonthMatch) {
      throw new Error("请选择有效的提前还款月份。");
    }

    const earlyMonthIndex = Number(earlyMonthMatch[1]) * 12 + Number(earlyMonthMatch[2]) - 1;
    const firstMonthIndex = firstPaymentDate.getFullYear() * 12 + firstPaymentDate.getMonth();
    const finalPaymentDate = addMonthsClamped(firstPaymentDate, input.termMonths - 1);
    const finalMonthIndex = finalPaymentDate.getFullYear() * 12 + finalPaymentDate.getMonth();
    if (earlyMonthIndex < firstMonthIndex || earlyMonthIndex > finalMonthIndex) {
      throw new Error("提前还款月份必须在贷款还款期内。");
    }
  }
}

export function calculateLoan(input: LoanCalculationInput): LoanCalculationResult {
  validateInput(input);

  const monthlyRate = input.annualRate / 12;
  const firstPaymentDate = parseLocalDate(input.firstPaymentDate);
  const normalizedEarlyRepayment = input.earlyRepayment
    ? {
        ...input.earlyRepayment,
        strategy:
          input.method === "interest-only"
            ? ("reduce-payment" as const)
            : input.earlyRepayment.strategy,
      }
    : null;

  let remainingPrincipal = input.principal;
  let annuityPaymentAmount = annuityPayment(
    input.principal,
    monthlyRate,
    input.termMonths,
  );
  let equalPrincipalAmount = input.principal / input.termMonths;
  let appliedEarlyRepayment: AppliedEarlyRepayment | null = null;
  const schedule: LoanPaymentRow[] = [];

  for (
    let period = 1;
    period <= input.termMonths && remainingPrincipal > balanceEpsilon;
    period += 1
  ) {
    const paymentDate = addMonthsClamped(firstPaymentDate, period - 1);
    const paymentDateText = formatDateInput(paymentDate);
    const interest = remainingPrincipal * monthlyRate;
    let principal = 0;

    if (input.method === "annuity") {
      principal = Math.max(annuityPaymentAmount - interest, 0);
    } else if (input.method === "equal-principal") {
      principal = equalPrincipalAmount;
    } else if (period === input.termMonths) {
      principal = remainingPrincipal;
    }

    if (period === input.termMonths || principal >= remainingPrincipal - balanceEpsilon) {
      principal = remainingPrincipal;
    }

    remainingPrincipal = Math.max(remainingPrincipal - principal, 0);
    let extraPrincipal = 0;

    if (
      normalizedEarlyRepayment &&
      !appliedEarlyRepayment &&
      dateMonth(paymentDateText) === normalizedEarlyRepayment.month &&
      remainingPrincipal > balanceEpsilon
    ) {
      extraPrincipal = Math.min(normalizedEarlyRepayment.amount, remainingPrincipal);
      remainingPrincipal = Math.max(remainingPrincipal - extraPrincipal, 0);
      appliedEarlyRepayment = {
        period,
        date: paymentDateText,
        amount: extraPrincipal,
        strategy: normalizedEarlyRepayment.strategy,
      };

      const remainingMonths = input.termMonths - period;
      if (
        normalizedEarlyRepayment.strategy === "reduce-payment" &&
        remainingMonths > 0 &&
        remainingPrincipal > balanceEpsilon
      ) {
        if (input.method === "annuity") {
          annuityPaymentAmount = annuityPayment(
            remainingPrincipal,
            monthlyRate,
            remainingMonths,
          );
        } else if (input.method === "equal-principal") {
          equalPrincipalAmount = remainingPrincipal / remainingMonths;
        }
      }
    }

    const regularPayment = interest + principal;
    schedule.push({
      period,
      date: paymentDateText,
      regularPayment,
      principal,
      interest,
      extraPrincipal,
      totalPayment: regularPayment + extraPrincipal,
      remainingPrincipal,
    });
  }

  if (!schedule.length) throw new Error("无法生成还款计划。");

  const totalInterest = schedule.reduce((total, row) => total + row.interest, 0);
  const totalRepayment = schedule.reduce((total, row) => total + row.totalPayment, 0);
  const maximumPayment = schedule.reduce(
    (maximum, row) => Math.max(maximum, row.totalPayment),
    0,
  );
  const monthlyDecrease =
    input.method === "equal-principal"
      ? (input.principal / input.termMonths) * monthlyRate
      : null;

  return {
    input,
    monthlyRate,
    firstPayment: schedule[0].regularPayment,
    lastPayment: schedule.at(-1)?.regularPayment ?? 0,
    maximumPayment,
    monthlyDecrease,
    totalInterest,
    totalRepayment,
    totalCost: totalInterest + input.fee,
    actualMonths: schedule.length,
    endDate: schedule.at(-1)?.date ?? input.firstPaymentDate,
    schedule,
    appliedEarlyRepayment,
  };
}

export function principalPaid(result: LoanCalculationResult) {
  return result.schedule.reduce(
    (total, row) => total + row.principal + row.extraPrincipal,
    0,
  );
}
