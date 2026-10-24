import { describe, expect, it } from "vitest";
import { canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "./lead-identifiers";

describe("canonical lead duplicate identifiers", () => {
  it("matches email identifiers case-insensitively and trims whitespace", () => {
    expect(canonicalLeadEmailKey("  SALES@Example.COM ")).toBe("sales@example.com");
    expect(canonicalLeadEmailKey("sales@example.com")).toBe(canonicalLeadEmailKey("SALES@EXAMPLE.COM"));
  });

  it("normalises website scheme/host casing and equates bare domains with HTTPS root URLs", () => {
    expect(canonicalLeadWebsiteKey("HTTPS://Example.COM/")).toBe("https://example.com");
    expect(canonicalLeadWebsiteKey("Example.COM")).toBe("https://example.com");
    expect(canonicalLeadWebsiteKey("https://example.com/")).toBe(canonicalLeadWebsiteKey("example.com"));
  });

  it("preserves case-sensitive paths and non-root trailing slashes", () => {
    expect(canonicalLeadWebsiteKey("HTTPS://EXAMPLE.COM/Directory")).toBe("https://example.com/Directory");
    expect(canonicalLeadWebsiteKey("https://example.com/directory")).not.toBe(canonicalLeadWebsiteKey("https://example.com/Directory"));
    expect(canonicalLeadWebsiteKey("https://example.com/Directory/")).not.toBe(canonicalLeadWebsiteKey("https://example.com/Directory"));
  });

  it("preserves query and fragment casing while normalising the authority", () => {
    expect(canonicalLeadWebsiteKey("HTTPS://EXAMPLE.COM/Path?Ref=ABC#Top")).toBe("https://example.com/Path?Ref=ABC#Top");
    expect(canonicalLeadWebsiteKey("https://example.com/Path?Ref=ABC#Top")).not.toBe(canonicalLeadWebsiteKey("https://example.com/Path?ref=ABC#Top"));
  });

  it("returns an empty key for an absent website", () => {
    expect(canonicalLeadWebsiteKey("")).toBe("");
    expect(canonicalLeadWebsiteKey("   ")).toBe("");
  });
});
