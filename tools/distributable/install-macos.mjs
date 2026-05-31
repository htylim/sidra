#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  detectBrowserInstallations,
  findCodexExecutable,
  installNativeHostForBrowsers,
  uninstallNativeHostForBrowsers,
  validatePackageRoot
} from "./lib/macos-installer-lib.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const extensionPath = path.join(packageRoot, "extension");

async function main() {
  validatePackageRoot(packageRoot);

  const readline = createInterface({ input, output });
  try {
    printBrowserStatus();

    while (true) {
      console.log("");
      console.log("1. Install bridge for installed browsers");
      console.log("2. Install bridge for selected browsers");
      console.log("3. Uninstall bridge for installed browsers");
      console.log("4. Uninstall bridge for selected browsers");
      console.log("5. Show extension path");
      console.log("0. Exit");

      const choice = (await readline.question("Choose an option: ")).trim();
      if (choice === "0") return;
      if (choice === "1") await installForBrowsers(readline, installedBrowserIds());
      else if (choice === "2") await installForBrowsers(readline, await askBrowserIds(readline));
      else if (choice === "3") uninstallForBrowsers(installedBrowserIds());
      else if (choice === "4") uninstallForBrowsers(await askBrowserIds(readline));
      else if (choice === "5") printExtensionPath();
      else console.log("Unknown option.");
    }
  } finally {
    readline.close();
  }
}

async function installForBrowsers(readline, browserIds) {
  if (browserIds.length === 0) {
    console.log("No browsers selected.");
    return;
  }

  const detectedCodexPath = findCodexExecutable();
  const codexPrompt = detectedCodexPath ? `Codex executable [${detectedCodexPath}]: ` : "Codex executable path: ";
  const codexAnswer = (await readline.question(codexPrompt)).trim();
  const codexExecutablePath = codexAnswer || detectedCodexPath;
  if (!codexExecutablePath) {
    console.log("Install cancelled. Codex executable path is required.");
    return;
  }

  const workspaceAnswer = (await readline.question(`Codex workspace root [${packageRoot}]: `)).trim();
  const workspaceRoot = workspaceAnswer || packageRoot;

  const results = installNativeHostForBrowsers({
    packageRoot,
    browserIds,
    codexExecutablePath,
    workspaceRoot
  });

  for (const result of results) {
    console.log(`${result.browserId}: installed ${result.manifestPath}`);
  }
  console.log(`Bridge wrapper: ${results[0].wrapperPath}`);
  console.log(`Expected extension ID: ${results[0].extensionId}`);
  printExtensionPath();
}

function uninstallForBrowsers(browserIds) {
  if (browserIds.length === 0) {
    console.log("No browsers selected.");
    return;
  }

  const results = uninstallNativeHostForBrowsers({ browserIds });
  for (const result of results) {
    console.log(`${result.browserId}: ${result.removed ? "removed" : "not found"} ${result.manifestPath}`);
  }
}

async function askBrowserIds(readline) {
  const browsers = detectBrowserInstallations();
  for (const [index, browser] of browsers.entries()) {
    const status = browser.installed ? `installed at ${browser.installedPath}` : "not installed";
    console.log(`${index + 1}. ${browser.label} (${status})`);
  }

  const answer = (await readline.question("Enter numbers separated by commas: ")).trim();
  const selectedIndexes = answer
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10) - 1)
    .filter((index) => Number.isInteger(index) && browsers[index]);

  return [...new Set(selectedIndexes.map((index) => browsers[index].id))];
}

function installedBrowserIds() {
  return detectBrowserInstallations()
    .filter((browser) => browser.installed)
    .map((browser) => browser.id);
}

function printBrowserStatus() {
  const browsers = detectBrowserInstallations();
  console.log("Installed browsers:");
  for (const browser of browsers.filter((candidate) => candidate.installed)) {
    console.log(`- ${browser.label}: ${browser.installedPath}`);
  }

  console.log("");
  console.log("Not installed:");
  for (const browser of browsers.filter((candidate) => !candidate.installed)) {
    console.log(`- ${browser.label}`);
  }
}

function printExtensionPath() {
  console.log(`Load this unpacked extension directory in the browser: ${extensionPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
