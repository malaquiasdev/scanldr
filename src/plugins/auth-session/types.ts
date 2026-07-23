// Shared auth-session type surface. `AuthSession` itself is canonically owned by
// src/integrations/_shared/auth-session.ts (the cURL-paste flow originates it);
// re-exported here so callers of this plugin don't need a second import path.

export type { AuthSession } from "@integrations/_shared/auth-session.ts";
