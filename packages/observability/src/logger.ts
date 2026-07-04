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
}

const REDACTED_KEY_PATTERN =
  /authorization|api[-_]?key|secret|token|password|credential|cookie/i;

export const REDACTED_VALUE = "[REDACTED]";

/**
 * Redacts values whose keys look secret-bearing (DEVELOPMENT_RULES section
 * 13: never log API keys, secrets, or full auth tokens). Applied
 * recursively to nested plain objects.
 */
export function redactLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      redacted[key] = REDACTED_VALUE;
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      redacted[key] = redactLogFields(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/**
 * JSON-lines structured logger for services without a framework logger
 * (workers, jobs). Every line carries `service`, `environment`, `level`,
 * `time`, and `message`, plus bound context ids; `trace_id`/`span_id`
 * are injected from the active OTel span when one is recording.
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
      ...redactLogFields(bindings),
      ...redactLogFields(fields),
      message,
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
