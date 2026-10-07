function normalizeProfileValue(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isMeaningfulAcademiaName(
  name: unknown,
  regNo?: unknown,
  username?: unknown,
): boolean {
  const normalizedName = normalizeProfileValue(name);
  if (!normalizedName || ["student", "unknown", "na", "none"].includes(normalizedName)) {
    return false;
  }

  return ![regNo, username]
    .map(normalizeProfileValue)
    .filter(Boolean)
    .includes(normalizedName);
}
