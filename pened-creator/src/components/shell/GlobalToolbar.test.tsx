import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalToolbar } from "./GlobalToolbar";
import { ToolSuggestionModal } from "@/components/tools/ToolSuggestionModal";
import {
  mockToolSuggestionsAdapter,
  realToolSuggestionsAdapter,
  setToolSuggestionsAdapter,
} from "@/lib/tools/toolSuggestionsClient";

// ---------------------------------------------------------------------------
// Module mocks: keep the toolbar isolated from routing, auth and storage.
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));

vi.mock("@/lib/curriculum/shared/db", () => ({
  getLesson: vi.fn(async () => undefined),
  getLessonBreakdown: vi.fn(async () => undefined),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock("@/lib/curriculum/shared/schema", () => ({
  PROJECT_ID: "test-project",
}));

const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    info: (...args: unknown[]) => toastInfo(...args),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Harness: wires the toolbar's onSuggestTool callback to the modal, the same
// way the app shell is expected to.
// ---------------------------------------------------------------------------

function ShellHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GlobalToolbar onSuggestTool={() => setOpen(true)} />
      <ToolSuggestionModal open={open} onOpenChange={setOpen} />
    </>
  );
}

const VALID_DESCRIPTION = "A tool that turns a lesson into a printable worksheet with answer key.";

async function openSuggestionModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("global-nav-context-menu-trigger"));
  await user.click(await screen.findByTestId("global-nav-context-menu-item-suggest-tool"));
  return screen.findByRole("dialog");
}

describe("GlobalToolbar context menu integration", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastInfo.mockReset();
    setToolSuggestionsAdapter(mockToolSuggestionsAdapter);
  });

  afterEach(() => {
    cleanup();
    setToolSuggestionsAdapter(realToolSuggestionsAdapter);
  });

  it("renders the menu trigger alongside the existing nav links", () => {
    render(<ShellHarness />);

    expect(screen.getByTestId("global-nav-context-menu-trigger")).toHaveAccessibleName("Open navigation menu");
    expect(screen.getByText("Curriculum Tree")).toBeInTheDocument();
    expect(screen.getByText("Content Generation")).toBeInTheDocument();
    expect(screen.getByText("Tool Registry")).toBeInTheDocument();
  });

  it("shows a single 'Suggest a tool' option when the menu is opened", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await user.click(screen.getByTestId("global-nav-context-menu-trigger"));

    const menu = await screen.findByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(menu).toBeInTheDocument();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Suggest a tool");
  });

  it("closes the menu with Escape without opening the modal", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await user.click(screen.getByTestId("global-nav-context-menu-trigger"));
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the suggestion modal when the option is chosen", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    const dialog = await openSuggestionModal(user);

    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("tool-suggestion-modal")).toBeInTheDocument();
    expect(screen.getByLabelText("Tool description")).toBeInTheDocument();
  });

  it("completes a full submit flow through the mock adapter", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await openSuggestionModal(user);
    await user.type(screen.getByTestId("tool-suggestion-description"), VALID_DESCRIPTION);
    await user.click(screen.getByTestId("tool-suggestion-submit"));

    // The mock adapter simulates ~400ms latency, so the loading state shows first.
    expect(await screen.findByTestId("tool-suggestion-success", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledTimes(1);

    // The modal auto-closes shortly after success.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("blocks submission of a too-short description before reaching the adapter", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await openSuggestionModal(user);
    await user.type(screen.getByTestId("tool-suggestion-description"), "too short");
    await user.click(screen.getByTestId("tool-suggestion-submit"));

    expect(await screen.findByText("Description must be at least 10 characters.")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-suggestion-success")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a server error and keeps the modal open when the mock simulates a failure", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await openSuggestionModal(user);
    await user.type(screen.getByTestId("tool-suggestion-description"), "simulate-error");
    await user.click(screen.getByTestId("tool-suggestion-submit"));

    expect(await screen.findByTestId("tool-suggestion-form-error", undefined, { timeout: 3000 })).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("tool-suggestion-description")).toHaveValue("simulate-error");
  });

  it("closes the modal via Cancel and can be reopened from the menu with a clean form", async () => {
    const user = userEvent.setup();
    render(<ShellHarness />);

    await openSuggestionModal(user);
    await user.type(screen.getByTestId("tool-suggestion-description"), "some draft text");
    await user.click(screen.getByTestId("tool-suggestion-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await openSuggestionModal(user);
    expect(screen.getByTestId("tool-suggestion-description")).toHaveValue("");
  });

  it("falls back to a placeholder toast when no onSuggestTool handler is provided", async () => {
    const user = userEvent.setup();
    render(<GlobalToolbar />);

    await user.click(screen.getByTestId("global-nav-context-menu-trigger"));
    await user.click(await screen.findByTestId("global-nav-context-menu-item-suggest-tool"));

    expect(toastInfo).toHaveBeenCalledWith("Tool suggestions are coming soon.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});