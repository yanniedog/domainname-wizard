import type { DomainResult, RawDomainResult, SearchResults } from "@/lib/types";

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

export function classifyDomainResults(
  rawResults: RawDomainResult[],
  yearlyBudget: number,
): SearchResults {
  const withinBudget: DomainResult[] = [];
  const overBudget: DomainResult[] = [];
  const unavailable: DomainResult[] = [];

  for (const item of rawResults) {
    const price = microsToPrice(item.priceMicros);
    const overBudgetFlag = item.available && typeof price === "number" ? price > yearlyBudget : false;

    const result: DomainResult = {
      ...item,
      price,
      overBudget: overBudgetFlag,
    };

    if (!item.available) {
      unavailable.push(result);
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
          data: { domain: result.domain, price: result.price, priceMicros: item.priceMicros, hypothesisId: "C" },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      overBudget.push(result);
      continue;
    }

    withinBudget.push(result);
  }

  withinBudget.sort(sortByPriceAscending);
  overBudget.sort(sortByPriceAscending);
  unavailable.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    withinBudget,
    overBudget,
    unavailable,
  };
}
