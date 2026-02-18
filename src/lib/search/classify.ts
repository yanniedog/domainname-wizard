import type {
  DomainResult,
  RankedDomainResult,
  RawDomainResult,
  SearchResults,
  TuningStep,
  ValueDriver,
  LoopSummary,
} from "@/lib/types";

function microsToPrice(micros?: number): number | undefined {
  if (typeof micros !== "number") {
    return undefined;
  }

  return Number((micros / 1_000_000).toFixed(2));
}

function sortByPriceAscending(a: DomainResult, b: DomainResult): number {
  const aPrice = a.price ?? Number.POSITIVE_INFINITY;
  const bPrice = b.price ?? Number.POSITIVE_INFINITY;

  if (aPrice !== bPrice) {
    return aPrice - bPrice;
  }

  return a.domain.localeCompare(b.domain);
}

function toRanked(result: DomainResult): RankedDomainResult {
  const neutralDriver: ValueDriver = {
    component: "unscored",
    impact: 0,
    detail: "Legacy classification path without scoring engine.",
  };

  return {
    ...result,
    marketabilityScore: 0,
    financialValueScore: 0,
    overallScore: 0,
    syllableCount: 0,
    labelLength: 0,
    valueDrivers: [neutralDriver],
    valueDetractors: [],
    firstSeenLoop: 1,
    lastSeenLoop: 1,
    timesDiscovered: 1,
  };
}

function sortRankedByPriceAscending(a: RankedDomainResult, b: RankedDomainResult): number {
  return sortByPriceAscending(a, b);
}

export function classifyDomainResults(
  rawResults: RawDomainResult[],
  yearlyBudget: number,
): SearchResults {
  const withinBudget: RankedDomainResult[] = [];
  const overBudget: RankedDomainResult[] = [];
  const unavailable: RankedDomainResult[] = [];

  for (const item of rawResults) {
    const price = microsToPrice(item.priceMicros);
    const overBudgetFlag = item.available && typeof price === "number" ? price > yearlyBudget : false;

    const result: DomainResult = {
      ...item,
      price,
      overBudget: overBudgetFlag,
    };
    const ranked = toRanked(result);

    if (!item.available) {
      unavailable.push(ranked);
      continue;
    }

    if (overBudgetFlag) {
      // #region agent log
      fetch("http://127.0.0.1:7278/ingest/12c75e00-6c9a-482c-b25d-6079b2218f1d", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "1e9370" },
        body: JSON.stringify({
          sessionId: "1e9370",
          location: "classify.ts:overBudgetEntry",
          message: "Overbudget row",
          data: { domain: ranked.domain, price: ranked.price, priceMicros: item.priceMicros, hypothesisId: "C" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      overBudget.push(ranked);
      continue;
    }

    withinBudget.push(ranked);
  }

  withinBudget.sort(sortRankedByPriceAscending);
  overBudget.sort(sortRankedByPriceAscending);
  unavailable.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    withinBudget,
    overBudget,
    unavailable,
    allRanked: [...withinBudget, ...overBudget, ...unavailable],
    loopSummaries: [],
    tuningHistory: [],
  };
}

export function classifyRankedResults(
  rankedResults: RankedDomainResult[],
  loopSummaries: LoopSummary[],
  tuningHistory: TuningStep[],
): SearchResults {
  const withinBudget = rankedResults
    .filter((result) => result.available && !result.overBudget)
    .sort(sortRankedByPriceAscending);
  const overBudget = rankedResults
    .filter((result) => result.available && result.overBudget)
    .sort(sortRankedByPriceAscending);
  const unavailable = rankedResults
    .filter((result) => !result.available)
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    withinBudget,
    overBudget,
    unavailable,
    allRanked: rankedResults,
    loopSummaries,
    tuningHistory,
  };
}
