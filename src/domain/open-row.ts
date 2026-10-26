export const openRow = <T>(last: T | undefined, live: T | undefined): { row: T | undefined; gone: boolean } =>
  live === undefined ? { row: last, gone: last !== undefined } : { row: live, gone: false };
