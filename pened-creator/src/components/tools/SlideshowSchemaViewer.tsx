import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SLIDESHOW_SCHEMA_PLACEHOLDER,
  SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE,
} from "@/lib/tools/slideshowSchemaPlaceholder";

/**
 * Read-only viewer for the slideshow app's slide-rendering JSON schema.
 * Currently always renders the hardcoded `SLIDESHOW_SCHEMA_PLACEHOLDER`
 * from `lib/tools/slideshowSchemaPlaceholder.ts` - there's no API call
 * here, unlike `ToolRegistryCard.tsx`'s live `/api/tools` data. Mirrors
 * that card's bordered/padded pretty-printed-JSON presentation so the
 * two tabs on the Tools Registry page read as one consistent surface.
 *
 * Usage:
 *   <SlideshowSchemaViewer />
 */
export function SlideshowSchemaViewer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Slideshow Schema</CardTitle>
        <p className="text-xs text-muted-foreground">{SLIDESHOW_SCHEMA_PLACEHOLDER_NOTE}</p>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 text-xs text-foreground">
          {JSON.stringify(SLIDESHOW_SCHEMA_PLACEHOLDER, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}