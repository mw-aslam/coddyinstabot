/** Matches Instagram reel/post/tv/story links, with or without protocol/www. */
const INSTAGRAM_URL_REGEX =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv|stories)\/[A-Za-z0-9_\-./]+/i;

const INSTAGRAM_HOST_REGEX = /instagram\.com/i;

/** Extracts the first Instagram media URL found in a free-text message, if any. */
export function extractInstagramUrl(text: string): string | null {
  const match = text.match(INSTAGRAM_URL_REGEX);
  if (!match) return null;
  return match[0].replace(/[)\]]+$/, '');
}

/** True if the text contains an instagram.com host but not a link our regex recognises. */
export function looksLikeUnsupportedInstagramLink(text: string): boolean {
  return INSTAGRAM_HOST_REGEX.test(text) && !extractInstagramUrl(text);
}
