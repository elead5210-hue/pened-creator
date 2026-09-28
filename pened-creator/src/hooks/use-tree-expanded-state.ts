
import { useCallback, useEffect, useRef, useState } from "react";
import { PROJECT_ID } from "@/lib/curriculum/shared/schema";

/**
 * A map of tree-node-key -> expanded (true) / collapsed (false), matching
 * the shape TreeView/NodeRow expect for their `expandedIds` prop. A node
 * key absent from this map isn't "unknown" here - TreeView already
 * falls back to its own depth-based default for any key that's missing,
 * so this hook only needs to persist explicit overrides.
 */
export type TreeExpandedState = Record<string, boolean>;

/** localStorage key this hook reads/writes, namespaced by PROJECT_ID so
 * separate projects (or a future multi-project build of this app) never
 * clobber each other's saved tree expand/collapse state. */
function buildStorageKey(): string {
  return `curriculum-tree:expanded:${PROJECT_ID}`;
}

/** Parses a stored JSON blob back into a TreeExpandedState, tolerating a
 * missing, empty, or corrupted value by returning an empty map rather
 * than throwing - a bad/stale localStorage entry shouldn't break the
 * tree, it should just fall back to the default expand behavior. */
function readStoredState(): TreeExpandedState {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(buildStorageKey());
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TreeExpandedState;
    }
    return {};
  } catch {
    return {};
  }
}

/** Writes a TreeExpandedState to localStorage, silently no-op'ing if
 * storage is unavailable (private browsing, quota exceeded, SSR, etc.) -
 * losing persisted expand state is a minor inconvenience, not something
 * that should surface as a user-facing error. */
function writeStoredState(state: TreeExpandedState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(buildStorageKey(), JSON.stringify(state));
  } catch {
    /* Ignore - see comment above. */
  }
}

/** How long to wait after the last toggle before persisting to
 * localStorage, so a burst of rapid expand/collapse clicks (e.g.
 * "expand all" style interactions, or a user quickly drilling down
 * several levels) batches into a single write instead of one write per
 * click. */
const PERSIST_DEBOUNCE_MS = 300;

/**
 * Manages the curriculum TreeView's expand/collapse state, persisted to
 * localStorage under a PROJECT_ID-scoped key so it survives page
 * refreshes and remounts. Exposes the current expanded-id map, a
 * `toggle(nodeKey)` function that flips a single node's entry, and a
 * `prune(validKeys)` function that drops any stored entry whose key isn't
 * in the given set - used after each tree load to keep localStorage from
 * accumulating ids for nodes that were deleted, cleared, or replaced by a
 * re-import, and to stop stale state from leaking into a differently
 * shaped tree.
 *
 * Reads are synchronous (localStorage is read once, on mount) and writes
 * are debounced for toggle(), but immediate for prune() (a load-driven
 * cleanup, not a rapid user interaction, so there's no burst to batch).
 * The debounce timer is flushed on unmount so a toggle right before
 * navigating away still gets persisted.
 *
 * Usage:
 *   const { expandedIds, toggle, prune } = useTreeExpandedState();
 *   <TreeView tree={tree} expandedIds={expandedIds} onToggle={toggle} ... />
 *   // after loading a fresh tree:
 *   prune(new Set(allNodeKeysInTree));
 */
export function useTreeExpandedState(): {
  expandedIds: TreeExpandedState;
  toggle: (nodeKey: string) => void;
  prune: (validKeys: ReadonlySet<string> | ReadonlyArray<string>) => void;
} {
  const [expandedIds, setExpandedIds] = useState<TreeExpandedState>(() => readStoredState());

  // Always persist the latest state, even if the debounce timer was
  // scheduled against an older value - avoids capturing a stale closure
  // over `expandedIds` inside the timeout callback below.
  const latestStateRef = useRef(expandedIds);
  latestStateRef.current = expandedIds;

  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPersist = useCallback(() => {
    if (persistTimeoutRef.current !== null) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    writeStoredState(latestStateRef.current);
  }, []);

  const schedulePersist = useCallback(() => {
    if (persistTimeoutRef.current !== null) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      persistTimeoutRef.current = null;
      writeStoredState(latestStateRef.current);
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  // Flush any pending debounced write on unmount, so a toggle made just
  // before navigating away or closing the tab isn't silently dropped.
  useEffect(() => {
    return () => {
      flushPersist();
    };
  }, [flushPersist]);

  const toggle = useCallback(
    (nodeKey: string) => {
      setExpandedIds((prev) => {
        // A key not yet in the map is treated as following TreeView's
        // depth-based default (see isExpanded in TreeView.tsx), which
        // this hook has no visibility into - so the first toggle of an
        // unrecorded node always flips it to collapsed. This matches the
        // common case (the user is collapsing something that started
        // open) and, worse case, a second click corrects it.
        const current = Object.prototype.hasOwnProperty.call(prev, nodeKey) ? prev[nodeKey] : true;
        return { ...prev, [nodeKey]: !current };
      });
      schedulePersist();
    },
    [schedulePersist],
  );

  const prune = useCallback((validKeys: ReadonlySet<string> | ReadonlyArray<string>) => {
    const validSet = validKeys instanceof Set ? validKeys : new Set(validKeys);

    setExpandedIds((prev) => {
      let changed = false;
      const next: TreeExpandedState = {};

      for (const key of Object.keys(prev)) {
        if (validSet.has(key)) {
          next[key] = prev[key];
        } else {
          changed = true;
        }
      }

      // Nothing to prune - bail out without touching state or storage, so
      // this can be called after every load without causing a write (or a
      // re-render) on the common case where nothing was deleted.
      if (!changed) return prev;

      // Pruning is driven by a fresh tree load, not a rapid user
      // interaction, so persist immediately rather than debouncing -
      // there's no burst of calls to batch here, and the latest tree
      // shape should be reflected in storage right away.
      latestStateRef.current = next;
      writeStoredState(next);
      return next;
    });
  }, []);

  return { expandedIds, toggle, prune };
}