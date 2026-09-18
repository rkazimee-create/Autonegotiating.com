export type InventoryGroup = { make: string; model: string; count: number };
export type SluggedInventoryGroup = InventoryGroup & {
  makeSlug: string; modelSlug: string; baseMakeSlug: string; baseModelSlug: string;
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
export function sluggedInventoryGroups(groups: InventoryGroup[]): SluggedInventoryGroup[] {
  const prepared = groups.map((group) => ({ ...group, baseMakeSlug: directorySlug(group.make), baseModelSlug: directorySlug(group.model) }));
  const counts = new Map<string, number>();
  for (const group of prepared) { const key = `${group.baseMakeSlug}/${group.baseModelSlug}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  return prepared.map((group) => {
    const key = `${group.baseMakeSlug}/${group.baseModelSlug}`;
    const suffix = counts.get(key) === 1 ? "" : `-${stableSlugSuffix(`${group.make}\0${group.model}`)}`;
    return { ...group, makeSlug: group.baseMakeSlug, modelSlug: `${group.baseModelSlug}${suffix}` };
  });
}