
import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BookCheck, LogOut, TreeDeciduous, Wrench } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getLesson, getLessonBreakdown, subscribe, type LessonRecord } from "@/lib/curriculum/shared/db";
import { PROJECT_ID } from "@/lib/curriculum/shared/schema";
import { computeLessonPipelineStage, type PipelineStage } from "@/lib/curriculum/shared/lessonPipelineStatus";
import { LessonPipelineBadge } from "@/components/shell/LessonPipelineBadge";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/button";
import {
  GlobalNavContextMenu,
  createSuggestToolItem,
  type GlobalNavContextMenuItem,
} from "@/components/shell/GlobalNavContextMenu";
import { ToolSuggestionModal } from "@/components/tools/ToolSuggestionModal";

/** The three top-level views a user can jump between via the global toolbar. */
type ShellView = "curriculum" | "content" | "tools";

/**
 * Which top-level view a given pathname belongs to. Falls back to
 * "curriculum" for the root and any unrecognized path so something is
 * always highlighted rather than leaving the toolbar in an ambiguous state.
 */
function getActiveView(pathname: string): ShellView {
  if (pathname.startsWith("/lessons")) {
    return "content";
  }
  if (pathname.startsWith("/tools")) {
    return "tools";
  }
  return "curriculum";
}

/**
 * Extracts the lesson node id from a `/lessons/$lessonId` pathname, or
 * `null` if the current route isn't scoped to a specific lesson.
 */
function getLessonNodeIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/lessons\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Loads the pipeline stage for whichever lesson node id is currently open
 * (if any), re-deriving it whenever the route changes or the underlying
 * breakdown/lesson record is written to, so the toolbar's badge never goes
 * stale while the user works inside the Phase 2 view.
 */
function useCurrentLessonPipelineStage(lessonNodeId: string | null): PipelineStage | null {
  const [stage, setStage] = useState<PipelineStage | null>(null);

  useEffect(() => {
    if (!lessonNodeId) {
      setStage(null);
      return;
    }

    let cancelled = false;

    async function load() {
      // This badge is a small, ambient piece of chrome, not something the
      // user is actively waiting on - so a failed fetch (network blip,
      // server hiccup, etc.) shouldn't surface as a toast or throw an
      // unhandled promise rejection out of this effect. It just leaves the
      // badge in its last-known state (or unset, on first load) and lets
      // the next subscribe()-triggered attempt try again.
      try {
        const [breakdown, record] = await Promise.all([
          getLessonBreakdown(lessonNodeId as string),
          getLesson(`${PROJECT_ID}:${lessonNodeId}`) as Promise<LessonRecord | undefined>,
        ]);
        if (cancelled) return;
        setStage(computeLessonPipelineStage(Boolean(breakdown), record));
      } catch {
        // Deliberately swallowed - see comment above. Nothing to set here;
        // stage keeps whichever value it already had.
      }
    }

    load();
    const unsubscribe = subscribe(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [lessonNodeId]);

  return stage;
}

interface ToolbarLinkProps {
  to: string;
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  /** Optional trailing badge, e.g. the current lesson's pipeline stage. */
  badge?: React.ReactNode;
}

/**
 * A single destination in the global toolbar. Rendered as a link when
 * navigable, or as an inert, muted button when there's nowhere useful to
 * send the user yet (e.g. "Content Generation" before any lesson has been
 * opened) — the phase should still be visible even when it can't be
 * jumped to directly from elsewhere.
 */
function ToolbarLink({ to, active, disabled, icon, label, sublabel, badge }: ToolbarLinkProps) {
  const content = (
    <>
      {icon}
      <span className="flex flex-col items-start leading-tight">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase opacity-70">
          {sublabel}
        </span>
      </span>
      {badge}
    </>
  );

  const sharedClassName = cn(
    "flex items-center gap-2 rounded-md px-3 py-1.5 transition-colors",
    active
      ? "bg-primary text-primary-foreground shadow-sm"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    disabled && "pointer-events-none opacity-40",
  );

  if (disabled) {
    return (
      <span className={sharedClassName} aria-disabled="true" title="Open a lesson from the curriculum tree first">
        {content}
      </span>
    );
  }

  return (
    <Link to={to} className={sharedClassName}>
      {content}
    </Link>
  );
}

/**
 * Persistent, always-visible toolbar that lets the user jump between the
 * three views that make up content creation: the Curriculum Tree (Phase 1),
 * the current lesson's Content Generation pipeline (Phase 2), and the
 * read-only Tool Registry browser. Lives above the routed content in the
 * root shell so the active view stays legible regardless of which in-page
 * tab (Curriculum / Questions, Breakdown / Content, etc.) happens to be
 * selected.
 *
 * "Content Generation" has no single fixed destination — it's scoped to
 * whichever lesson is currently open — so it only becomes a real link
 * (back to that lesson's own Phase 2 URL) while already inside a
 * `/lessons/$lessonId` route; elsewhere it renders as a disabled
 * placeholder rather than guessing which lesson to send the user to.
 * While inside that route, the lesson's pipeline stage is also looked up
 * and shown as a badge so the toolbar reflects lesson status everywhere,
 * not just inside the curriculum tree.
 *
 * By contrast, the "Tool Registry" link is an always-on, fixed
 * destination — a static, read-only browser for the /api/tools registry
 * that isn't scoped to any particular lesson (see routes/tools.tsx) — so
 * it's kept visually and functionally distinct from the contextual
 * Phase 2 link above.
 *
 * A Logout action sits at the far end of the bar, separate from the
 * navigational links above — it's an account action, not a destination —
 * and only renders once a session's user has actually loaded (see
 * useAuth()), so it never flashes on before the initial /api/auth/me
 * check has resolved.
 */
export function GlobalToolbar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeView = getActiveView(pathname);
  const lessonNodeId = activeView === "content" ? getLessonNodeIdFromPathname(pathname) : null;
  const lessonPipelineStage = useCurrentLessonPipelineStage(lessonNodeId);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isToolSuggestionModalOpen, setIsToolSuggestionModalOpen] = useState(false);

  // Add future context menu options here; the menu component needs no changes.
  const contextMenuItems: GlobalNavContextMenuItem[] = [
    createSuggestToolItem(() => setIsToolSuggestionModalOpen(true)),
  ];

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      await navigate({ to: "/login" });
    } catch (err) {
      toast.error("Couldn't log out", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background">
      <div className="relative mx-auto flex max-w-4xl flex-wrap items-center gap-1 bg-secondary/40 px-6 py-1.5">
        {/* Pinned to the leftmost edge of the viewport, outside the centered
            max-w container's content flow, so existing nav items don't shift. */}
        <div className="fixed left-2 top-1.5 z-40">
          <GlobalNavContextMenu items={contextMenuItems} triggerLabel="Open navigation menu" />
        </div>
        <ToolbarLink
          to="/"
          active={activeView === "curriculum"}
          icon={<TreeDeciduous className="size-4 shrink-0" />}
          label="Curriculum Tree"
          sublabel="Phase 1"
        />
        <ToolbarLink
          to={lessonNodeId ? `/lessons/${lessonNodeId}` : pathname}
          active={activeView === "content"}
          disabled={!lessonNodeId}
          icon={<BookCheck className="size-4 shrink-0" />}
          label="Content Generation"
          sublabel="Phase 2"
          badge={
            lessonPipelineStage ? (
              <LessonPipelineBadge
                stage={lessonPipelineStage}
                className={cn(activeView === "content" && "border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground")}
              />
            ) : undefined
          }
        />
        <ToolbarLink
          to="/tools"
          active={activeView === "tools"}
          icon={<Wrench className="size-4 shrink-0" />}
          label="Tool Registry"
          sublabel="Reference"
        />

        {user ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-2 text-muted-foreground hover:text-accent-foreground"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            <LogOut className="size-4 shrink-0" />
            {isLoggingOut ? "Logging out..." : "Logout"}
          </Button>
        ) : null}
      </div>
      <ToolSuggestionModal open={isToolSuggestionModalOpen} onOpenChange={setIsToolSuggestionModalOpen} />
    </div>
  );
}