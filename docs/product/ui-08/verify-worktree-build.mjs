// UI-08 delivery smoke: start the integrated build in this worktree on an
// ephemeral loopback port and verify the process that actually answers HTTP.
// Publication to energy-markets-ui.service has a separate UI-09 gate.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyServedBuild } from "./verify-served-build.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SERVE = resolve(ROOT, "src/ui/serve.mjs");

export function assertWorktreeCommand(commandLine, workingDirectory, repoRoot = ROOT) {
  const args = Buffer.isBuffer(commandLine) ? commandLine.toString("utf8").split("\0").filter(Boolean) : [];
  if (workingDirectory !== repoRoot || !args.includes(resolve(repoRoot, "src/ui/serve.mjs"))
    || args.filter((arg) => arg === "--host").length !== 1
    || args[args.indexOf("--host") + 1] !== "127.0.0.1"
    || args.filter((arg) => arg === "--port").length !== 1
    || args[args.indexOf("--port") + 1] !== "0") {
    throw new Error("smoke process is not the worktree UI server on ephemeral loopback");
  }
}

function assertRunningWorktreeProcess(pid) {
  const cwd = readlinkSync(`/proc/${pid}/cwd`);
  const commandLine = readFileSync(`/proc/${pid}/cmdline`);
  assertWorktreeCommand(commandLine, cwd);
  return pid;
}

function awaitServedUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => done(new Error(`worktree server did not start within 20 seconds: ${stderr}`)), 20_000);
    const clean = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    let finished = false;
    const done = (error, url) => {
      if (finished) return;
      finished = true;
      clean();
      if (error) reject(error);
      else resolveUrl(url);
    };
    const onStdout = (chunk) => {
      stdout += chunk.toString();
      const url = stdout.match(/Energy Markets Operator UI: (http:\/\/127\.0\.0\.1:[1-9][0-9]*\/)/)?.[1];
      if (url) done(null, url);
      else if (stdout.length > 64_000) done(new Error("worktree server output exceeded startup limit"));
    };
    const onStderr = (chunk) => { stderr += chunk.toString().slice(0, 8_000); };
    const onError = (error) => done(error);
    const onExit = (code, signal) => done(new Error(`worktree server exited before ready (${code ?? signal}): ${stderr}`));
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); done(); }, 5_000);
    child.once("close", () => { clearTimeout(timeout); done(); });
    child.kill("SIGTERM");
  });
}

export async function verifyWorktreeBuild() {
  const expectedCommit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const child = spawn(process.execPath, [SERVE, "--host", "127.0.0.1", "--port", "0"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const baseUrl = await awaitServedUrl(child);
    assertRunningWorktreeProcess(child.pid);
    const report = await verifyServedBuild({
      baseUrl, expectedCommit, expectedPid: child.pid,
      readConfiguredPid: () => assertRunningWorktreeProcess(child.pid),
    });
    return { ...report, target: "UI-08 worktree process" };
  } finally {
    await stopChild(child);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const report = await verifyWorktreeBuild();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exitCode = 2;
  }
}
