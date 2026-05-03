export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogFormat = "human" | "json";

export interface LoggerOptions {
  level: LogLevel;
  format: LogFormat;
  write?: (line: string) => void;
  now?: () => string;
}

export interface Logger {
  error: (fields: Record<string, unknown>, msg: string) => void;
  warn: (fields: Record<string, unknown>, msg: string) => void;
  info: (fields: Record<string, unknown>, msg: string) => void;
  debug: (fields: Record<string, unknown>, msg: string) => void;
}
