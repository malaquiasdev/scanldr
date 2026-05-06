// Public surface for the mangakakalot manual auth flow.
// Replaces src/integrations/mangakakalot/browser/ (deleted in issue #62).

export { runAuth } from "./service.ts";
export { AuthError } from "./types.ts";
export type { AuthSession, ParsedCurl, RunAuthOptions } from "./types.ts";
