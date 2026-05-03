export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message);
  }
}
