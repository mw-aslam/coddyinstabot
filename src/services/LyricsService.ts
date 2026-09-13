import { logger } from '../utils/logger';

const LYRICS_ENDPOINT = 'https://api.lyrics.ovh/v1';

interface LyricsResponse {
  lyrics?: string;
  error?: string;
}

/**
 * Fetches plain lyrics text via the free lyrics.ovh API. Tries the stored artist first (when
 * known), then falls back to splitting "Artist - Title"-style titles — the common YouTube
 * music upload convention — since music-search results don't always carry a separate artist.
 */
export async function fetchLyrics(artist: string | undefined, title: string): Promise<string | null> {
  for (const candidate of buildCandidates(artist, title)) {
    try {
      const res = await fetch(`${LYRICS_ENDPOINT}/${encodeURIComponent(candidate.artist)}/${encodeURIComponent(candidate.title)}`);
      if (!res.ok) continue;
      const data = (await res.json()) as LyricsResponse;
      if (data.lyrics?.trim()) return data.lyrics.trim();
    } catch (err) {
      logger.debug('Lyrics lookup attempt failed', { candidate, err: (err as Error).message });
    }
  }
  return null;
}

function buildCandidates(artist: string | undefined, title: string): { artist: string; title: string }[] {
  const candidates: { artist: string; title: string }[] = [];
  if (artist) candidates.push({ artist, title });

  const dashSplit = title.split(/\s-\s/);
  if (dashSplit.length === 2) candidates.push({ artist: dashSplit[0].trim(), title: dashSplit[1].trim() });

  return candidates;
}
