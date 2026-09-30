import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import {
  realToolSuggestionsAdapter,
  setToolSuggestionsAdapter,
} from "@/lib/tools/toolSuggestionsClient";

// Unmount rendered trees between tests so DOM state never leaks across them,
// and make sure no timers, mocks, stubs or adapter overrides outlive a test
// (a leftover timer or listener can keep the Vitest process from exiting).
afterEach(() => {
  cleanup();

  // Drop any timers still pending under fake timers, then go back to real ones.
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
  }
  vi.useRealTimers();

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();

  // Tests may swap in a mock adapter; always go back to the real one.
  setToolSuggestionsAdapter(realToolSuggestionsAdapter);
});

// jsdom does not implement these browser APIs, which Radix UI primitives
// (Dialog, DropdownMenu, etc.) rely on when they open and close.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
}