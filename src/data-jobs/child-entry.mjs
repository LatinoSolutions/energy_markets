// DATA-01: supervisor de un job. Corre el comando dentro del cgroup que le toque
// (el scope de systemd que arma el runner) y, al terminar, escribe el pico de
// memoria de ESE cgroup en el archivo que le pasa el runner. Sin esto, el receipt
// lee el cgroup del servicio —no el del job— y con `systemd-run --scope --collect`
// el scope se borra al salir y su memory.peak se pierde (hallazgo
// DATA01-MEMPEAK-SCOPE).
//
// Uso: node child-entry.mjs <peakFile> -- <comando...>
// El comando hereda stdout/stderr (el runner los manda a job.log) y el código de
// salida se propaga tal cual.

import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const [peakFile, separator, ...command] = process.argv.slice(2);
if (separator !== "--" || !peakFile || command.length === 0) {
  process.stderr.write("child-entry: uso: node child-entry.mjs <peakFile> -- <comando...>\n");
  process.exit(2);
}

// cgroup v2 del proceso que corre el job; null si no se puede leer (nunca un
// número inventado).
function readCgroupPeak() {
  let cgroup = null;
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8").split("\n").find((item) => item.startsWith("0::"));
    cgroup = line === undefined ? null : line.slice(3).trim();
  } catch {
    cgroup = null;
  }
  if (cgroup === null) return { cgroup: null, memoryPeakBytes: null, oomKills: null };
  const readNumber = (file, pattern) => {
    try {
      const match = readFileSync(path.join("/sys/fs/cgroup", cgroup, file), "utf8").match(pattern);
      const value = match === null ? Number.NaN : Number.parseInt(match[1], 10);
      return Number.isInteger(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    cgroup,
    memoryPeakBytes: readNumber("memory.peak", /^(\d+)/),
    oomKills: readNumber("memory.events", /^oom_kill (\d+)$/m),
  };
}

function writePeak() {
  try {
    const temporary = `${peakFile}.tmp`;
    writeFileSync(temporary, JSON.stringify(readCgroupPeak()));
    renameSync(temporary, peakFile);
  } catch {
    // Sin pico del job el receipt lo declara; no se tumba el job por esto.
  }
}

const child = spawn(command[0], command.slice(1), { stdio: "inherit", env: process.env });
child.once("error", (error) => {
  process.stderr.write(`child-entry: no se pudo lanzar el job: ${String(error?.message ?? error)}\n`);
  writePeak();
  process.exit(127);
});
child.once("exit", (code, signal) => {
  writePeak();
  process.exit(code ?? (signal ? 128 : 1));
});
