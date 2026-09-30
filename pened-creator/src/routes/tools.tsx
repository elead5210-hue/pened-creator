import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { requireAuth } from "@/lib/auth/routeGuard";
import { Button } from "@/components/ui/button";
import { ToolRegistryCard } from "@/components/tools/ToolRegistryCard";
import { SlideshowSchemaViewer } from "@/components/tools/SlideshowSchemaViewer";
import { getTools } from "@/lib/tools/toolsClient";
import { ApiError } from "@/lib/curriculum/shared/apiClient";

const TOOLS_QUERY_KEY = ["tools"] as const;

/** The two side tabs on this page. "registry" is the default. */
type ToolsPageTab = "registry" | "slideshow-schema";

const TOOLS_PAGE_TABS: { value: ToolsPageTab; label: string }[] = [
  { value: "registry", label: "Tool Registry" },
  { value: "slideshow-schema", label: "Slideshow Schema" },
];

export const Route = createFileRoute("/tools")({
  beforeLoad: ({ location }) => requireAuth(location),
  head: () => ({
    meta: [
      { title: "Tool Registry" },
      {
        name: "description",
        content: "Browse the tools registered for the AI to use when generating lesson content.",
      },
    ],
  }),
  component: ToolsPage,
});

/** Turns a query failure into a short, human-readable message, calling
 * out an unreachable API distinctly from a request the server rejected -
 * matching describeLoadError in routes/index.tsx. */
function describeLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0
      ? "Couldn't reach the server. Check your connection and try again."
      : err.message;
  }
  return err instanceof Error
    ? err.message
    : "Something went wrong while loading the tools registry.";
}

/**
 * Tools Registry route. Reachable from the global toolbar.
 *
 * Read-only counterpart to pened-admin's /tools page: it loads the same
 * /api/tools registry via React Query (see lib/tools/toolsClient.ts) and
 * renders one ToolRegistryCard per tool, but has no "Register tool"
 * button and no register/edit dialog - the creator account can only
 * browse what's already been registered in the admin app.
 *
 * Layout mirrors this app's other top-level pages: a centered column
 * with an icon + eyebrow + title header, no sidebar or nested routing
 * of its own.
 */
function ToolsPage() {
  const toolsQuery = useQuery({ queryKey: TOOLS_QUERY_KEY, queryFn: () => getTools() });
  const [activeTab, setActiveTab] = useState<ToolsPageTab>("registry");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="flex items-start gap-3 border-b border-border pb-4">
          <Wrench className="mt-1 size-6 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
              Registry
            </p>
            <h1 className="mt-1 font-serif text-3xl text-foreground">Tool Registry</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Registered in the admin app, available here to browse - tools can't be added or
              changed from this account.
            </p>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:items-start">
          <nav
            aria-label="Tool Registry sections"
            className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-x-visible"
          >
            {TOOLS_PAGE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-current={activeTab === tab.value ? "page" : undefined}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors",
                  activeTab === tab.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0">
            {activeTab === "registry" ? (
              <div className="space-y-4">
                {toolsQuery.isPending ? (
                  <p className="text-sm text-muted-foreground">Loading tools...</p>
                ) : toolsQuery.isError ? (
                  <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm font-medium text-destructive">
                      Couldn't load the tools registry
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {describeLoadError(toolsQuery.error)}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toolsQuery.refetch()}
                      disabled={toolsQuery.isFetching}
                    >
                      {toolsQuery.isFetching ? "Retrying..." : "Try again"}
                    </Button>
                  </div>
                ) : toolsQuery.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tools have been registered yet.
                  </p>
                ) : (
                  toolsQuery.data.map((tool) => <ToolRegistryCard key={tool.id} tool={tool} />)
                )}
              </div>
            ) : (
              <SlideshowSchemaViewer />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
