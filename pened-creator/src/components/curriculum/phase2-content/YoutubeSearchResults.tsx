import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

import type { YoutubeSearchResultItem } from "@/lib/curriculum/phase2-content/youtubeClient";

interface YoutubeSearchResultsProps {
  /**
   * Results grouped by the keyword that produced them, matching the shape
   * returned by searchYoutubeVideos() / POST /api/youtube/search on the
   * server (see server/src/routes/youtube.js): an object whose keys are
   * the original keyword strings and whose values are that keyword's
   * matched videos.
   */
  resultsByKeyword: Record<string, YoutubeSearchResultItem[]>;
}

/**
 * Renders keyword-grouped YouTube search results as video cards. This is
 * a pure display component — results are session-only (not persisted),
 * so it takes the already-fetched data as a prop rather than fetching
 * anything itself; the calling step container owns the fetch, loading,
 * and error states.
 */
export function YoutubeSearchResults({ resultsByKeyword }: YoutubeSearchResultsProps) {
  const keywords = Object.keys(resultsByKeyword);

  if (keywords.length === 0) {
    return <p className="text-sm text-muted-foreground">No results to show yet.</p>;
  }

  return (
    <div className="space-y-8">
      {keywords.map((keyword) => {
        const videos = resultsByKeyword[keyword];

        return (
          <div key={keyword} className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{keyword}</h3>
              <Badge variant="outline" className="text-xs">
                {videos.length} {videos.length === 1 ? "result" : "results"}
              </Badge>
            </div>

            {videos.length === 0 ? (
              // Matches the "nothing here yet" placeholder convention used
              // elsewhere in Phase 2 (e.g. ImagePromptCard.tsx's empty
              // image slot, ImagePromptGenerator.tsx's empty prompt
              // preview): a dashed-bordered box with centered, muted,
              // mono-font copy, rather than a bare paragraph — so a
              // keyword that simply had no matches reads the same way as
              // every other "nothing to show" state in this app instead
              // of looking like an error or a layout gap.
              <div className="flex min-h-[100px] flex-col items-center justify-center gap-1 rounded-md border border-dashed p-3 text-center">
                <span className="font-mono text-xs text-muted-foreground">
                  No videos found for "{keyword}"
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {videos.map((video) => (
                  <VideoResultCard key={video.videoId} video={video} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VideoResultCard({ video }: { video: YoutubeSearchResultItem }) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const publishedLabel = formatPublishedDate(video.publishedAt);

  return (
    <Card className="flex flex-col overflow-hidden py-0">
      <a
      
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-video w-full overflow-hidden bg-muted"
      >
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title ?? "YouTube video thumbnail"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No thumbnail
          </div>
        )}
      </a>

      <CardHeader className="px-4 pt-4 pb-0">
        <CardTitle className="line-clamp-2 text-sm leading-snug">
          {video.title || "Untitled video"}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-between gap-3 px-4 pb-4 pt-2">
        <div className="space-y-1 text-xs text-muted-foreground">
          {video.channelTitle && <p className="line-clamp-1">{video.channelTitle}</p>}
          {publishedLabel && <p>{publishedLabel}</p>}
        </div>

        <Button asChild type="button" variant="outline" size="sm" className="w-full">
          <a href={watchUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Watch on YouTube
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function formatPublishedDate(publishedAt: string | undefined): string | null {
  if (!publishedAt) return null;

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}