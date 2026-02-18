"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { RANDOMNESS_VALUES, STYLE_VALUES, type DomainResult } from "@/lib/types";

type SearchStatus = "queued" | "running" | "done" | "failed";
type SearchPhase = "namelix" | "godaddy" | "finalize" | null;

interface SearchJobResponse {
  id: string;
  status: SearchStatus;
  phase: SearchPhase;
  progress: number;
  error?: {
    code: string;
    message: string;
  };
  results?: {
    withinBudget: DomainResult[];
    overBudget: DomainResult[];
    unavailable: DomainResult[];
  };
}

interface SearchFormState {
  keywords: string;
  description: string;
  style: (typeof STYLE_VALUES)[number];
  randomness: (typeof RANDOMNESS_VALUES)[number];
  blacklist: string;
  maxLength: number;
  tld: string;
  maxNames: number;
  yearlyBudget: number;
}

const initialFormState: SearchFormState = {
  keywords: "",
  description: "",
  style: "default",
  randomness: "medium",
  blacklist: "",
  maxLength: 25,
  tld: "com",
  maxNames: 100,
  yearlyBudget: 50,
};

function formatMoney(value?: number, currency?: string): string {
  if (typeof value !== "number") {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function phaseLabel(status: SearchStatus, phase: SearchPhase): string {
  if (status === "queued") {
    return "Queued";
  }

  if (status === "done") {
    return "Done";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (phase === "namelix") {
    return "Generating names";
  }

  if (phase === "godaddy") {
    return "Checking domains";
  }

  if (phase === "finalize") {
    return "Finalizing";
  }

  return "Running";
}

function ResultTable({ rows }: { rows: DomainResult[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Name</th>
            <th>Available</th>
            <th>Definitive</th>
            <th>Price</th>
            <th>Premium</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.domain}:${row.sourceName}`}>
              <td>{row.domain}</td>
              <td>{row.sourceName}</td>
              <td>{row.available ? "Yes" : "No"}</td>
              <td>{row.definitive ? "Yes" : "No"}</td>
              <td>{formatMoney(row.price, row.currency)}</td>
              <td>{row.isNamelixPremium ? "Yes" : "No"}</td>
              <td>{row.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Page() {
  const [form, setForm] = useState<SearchFormState>(initialFormState);
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<SearchJobResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showOverBudget, setShowOverBudget] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let active = true;

    const fetchJob = async () => {
      const response = await fetch(`/api/searches/${jobId}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as SearchJobResponse;

      if (!active) {
        return;
      }

      setJob(payload);
    };

    void fetchJob();

    const interval = setInterval(() => {
      if (!active) {
        return;
      }

      if (job?.status === "done" || job?.status === "failed") {
        return;
      }

      void fetchJob();
    }, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [jobId, job?.status]);

  const isPollingComplete = useMemo(() => {
    return job?.status === "done" || job?.status === "failed";
  }, [job]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setLoading(true);
    setJob(null);
    setJobId(null);
    setShowOverBudget(false);
    setShowUnavailable(false);

    try {
      const response = await fetch("/api/searches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const payload = (await response.json()) as { jobId?: string; message?: string };

      if (!response.ok || !payload.jobId) {
        throw new Error(payload.message ?? "Unable to start the search job.");
      }

      setJobId(payload.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error while creating search job.";
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <section className="card">
        <h1>Namelix-to-GoDaddy Budget Finder</h1>

        <form onSubmit={onSubmit} className="grid">
          <label>
            Keywords
            <input
              required
              value={form.keywords}
              onChange={(event) => setForm((previous) => ({ ...previous, keywords: event.target.value }))}
              placeholder="e.g. AI productivity"
            />
          </label>

          <label>
            Description
            <input
              value={form.description}
              onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))}
              placeholder="Optional business description"
            />
          </label>

          <label>
            Style
            <select
              value={form.style}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  style: event.target.value as SearchFormState["style"],
                }))
              }
            >
              {STYLE_VALUES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>

          <label>
            Randomness
            <select
              value={form.randomness}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  randomness: event.target.value as SearchFormState["randomness"],
                }))
              }
            >
              {RANDOMNESS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Blacklist
            <input
              value={form.blacklist}
              onChange={(event) => setForm((previous) => ({ ...previous, blacklist: event.target.value }))}
              placeholder="comma,separated,words"
            />
          </label>

          <label>
            Maximum Name Length
            <input
              type="number"
              min={5}
              max={25}
              value={form.maxLength}
              onChange={(event) => setForm((previous) => ({ ...previous, maxLength: Number(event.target.value) || 25 }))}
            />
          </label>

          <label>
            TLD
            <input
              value={form.tld}
              onChange={(event) => setForm((previous) => ({ ...previous, tld: event.target.value }))}
              placeholder="com"
            />
          </label>

          <label>
            Max Names
            <input
              type="number"
              min={1}
              max={250}
              value={form.maxNames}
              onChange={(event) => setForm((previous) => ({ ...previous, maxNames: Number(event.target.value) || 100 }))}
            />
          </label>

          <label>
            Yearly Budget
            <input
              type="number"
              min={1}
              value={form.yearlyBudget}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  yearlyBudget: Number(event.target.value) || previous.yearlyBudget,
                }))
              }
            />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Starting..." : "Start Search"}
          </button>
        </form>

        {submitError && <p className="error">{submitError}</p>}
      </section>

      {job && (
        <section className="card">
          <h2>Status</h2>
          <p>
            <strong>{phaseLabel(job.status, job.phase)}</strong>
            {" "}
            ({job.progress}%)
          </p>
          <div className="progress">
            <div style={{ width: `${job.progress}%` }} />
          </div>

          {job.error && <p className="error">{job.error.code}: {job.error.message}</p>}

          {job.results && (
            <>
              <h3>Within Budget ({job.results.withinBudget.length})</h3>
              <ResultTable rows={job.results.withinBudget} />

              <h3>
                Over Budget ({job.results.overBudget.length})
                <button type="button" onClick={() => setShowOverBudget((previous) => !previous)}>
                  {showOverBudget ? "Hide" : "Show"}
                </button>
              </h3>
              {showOverBudget && <ResultTable rows={job.results.overBudget} />}

              <h3>
                Unavailable / Unknown ({job.results.unavailable.length})
                <button type="button" onClick={() => setShowUnavailable((previous) => !previous)}>
                  {showUnavailable ? "Hide" : "Show"}
                </button>
              </h3>
              {showUnavailable && <ResultTable rows={job.results.unavailable} />}
            </>
          )}

          {isPollingComplete && !job.results && !job.error && <p>No data returned.</p>}
        </section>
      )}
    </main>
  );
}

