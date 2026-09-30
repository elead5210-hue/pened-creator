import { Gamepad2 } from "lucide-react";

/**
 * Placeholder panel for the Phase 3 "Games" tab. This is intentionally
 * empty of any real functionality: no game list, no selection state,
 * and no embedding logic. It exists only so the tab has somewhere to
 * navigate to while the actual prebuilt-games feature is designed.
 *
 * Usage:
 *   <GamesPlaceholder />
 */
export function GamesPlaceholder() {
  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-12 text-center">
      <Gamepad2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Games are coming soon</p>
        <p className="text-sm text-muted-foreground">
          Prebuilt games for this lesson will appear here once this feature is built out.
        </p>
      </div>
    </section>
  );
}
