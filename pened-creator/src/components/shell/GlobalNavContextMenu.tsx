import type { ComponentType, ReactNode } from "react";
import { Lightbulb, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * A single option in the Global Nav context menu.
 *
 * To add a new option, append another entry to the `items` array passed to
 * <GlobalNavContextMenu />. No changes to this component are required.
 */
export interface GlobalNavContextMenuItem {
  /** Stable unique identifier, used as the React key and test id suffix. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional leading icon (any lucide-react compatible component). */
  icon?: ComponentType<{ className?: string }>;
  /** Called when the item is chosen (click, Enter or Space). */
  onSelect: () => void;
  /** Optional: render the item as disabled. */
  disabled?: boolean;
  /** Optional: render a separator above this item. */
  separatorBefore?: boolean;
}

export interface GlobalNavContextMenuProps {
  /** Menu options, rendered in order. When empty, the menu is not rendered. */
  items: GlobalNavContextMenuItem[];
  /** Accessible name for the trigger button. */
  triggerLabel?: string;
  /** Optional heading shown at the top of the open menu. */
  menuLabel?: string;
  /** Optional custom trigger icon. Defaults to a menu (hamburger) icon. */
  triggerIcon?: ReactNode;
  className?: string;
  /**
   * Optional callback for the built-in "Suggest a tool" option. When provided,
   * the option is added as the first menu item (unless `items` already
   * contains it), and the callback should open the ToolSuggestionModal.
   */
  onSuggestTool?: () => void;
}

/** Default option used by the Global Nav. */
export const SUGGEST_TOOL_ITEM_ID = "suggest-tool";

/**
 * Convenience factory for the "Suggest a tool" option.
 */
export function createSuggestToolItem(
  onSelect: () => void,
): GlobalNavContextMenuItem {
  return {
    id: SUGGEST_TOOL_ITEM_ID,
    label: "Suggest a tool",
    icon: Lightbulb,
    onSelect,
  };
}

/**
 * Context menu control for the top Global Nav.
 *
 * Built on the existing dropdown-menu primitive (Radix), which provides:
 * - open/close on click, Enter, Space and ArrowDown on the trigger
 * - arrow key navigation, Home/End, and type-ahead between items
 * - Escape to close, with focus returned to the trigger
 * - click-outside dismissal
 * - focus management and ARIA roles (menu, menuitem)
 *
 * Positioning is intentionally left to the parent: place this as the first
 * child of the toolbar so it sits at the leftmost edge of the nav.
 */
export function GlobalNavContextMenu({
  items,
  triggerLabel = "Open menu",
  menuLabel,
  triggerIcon,
  className,
  onSuggestTool,
}: GlobalNavContextMenuProps) {
  const menuItems =
    onSuggestTool && !items.some((item) => item.id === SUGGEST_TOOL_ITEM_ID)
      ? [createSuggestToolItem(onSuggestTool), ...items]
      : items;

  if (menuItems.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={triggerLabel}
          data-testid="global-nav-context-menu-trigger"
          className={cn("shrink-0", className)}
        >
          {triggerIcon ?? <Menu className="h-5 w-5" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="min-w-[12rem]"
        data-testid="global-nav-context-menu"
      >
        {menuLabel ? (
          <>
            <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.id}>
              {item.separatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={item.disabled}
                onSelect={() => item.onSelect()}
                data-testid={`global-nav-context-menu-item-${item.id}`}
                className="cursor-pointer gap-2"
              >
                {Icon ? (
                  <Icon className="h-4 w-4" aria-hidden="true" />
                ) : null}
                <span>{item.label}</span>
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default GlobalNavContextMenu;