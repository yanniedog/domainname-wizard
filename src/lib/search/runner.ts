import { buildDomainFromBusinessName } from "@/lib/domain/normalize";
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
import { classifyDomainResults } from "@/lib/search/classify";
import type { JobError, RawDomainResult, SearchRequest } from "@/lib/types";

interface DomainCandidate {
  domain: string;
  sourceName: string;
  isNamelixPremium: boolean;
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

function buildDomainCandidates(input: SearchRequest, logos: Awaited<ReturnType<typeof scrapeNamelix>>) {
  const candidates: DomainCandidate[] = [];
  const invalid: RawDomainResult[] = [];
  const seenDomains = new Set<string>();

  for (const logo of logos) {
    const sourceName = logo.businessName;
    const isNamelixPremium = logo.name === "premium";

    const domain = buildDomainFromBusinessName(sourceName, input.tld);
    if (!domain) {
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

  const input = initialJob.input;
  const cacheKey = buildCacheKey(input);

  try {
    markJobRunning(jobId, "namelix", 10);

    let rawResults: RawDomainResult[] | undefined;

    const cached = getCachedSearchResult(cacheKey);
    if (cached) {
      rawResults = cached.rawResults;
      patchJob(jobId, { phase: "finalize", progress: 85 });
    }

    if (!rawResults) {
      const logos = await scrapeNamelix(input);
      markJobRunning(jobId, "namelix", 45);

      const { candidates, invalid } = buildDomainCandidates(input, logos);

      patchJob(jobId, {
        status: "running",
        phase: "godaddy",
        progress: 60,
      });

      const availabilityMap = await checkAvailabilityBulk(candidates.map((candidate) => candidate.domain));

      rawResults = [
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
      patchJob(jobId, { phase: "finalize", progress: 90 });
    }

    const results = classifyDomainResults(rawResults, input.yearlyBudget);
    markJobComplete(jobId, results);
  } catch (error) {
    markJobFailed(jobId, mapErrorToJobError(error));
  }
}
