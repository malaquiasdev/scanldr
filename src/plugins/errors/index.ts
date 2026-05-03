export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
  }
}

export class CliError extends Error {
  override readonly name = "CliError";
  constructor(
    message: string,
    public readonly exitCode: number = 2,
  ) {
    super(message);
  }
}
