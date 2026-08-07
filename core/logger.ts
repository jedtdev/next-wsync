export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type DebugOption = boolean | 'verbose' | 'minimal';

export interface LoggerFn {
  (message: string, meta?: unknown): void;
}

export interface ScopeLogger {
  readonly debug: LoggerFn;
  readonly info: LoggerFn;
  readonly warn: LoggerFn;
  readonly error: LoggerFn;
  child(subTag: string): ScopeLogger;
}

export interface LoggerOptions {
  debug?: DebugOption;
  logger?: (level: LogLevel, tag: string, message: string, meta?: unknown) => void;
}

let globalDebug: DebugOption =
  typeof process !== 'undefined' && process.env
    ? Boolean(process.env.DEBUG?.includes('next-wsync') || process.env.NEXT_WSYNC_DEBUG === '1')
    : false;

let globalCustomLogger: LoggerOptions['logger'] | undefined;

export function configureLogger(options?: LoggerOptions): void {
  if (options?.debug !== undefined) {
    globalDebug = options.debug;
  }
  if (options?.logger !== undefined) {
    globalCustomLogger = options.logger;
  }
}

export function isDebugEnabled(): boolean {
  return globalDebug !== false;
}

const levelColors: Record<LogLevel, string> = {
  debug: '\x1b[34m', // Blue
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};
const resetColor = '\x1b[0m';
const prefixColor = '\x1b[36m'; // Cyan

function formatTimestamp(): string {
  const d = new Date();
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function logMessage(
  level: LogLevel,
  tag: string,
  message: string,
  meta?: unknown,
): void {
  if (!isDebugEnabled()) return;

  if (globalDebug === 'minimal' && level === 'debug') {
    return;
  }

  if (globalCustomLogger) {
    try {
      globalCustomLogger(level, tag, message, meta);
    } catch {
      // Suppress custom logger error
    }
    return;
  }

  const time = formatTimestamp();
  const color = levelColors[level] || '';
  const levelTag = level.toUpperCase().padEnd(5);
  const formattedTag = tag ? `[${tag}]` : '';

  const metaString =
    meta !== undefined
      ? typeof meta === 'string' || typeof meta === 'number'
        ? String(meta)
        : JSON.stringify(meta)
      : '';

  const output = `${prefixColor}[next-wsync]${resetColor} \x1b[90m${time}${resetColor} ${color}${levelTag}${resetColor} \x1b[1m${formattedTag}${resetColor} ${message} ${metaString}`.trim();

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'info':
      console.info(output);
      break;
    case 'debug':
    default:
      console.log(output);
      break;
  }
}

export class Logger implements ScopeLogger {
  constructor(public readonly tag: string = '') {}

  debug(message: string, meta?: unknown): void {
    logMessage('debug', this.tag, message, meta);
  }

  info(message: string, meta?: unknown): void {
    logMessage('info', this.tag, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    logMessage('warn', this.tag, message, meta);
  }

  error(message: string, meta?: unknown): void {
    logMessage('error', this.tag, message, meta);
  }

  child(subTag: string): Logger {
    const combinedTag = this.tag ? `${this.tag}/${subTag}` : subTag;
    return new Logger(combinedTag);
  }
}

export const WsyncLogger = Logger;

export function createScopeLogger(tag: string): Logger {
  return new Logger(tag);
}
