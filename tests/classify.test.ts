import { describe, expect, it } from "vitest";

import { classifyDomainResults } from "@/lib/search/classify";

describe("budget classification", () => {
  it("splits within-budget, over-budget, and unavailable buckets", () => {
    const results = classifyDomainResults(
      [
        {
          domain: "alpha.com",
          sourceName: "Alpha",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 20_000_000,
          currency: "USD",
        },
        {
          domain: "beta.com",
          sourceName: "Beta",
          isNamelixPremium: true,
          available: true,
          definitive: true,
          priceMicros: 80_000_000,
          currency: "USD",
        },
        {
          domain: "gamma.com",
          sourceName: "Gamma",
          isNamelixPremium: false,
          available: false,
          definitive: false,
          reason: "taken",
        },
      ],
      50,
    );

    expect(results.withinBudget).toHaveLength(1);
    expect(results.overBudget).toHaveLength(1);
    expect(results.unavailable).toHaveLength(1);

    expect(results.withinBudget[0]?.domain).toBe("alpha.com");
    expect(results.overBudget[0]?.domain).toBe("beta.com");
    expect(results.overBudget[0]?.isNamelixPremium).toBe(true);
    expect(results.unavailable[0]?.domain).toBe("gamma.com");
  });

  it("sorts available results by lowest price first", () => {
    const results = classifyDomainResults(
      [
        {
          domain: "zeta.com",
          sourceName: "Zeta",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 30_000_000,
          currency: "USD",
        },
        {
          domain: "alpha.com",
          sourceName: "Alpha",
          isNamelixPremium: false,
          available: true,
          definitive: true,
          priceMicros: 10_000_000,
          currency: "USD",
        },
      ],
      50,
    );

    expect(results.withinBudget[0]?.domain).toBe("alpha.com");
    expect(results.withinBudget[1]?.domain).toBe("zeta.com");
  });
});

