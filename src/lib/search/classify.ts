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
