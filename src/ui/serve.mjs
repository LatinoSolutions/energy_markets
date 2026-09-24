// CLI de serving de la UI de Energy Markets (tarea UI-02, PLAN_STATUS owner
// 24-sep-2026). Arranca el servidor HTTP de ./server.mjs con el estado
// fail-closed por defecto: sin el manifest backend verificado no hay
// superficie con datos (todo UNAVAILABLE/ERROR, §26.5), jamás datos de
// muestra. La inyección del estado canónico es programática vía
// createUiServer({ inputs }) para el wiring posterior con IMP-29.
//
// Enlace por defecto 127.0.0.1:sin apertura pública nueva; un host distinto
// o puerto distinto son explícitos (--host / --port).
//
// Uso: node src/ui/serve.mjs [--port 8787] [--host 127.0.0.1]

import {
  createUiServer,
  DEFAULT_UI_HOST,
  DEFAULT_UI_PORT,
} from "./server.mjs";
import { loadCanonicalUiInputs } from "./canonical-inputs.mjs";

function parseArgs(argv) {
  const options = { host: DEFAULT_UI_HOST, port: DEFAULT_UI_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--port") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        console.error("usage: --port <0-65535>");
        process.exit(2);
      }
      options.port = value;
      index += 1;
      continue;
    }
    if (arg === "--host") {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.trim().length === 0) {
        console.error("usage: --host <hostname>");
        process.exit(2);
      }
      options.host = value.trim();
      index += 1;
      continue;
    }
    console.error(`argumento no reconocido: ${arg}`);
    console.error("usage: node src/ui/serve.mjs [--port 8787] [--host 127.0.0.1]");
    process.exit(2);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const canonical = loadCanonicalUiInputs();
const { server, ready } = createUiServer({ inputs: canonical.inputs, backend: canonical.backend, host: options.host, port: options.port });
const served = await ready;
console.log(`Energy Markets Operator UI: ${served.url}`);
console.log("rutas: / (navegación) · /replay · /backtests · /research · /campaigns · /health");
console.log(`backend canónico: manifest=${canonical.backend.manifestLoaded} records=${canonical.backend.recordCount} valores atestados=${canonical.backend.bindableIdentities} errores=${canonical.backend.errors.length}`);
const stop = () => new Promise((resolve) => server.close(resolve));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log("");
    console.log("Energy Markets Operator UI: parando el servidor…");
    await stop();
    process.exit(0);
  });
}
