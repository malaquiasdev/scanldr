// Types for the atomic-write plugin.
// Factored out of src/pack/pack.ts, src/walkthrough/steps/auth-check.ts and
// src/downloader/service.ts, which each hand-rolled the same
// write-.tmp -> rename -> unlink-on-fail micro-pattern.

export interface AtomicWriteOptions {
  /** Passed through to `fs/promises.writeFile`'s `mode` option. */
  mode?: number;
  /** Passed through to `fs/promises.writeFile`'s `encoding` option. Omit for binary data. */
  encoding?: BufferEncoding;
  /**
   * Suffix appended to `path` to build the temp file that gets written first
   * and renamed into place. Defaults to `.tmp`.
   */
  tmpSuffix?: string;
}
