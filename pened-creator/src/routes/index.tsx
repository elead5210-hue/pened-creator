import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Trash2, TreeDeciduous } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TreeView } from "@/components/curriculum/phase1-tree/TreeView";
import { QuestionInboxDialog } from "@/components/curriculum/phase1-tree/QuestionInboxDialog";
import { LessonBreakdownPanel } from "@/components/curriculum/phase1-tree/LessonBreakdownPanel";
import {
  clearNodes,
  getAllNodes,
  listLessonBreakdowns,
  listLessons,
  subscribe,
} from "@/lib/curriculum/shared/db";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { expand, LESSON_NODE_TYPE, type CurriculumNode } from "@/lib/curriculum/shared/schema";
import {
  computeLessonPipelineStage,
  type PipelineStage,
} from "@/lib/curriculum/shared/lessonPipelineStatus";
import { useTreeExpandedState } from "@/hooks/use-tree-expanded-state";
import { requireAuth } from "@/lib/auth/routeGuard";

/** Search params this route understands. `editLessonId` lets other routes
 * (e.g. Lesson Detail's "Edit in curriculum tree" link) deep-link straight
 * into the breakdown edit panel for a specific lesson node. */
interface IndexSearch {
  editLessonId?: string;
}

export const Route = createFileRoute("/")({
  beforeLoad: ({ location }) => requireAuth(location),
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    editLessonId: typeof search.editLessonId === "string" ? search.editLessonId : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Curriculum Treeview — JSON Import & Export" },
      {
        name: "description",
        content:
          "Import a curriculum JSON tree, store it flattened in IndexedDB, browse it as a treeview and export it back to JSON.",
      },
      { property: "og:title", content: "Curriculum Treeview — JSON Import & Export" },
      {
        property: "og:description",
        content:
          "Import, store and export hierarchical curriculum data as JSON, rendered as an interactive treeview.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/** Which panel is shown on the page: the curriculum tree or the question inbox. */
type PageView = "curriculum" | "questions";

/** Walk the tree and collect the ids of every LESSON-type leaf node. */
function collectLessonNodeIds(node: CurriculumNode, out: string[] = []): string[] {
  const children = node.children ?? [];
  if (node.type === LESSON_NODE_TYPE && children.length === 0 && node.id) {
    out.push(node.id);
  }
  for (const child of children) collectLessonNodeIds(child, out);
  return out;
}

/**
 * Walk the tree and collect the expand-state key for every node, mirroring
 * TreeView's own key derivation exactly (see getNodeKey in TreeView.tsx:
 * node.id if present, otherwise a `${label}-${index}` fallback where
 * `index` is the node's position within its immediate parent's children
 * array, and the root is always treated as index 0). Used after each load
 * to prune stale expanded-state entries for nodes that no longer exist -
 * this has to match TreeView's key scheme precisely, or valid keys would
 * get pruned right along with genuinely stale ones.
 */
function collectAllNodeKeys(node: CurriculumNode, index: number, out: string[] = []): string[] {
  out.push(node.id ?? `${node.label}-${index}`);
  const children = node.children ?? [];
  children.forEach((child, i) => collectAllNodeKeys(child, i, out));
  return out;
}

/** Depth-first search for the node with the given id, anywhere in the tree. */
function findNodeById(node: CurriculumNode, id: string): CurriculumNode | null {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/** Turns a load() failure into a short, human-readable message, calling out
 * an unreachable API distinctly from a request the server rejected. */
function describeLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0
      ? "Couldn't reach the server. Check your connection and try again."
      : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong while loading the curriculum.";
}

function Index() {
  const navigate = useNavigate();
  const { editLessonId } = Route.useSearch();
  const [tree, setTree] = useState<CurriculumNode | null>(null);
  // `ready` only gates the curriculum tree/empty-state section below - it
  // must never gate the header or the view toggle, otherwise the toggle
  // would flash away or be missing while data is still loading.
  const [ready, setReady] = useState(false);
  // Set only when load() itself fails (network error, non-2xx response,
  // etc.) - kept distinct from `tree === null`, which also legitimately
  // means "no curriculum has been imported yet". Drives an error panel
  // with a retry action instead of silently falling back to the empty
  // state, since a failed fetch and an empty tree are not the same thing
  // now that this data comes from a real network call rather than
  // effectively-always-succeeds IndexedDB reads.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>(undefined);
  // Single source of truth for which panel is active. Always initialized to
  // the same static value ("curriculum") on both server and client renders -
  // it doesn't read from IndexedDB, localStorage, or any browser-only API -
  // so the very first client render matches the server-rendered markup
  // exactly and React can hydrate without a mismatch or a flash of missing
  // UI. Do not seed this from `ready`/`tree` or any other async state.
  const [view, setView] = useState<PageView>("curriculum");
  // nodeId -> that lesson's current PipelineStage, derived the same way as
  // the global toolbar and Lesson Detail via computeLessonPipelineStage (so
  // it reflects the saved breakdown *and* the lesson record's own
  // status/generatedPrompt/generatedContent, not just generatedContent
  // length). Only ever populated for LESSON-type leaf nodes; rebuilt in
  // full whenever the tree changes (see load()) so it never drifts out of
  // sync with which lesson nodes currently exist. Also drives which click
  // behavior a lesson node gets (see handleLessonNodeClick below): nodes
  // with no saved breakdown yet open the Phase 1 panel, everything past
  // that stage navigates straight into Phase 2.
  const [pipelineStageByNodeId, setPipelineStageByNodeId] = useState<Record<string, PipelineStage>>(
    {},
  );
  // The lesson node currently selected for breakdown create/update/
  // regenerate. When set, the Curriculum view renders a two-column layout:
  // TreeView on the left, LessonBreakdownPanel on the right. Only ever set
  // for LESSON leaf nodes that don't have a saved breakdown yet - see
  // handleLessonNodeClick, which is the single place that decides whether a
  // click opens this panel or navigates into Phase 2 instead.
  const [selectedLessonNode, setSelectedLessonNode] = useState<CurriculumNode | null>(null);
  // Guards against re-applying the same editLessonId search param on every
  // render/reload (e.g. after the panel is closed) - only auto-open once
  // per distinct incoming value.
  const appliedEditLessonId = useRef<string | undefined>(undefined);
  // Tracks the in-flight "Clear curriculum" request so the button can be
  // disabled (guarding against a double-click firing two overlapping
  // deletes) and so a failed clear can be reported instead of just
  // silently leaving the tree exactly as it was.
  const [isClearing, setIsClearing] = useState(false);
  // Persisted expand/collapse state for the curriculum TreeView, backed by
  // localStorage (see useTreeExpandedState) so a node the user opened
  // stays open across refreshes/remounts instead of always resetting back
  // to the tree's depth-based default. `prune` is called below after every
  // successful load so entries for nodes that no longer exist (deleted,
  // cleared, or replaced by a re-import) don't linger in storage forever.
  const {
    expandedIds,
    toggle: toggleTreeExpanded,
    prune: pruneTreeExpanded,
  } = useTreeExpandedState();

  const load = useCallback(async () => {
    try {
      const rows = await getAllNodes();
      const nextTree = expand(rows);
      setTree(nextTree);
      setLoadError(null);

      // Drop any persisted expand/collapse entries whose node key no
      // longer appears anywhere in the freshly loaded tree - covers
      // deleted nodes, a cleared curriculum (nextTree is null, so every
      // stored entry is stale), and a re-imported tree with a different
      // shape. A no-op if nothing has actually gone stale (see prune's
      // own bail-out for the unchanged case).
      pruneTreeExpanded(new Set(nextTree ? collectAllNodeKeys(nextTree, 0) : []));

      if (nextTree) {
        const lessonNodeIds = collectLessonNodeIds(nextTree);
        // Two bulk fetches instead of 2 x lessonNodeIds.length individual
        // requests - most lesson nodes haven't been started yet, so the old
        // per-node getLessonBreakdown/getLesson loop meant guaranteed 404s
        // for the majority of the tree on every load.
        // Deliberately its own try/catch, separate from the tree fetch
        // above: if only the lesson-progress requests fail, the tree is
        // still perfectly good, so report the failure and keep whatever
        // stages were already computed instead of wiping them (an empty
        // map would make every lesson look like it has no breakdown).
        try {
          const [breakdownNodeIds, lessonRecords] = await Promise.all([
            listLessonBreakdowns(),
            listLessons(),
          ]);
          const nodeIdsWithBreakdown = new Set(breakdownNodeIds);
          const lessonRecordByNodeId = new Map(
            lessonRecords.map((record) => [record.lesson_node_id, record]),
          );
          const entries = lessonNodeIds.map((nodeId) => {
            const hasBreakdown = nodeIdsWithBreakdown.has(nodeId);
            const lessonRecord = lessonRecordByNodeId.get(nodeId);
            return [nodeId, computeLessonPipelineStage(hasBreakdown, lessonRecord)] as const;
          });
          setPipelineStageByNodeId(Object.fromEntries(entries));
        } catch (stageErr) {
          toast.error("Couldn't load lesson progress", {
            description: describeLoadError(stageErr),
            action: { label: "Try again", onClick: () => load() },
          });
        }
      } else {
        setPipelineStageByNodeId({});
      }
    } catch (err) {
      // Don't clobber a tree that's already on screen with a hard error -
      // only the very first load (or a retry after one already failed)
      // should replace the view with the error panel. A background
      // refresh failure (e.g. triggered by subscribe() after the network
      // blips) still gets reported via toast so it isn't silently lost.
      const message = describeLoadError(err);
      if (tree === null) {
        setLoadError(message);
      } else {
        toast.error("Couldn't refresh the curriculum tree", { description: message });
      }
      // Intentionally leaves pipelineStageByNodeId untouched: a failed
      // request says nothing about which lessons have saved work, so keep
      // the last known stages rather than resetting them.
    } finally {
      setReady(true);
    }
  }, [tree, pruneTreeExpanded]);

  useEffect(() => {
    load();
    const unsubscribe = subscribe(load);
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link support: once the tree has loaded, if an `editLessonId` search
  // param is present (e.g. from Lesson Detail's "Edit in curriculum tree"
  // link) and hasn't already been applied, locate that node and open the
  // breakdown edit panel for it directly, then clear the param so closing
  // and re-triggering doesn't fight with normal in-page selection. This is
  // a deliberate escape hatch back into Phase 1 for lessons that already
  // have a saved breakdown, since handleLessonNodeClick no longer opens the
  // panel for those on a plain tree click.
  useEffect(() => {
    if (!ready || !tree || !editLessonId) return;
    if (appliedEditLessonId.current === editLessonId) return;

    const node = findNodeById(tree, editLessonId);
    if (node) {
      setView("curriculum");
      setSelectedLessonNode(node);
    }
    appliedEditLessonId.current = editLessonId;
    navigate({ to: "/", search: {}, replace: true });
  }, [ready, tree, editLessonId, navigate]);

  // Single funnel for opening/closing the question inbox. Every entry point
  // (the header toggle, the Questions tab, and clicking a question-derived
  // tree node) routes through this so `view` and `importDialogOpen` can
  // never drift apart: the question inbox is open if and only if
  // `view === "questions"`.
  function setQuestionsOpen(open: boolean) {
    setImportDialogOpen(open);
    if (open) {
      setView("questions");
    } else {
      setView("curriculum");
      setSelectedQuestionId(undefined);
    }
  }

  // Driven by the Tabs control in the header.
  function handleViewChange(nextView: string) {
    setQuestionsOpen((nextView as PageView) === "questions");
  }

  // Driven by the QuestionInboxDialog itself (Escape key, overlay click, or
  // the in-dialog close button all funnel through this controlled
  // onOpenChange).
  function handleImportDialogOpenChange(nextOpen: boolean) {
    setQuestionsOpen(nextOpen);
  }

  // Driven by clicking a question-derived node in the curriculum tree.
  function handleQuestionNodeClick(sourceQuestionId: string) {
    setSelectedQuestionId(sourceQuestionId);
    setQuestionsOpen(true);
  }

  // Driven by clicking a LESSON leaf node in the curriculum tree. Phase 1
  // (this panel) is only for lessons that don't have a breakdown saved yet
  // - once a breakdown exists (breakdown-saved, prompt-generated, or
  // content-generated), the lesson's Phase 2 detail page is the click
  // target instead, so the user lands on generating/pasting/viewing
  // content rather than re-opening the breakdown editor. Regenerating an
  // existing breakdown still happens via the "Edit in curriculum tree" deep
  // link from Lesson Detail (see the editLessonId effect above), not via a
  // plain tree click.
  function handleLessonNodeClick(node: CurriculumNode) {
    // A node with no id can't have any saved work attached to it yet, so it
    // can only be a brand-new lesson: open the Phase 1 panel for it.
    if (!node.id) {
      setSelectedLessonNode(node);
      return;
    }

    const stage = pipelineStageByNodeId[node.id];

    // No computed stage means we don't know this lesson's progress (the
    // progress request is still loading, or it failed) - which is not the
    // same as "no breakdown". Don't open the Phase 1 panel here, or a lesson
    // that already has saved work could be reopened as a brand-new breakdown
    // and overwritten.
    if (!stage) {
      toast.error("This lesson's progress isn't available yet", {
        description: "Wait for progress to finish loading, or try again.",
        action: { label: "Try again", onClick: () => load() },
      });
      return;
    }

    if (stage === "no-breakdown") {
      setSelectedLessonNode(node);
      return;
    }

    navigate({ to: "/lessons/$lessonId", params: { lessonId: node.id } });
  }

  function handleExport() {
    if (!tree) return;
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "curriculum.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported curriculum.json");
  }

  // Deletes the entire curriculum tree via the API. Destructive and
  // irreversible from here, so it now gets the same treatment as every
  // other mutation in this app: a busy flag that disables the trigger
  // while the request is in flight (guarding against a double-click firing
  // two overlapping deletes), and explicit success/failure feedback rather
  // than a fire-and-forget call that leaves the user guessing whether it
  // actually worked when the network hiccups.
  async function handleClear() {
    setIsClearing(true);
    try {
      await clearNodes();
      toast.success("Curriculum cleared");
    } catch (err) {
      toast.error("Couldn't clear the curriculum", { description: describeLoadError(err) });
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/*
          The header - including the Curriculum/Questions toggle - lives
          outside of the `ready`/`tree` conditional in the section below, so
          it always renders on every pass: during the initial SSR render,
          during the loading state, once a tree exists, and in the
          empty-tree state. It must stay unconditional here; do not move it
          inside the `!ready ? ... : tree ? ... : ...` branch.
        */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
              JSON in · JSON out
            </p>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Curriculum Treeview</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Import a curriculum tree, stored flattened with parent associations in IndexedDB and
              re-expanded for rendering.
            </p>
            <Tabs value={view} onValueChange={handleViewChange} className="mt-4">
              <TabsList>
                <TabsTrigger value="curriculum">Curriculum</TabsTrigger>
                <TabsTrigger value="questions">Questions</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="flex gap-2">
            {/*
              The exam question inbox is no longer opened from a visible
              header button - it's driven entirely by the Questions tab
              above and by clicking question-derived tree nodes (see
              handleQuestionNodeClick), both of which flow through the
              controlled `open`/`onOpenChange` props below. It still needs
              a trigger element to anchor the dialog, so an sr-only span
              stands in for the old visible "Import questions" button.
            */}
            <QuestionInboxDialog
              open={importDialogOpen}
              onOpenChange={handleImportDialogOpenChange}
              highlightQuestionId={selectedQuestionId}
            >
              <span className="sr-only">Open question inbox</span>
            </QuestionInboxDialog>
            <Button variant="outline" onClick={handleExport} disabled={!tree}>
              <Download className="size-4" /> Export
            </Button>
            {tree && (
              <Button
                variant="ghost"
                onClick={handleClear}
                disabled={isClearing}
                aria-label="Clear curriculum"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </header>

        <div className={cnLayout(Boolean(selectedLessonNode))}>
          <section className="min-w-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-sm">
            {!ready ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : loadError ? (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <AlertCircle className="size-8 text-destructive" />
                <p className="text-sm font-medium text-foreground">Couldn't load the curriculum</p>
                <p className="max-w-sm text-sm text-muted-foreground">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => load()}>
                  Try again
                </Button>
              </div>
            ) : tree ? (
              <TreeView
                tree={tree}
                onQuestionNodeClick={handleQuestionNodeClick}
                pipelineStageByNodeId={pipelineStageByNodeId}
                onLessonNodeClick={(node) => handleLessonNodeClick(node)}
                expandedIds={expandedIds}
                onToggle={toggleTreeExpanded}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 p-12 text-center">
                <TreeDeciduous className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No curriculum yet — import JSON to populate the tree.
                </p>
              </div>
            )}
          </section>

          {selectedLessonNode && (
            <LessonBreakdownPanel
              node={selectedLessonNode}
              tree={tree}
              onClose={() => setSelectedLessonNode(null)}
              onSaved={() => {
                load();
                setSelectedLessonNode(null);
              }}
            />
          )}
        </div>

        <section className="mt-8 rounded-xl border border-border bg-secondary/50 p-5">
          <h2 className="font-serif text-lg text-foreground">Expected schema</h2>
          <pre className="mt-3 overflow-x-auto font-mono text-xs text-muted-foreground">
            {`{
  "label": "Root",            // required, string
  "type": "ROOT",             // required, string
  "id": "optional-id",        // optional, generated if absent
  "children": [               // optional, same shape recursively
    { "label": "CAPS", "type": "CURRICULUM", "children": [] }
  ]
}`}
          </pre>
        </section>
      </div>
    </main>
  );
}

/**
 * Classes for the row that holds TreeView (and, when a lesson is selected,
 * LessonBreakdownPanel beside it). Split out purely so the two-column-vs-single
 * -column intent reads clearly at the call site above.
 */
function cnLayout(twoColumn: boolean): string {
  return twoColumn ? "mt-8 flex items-start gap-6" : "mt-8";
}
