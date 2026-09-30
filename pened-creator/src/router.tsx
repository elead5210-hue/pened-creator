import { createRouter } from "@tanstack/react-router";
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { ApiError } from "./lib/curriculum/shared/apiClient";

export function getRouter() {
  // Assigned once createRouter() below returns. The onError handlers are
  // only ever invoked later, in response to a query/mutation failing, by
  // which point this closure has already picked up the real router - so
  // capturing the variable (rather than a value) here is safe despite it
  // being read before its declaration in source order.

  // Global session-expiry handling: any query or mutation that fails with
  // a 401 (session cookie missing/expired/invalid - see requireAuth in
  // ./lib/auth/routeGuard.ts and apiClient's ApiError) means the user is
  // no longer authenticated, regardless of which screen triggered it. In
  // that case there's nothing useful left to show from cached data, so
  // the cache is wiped and the user is sent to /login, preserving where
  // they were as the `redirect` search param the same way requireAuth
  // does, so login can send them back afterward.
  function handleAuthError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.clear();
      router.navigate({
        to: "/login",
        search: { redirect: router.state.location.href },
      });
    }
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handleAuthError }),
    mutationCache: new MutationCache({ onError: handleAuthError }),
  });

  const router: ReturnType<typeof createRouter> = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    scrollRestoration: true,
  });

  return router;
}
