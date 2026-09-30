import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tool } from "@/lib/tools/toolsClient";

interface ToolRegistryCardProps {
  tool: Tool;
}

/**
 * Renders a single registered tool as a read-only card: its id, name,
 * mode badge, description, and pretty-printed inputSchema. This is the
 * creator app's counterpart to pened-admin's RegisteredToolCard.tsx,
 * with the Edit/Delete buttons, the delete confirmation AlertDialog,
 * and the deleteTool mutation all stripped out - the creator account
 * can only browse the registry, never modify it (see
 * @/lib/tools/toolsClient.ts's doc comment).
 */
export function ToolRegistryCard({ tool }: ToolRegistryCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-foreground">{tool.name}</span>
            <Badge variant="secondary">{tool.mode}</Badge>
          </div>
          <span className="block font-mono text-[11px] text-muted-foreground">{tool.id}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{tool.description}</p>
        <pre className="overflow-x-auto rounded-md bg-secondary/50 p-2 font-mono text-xs text-foreground">
          {JSON.stringify(tool.inputSchema, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
