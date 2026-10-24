/** Canonical indexed keys for tenant-scoped lead duplicate matching. */
export function canonicalLeadEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Canonicalise only URL scheme/host and the root path. Keep non-root path,
 * query and fragment casing (and trailing slashes) significant. Bare domains
 * are treated as HTTPS so they match their equivalent explicit HTTPS URL.
 */
export function canonicalLeadWebsiteKey(website: string): string {
  const value = website.trim();
  if (!value) return "";
  const hasScheme = value.includes("://");
  const parsed = new URL(hasScheme ? value : `https://${value}`);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
}

/** Stable, collision-safe key for the business-name/location fallback. */
export function canonicalLeadBusinessLocationKey(businessName: string, location: string): string {
  return JSON.stringify([businessName.trim().toLowerCase(), location.trim().toLowerCase()]);
}
