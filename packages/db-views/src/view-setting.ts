/** The device setting that remembers which view a database page shows. */
export function activeViewKey(databaseId: string): string {
  return `databases.view.${databaseId}`;
}
