import fs from 'node:fs/promises';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const AUDD_ENDPOINT = 'https://api.audd.io/';

export interface RecognizedTrack {
  artist: string;
  title: string;
}

interface AudDResponse {
  status: 'success' | 'error';
  result: { artist: string; title: string } | null;
  error?: { error_code: number; error_message: string };
}

/** Shazam-style recognition of a short audio clip via the AudD.io API. */
export class RecognitionService {
  isEnabled(): boolean {
    return Boolean(config.auddApiKey);
  }

  /** Sends a local audio file to AudD and returns the matched artist/title, or null if no match. */
  async recognize(filePath: string): Promise<RecognizedTrack | null> {
    if (!config.auddApiKey) {
      throw new Error('AUDD_API_KEY is not configured');
    }

    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append('api_token', config.auddApiKey);
    form.append('return', 'apple_music,spotify');
    form.append('file', new Blob([buffer]), 'clip.mp3');

    const res = await fetch(AUDD_ENDPOINT, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`AudD request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as AudDResponse;
    if (data.status !== 'success') {
      logger.warn('AudD returned an error', { error: data.error });
      throw new Error(data.error?.error_message ?? 'AudD recognition failed');
    }

    if (!data.result) return null;
    return { artist: data.result.artist, title: data.result.title };
  }
}

export const recognitionService = new RecognitionService();
