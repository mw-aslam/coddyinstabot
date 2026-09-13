FROM node:20-bookworm-slim AS base

# python3 (required by yt-dlp), curl (to fetch binaries), xz-utils (to unpack the static ffmpeg build).
# Debian's own `ffmpeg` apt package is built without libx264 (no H.264 encoder), which we need to
# transcode Instagram's VP9-only streams into something Telegram can actually play. A static build
# (johnvansickle.com) ships libx264/libx265/libvpx etc. all in one self-contained binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 curl ca-certificates ffmpeg \
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
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    TMP_DIR=/app/downloads/tmp \
    LOG_DIR=/app/logs

CMD ["node", "dist/index.js"]
