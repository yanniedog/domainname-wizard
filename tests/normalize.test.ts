import { describe, expect, it } from "vitest";

import {
  buildDomainFromBusinessName,
  normalizeBusinessNameKey,
  normalizeBusinessNameToLabel,
  normalizeTld,
} from "@/lib/domain/normalize";

describe("domain normalization", () => {
  it("normalizes unicode and punctuation to dns-safe labels", () => {
    expect(normalizeBusinessNameToLabel(`Cre\u0301me & Co.`))?.toBe("creme-and-co");
  });

  it("rejects empty normalized labels", () => {
    expect(normalizeBusinessNameToLabel("!!!")).toBeNull();
  });

  it("builds fqdn with normalized tld", () => {
    expect(buildDomainFromBusinessName("Alpha Labs", ".COM")).toBe("alpha-labs.com");
  });

  it("normalizes key for dedupe", () => {
    expect(normalizeBusinessNameKey(`AC\u0327ME & Co`))?.toBe("acme and co");
  });

  it("rejects invalid tld", () => {
    expect(normalizeTld("***")).toBeNull();
  });
});

