// BT-05: proceso hijo del job. Ejecuta el generador del backtest con sus
// argumentos de siempre y, al salir, deja su pico de RSS propio para el receipt
// (nota BT-05 en PLAN_STATUS: medir la RAM del primer backtest real).
//
// Uso interno: node child-entry.mjs <rusage.json> <generador.mjs> ...args-del-generador

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [rusageFile, entry, ...entryArgs] = process.argv.slice(2);

process.on("exit", () => {
  // Linux: resourceUsage().maxRSS viene en kilobytes.
  writeFileSync(rusageFile, JSON.stringify({ maxRSSKb: process.resourceUsage().maxRSS }));
});

// El generador lee process.argv.slice(2) al cargarse.
process.argv = [process.argv[0], entry, ...entryArgs];
await import(pathToFileURL(entry).href);
