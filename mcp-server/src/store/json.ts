/** Fjerner `undefined`-felt (Admin SDK-et nekter å skrive dem). */
export function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
