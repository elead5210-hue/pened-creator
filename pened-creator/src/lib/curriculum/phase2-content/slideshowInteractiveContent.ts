/**
 * Pure helpers for reading and writing a lesson's slideshow deck as an
 * `interactiveContent` entry.
 *
 * pened-server stores a lesson's interactive content as an array of
 * `{ tool, data }` entries (or null when nothing has been saved).
 * pened-tools loads a slideshow by lesson id and uses the `data` of the
 * FIRST entry whose `tool` is "slideshow". These helpers keep that
 * contract in one place:
 *
 *   - getSlideshowDeck reads the deck the same way pened-tools does
 *     (first matching entry wins).
 *   - upsertSlideshowEntry produces the entries array to save, replacing
 *     the slideshow entry instead of appending a second one and leaving
 *     every other tool's entry exactly as it was.
 *
 * Nothing here does I/O, validates the deck, or mutates its inputs.
 * Deck validation lives in ./slideshowDeckValidator.ts and callers are
 * expected to validate before saving; persistence lives in
 * ../shared/db.ts.
 */

/** The `tool` value pened-tools looks for to find a lesson's slideshow. */
export const SLIDESHOW_TOOL_ID = "slideshow";

/**
 * One entry in a lesson's `interactiveContent` array. `tool` names the
 * pened-tools tool the data belongs to; `data` is that tool's payload
 * (for the slideshow, the Deck JSON). Any extra fields the server may add
 * are preserved when an entry is replaced.
 */
export type InteractiveContentEntry = {
  tool: string;
  data: unknown;
  [key: string]: unknown;
};

/** What the server stores/returns: entries, or null when nothing is saved. */
export type InteractiveContent = InteractiveContentEntry[] | null;

function isSlideshowEntry(entry: unknown): entry is InteractiveContentEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry as { tool?: unknown }).tool === SLIDESHOW_TOOL_ID
  );
}

/**
 * Returns the saved slideshow deck from a lesson's interactiveContent, or
 * null if there is none. Mirrors pened-tools: the deck is the `data` of
 * the first entry where `tool === "slideshow"`. A null/undefined/non-array
 * input, or an array with no slideshow entry, means "no slideshow saved
 * yet". An entry whose `data` is null or undefined also counts as no deck.
 */
export function getSlideshowDeck(interactiveContent: unknown): unknown | null {
  if (!Array.isArray(interactiveContent)) return null;

  const entry = interactiveContent.find(isSlideshowEntry);
  if (!entry) return null;

  return entry.data === undefined ? null : entry.data;
}

/**
 * Returns a new interactiveContent array with the slideshow entry set to
 * the given deck:
 *
 *   - If a slideshow entry already exists, the first one is replaced in
 *     place (keeping its position and any extra fields, with `data`
 *     overwritten). Any further slideshow entries are dropped, so a lesson
 *     ends up with exactly one and pened-tools' "first entry wins" rule
 *     can never pick up a stale deck.
 *   - If there is none, a new `{ tool: "slideshow", data: deck }` entry is
 *     appended.
 *   - Entries for other tools (and anything that isn't a recognisable
 *     slideshow entry) are passed through untouched, in their original
 *     order.
 *   - A null/undefined/non-array input is treated as "nothing saved yet".
 *
 * The input array and its entries are never mutated.
 *
 * @param interactiveContent - the lesson's current interactiveContent
 * @param deck - the already-validated slideshow Deck object
 */
export function upsertSlideshowEntry(
  interactiveContent: unknown,
  deck: unknown,
): InteractiveContentEntry[] {
  const current: unknown[] = Array.isArray(interactiveContent) ? interactiveContent : [];

  const result: InteractiveContentEntry[] = [];
  let replaced = false;

  for (const entry of current) {
    if (isSlideshowEntry(entry)) {
      if (replaced) continue; // drop duplicate slideshow entries
      result.push({ ...entry, data: deck });
      replaced = true;
    } else {
      result.push(entry as InteractiveContentEntry);
    }
  }

  if (!replaced) {
    result.push({ tool: SLIDESHOW_TOOL_ID, data: deck });
  }

  return result;
}
