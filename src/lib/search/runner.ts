import {
  normalizeBusinessNameToLabel,
  normalizeTld,
} from "@/lib/domain/normalize";
import {
  GoDaddyApiError,
  GoDaddyAuthError,
  GoDaddyRateLimitError,
  checkAvailabilityBulk,
} from "@/lib/godaddy/client";
import {
  getCachedSearchResult,
  getJob,
  markJobComplete,
  markJobFailed,
  markJobRunning,
  patchJob,
  setCachedSearchResult,
} from "@/lib/jobs/store";
import { NamelixScrapeError, scrapeNamelix } from "@/lib/namelix/scraper";
import { classifyRankedResults } from "@/lib/search/classify";
import { loadOptimizerModelState, saveOptimizerModelState } from "@/lib/search/model-store";
import { DomainSearchOptimizer } from "@/lib/search/optimizer";
import { scoreDomainResult, scoreRewardFromRankedScores } from "@/lib/search/scoring";
import { sortRankedDomains } from "@/lib/search/sort";
import type {
  DomainResult,
  JobError,
  LoopSummary,
  RankedDomainResult,
  RawDomainResult,
  SearchRequest,
  TuningStep,
} from "@/lib/types";

interface DomainCandidate {
  domain: string;
  sourceName: string;
  isNamelixPremium: boolean;
}

interface IterationResults {
  ranked: RankedDomainResult[];
  availableCount: number;
  withinBudgetCount: number;
  averageOverallScore: number;
  topDomain?: string;
  topScore?: number;
}

function buildCacheKey(input: SearchRequest): string {
  return JSON.stringify({
    keywords: input.keywords.trim().toLowerCase(),
    description: (input.description ?? "").trim().toLowerCase(),
    style: input.style,
    randomness: input.randomness,
    blacklist: (input.blacklist ?? "").trim().toLowerCase(),
    maxLength: input.maxLength,
    tld: input.tld.trim().toLowerCase().replace(/^\./, ""),
    maxNames: input.maxNames,
  });
}

export function buildDomainCandidates(
  input: SearchRequest,
  logos: Awaited<ReturnType<typeof scrapeNamelix>>,
) {
  const candidates: DomainCandidate[] = [];
  const invalid: RawDomainResult[] = [];
  const seenDomains = new Set<string>();
  const normalizedTld = normalizeTld(input.tld);

  if (!normalizedTld) {
    throw new Error("Invalid TLD after normalization.");
  }

  for (const logo of logos) {
    const sourceName = logo.businessName;
    const isNamelixPremium = logo.name === "premium";
    const label = normalizeBusinessNameToLabel(sourceName);

    if (!label) {
      invalid.push({
        domain: `${sourceName} (invalid)`,
        sourceName,
        isNamelixPremium,
        available: false,
        definitive: false,
        reason: "Unable to normalize business name into a valid domain label.",
      });
      continue;
    }

    if (label.length > input.maxLength) {
      invalid.push({
        domain: `${sourceName} (invalid)`,
        sourceName,
        isNamelixPremium,
        available: false,
        definitive: false,
        reason: `Normalized label length ${label.length} exceeds maxLength ${input.maxLength}.`,
      });
      continue;
    }

    const domain = `${label}.${normalizedTld}`;
    if (seenDomains.has(domain)) {
      continue;
    }

    seenDomains.add(domain);
    candidates.push({
      domain,
      sourceName,
      isNamelixPremium,
    });
  }

  return {
    candidates,
    invalid,
  };
}

function microsToPrice(micros?: number): number | undefined {
  if (typeof micros !== "number") {
    return undefined;
  }

  return Number((micros / 1_000_000).toFixed(2));
}

function toDomainResult(item: RawDomainResult, yearlyBudget: number): DomainResult {
  const price = microsToPrice(item.priceMicros);
  const overBudgetFlag = item.available && typeof price === "number" ? price > yearlyBudget : false;

  return {
    ...item,
    price,
    overBudget: overBudgetFlag,
  };
}

function shouldReplaceByScore(existing: RankedDomainResult, next: RankedDomainResult): boolean {
  if (next.overallScore !== existing.overallScore) {
    return next.overallScore > existing.overallScore;
  }

  if (next.available !== existing.available) {
    return next.available;
  }

  if ((next.price ?? Number.POSITIVE_INFINITY) !== (existing.price ?? Number.POSITIVE_INFINITY)) {
    return (next.price ?? Number.POSITIVE_INFINITY) < (existing.price ?? Number.POSITIVE_INFINITY);
  }

  return next.domain.localeCompare(existing.domain) < 0;
}

function mergeAggregateEntry(
  existing: RankedDomainResult | undefined,
  candidate: RankedDomainResult,
  loop: number,
): RankedDomainResult {
  if (!existing) {
    return candidate;
  }

  const chosen = shouldReplaceByScore(existing, candidate) ? candidate : existing;
  return {
    ...chosen,
    firstSeenLoop: existing.firstSeenLoop,
    lastSeenLoop: loop,
    timesDiscovered: existing.timesDiscovered + 1,
  };
}

function parseDomainLabel(domain: string): string | null {
  const index = domain.indexOf(".");
  if (index <= 0) {
    return null;
  }

  return domain.slice(0, index);
}

function normalizeLoopProgress(loop: number, totalLoops: number): number {
  const ratio = totalLoops === 0 ? 1 : loop / totalLoops;
  return Math.round(5 + ratio * 90);
}

async function runSingleIterationInput(input: SearchRequest): Promise<RawDomainResult[]> {
  const cacheKey = buildCacheKey(input);
  const cached = getCachedSearchResult(cacheKey);

  if (cached) {
    return cached.rawResults;
  }

  const logos = await scrapeNamelix(input);
  const { candidates, invalid } = buildDomainCandidates(input, logos);

  const availabilityMap =
    candidates.length > 0
      ? await checkAvailabilityBulk(candidates.map((candidate) => candidate.domain))
      : new Map();

  const rawResults: RawDomainResult[] = [
    ...candidates.map((candidate) => {
      const availability = availabilityMap.get(candidate.domain);

      return {
        domain: candidate.domain,
        sourceName: candidate.sourceName,
        isNamelixPremium: candidate.isNamelixPremium,
        available: Boolean(availability?.available),
        definitive: Boolean(availability?.definitive),
        priceMicros: availability?.priceMicros,
        currency: availability?.currency,
        period: availability?.period,
        reason: availability?.reason,
      } satisfies RawDomainResult;
    }),
    ...invalid,
  ];

  setCachedSearchResult(cacheKey, rawResults);
  return rawResults;
}

function scoreIterationResults(
  rawResults: RawDomainResult[],
  input: SearchRequest,
  loop: number,
): IterationResults {
  const ranked: RankedDomainResult[] = [];

  for (const item of rawResults) {
    const result = toDomainResult(item, input.yearlyBudget);
    const label = parseDomainLabel(result.domain);
    if (!label || label.length > input.maxLength) {
      continue;
    }

    const metrics = scoreDomainResult(result, input);
    ranked.push({
      ...result,
      ...metrics,
      firstSeenLoop: loop,
      lastSeenLoop: loop,
      timesDiscovered: 1,
    });
  }

  const sorted = sortRankedDomains(ranked, "marketability");
  const top = sorted[0];
  const averageOverallScore =
    sorted.length > 0
      ? Number((sorted.reduce((sum, row) => sum + row.overallScore, 0) / sorted.length).toFixed(2))
      : 0;

  return {
    ranked: sorted,
    availableCount: sorted.filter((row) => row.available).length,
    withinBudgetCount: sorted.filter((row) => row.available && !row.overBudget).length,
    averageOverallScore,
    topDomain: top?.domain,
    topScore: top?.overallScore,
  };
}

function mapErrorToJobError(error: unknown): JobError {
  if (error instanceof NamelixScrapeError) {
    return {
      code: "NAMELIX_SCRAPE_FAILED",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyAuthError) {
    return {
      code: "GODADDY_AUTH_FAILED",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyRateLimitError) {
    return {
      code: "GODADDY_RATE_LIMIT",
      message: error.message,
    };
  }

  if (error instanceof GoDaddyApiError) {
    return {
      code: "GODADDY_API_ERROR",
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Unexpected unknown error occurred during search execution.",
  };
}

export async function runSearchJob(jobId: string): Promise<void> {
  const initialJob = getJob(jobId);
  if (!initialJob) {
    return;
  }

  const baseInput = initialJob.input;
  const totalLoops = baseInput.loopCount;
  const aggregate = new Map<string, RankedDomainResult>();
  const loopSummaries: LoopSummary[] = [];
  const tuningHistory: TuningStep[] = [];

  try {
    markJobRunning(jobId, "looping", 5);
    patchJob(jobId, {
      currentLoop: 0,
      totalLoops,
    });

    const modelState = await loadOptimizerModelState();
    const optimizer = new DomainSearchOptimizer(baseInput, modelState);

    for (let loop = 1; loop <= totalLoops; loop += 1) {
      patchJob(jobId, {
        status: "running",
        phase: "looping",
        progress: normalizeLoopProgress(loop - 1, totalLoops),
        currentLoop: loop,
        totalLoops,
      });

      const plan = optimizer.nextLoop(loop);
      const rawResults = await runSingleIterationInput(plan.input);
      const scored = scoreIterationResults(rawResults, plan.input, loop);

      for (const row of scored.ranked) {
        const label = parseDomainLabel(row.domain);
        if (!label || label.length > plan.input.maxLength) {
          continue;
        }

        const key = row.domain.toLowerCase();
        const merged = mergeAggregateEntry(aggregate.get(key), row, loop);
        aggregate.set(key, merged);
      }

      const reward = scoreRewardFromRankedScores(scored.ranked.map((row) => row.overallScore));
      const tuningStep = optimizer.recordReward(plan, reward);
      tuningHistory.push(tuningStep);

      loopSummaries.push({
        loop,
        keywords: plan.input.keywords,
        description: plan.input.description ?? "",
        style: plan.selectedStyle,
        randomness: plan.selectedRandomness,
        mutationIntensity: plan.selectedMutationIntensity,
        discoveredCount: scored.ranked.length,
        availableCount: scored.availableCount,
        withinBudgetCount: scored.withinBudgetCount,
        averageOverallScore: scored.averageOverallScore,
        topDomain: scored.topDomain,
        topScore: scored.topScore,
      });

      patchJob(jobId, {
        status: "running",
        phase: "looping",
        progress: normalizeLoopProgress(loop, totalLoops),
        currentLoop: loop,
        totalLoops,
      });
    }

    const finalModelState = optimizer.snapshotModelState();
    await saveOptimizerModelState(finalModelState);

    const allRanked = sortRankedDomains(Array.from(aggregate.values()), "marketability");
    const results = classifyRankedResults(allRanked, loopSummaries, tuningHistory);
    markJobComplete(jobId, results);
  } catch (error) {
    markJobFailed(jobId, mapErrorToJobError(error));
  }
}
