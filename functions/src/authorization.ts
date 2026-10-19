export type OrganisationRole = "owner" | "admin" | "member" | "viewer";

export function normaliseRequiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) return null;
  return result;
}

export function hasCampaignWritePermission(role: unknown): role is "owner" | "admin" {
  return role === "owner" || role === "admin";
}

export function isValidOrganisationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function normaliseOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length <= maxLength ? result : null;
}
