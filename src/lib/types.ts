export const STYLE_VALUES = [
  "default",
  "brandable",
  "twowords",
  "threewords",
  "compound",
  "spelling",
  "nonenglish",
  "dictionary",
] as const;

export const RANDOMNESS_VALUES = ["low", "medium", "high"] as const;

export type StyleValue = (typeof STYLE_VALUES)[number];
export type RandomnessValue = (typeof RANDOMNESS_VALUES)[number];

export interface SearchRequest {
  keywords: string;
  description?: string;
  style: StyleValue;
  randomness: RandomnessValue;
  blacklist?: string;
  maxLength: number;
  tld: string;
  maxNames: number;
  yearlyBudget: number;
}

export interface NamelixLogo {
  businessName: string;
  description?: string;
  name?: string;
  domains?: string;
  hasDomain?: boolean;
}

export interface RawDomainResult {
  domain: string;
  sourceName: string;
  isNamelixPremium: boolean;
  available: boolean;
  definitive: boolean;
  priceMicros?: number;
  currency?: string;
  period?: number;
  reason?: string;
}

export interface DomainResult extends RawDomainResult {
  price?: number;
  overBudget: boolean;
}

export interface SearchResults {
  withinBudget: DomainResult[];
  overBudget: DomainResult[];
  unavailable: DomainResult[];
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobPhase = "namelix" | "godaddy" | "finalize" | null;

export interface JobError {
  code: string;
  message: string;
}

export interface SearchJob {
  id: string;
  status: JobStatus;
  phase: JobPhase;
  progress: number;
  input: SearchRequest;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  results?: SearchResults;
  error?: JobError;
}

export interface CachedSearchResult {
  rawResults: RawDomainResult[];
  createdAt: number;
  expiresAt: number;
}
