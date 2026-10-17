import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { staticServer } from "../dev/server.mjs";
export { staticServer } from "../dev/server.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!existsSync(resolve(root, "renderer/artifact-manifest.json")))
    throw new Error("Renderer not built. Run npm run build:native or copy renderer/ from the CI artifact for this commit.");
  const port = Number(process.env.PORT ?? 3030);
  const performanceLogDir =
    process.env.MIAVIEW_LOG_FILE === "1" ? resolve(root, ".logs") : null;
  const performanceTerminal = process.env.MIAVIEW_LOG_TERMINAL !== "0";
  const server = staticServer(root, { performanceLogDir, performanceTerminal });
  const stop = () => {
    server.close();
    server.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Preview example: http://localhost:${port}`);
    console.log(
      `Logs: initialization=on, performance=playing-only, terminal=${performanceTerminal ? "on" : "off"}, file=${performanceLogDir ?? "off"}`,
    );
  });
}
