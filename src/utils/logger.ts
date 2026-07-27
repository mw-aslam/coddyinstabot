import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';
import { config } from '../config/config';

if (!fs.existsSync(config.logging.dir)) {
  fs.mkdirSync(config.logging.dir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] ${level}: ${stack ?? message}${metaStr}`;
  }),
);

const fileFormat = combine(timestamp(), errors({ stack: true }), winston.format.json());

export const logger = winston.createLogger({
  level: config.logging.level,
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});
