/**
 * Tiny classnames helper. Joins truthy class fragments with a single space so
 * components can write `cx("base", cond && "active", maybeUndefined)` without a
 * runtime dependency.
 */
export type ClassValue = string | number | false | null | undefined;

export function cx(...classes: ClassValue[]): string {
  return classes.filter((c): c is string | number => Boolean(c)).join(" ");
}
