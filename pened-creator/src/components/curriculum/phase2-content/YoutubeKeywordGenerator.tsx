import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Copy,
  Download,
  Check,
  RefreshCw,
  Youtube,
  Loader2,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";

import { buildYoutubeKeywordPromptRequest } from "@/lib/curriculum/phase2-content/youtubeKeywordPromptBuilder";
import { copyTextToClipboard, downloadTextFile } from "@/lib/curriculum/phase2-content/download";
import {
  searchYoutubeVideos,
  type YoutubeSearchResultItem,
} from "@/lib/curriculum/phase2-content/youtubeClient";
import { ApiError } from "@/lib/curriculum/shared/apiClient";
import { PasteYoutubeKeywordResponseForm } from "./PasteYoutubeKeywordResponseForm";
import { YoutubeSearchResults } from "./YoutubeSearchResults";

import { getYoutubeKeywordResponse, type LessonRecord } from "@/lib/curriculum/shared/db";

interface YoutubeKeywordGeneratorProps {
  /** The lesson this step belongs to - its saved generatedContent feeds
   * Step 1's keyword-request prompt. */
  lessonRecord: LessonRecord;
  /**
   * Keywords already saved for this lesson session, if any (held in the
   * parent route's own state - see routes/lessons.$lessonId.tsx). When
   * present, Step 3 renders the chip/badge display instead of the paste
   * form, and the search below runs automatically. Never persisted
   * anywhere, so this reverts to null on a page refresh or when the user
   * navigates to a different lesson.
   */
  savedKeywords: string[] | null;
  /**
   * Called once the user pastes and confirms a keyword response, with the
   * plain keyword strings extracted from the parsed response. Passing an
   * empty array is not expected — PasteYoutubeKeywordResponseForm only
   * calls its own onSaved once it has parsed at least one keyword.
   */
  onKeywordsSaved: (keywords: string[]) => void;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; resultsByKeyword: Record<string, YoutubeSearchResultItem[]> }
  | { status: "error"; message: string };

function buildKeywordPromptFilename(lessonRecord: LessonRecord): string {
  const sanitize = (value: string | null | undefined) =>
    String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  const projectPart = sanitize(lessonRecord.project_id) || "project";
  const lessonPart = sanitize(lessonRecord.lesson_node_id) || "lesson";
  return `${projectPart}_${lessonPart}_youtube-keywords-prompt.txt`;
}

/**
 * Step 1/2/3 container for the "YouTube keywords" lesson step, mirroring
 * ImagePromptGenerator.tsx's layout:
 *   Step 1 — build the keyword-request prompt from the lesson's saved
 *            generatedContent (via buildYoutubeKeywordPromptRequest).
 *   Step 2 — copy or download that prompt to paste into an external LLM.
 *   Step 3 — paste the LLM's response back in (PasteYoutubeKeywordResponseForm),
 *            or, once keywords are saved, show them as chips with a way to
 *            paste a different response instead of the form.
 *
 * Once keywords are available (saved this session, or freshly pasted),
 * this component also drives the YouTube search itself: it calls
 * searchYoutubeVideos() with the keyword list, tracks a loading/error/
 * success state, and renders YoutubeSearchResults on success. Nothing
 * about the search results is persisted anywhere — it's re-run from the
 * saved keywords on every mount/keyword-change, consistent with this step
 * being session-only (only the keyword strings themselves are lifted up
 * to the parent route's state, and even that is lost on refresh).
 */
export function YoutubeKeywordGenerator({
  lessonRecord,
  savedKeywords,
  onKeywordsSaved,
}: YoutubeKeywordGeneratorProps) {
  const [copied, setCopied] = useState(false);
  const [isRepasting, setIsRepasting] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  // The raw LLM response text last saved to the API for this lesson, used
  // to pre-fill the paste form, and whether that saved response is still
  // being loaded on mount (so the empty paste form doesn't flash before
  // a previously saved response arrives).
  const [savedRawResponse, setSavedRawResponse] = useState<string | undefined>(undefined);
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  // Tracks whether this session has ever had saved keywords, so a later
  // transition to "no keywords" can be told apart from "never generated
  // any keywords yet" — the former means the session was cleared (a page
  // refresh, or switching away and back to this lesson) and should prompt
  // the user to regenerate, rather than silently looking identical to a
  // lesson that's simply never had this step run.
  const everHadKeywordsRef = useRef(false);
  const [sessionCleared, setSessionCleared] = useState(false);

  const prompt = useMemo(
    () =>
      buildYoutubeKeywordPromptRequest(
        (lessonRecord.generatedContent ?? []) as Record<string, unknown>[],
      ),
    [lessonRecord.generatedContent],
  );

  const hasSavedKeywords = Boolean(savedKeywords && savedKeywords.length > 0);
  const showPasteForm = !hasSavedKeywords || isRepasting;

  // Detect the "cleared session" transition: keywords were present at
  // some point during this component's lifetime, and are now gone (not
  // because the paste form is mid-repaste — that's isRepasting, tracked
  // separately below — but because savedKeywords itself reverted to
  // null/empty, e.g. the parent reset it on a lessonId change). Runs
  // after the "were keywords ever saved" flag is updated below so a
  // simple `if (hasSavedKeywords)` first pass never spuriously reports a
  // clear.
  useEffect(() => {
    if (hasSavedKeywords) {
      everHadKeywordsRef.current = true;
      setSessionCleared(false);
    } else if (everHadKeywordsRef.current) {
      setSessionCleared(true);
    }
  }, [hasSavedKeywords]);

  // Re-run the search whenever the saved keyword list changes (including
  // on first load, if keywords were already saved for this lesson this
  // session). Guard against a stale response landing after a newer
  // request has started by ignoring the result if the effect has since
  // been cleaned up. When there are no saved keywords (never generated,
  // or cleared), search state is reset to "idle" immediately, so a
  // cleared session never leaves a stale "loading" or "success" card on
  // screen.
  const keywordsKey = hasSavedKeywords ? savedKeywords!.join("\u0000") : "";
  useEffect(() => {
    if (!hasSavedKeywords) {
      setSearchState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setSearchState({ status: "loading" });

    searchYoutubeVideos(savedKeywords!)
      .then((response) => {
        if (cancelled) return;
        setSearchState({ status: "success", resultsByKeyword: response.results });
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError ? err.message : "Couldn't search YouTube. Please try again.";
        setSearchState({ status: "error", message });
        toast.error(message);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordsKey, hasSavedKeywords]);

  // Load any previously saved response for this lesson from the API when
  // the step mounts (or the lesson changes). If keywords aren't already
  // held by the parent, they're restored from the saved response so a
  // page refresh or returning to the lesson doesn't lose them.
  useEffect(() => {
    let cancelled = false;
    setIsLoadingSaved(true);
    setSavedRawResponse(undefined);

    getYoutubeKeywordResponse(lessonRecord.id)
      .then((saved) => {
        if (cancelled || !saved) return;
        setSavedRawResponse(saved.rawResponse);
        if (!hasSavedKeywords) {
          onKeywordsSaved(saved.keywords.map((item) => item.keyword));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? `Couldn't load your saved response: ${err.message}`
            : "Couldn't load your saved response.";
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSaved(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonRecord.id]);

  async function handleCopy() {
    try {
      await copyTextToClipboard(prompt);
      setCopied(true);
      toast.success("Prompt copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy to clipboard. Try downloading the prompt instead.");
    }
  }

  function handleDownload() {
    downloadTextFile(prompt, buildKeywordPromptFilename(lessonRecord));
  }

  function handleKeywordsSaved(keywords: string[]) {
    setIsRepasting(false);
    setSessionCleared(false);
    onKeywordsSaved(keywords);
    // The form has already saved the response to the API; refresh the
    // stored raw text so a later re-paste is pre-filled with the latest.
    getYoutubeKeywordResponse(lessonRecord.id)
      .then((saved) => setSavedRawResponse(saved?.rawResponse))
      .catch(() => {
        /* non-critical: the pre-fill text just stays as it was */
      });
  }

  function handleRetrySearch() {
    if (!hasSavedKeywords) return;
    setSearchState({ status: "loading" });
    searchYoutubeVideos(savedKeywords!)
      .then((response) => setSearchState({ status: "success", resultsByKeyword: response.results }))
      .catch((err) => {
        const message =
          err instanceof ApiError ? err.message : "Couldn't search YouTube. Please try again.";
        setSearchState({ status: "error", message });
        toast.error(message);
      });
  }

  return (
    <div className="space-y-6">
      {/* Step 1: the generated prompt */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              1
            </span>
            <CardTitle className="text-base">Generate the keyword-request prompt</CardTitle>
          </div>
          <CardDescription>
            This prompt asks an LLM for a set of YouTube search keywords relevant to this lesson.
            Copy or download it, then paste it into your preferred AI assistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 text-sm">
            {prompt}
          </pre>
        </CardContent>
      </Card>

      {/* Step 2: copy / download actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              2
            </span>
            <CardTitle className="text-base">Copy or download the prompt</CardTitle>
          </div>
          <CardDescription>Send this prompt to an LLM of your choice.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleCopy}>
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy prompt
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />
              Download prompt
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Step 3: paste response, or show saved keywords */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              3
            </span>
            <CardTitle className="text-base">
              {hasSavedKeywords && !isRepasting ? "Saved keywords" : "Paste the LLM's response"}
            </CardTitle>
          </div>
          <CardDescription>
            {hasSavedKeywords && !isRepasting
              ? "These keywords are saved with this lesson."
              : sessionCleared
                ? "This session's previously saved keywords were cleared. Paste the response again to restore them."
                : "Paste the response back here to extract the suggested keywords."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingSaved ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your saved response…
              </div>
              <Skeleton className="h-24 w-full" />
            </div>
          ) : showPasteForm ? (
            <div className="space-y-4">
              {isRepasting && (
                <div className="flex items-center justify-between rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  <span>Pasting a new response will replace the current saved keywords.</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsRepasting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              <PasteYoutubeKeywordResponseForm
                lessonId={lessonRecord.id}
                initialRawResponse={savedRawResponse}
                onSaved={(items) => handleKeywordsSaved(items.map((item) => item.keyword))}
                onCancel={() => setIsRepasting(false)}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {savedKeywords!.map((keyword, index) => (
                  <Badge key={`${keyword}-${index}`} variant="secondary" className="gap-1.5 py-1.5">
                    <Youtube className="h-3.5 w-3.5" />
                    {keyword}
                  </Badge>
                ))}
              </div>
              <Separator />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRepasting(true)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Paste a different response
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* YouTube search results, driven by the saved keywords above. Not
          shown while the paste form is open (mid-repaste) since the saved
          keywords haven't changed yet and re-showing stale results would
          be confusing. When there are no saved keywords at all — either
          because this step has never been run, or because the session was
          cleared (refresh, or navigating away and back) — an explicit
          empty/cleared-session state is shown here instead of just
          omitting the card, so it's clear why no videos are showing and
          what to do next. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">YouTube results</CardTitle>
          <CardDescription>
            Videos found for each saved keyword. These results are not saved — only the keywords and
            the pasted response above are, and they're searched again each time you return.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasSavedKeywords || isRepasting ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              {sessionCleared ? (
                <>
                  <p className="text-sm font-medium text-foreground">
                    This session's keywords were cleared
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Keywords and search results for this step aren't saved past a refresh or a
                    switch to another lesson. Paste the AI's response again in Step 3 above to
                    search YouTube again.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-foreground">
                    No keywords generated or pasted yet
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Complete Steps 1–3 above — generate the prompt, run it through an AI, and paste
                    the response back in — and matching videos will appear here.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {searchState.status === "loading" && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching YouTube…
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="space-y-2">
                        <Skeleton className="aspect-video w-full rounded-md" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchState.status === "error" && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Couldn't search YouTube</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>{searchState.message}</p>
                    <Button type="button" variant="outline" size="sm" onClick={handleRetrySearch}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Try again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {searchState.status === "success" && (
                <YoutubeSearchResults resultsByKeyword={searchState.resultsByKeyword} />
              )}

              {searchState.status === "idle" && (
                <p className="text-sm text-muted-foreground">Preparing search…</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
