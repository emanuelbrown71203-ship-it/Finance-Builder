import { AsyncLocalStorage } from "node:async_hooks";
import { setCategoryResolver, type UserCategory } from "@/lib/categories";

/*
 * The signed-in person's own categories, for the length of one request, so `category()` names them
 * anywhere on the server (Nickel, the weekly review, wins) without passing them through every call.
 * Outside a request (a bank sync, a test) only the built-in categories are known.
 */
const scope = new AsyncLocalStorage<readonly UserCategory[]>();
setCategoryResolver(() => scope.getStore() ?? []);

export function withCategories<T>(list: readonly UserCategory[], run: () => T): T {
  return scope.run(list, run);
}
