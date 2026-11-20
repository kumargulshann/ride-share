import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

export const projectRoot = new URL(".", import.meta.url);
export const publicFiles = new Map([
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/backend.js", ["backend.js", "text/javascript; charset=utf-8"]],
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
  ["/vendor/supabase.js", ["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "text/javascript; charset=utf-8"]],
  ["/vendor/supabase.LICENSE.txt", ["node_modules/@supabase/supabase-js/LICENSE", "text/plain; charset=utf-8"]],
  ["/vendor/leaflet/leaflet.js", ["vendor/leaflet/leaflet.js", "text/javascript; charset=utf-8"]],
  ["/vendor/leaflet/leaflet.js.map", ["vendor/leaflet/leaflet.js.map", "application/json"]],
  ["/vendor/leaflet/leaflet.css", ["vendor/leaflet/leaflet.css", "text/css; charset=utf-8"]],
  ["/vendor/leaflet/LICENSE", ["vendor/leaflet/LICENSE", "text/plain; charset=utf-8"]],
]);

for (const image of ["layers-2x.png", "layers.png", "marker-icon-2x.png", "marker-icon.png", "marker-shadow.png"]) {
  const path = `vendor/leaflet/images/${image}`;
  publicFiles.set(`/${path}`, [path, "image/png"]);
}

export async function readPublicConfig() {
  let local = {};
  try {
    local = parseEnv(await readFile(new URL(".env", projectRoot), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const url = process.env.SUPABASE_URL ?? local.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? local.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !publishableKey || url.includes("YOUR_PROJECT_REF") || publishableKey === "sb_publishable_YOUR_KEY") {
    return { state: "missing" };
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) ||
      !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(publishableKey)) {
    return { state: "invalid" };
  }
  return { state: "ready", url: url.replace(/\/$/, ""), publishableKey };
}
