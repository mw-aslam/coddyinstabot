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

const GENERIC_URL_REGEX = /https?:\/\/\S+|(?:^|\s)www\.\S+/i;

/** True if the text looks like some kind of URL (any host), not just Instagram. */
export function looksLikeUrl(text: string): boolean {
  return GENERIC_URL_REGEX.test(text);
}

const YOUTUBE_URL_REGEX =
  /https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)[\w-]+(?:[&?][\w=&%-]*)?|youtu\.be\/[\w-]+(?:\?[\w=&%-]*)?)/i;

/** Extracts the first YouTube video/Shorts URL found in a free-text message, if any. */
export function extractYouTubeUrl(text: string): string | null {
  const match = text.match(YOUTUBE_URL_REGEX);
  return match ? match[0] : null;
}

const TIKTOK_URL_REGEX = /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/[^\s]+/i;

/** Extracts the first TikTok URL found in a free-text message, if any. */
export function extractTikTokUrl(text: string): string | null {
  const match = text.match(TIKTOK_URL_REGEX);
  if (!match) return null;
  return match[0].replace(/[)\]]+$/, '');
}
