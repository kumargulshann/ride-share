import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { projectRoot, publicFiles, readPublicConfig } from "./hosting.mjs";

const port = Number(process.env.PORT ?? 4175);

function respond(response, status, type, body, isHead) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(isHead ? undefined : body);
}

const server = createServer(async (request, response) => {
  const isHead = request.method === "HEAD";
  if (request.method !== "GET" && !isHead) {
    response.setHeader("Allow", "GET, HEAD");
    return respond(response, 405, "text/plain", "Method not allowed", isHead);
  }

  const path = request.url.split("?", 1)[0];
  try {
    if (path === "/config.json" || path === "/api/config") {
      return respond(response, 200, "application/json", JSON.stringify(await readPublicConfig()), isHead);
    }

    const file = publicFiles.get(path === "/" ? "/index.html" : path);
    if (!file) return respond(response, 404, "text/plain", "Not found", isHead);
    const [filename, type] = file;
    return respond(response, 200, type, await readFile(new URL(filename, projectRoot)), isHead);
  } catch {
    return respond(response, 500, "text/plain", "Preview could not read this resource", isHead);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RideShare is running at http://127.0.0.1:${port}/`);
});
