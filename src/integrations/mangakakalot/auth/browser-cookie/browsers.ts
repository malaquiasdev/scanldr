// Static metadata for the macOS/Chromium browsers supported in the MVP (issue #202).
// All four share the same v10 cookie-decrypt scheme; only paths/names/UA tokens differ.

import type { ChromiumBrowserDef, ChromiumBrowserId } from "./types.ts";

export const CHROMIUM_BROWSERS: Record<ChromiumBrowserId, ChromiumBrowserDef> = {
  chrome: {
    id: "chrome",
    label: "Google Chrome",
    appName: "Google Chrome",
    appBundlePath: "/Applications/Google Chrome.app",
    supportDirName: "Google/Chrome",
    keychainService: "Chrome Safe Storage",
    uaProductToken: null, // Chrome's own UA needs no extra product token.
  },
  opera: {
    id: "opera",
    label: "Opera",
    appName: "Opera",
    appBundlePath: "/Applications/Opera.app",
    supportDirName: "com.operasoftware.Opera",
    keychainService: "Opera Safe Storage",
    uaProductToken: "OPR",
  },
  brave: {
    id: "brave",
    label: "Brave Browser",
    appName: "Brave Browser",
    appBundlePath: "/Applications/Brave Browser.app",
    supportDirName: "BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage",
    uaProductToken: null, // Brave deliberately keeps a Chrome-shaped UA (no Brave token).
  },
  edge: {
    id: "edge",
    label: "Microsoft Edge",
    appName: "Microsoft Edge",
    appBundlePath: "/Applications/Microsoft Edge.app",
    supportDirName: "Microsoft Edge",
    keychainService: "Microsoft Edge Safe Storage",
    uaProductToken: "Edg",
  },
};

export function listChromiumBrowserDefs(): ChromiumBrowserDef[] {
  return Object.values(CHROMIUM_BROWSERS);
}
