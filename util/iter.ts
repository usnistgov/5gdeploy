/** Find item by name in a list of named items. */
export function findByName<T extends { readonly name: string }>(k: string, list: Iterable<T>): T | undefined {
  for (const item of list) {
    if (item.name === k) {
      return item;
    }
  }
  return undefined;
}
