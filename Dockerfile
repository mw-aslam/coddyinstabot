FROM node:20-bookworm-slim AS base

# ffmpeg, python3 (required by yt-dlp) and curl (to fetch the yt-dlp binary)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev=false

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

RUN mkdir -p /app/downloads/tmp /app/logs

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    TMP_DIR=/app/downloads/tmp \
    LOG_DIR=/app/logs

CMD ["node", "dist/index.js"]
