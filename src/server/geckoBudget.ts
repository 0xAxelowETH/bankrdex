// GeckoTerminal's public API allows ~30 calls/min per IP. Every server-side caller (the proxy
// route and the token catalog) draws from this one per-instance budget so together they stay
// below it. Part of the budget is reserved for charts so market refreshes cannot starve them.
const UPSTREAM_BUDGET_PER_MIN = 22;
const NON_CHART_BUDGET_PER_MIN = 16;
const upstreamCalls: number[] = [];
const nonChartCalls: number[] = [];

function trim(calls: number[], now: number) {
  while (calls.length > 0 && now - calls[0] >= 60_000) calls.shift();
}

export function hasGeckoBudget(isChartRequest: boolean, now = Date.now()): boolean {
  trim(upstreamCalls, now);
  trim(nonChartCalls, now);
  return upstreamCalls.length < UPSTREAM_BUDGET_PER_MIN &&
    (isChartRequest || nonChartCalls.length < NON_CHART_BUDGET_PER_MIN);
}

export function recordGeckoCall(isChartRequest: boolean, now = Date.now()) {
  upstreamCalls.push(now);
  if (!isChartRequest) nonChartCalls.push(now);
}
