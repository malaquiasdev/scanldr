// Shared auth-session type surface. `AuthSession` itself is canonically owned by
// src/integrations/mangakakalot/auth/types.ts (the cURL-paste flow originates it);
// re-exported here so callers of this plugin don't need a second import path.

export type { AuthSession } from "@integrations/mangakakalot/auth/types.ts";
