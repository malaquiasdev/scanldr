export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogFormat = "human" | "json";

export interface LoggerOptions {
  level: LogLevel;
  format: LogFormat;
  write?: (line: string) => void;
  now?: () => string;
}

export interface Logger {
  error: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
}
