import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Sparkles } from "lucide-react";
import type { CurriculumNode } from "@/lib/curriculum/shared/schema";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

/** A single searchable row: a node plus the breadcrumb of labels above it. */
interface FlatEntry {
  node: CurriculumNode;
  id: string;
  path: string[];
}

/**
 * Depth-first flatten of the tree into rows with breadcrumb paths. Nodes
 * without an id can't be targeted (there's nothing stable to store), so
 * they're skipped but their children are still walked.
 */
function flattenSearchable(node: CurriculumNode, path: string[] = []): FlatEntry[] {
  const entries: FlatEntry[] = [];
  if (node.id) {
    entries.push({ node, id: node.id, path });
  }
  const here = [...path, node.label];
  for (const child of node.children ?? []) {
    entries.push(...flattenSearchable(child, here));
  }
  return entries;
}

/**
 * Pull candidate target node ids out of a parsedSummary string. AI
 * summaries are prompted to reference a node's id and label directly (see
 * buildCategorizationPrompt's CATEGORIZATION_SCHEMA_EXAMPLE), so this looks
 * for two kinds of evidence: an explicit "n_<ts36>_<counter36>"-shaped id
 * token that matches a real node, and any existing node label mentioned
 * verbatim in the summary text.
 */
function extractHintedNodeIds(hintText: string | undefined, entries: FlatEntry[]): Set<string> {
  const hinted = new Set<string>();
  if (!hintText) return hinted;

  const knownIds = new Set(entries.map((e) => e.id));
  const idPattern = /\bn_[0-9a-z]+_[0-9a-z]+\b/gi;
  for (const match of hintText.match(idPattern) ?? []) {
    if (knownIds.has(match)) hinted.add(match);
  }

  const lowerHint = hintText.toLowerCase();
  for (const entry of entries) {
    const label = entry.node.label.trim();
    // Require a little length so short/common labels ("Set", "Data") don't
    // spuriously match unrelated prose in the summary.
    if (label.length >= 3 && lowerHint.includes(label.toLowerCase())) {
      hinted.add(entry.id);
    }
  }

  return hinted;
}

interface NodePickerProps {
  /** Root of the curriculum tree to search over. */
  tree: CurriculumNode | null;
  /** Currently selected node's id, if any. */
  value?: string | undefined;
  onSelect: (node: CurriculumNode) => void;
  /**
   * Free text (typically a parsed AI summary) to derive "Suggested" node
   * hints from. Hinted nodes are highlighted and sorted to the top of the
   * list, but every node stays searchable and selectable.
   */
  hintText?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function NodePicker({
  tree,
  value,
  onSelect,
  hintText,
  placeholder = "Select a node...",
  disabled,
  className,
}: NodePickerProps) {
  const [open, setOpen] = useState(false);

  const entries = useMemo(() => (tree ? flattenSearchable(tree) : []), [tree]);
  const hintedIds = useMemo(() => extractHintedNodeIds(hintText, entries), [hintText, entries]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aHinted = hintedIds.has(a.id) ? 0 : 1;
      const bHinted = hintedIds.has(b.id) ? 0 : 1;
      return aHinted - bHinted;
    });
  }, [entries, hintedIds]);

  const selectedEntry = entries.find((e) => e.id === value);
  const isEmpty = entries.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isEmpty}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate text-left">
            {selectedEntry
              ? [...selectedEntry.path, selectedEntry.node.label].join(" / ")
              : isEmpty
                ? "No nodes in the tree yet"
                : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search, keywords) => {
            if (!search) return 1;
            const haystack = [itemValue, ...(keywords ?? [])].join(" ").toLowerCase();
            return haystack.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search by label or id..." />
          <CommandList>
            <CommandEmpty>No matching node found.</CommandEmpty>
            <CommandGroup>
              {sortedEntries.map((entry) => {
                const isHinted = hintedIds.has(entry.id);
                const isSelected = entry.id === value;
                const breadcrumb = entry.path.join(" / ");
                return (
                  <CommandItem
                    key={entry.id}
                    value={entry.node.label}
                    keywords={[entry.node.label, entry.id, entry.node.type, ...entry.path]}
                    onSelect={() => {
                      onSelect(entry.node);
                      setOpen(false);
                    }}
                    className="flex-col items-start gap-0.5 py-2"
                  >
                    <div className="flex w-full items-center gap-2">
                      <Check
                        className={cn("size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                      />
                      <span className="truncate text-sm font-medium">{entry.node.label}</span>
                      <span className="shrink-0 rounded-full border border-border bg-secondary px-1.5 py-0 font-mono text-[10px] tracking-wide text-secondary-foreground uppercase">
                        {entry.node.type}
                      </span>
                      {isHinted && (
                        <Badge variant="secondary" className="ml-auto shrink-0 gap-1 text-[10px]">
                          <Sparkles className="size-3" />
                          Suggested
                        </Badge>
                      )}
                    </div>
                    {breadcrumb && (
                      <span className="truncate pl-6 text-xs text-muted-foreground">
                        {breadcrumb}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
