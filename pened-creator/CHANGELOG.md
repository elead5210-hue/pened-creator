# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> **Note:** This file was just created and does not yet reflect any
> completed work. The entries below describe the *intended* changes for
> the in-progress update (adding a YouTube Keywords / Video Search step
> to Phase 2), not changes that have actually landed in the code yet.
> This file will be revised to reflect what was actually implemented
> after each batch of tasks in this update is completed.

## [Unreleased]

### Added

- **YouTube Keywords / Video Search step (Phase 2)** — a new step in the
  Phase 2 (Content Generation) lifecycle, placed between "View Content"
  and "Image Generation" in the lesson detail step sidebar.
  - Generates a structured prompt from the lesson's already-generated
    content, asking an AI to propose a list of YouTube search keywords
    relevant to the lesson.
  - The generated prompt can be copied/downloaded, pasted into an AI,
    and the AI's structured JSON response pasted back into the app and
    validated, mirroring the existing Image Generation step's
    generate-prompt / paste-response pattern.
  - The saved keyword list is used to call the API's
    `POST /api/youtube/search` endpoint, and the returned videos are
    displayed in a list the user can watch.
  - Keywords and search results for this step are **session-only**:
    nothing is persisted to the lesson record or the server, so they're
    cleared on a page/session refresh and must be regenerated.

[Unreleased]: #