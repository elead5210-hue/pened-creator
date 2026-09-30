import { describe, expect, it } from "vitest";

import {
  PHASE2_STEPS,
  getPhase2StepStatuses,
  getPhase2StepUnlockStatus,
} from "./lessonPipelineStatus";
import type { LessonRecord } from "./db";

function makeRecord(overrides: Record<string, unknown> = {}): LessonRecord {
  return {
    id: "project:lesson",
    project_id: "project",
    lesson_node_id: "lesson",
    imagePrompts: [{ id: "img-01" }],
    images: { "img-01": "img-01.png" },
    slideshowDeck: null,
    ...overrides,
  } as unknown as LessonRecord;
}

const SAVED_DECK = {
  version: "v1",
  id: "deck-1",
  metadata: { title: "My Deck" },
  slides: [{ id: "slide-1", elements: [] }],
};

describe("PHASE2_STEPS", () => {
  it("places 'slide-data' directly after 'slideshow-data'", () => {
    const index = PHASE2_STEPS.indexOf("slideshow-data");

    expect(index).toBeGreaterThanOrEqual(0);
    expect(PHASE2_STEPS[index + 1]).toBe("slide-data");
  });

  it("keeps 'games' after 'slide-data'", () => {
    expect(PHASE2_STEPS.indexOf("games")).toBeGreaterThan(PHASE2_STEPS.indexOf("slide-data"));
  });
});

describe("getPhase2StepUnlockStatus('slide-data')", () => {
  it("is locked when the lesson record is null", () => {
    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", false, null)).toBe("locked");
  });

  it("is locked when the lesson record is undefined", () => {
    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", false, undefined)).toBe(
      "locked",
    );
  });

  it("is locked when no deck has been saved", () => {
    const record = makeRecord({ slideshowDeck: null });

    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", true, record)).toBe("locked");
  });

  it("is locked when the deck field is missing entirely", () => {
    const record = makeRecord();
    delete (record as unknown as Record<string, unknown>).slideshowDeck;

    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", true, record)).toBe("locked");
  });

  it("is available once a deck has been saved", () => {
    const record = makeRecord({ slideshowDeck: SAVED_DECK });

    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", true, record)).toBe(
      "available",
    );
  });

  it("never reports 'complete', since it only displays data", () => {
    const record = makeRecord({ slideshowDeck: SAVED_DECK });

    expect(getPhase2StepUnlockStatus("slide-data", "images-generated", true, record)).not.toBe(
      "complete",
    );
  });
});

describe("getPhase2StepStatuses", () => {
  it("includes a 'slide-data' entry for every call", () => {
    const statuses = getPhase2StepStatuses("images-generated", true, makeRecord());

    expect(Object.keys(statuses)).toEqual([...PHASE2_STEPS]);
    expect(statuses["slide-data"]).toBe("locked");
  });

  it("unlocks 'slide-data' alongside a completed 'slideshow-data' when a deck is saved", () => {
    const statuses = getPhase2StepStatuses(
      "images-generated",
      true,
      makeRecord({ slideshowDeck: SAVED_DECK }),
    );

    expect(statuses["slideshow-data"]).toBe("complete");
    expect(statuses["slide-data"]).toBe("available");
  });

  it("keeps 'slide-data' locked while 'slideshow-data' is available but unsaved", () => {
    const statuses = getPhase2StepStatuses("images-generated", true, makeRecord());

    expect(statuses["slideshow-data"]).toBe("available");
    expect(statuses["slide-data"]).toBe("locked");
  });

  it("does not affect the 'games' step status", () => {
    const withoutDeck = getPhase2StepStatuses("images-generated", true, makeRecord());
    const withDeck = getPhase2StepStatuses(
      "images-generated",
      true,
      makeRecord({ slideshowDeck: SAVED_DECK }),
    );

    expect(withoutDeck.games).toBe("available");
    expect(withDeck.games).toBe("available");
  });

  it("locks 'slide-data' when there is no lesson record", () => {
    const statuses = getPhase2StepStatuses("breakdown-saved", false, null);

    expect(statuses["slide-data"]).toBe("locked");
  });
});