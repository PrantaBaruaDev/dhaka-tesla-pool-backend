import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLevel(): Level {
  const env = process.env.LOG_LEVEL as Level | undefined;
  if (env && env in LEVELS) return env;
  if (process.env.NODE_ENV === 'test') return 'warn';
  if (process.env.NODE_ENV === 'production') return 'info';
  return 'debug';
}

const MIN_LEVEL = LEVELS[resolveLevel()];
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_DEV  = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;

const USE_COLOR = !IS_PROD && process.env.NO_COLOR !== '1';

const FILE_FLAG = process.env.LOG_FILE;
const FILE_ENABLED =
  FILE_FLAG === '1' ? true :
  FILE_FLAG === '0' ? false :
  IS_DEV;

const LOG_DIR = join(process.cwd(), 'logs');
let LOG_FILE = '';

if (FILE_ENABLED) {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  LOG_FILE = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
}

let lastLogTime = 0;
const BURST_GAP_MS = 100;

const c = {
  gray:   (s: string) => (USE_COLOR ? `\x1b[90m${s}\x1b[0m` : s),
  cyan:   (s: string) => (USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s),
  yellow: (s: string) => (USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s),
  red:    (s: string) => (USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s),
  green:  (s: string) => (USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s),
  bold:   (s: string) => (USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s),
  dim:    (s: string) => (USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s),
};

const LEVEL_COLOR: Record<Level, (s: string) => string> = {
  debug: c.gray,
  info:  c.cyan,
  warn:  c.yellow,
  error: c.red,
};

const LEVEL_LABEL: Record<Level, string> = {
  debug: 'DEBUG',
  info:  'INFO ',
  warn:  'WARN ',
  error: 'ERROR',
};

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function fmtData(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (data instanceof Error) return `\n  ${c.red(data.name + ': ' + data.message)}`;
  try {
    return '  ' + c.dim(JSON.stringify(data));
  } catch {
    return '  ' + c.dim(String(data));
  }
}

function fmtError(err: unknown): string {
  if (!(err instanceof Error)) return `  ${String(err)}`;
  const lines: string[] = [];
  lines.push(`  ${c.red(c.bold(err.name))}: ${err.message}`);
  if (err.stack) {
    const stack = err.stack
      .split('\n')
      .slice(1)
      .map((l) => '    ' + c.dim(l.trim()))
      .join('\n');
    lines.push(stack);
  }
  return '\n' + lines.join('\n');
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function write(level: Level, scope: string, message: string, data?: unknown, err?: unknown): void {
  if (LEVELS[level] < MIN_LEVEL) return;

  if (IS_PROD) {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
    };
    if (data && typeof data === 'object') Object.assign(entry, data);
    if (err instanceof Error) {
      entry.error = { name: err.name, message: err.message, stack: err.stack };
    }
    process.stdout.write(JSON.stringify(entry) + '\n');
    return;
  }

  const ts = c.gray(timestamp());
  const lvl = LEVEL_COLOR[level](LEVEL_LABEL[level]);
  const sc = c.bold(scope.padEnd(6));

  let line = `${ts} ${lvl} ${sc} ${message}`;
  if (data !== undefined) line += fmtData(data);
  if (err !== undefined) line += fmtError(err);

  const now = Date.now();
  const isNewBurst = now - lastLogTime > BURST_GAP_MS;
  lastLogTime = now;
  const prefix = IS_TEST && isNewBurst ? '\n' : '';

  process.stderr.write(prefix + line + '\n');

  if (FILE_ENABLED && LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, stripAnsi(line) + '\n');
    } catch {
      console.log("Internal Server Error");
    }
  }
}

export const logger = {
  debug: (scope: string, message: string, data?: unknown) => write('debug', scope, message, data),
  info:  (scope: string, message: string, data?: unknown) => write('info',  scope, message, data),
  warn:  (scope: string, message: string, data?: unknown) => write('warn',  scope, message, data),
  error: (scope: string, message: string, data?: unknown, err?: unknown) => write('error', scope, message, data, err),
};