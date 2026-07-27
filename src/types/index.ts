/** Shared type definitions used across the whole bot. */

export type DownloadType = 'video' | 'mp3' | 'videoaudio';

export type QualityOption = '360' | '480' | '720' | '1080' | 'best';

export interface InstagramFormat {
  formatId: string;
  ext: string;
  height?: number;
  width?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  tbr?: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface InstagramMediaInfo {
  id: string;
  title: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  formats: InstagramFormat[];
  url: string;
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  fileSize: number;
  title: string;
  author?: string;
  duration?: number;
  width?: number;
  height?: number;
  type: DownloadType;
  thumbnailPath?: string;
}

/** One candidate track returned by a music search, before it's downloaded. */
export interface MusicTrack {
  title: string;
  uploader?: string;
  duration?: number;
  url: string;
  thumbnail?: string;
}

export interface ProbeResult {
  duration?: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasVideo: boolean;
  size: number;
}

export interface SessionData {
  id: string;
  userId: number;
  chatId: number;
  statusMessageId?: number;
  url: string;
  info?: InstagramMediaInfo;
  type?: DownloadType;
  createdAt: number;
  musicQuery?: string;
  musicResults?: MusicTrack[];
}
