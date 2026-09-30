import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolSuggestionModal } from "./ToolSuggestionModal";
import {
  ToolSuggestionsApiError,
  setToolSuggestionsAdapter,
  realToolSuggestionsAdapter,
  type SubmitToolSuggestionInput,
  type SubmitToolSuggestionResult,
  type ToolSuggestionsAdapter,
} from "@/lib/tools/toolSuggestionsClient";

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const VALID_DESCRIPTION = "A tool that turns a lesson into a printable worksheet with answer key.";

function makeResult(description: string): SubmitToolSuggestionResult {
  return {
    suggestion: {
      id: "6f1c1f0e-2f3e-4a52-9d55-6b1a2f7d8c11",
      description,
      status: "new",
      submittedBy: { id: "b7a0f1d2-3c44-4e6b-8f21-0d9e5c7a1234", displayName: "Sam Teacher" },
      createdAt: "2026-09-29T08:15:30.000Z",
      updatedAt: "2026-09-29T08:15:30.000Z",
      reviewedBy: null,
      reviewedAt: null,
      adminNote: null,
    },
  };
}

/** Test harness that owns the `open` state like a real parent would. */
function Harness({
  onSubmitted,
  onOpenChangeSpy,
  initialOpen = true,
}: {
  onSubmitted?: () => void;
  onOpenChangeSpy?: (open: boolean) => void;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <ToolSuggestionModal
        open={open}
        onOpenChange={(next) => {
          onOpenChangeSpy?.(next);
          setOpen(next);
        }}
        onSubmitted={onSubmitted}
      />
    </>
  );
}

function setAdapter(submit: (input: SubmitToolSuggestionInput) => Promise<SubmitToolSuggestionResult>) {
  const adapter: ToolSuggestionsAdapter = { submit: vi.fn(submit) };
  setToolSuggestionsAdapter(adapter);
  return adapter;
}

function getTextarea() {
  return screen.getByTestId("tool-suggestion-description") as HTMLTextAreaElement;
}

describe("ToolSuggestionModal", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
  });

  afterEach(() => {
    // Unmount first so the modal's own cleanup clears its auto-close timer,
    // then drop any timers still pending under fake timers and go back to
    // real ones so nothing outlives the test.
    cleanup();
    if (vi.isFakeTimers()) {
      vi.clearAllTimers();
    }
    vi.useRealTimers();
    setToolSuggestionsAdapter(realToolSuggestionsAdapter);
  });

  describe("rendering and accessibility", () => {
    it("renders a labelled dialog with the textarea focused", async () => {
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText("Suggest a tool")).toBeInTheDocument();
      expect(screen.getByLabelText("Tool description")).toBe(getTextarea());

      await waitFor(() => expect(getTextarea()).toHaveFocus());
    });

    it("does not render when closed", () => {
      render(<Harness initialOpen={false} />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a live character counter based on the trimmed length", async () => {
      const user = userEvent.setup();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.type(getTextarea(), "  hello  ");
      expect(screen.getByText("5/2000")).toBeInTheDocument();
    });
  });

  describe("validation", () => {
    it("shows a required error and does not call the API when submitting empty", async () => {
      const user = userEvent.setup();
      const adapter = setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByText("Description is required.")).toBeInTheDocument();
      expect(adapter.submit).not.toHaveBeenCalled();
      expect(getTextarea()).toHaveAttribute("aria-invalid", "true");
      expect(getTextarea()).toHaveFocus();
    });

    it("shows a minimum length error for short input", async () => {
      const user = userEvent.setup();
      const adapter = setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.type(getTextarea(), "too short");
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByText("Description must be at least 10 characters.")).toBeInTheDocument();
      expect(adapter.submit).not.toHaveBeenCalled();
    });

    it("treats whitespace-only input as empty", async () => {
      const user = userEvent.setup();
      const adapter = setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.type(getTextarea(), "            ");
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByText("Description is required.")).toBeInTheDocument();
      expect(adapter.submit).not.toHaveBeenCalled();
    });

    it("shows a maximum length error for oversized input", async () => {
      const adapter = setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      fireEvent.change(getTextarea(), { target: { value: "x".repeat(2001) } });
      fireEvent.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByText("Description must be 2000 characters or fewer.")).toBeInTheDocument();
      expect(adapter.submit).not.toHaveBeenCalled();
    });

    it("validates on blur and clears the error once the input becomes valid", async () => {
      const user = userEvent.setup();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.type(getTextarea(), "short");
      await user.tab();
      expect(await screen.findByText("Description must be at least 10 characters.")).toBeInTheDocument();

      await user.click(getTextarea());
      await user.type(getTextarea(), " but now it is long enough");
      await waitFor(() =>
        expect(screen.queryByText("Description must be at least 10 characters.")).not.toBeInTheDocument(),
      );
      expect(getTextarea()).not.toHaveAttribute("aria-invalid");
    });
  });

  describe("submitting", () => {
    it("submits the description, shows success, notifies the parent and auto-closes", async () => {
      const user = userEvent.setup();
      const onSubmitted = vi.fn();
      const onOpenChangeSpy = vi.fn();
      const adapter = setAdapter(async (input) => makeResult(input.description.trim()));
      render(<Harness onSubmitted={onSubmitted} onOpenChangeSpy={onOpenChangeSpy} />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByTestId("tool-suggestion-success")).toBeInTheDocument();
      expect(adapter.submit).toHaveBeenCalledTimes(1);
      expect(adapter.submit).toHaveBeenCalledWith({ description: VALID_DESCRIPTION });
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(toastSuccess).toHaveBeenCalledTimes(1);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 3000 });
      expect(onOpenChangeSpy).toHaveBeenLastCalledWith(false);
    });

    it("shows a loading state and blocks duplicate submits and dismissal while in flight", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      let resolveSubmit: (value: SubmitToolSuggestionResult) => void = () => {};
      const adapter = setAdapter(
        () =>
          new Promise<SubmitToolSuggestionResult>((resolve) => {
            resolveSubmit = resolve;
          }),
      );
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      const submitButton = await screen.findByTestId("tool-suggestion-submit");
      expect(submitButton).toBeDisabled();
      expect(submitButton).toHaveTextContent("Sending...");
      expect(screen.getByTestId("tool-suggestion-cancel")).toBeDisabled();
      expect(getTextarea()).toBeDisabled();

      // Escape must not dismiss while a request is pending.
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onOpenChangeSpy).not.toHaveBeenCalled();

      expect(adapter.submit).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveSubmit(makeResult(VALID_DESCRIPTION));
      });
      expect(await screen.findByTestId("tool-suggestion-success")).toBeInTheDocument();
    });

    it("keeps the dialog open and preserves input after a generic server error", async () => {
      const user = userEvent.setup();
      const onSubmitted = vi.fn();
      setAdapter(async () => {
        throw new ToolSuggestionsApiError({
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        });
      });
      render(<Harness onSubmitted={onSubmitted} />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      const alert = await screen.findByTestId("tool-suggestion-form-error");
      expect(alert).toHaveTextContent("Something went wrong. Please try again.");
      expect(getTextarea()).toHaveValue(VALID_DESCRIPTION);
      expect(screen.getByTestId("tool-suggestion-submit")).toBeEnabled();
      expect(onSubmitted).not.toHaveBeenCalled();
      expect(screen.queryByTestId("tool-suggestion-success")).not.toBeInTheDocument();
    });

    it("allows retrying after an error and clears the error on edit", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const adapter = setAdapter(async (input) => {
        calls += 1;
        if (calls === 1) {
          throw new ToolSuggestionsApiError({
            status: 0,
            code: "NETWORK_ERROR",
            message: "Couldn't reach the server. Check your connection and try again.",
          });
        }
        return makeResult(input.description);
      });
      render(<Harness />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));
      expect(await screen.findByTestId("tool-suggestion-form-error")).toHaveTextContent(
        "Couldn't reach the server. Check your connection and try again.",
      );

      await user.type(getTextarea(), "!");
      expect(screen.queryByTestId("tool-suggestion-form-error")).not.toBeInTheDocument();

      await user.click(screen.getByTestId("tool-suggestion-submit"));
      expect(await screen.findByTestId("tool-suggestion-success")).toBeInTheDocument();
      expect(adapter.submit).toHaveBeenCalledTimes(2);
    });

    it("shows server-side field errors inline on the textarea", async () => {
      const user = userEvent.setup();
      setAdapter(async () => {
        throw new ToolSuggestionsApiError({
          status: 400,
          code: "VALIDATION_ERROR",
          message: "Description must be 2000 characters or fewer.",
          fields: { description: "Description must be 2000 characters or fewer." },
        });
      });
      render(<Harness />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByTestId("tool-suggestion-field-error")).toHaveTextContent(
        "Description must be 2000 characters or fewer.",
      );
      expect(getTextarea()).toHaveAttribute("aria-invalid", "true");
      expect(screen.queryByTestId("tool-suggestion-form-error")).not.toBeInTheDocument();
    });

    it("shows a friendly message with minutes when rate limited", async () => {
      const user = userEvent.setup();
      setAdapter(async () => {
        throw new ToolSuggestionsApiError({
          status: 429,
          code: "RATE_LIMITED",
          message: "Too many suggestions. Please try again later.",
          retryAfterSeconds: 1800,
        });
      });
      render(<Harness />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByTestId("tool-suggestion-form-error")).toHaveTextContent(
        "Too many suggestions. Please try again in about 30 minutes.",
      );
    });

    it("asks the user to sign in on an unauthenticated response", async () => {
      const user = userEvent.setup();
      setAdapter(async () => {
        throw new ToolSuggestionsApiError({
          status: 401,
          code: "UNAUTHENTICATED",
          message: "Please sign in to continue.",
        });
      });
      render(<Harness />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByTestId("tool-suggestion-form-error")).toHaveTextContent(
        "Please sign in to suggest a tool.",
      );
    });

    it("falls back to a generic message for unexpected non-API errors", async () => {
      const user = userEvent.setup();
      setAdapter(async () => {
        throw new Error("boom");
      });
      render(<Harness />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));

      expect(await screen.findByTestId("tool-suggestion-form-error")).toHaveTextContent(
        "Something went wrong. Please try again.",
      );
    });
  });

  describe("cancel and dismissal", () => {
    it("closes without calling the API when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      const adapter = setAdapter(async (input) => makeResult(input.description));
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-cancel"));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
      expect(adapter.submit).not.toHaveBeenCalled();
    });

    it("closes when Escape is pressed", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onOpenChangeSpy).toHaveBeenCalledWith(false);
    });

    it("resets the form when closed and reopened", async () => {
      const user = userEvent.setup();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      await user.type(getTextarea(), "short");
      await user.tab();
      expect(await screen.findByText("Description must be at least 10 characters.")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: "Open modal" }));
      await screen.findByRole("dialog");

      expect(getTextarea()).toHaveValue("");
      expect(screen.queryByText("Description must be at least 10 characters.")).not.toBeInTheDocument();
      expect(screen.getByText("0/2000")).toBeInTheDocument();
    });

    it("cancels the pending auto-close timer if the user closes during the success state", async () => {
      const user = userEvent.setup();
      const onOpenChangeSpy = vi.fn();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness onOpenChangeSpy={onOpenChangeSpy} />);

      await user.type(getTextarea(), VALID_DESCRIPTION);
      await user.click(screen.getByTestId("tool-suggestion-submit"));
      await screen.findByTestId("tool-suggestion-success");

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      const closeCalls = onOpenChangeSpy.mock.calls.filter(([value]) => value === false).length;
      expect(closeCalls).toBe(1);

      // Advance past the auto-close delay (with a fake clock, not a real wait)
      // to prove no second close fires. The cancelled timer was created with
      // the real clock, so this also checks it was cleared rather than left
      // pending: switch to fake timers and run everything that is scheduled.
      vi.useFakeTimers();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700);
      });
      expect(onOpenChangeSpy.mock.calls.filter(([value]) => value === false).length).toBe(1);
    });
  });

  describe("focus trap", () => {
    it("keeps keyboard focus inside the dialog when tabbing forwards and backwards", async () => {
      const user = userEvent.setup();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness />);

      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(getTextarea()).toHaveFocus());

      for (let i = 0; i < 6; i += 1) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }

      for (let i = 0; i < 6; i += 1) {
        await user.tab({ shift: true });
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });

    it("returns focus to the element that opened the dialog after closing", async () => {
      const user = userEvent.setup();
      setAdapter(async (input) => makeResult(input.description));
      render(<Harness initialOpen={false} />);

      const opener = screen.getByRole("button", { name: "Open modal" });
      // Explicitly focus the opener first so the previously focused element is
      // deterministic (a click alone doesn't reliably focus a button in jsdom).
      act(() => {
        opener.focus();
      });
      expect(opener).toHaveFocus();

      await user.click(opener);
      await screen.findByRole("dialog");
      await waitFor(() => expect(getTextarea()).toHaveFocus());

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(opener).toHaveFocus(), { timeout: 2000 });
    });
  });
});