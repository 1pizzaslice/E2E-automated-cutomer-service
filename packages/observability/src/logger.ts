import { getActiveTraceContext } from "./tracing.js";

export type StructuredLogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Record<StructuredLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type StructuredLogSink = (line: string) => void;

export interface StructuredLogger {
  child(bindings: Record<string, unknown>): StructuredLogger;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface CreateStructuredLoggerOptions {
  service: string;
  environment: string;
  level?: StructuredLogLevel;
  bindings?: Record<string, unknown>;
  sink?: StructuredLogSink;
  now?: () => Date;
  redactPii?: boolean;
}

const REDACTED_KEY_PATTERN =
  /authorization|api[-_]?key|secret|token|password|credential|cookie/i;

export const REDACTED_VALUE = "[REDACTED]";
export const REDACTED_EMAIL_VALUE = "[REDACTED_EMAIL]";
export const REDACTED_PHONE_VALUE = "[REDACTED_PHONE]";
export const REDACTED_NUMBER_VALUE = "[REDACTED_NUMBER]";

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const CARD_NUMBER_PATTERN =
  /(?<![\w+])(?<!\w[.-])\d(?:[ -]?\d){12,18}(?!\w)(?![.-]\w)/g;

const PHONE_CANDIDATE_PATTERN =
  /(?<![\w+])(?<!\w[.-])\+?(?:\(\d{1,4}\)|\d{1,4})(?:[ .-]?(?:\(\d{1,4}\)|\d{1,4}))*(?!\w)(?![.-]\w)/g;

const redactPhoneNumbers = (text: string): string =>
  text.replace(PHONE_CANDIDATE_PATTERN, (candidate) => {
    const digitCount = candidate.replace(/\D/g, "").length;
    return digitCount >= 10 && digitCount <= 15
      ? REDACTED_PHONE_VALUE
      : candidate;
  });

/**
 * Scrubs PII-looking content out of free text: email addresses, card-like
 * digit runs (13-19 digits, optionally space/dash separated), and phone
 * numbers (optional `+`, 10-15 digits with single space/dash/dot/paren
 * separators). Boundary guards keep hex ids, UUIDs, ISO timestamps, dotted
 * version strings, and short numbers untouched; a digits-only run of 10+
 * is indistinguishable from PII and gets redacted.
 */
export function redactPiiFromText(text: string): string {
  return redactPhoneNumbers(
    text
      .replace(EMAIL_PATTERN, REDACTED_EMAIL_VALUE)
      .replace(CARD_NUMBER_PATTERN, REDACTED_NUMBER_VALUE),
  );
}

function redactValue(value: unknown, redactPii: boolean): unknown {
  if (typeof value === "string") {
    return redactPii ? redactPiiFromText(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactPii));
  }
  if (value !== null && typeof value === "object") {
    return redactLogFields(value as Record<string, unknown>, redactPii);
  }
  return value;
}

/**
 * Redacts values whose keys look secret-bearing (DEVELOPMENT_RULES section
 * 13: never log API keys, secrets, or full auth tokens). Applied
 * recursively to nested plain objects and arrays. Unless `redactPii` is
 * false, string values are additionally scrubbed with `redactPiiFromText`;
 * key-based redaction always applies and takes precedence.
 */
export function redactLogFields(
  fields: Record<string, unknown>,
  redactPii = true,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = REDACTED_KEY_PATTERN.test(key)
      ? REDACTED_VALUE
      : redactValue(value, redactPii);
  }
  return redacted;
}

/**
 * JSON-lines structured logger for services without a framework logger
 * (workers, jobs). Every line carries `service`, `environment`, `level`,
 * `time`, and `message`, plus bound context ids; `trace_id`/`span_id`
 * are injected from the active OTel span when one is recording. Field and
 * message strings are PII-scrubbed unless `redactPii` is false; key-based
 * secret redaction cannot be disabled.
 */
export function createStructuredLogger(
  options: CreateStructuredLoggerOptions,
): StructuredLogger {
  const {
    service,
    environment,
    level = "info",
    bindings = {},
    sink = (line) => {
      process.stdout.write(`${line}\n`);
    },
    now = () => new Date(),
    redactPii = true,
  } = options;

  const minimumRank = LOG_LEVEL_RANK[level];

  const write = (
    logLevel: StructuredLogLevel,
    message: string,
    fields: Record<string, unknown>,
  ): void => {
    if (LOG_LEVEL_RANK[logLevel] < minimumRank) {
      return;
    }
    const traceContext = getActiveTraceContext();
    const entry: Record<string, unknown> = {
      level: logLevel,
      time: now().toISOString(),
      service,
      environment,
      ...(traceContext ?? {}),
      ...redactLogFields(bindings, redactPii),
      ...redactLogFields(fields, redactPii),
      message: redactPii ? redactPiiFromText(message) : message,
    };
    sink(JSON.stringify(entry));
  };

  return {
    child: (childBindings) =>
      createStructuredLogger({
        service,
        environment,
        level,
        bindings: { ...bindings, ...childBindings },
        sink,
        now,
        redactPii,
      }),
    debug: (message, fields = {}) => write("debug", message, fields),
    info: (message, fields = {}) => write("info", message, fields),
    warn: (message, fields = {}) => write("warn", message, fields),
    error: (message, fields = {}) => write("error", message, fields),
  };
}

export interface RecordingLogSink {
  sink: StructuredLogSink;
  entries: () => Record<string, unknown>[];
}

export function createRecordingLogSink(): RecordingLogSink {
  const lines: string[] = [];
  return {
    sink: (line) => {
      lines.push(line);
    },
    entries: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
