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

export class Logger implements ScopeLogger {
  private static debugOption: DebugOption =
    typeof process !== 'undefined' && process.env
      ? Boolean(process.env.DEBUG?.includes('next-wsync') || process.env.NEXT_WSYNC_DEBUG === '1')
      : false;

  private static customLogger?: LoggerOptions['logger'];

  private static readonly colors: Record<LogLevel, string> = {
    debug: '\x1b[34m', // Blue
    info: '\x1b[32m',  // Green
    warn: '\x1b[33m',  // Yellow
    error: '\x1b[31m', // Red
  };
  private static readonly resetColor = '\x1b[0m';
  private static readonly prefixColor = '\x1b[36m'; // Cyan

  constructor(public readonly tag: string = '') {}

  // ── Static Configuration & Utilities ───────────────────────

  static configure(options?: LoggerOptions): void {
    if (options?.debug !== undefined) {
      Logger.debugOption = options.debug;
    }
    if (options?.logger !== undefined) {
      Logger.customLogger = options.logger;
    }
  }

  static isDebugEnabled(): boolean {
    return Logger.debugOption !== false;
  }

  static create(tag: string): Logger {
    return new Logger(tag);
  }

  private static formatTimestamp(): string {
    const d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  private static formatOutput(
    level: LogLevel,
    tag: string,
    message: string,
    meta?: unknown,
  ): string {
    const time = Logger.formatTimestamp();
    const color = Logger.colors[level] || '';
    const levelTag = level.toUpperCase().padEnd(5);
    const formattedTag = tag ? `[${tag}]` : '';

    const metaString =
      meta !== undefined
        ? typeof meta === 'string' || typeof meta === 'number'
          ? String(meta)
          : JSON.stringify(meta)
        : '';

    return `${Logger.prefixColor}[next-wsync]${Logger.resetColor} \x1b[90m${time}${Logger.resetColor} ${color}${levelTag}${Logger.resetColor} \x1b[1m${formattedTag}${Logger.resetColor} ${message} ${metaString}`.trim();
  }

  private static emit(
    level: LogLevel,
    tag: string,
    message: string,
    meta?: unknown,
  ): void {
    if (!Logger.isDebugEnabled()) return;

    if (Logger.debugOption === 'minimal' && level === 'debug') {
      return;
    }

    if (Logger.customLogger) {
      try {
        Logger.customLogger(level, tag, message, meta);
      } catch {
        // Suppress custom logger errors
      }
      return;
    }

    const output = Logger.formatOutput(level, tag, message, meta);

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

  // ── Instance Methods ────────────────────────────────────────

  debug(message: string, meta?: unknown): void {
    Logger.emit('debug', this.tag, message, meta);
  }

  info(message: string, meta?: unknown): void {
    Logger.emit('info', this.tag, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    Logger.emit('warn', this.tag, message, meta);
  }

  error(message: string, meta?: unknown): void {
    Logger.emit('error', this.tag, message, meta);
  }

  child(subTag: string): Logger {
    const combinedTag = this.tag ? `${this.tag}/${subTag}` : subTag;
    return new Logger(combinedTag);
  }
}

// Aliases for backward compatibility
export const WsyncLogger = Logger;
export const configureLogger = Logger.configure;
export const createScopeLogger = Logger.create;
export function logMessage(level: LogLevel, tag: string, message: string, meta?: unknown): void {
  (Logger as unknown as { emit: typeof Logger['emit'] }).emit(level, tag, message, meta);
}
