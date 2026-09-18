export type InventoryGroup = { make: string; model: string; count: number };
export type SluggedInventoryGroup = InventoryGroup & {
  makeSlug: string; modelSlug: string; baseMakeSlug: string; baseModelSlug: string;
  legacyModelSlugs: string[];
};

export function directorySlug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/['’]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function stableSlugSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}

function identityValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function displayScore(value: string): number {
  return value.split(/\s+/).reduce((score, word) =>
    score + (/^[A-Z0-9]/.test(word) ? 1 : 0), 0);
}

function preferredDisplay(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()))].sort((left, right) =>
    displayScore(right) - displayScore(left) ||
    (left < right ? -1 : left > right ? 1 : 0)
  )[0] ?? "";
}

export function sluggedInventoryGroups(groups: InventoryGroup[]): SluggedInventoryGroup[] {
  const caseFolded = new Map<string, InventoryGroup[]>();
  for (const group of groups) {
    const key = `${identityValue(group.make)}\0${identityValue(group.model)}`;
    caseFolded.set(key, [...(caseFolded.get(key) ?? []), group]);
  }
  const merged = [...caseFolded.values()].map((variants) => ({
    make: preferredDisplay(variants.map((variant) => variant.make)),
    model: preferredDisplay(variants.map((variant) => variant.model)),
    count: variants.reduce((total, variant) => total + variant.count, 0),
    variants,
  }));
  const prepared = merged.map((group) => ({
    ...group,
    baseMakeSlug: directorySlug(group.make),
    baseModelSlug: directorySlug(group.model),
  }));
  const counts = new Map<string, number>();
  for (const group of prepared) { const key = `${group.baseMakeSlug}/${group.baseModelSlug}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  return prepared.map((group) => {
    const key = `${group.baseMakeSlug}/${group.baseModelSlug}`;
    const suffix = counts.get(key) === 1 ? "" : `-${stableSlugSuffix(`${group.make}\0${group.model}`)}`;
    const legacyModelSlugs = group.variants.length > 1
      ? group.variants.map((variant) =>
        `${group.baseModelSlug}-${stableSlugSuffix(`${variant.make}\0${variant.model}`)}`)
      : [];
    const { variants: _variants, ...inventoryGroup } = group;
    return {
      ...inventoryGroup,
      makeSlug: group.baseMakeSlug,
      modelSlug: `${group.baseModelSlug}${suffix}`,
      legacyModelSlugs: [...new Set(legacyModelSlugs)],
    };
  });
}

export function resolveInventoryGroup(
  groups: SluggedInventoryGroup[],
  makeSlug: string,
  modelSlug: string,
): { group: SluggedInventoryGroup; redirect: boolean } | undefined {
  const direct = groups.find((group) =>
    group.makeSlug === makeSlug && group.modelSlug === modelSlug);
  if (direct) return { group: direct, redirect: false };
  const legacyAlias = groups.find((group) =>
    group.makeSlug === makeSlug && group.legacyModelSlugs.includes(modelSlug));
  if (legacyAlias) return { group: legacyAlias, redirect: true };
  const legacyMatches = groups.filter((group) =>
    group.baseMakeSlug === makeSlug && group.baseModelSlug === modelSlug);
  return legacyMatches.length === 1 ? { group: legacyMatches[0], redirect: true } : undefined;
}

export function modelFamilySitemapUrls(
  groups: InventoryGroup[],
  origin = "https://www.autonegotiating.com",
): string[] {
  return [...new Set(sluggedInventoryGroups(groups)
    .filter((group) => group.count > 0 && group.makeSlug && group.modelSlug)
    .map((group) => `${origin}/cars/${group.makeSlug}/${group.modelSlug}`))];
}
