import { describe, expect, it, vi } from "vitest";

import { createJob, getJob } from "@/lib/jobs/store";
import { runSearchJob } from "@/lib/search/runner";
import type { GoDaddyAvailability } from "@/lib/godaddy/client";
import type { NamelixLogo } from "@/lib/types";

const {
  scrapeNamelixMock,
  checkAvailabilityBulkMock,
  loadOptimizerModelStateMock,
  saveOptimizerModelStateMock,
} = vi.hoisted(() => ({
  scrapeNamelixMock: vi.fn<() => Promise<NamelixLogo[]>>(),
  checkAvailabilityBulkMock: vi.fn<(domains: string[]) => Promise<Map<string, GoDaddyAvailability>>>(),
  loadOptimizerModelStateMock: vi.fn(),
  saveOptimizerModelStateMock: vi.fn(),
}));

vi.mock("@/lib/namelix/scraper", async () => {
  const actual = await vi.importActual<typeof import("@/lib/namelix/scraper")>("@/lib/namelix/scraper");
  return {
    ...actual,
    scrapeNamelix: scrapeNamelixMock,
  };
});

vi.mock("@/lib/godaddy/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/godaddy/client")>("@/lib/godaddy/client");
  return {
    ...actual,
    checkAvailabilityBulk: checkAvailabilityBulkMock,
  };
});

vi.mock("@/lib/search/model-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/search/model-store")>("@/lib/search/model-store");
  return {
    ...actual,
    loadOptimizerModelState: loadOptimizerModelStateMock,
    saveOptimizerModelState: saveOptimizerModelStateMock,
  };
});

describe("runSearchJob looped aggregation", () => {
  it("runs exact loop count and aggregates unique ranked domains", async () => {
    let scrapeCall = 0;
    scrapeNamelixMock.mockImplementation(async () => {
      scrapeCall += 1;
      if (scrapeCall === 1) {
        return [{ businessName: "VeryLongBrandName" }, { businessName: "Nova" }];
      }
      if (scrapeCall === 2) {
        return [{ businessName: "Nova" }, { businessName: "Pix" }];
      }
      return [{ businessName: "Pix" }, { businessName: "Quik" }];
    });

    checkAvailabilityBulkMock.mockImplementation(async (domains) => {
      const map = new Map<string, GoDaddyAvailability>();
      for (const domain of domains) {
        if (domain === "nova.com") {
          map.set(domain, {
            domain,
            available: true,
            definitive: true,
            priceMicros: 9_000_000,
            currency: "USD",
            period: 1,
          });
          continue;
        }

        if (domain === "pix.com") {
          map.set(domain, {
            domain,
            available: true,
            definitive: true,
            priceMicros: 80_000_000,
            currency: "USD",
            period: 1,
          });
          continue;
        }

        map.set(domain, {
          domain,
          available: false,
          definitive: true,
          reason: "taken",
        });
      }

      return map;
    });

    loadOptimizerModelStateMock.mockResolvedValue({
      version: 1,
      runCount: 0,
      updatedAt: Date.now(),
      styleBandit: {
        default: { plays: 0, reward: 0 },
        brandable: { plays: 0, reward: 0 },
        twowords: { plays: 0, reward: 0 },
        threewords: { plays: 0, reward: 0 },
        compound: { plays: 0, reward: 0 },
        spelling: { plays: 0, reward: 0 },
        nonenglish: { plays: 0, reward: 0 },
        dictionary: { plays: 0, reward: 0 },
      },
      randomnessBandit: {
        low: { plays: 0, reward: 0 },
        medium: { plays: 0, reward: 0 },
        high: { plays: 0, reward: 0 },
      },
      mutationBandit: {
        low: { plays: 0, reward: 0 },
        medium: { plays: 0, reward: 0 },
        high: { plays: 0, reward: 0 },
      },
      tokenStats: {},
    });
    saveOptimizerModelStateMock.mockResolvedValue(undefined);

    const job = createJob({
      keywords: "speed tools",
      description: "memorable names",
      style: "default",
      randomness: "medium",
      blacklist: "",
      maxLength: 4,
      tld: "com",
      maxNames: 10,
      yearlyBudget: 20,
      loopCount: 3,
    });

    await runSearchJob(job.id);
    const finished = getJob(job.id);

    expect(finished?.status).toBe("done");
    expect(finished?.currentLoop).toBe(3);
    expect(finished?.totalLoops).toBe(3);
    expect(finished?.results?.loopSummaries).toHaveLength(3);
    expect(finished?.results?.tuningHistory).toHaveLength(3);
    expect(finished?.results?.allRanked.length).toBeGreaterThan(0);

    const domains = finished?.results?.allRanked.map((row) => row.domain) ?? [];
    expect(domains).toContain("nova.com");
    expect(domains).toContain("pix.com");
    expect(domains).not.toContain("verylongbrandname.com");

    for (const row of finished?.results?.allRanked ?? []) {
      const label = row.domain.split(".")[0] ?? "";
      expect(label.length).toBeLessThanOrEqual(4);
    }

    expect(new Set(domains).size).toBe(domains.length);
  });
});
