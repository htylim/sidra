import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseRoot = path.join(repoRoot, "release");
const packageName = "sidra-macos";
const packageRoot = path.join(releaseRoot, packageName);
const zipPath = path.join(releaseRoot, `${packageName}.zip`);

const requiredBuildOutputs = [
  "apps/extension/dist/manifest.json",
  "apps/bridge/dist/cli.js",
  "packages/protocol/dist/index.js"
];

for (const relativePath of requiredBuildOutputs) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(`Missing ${relativePath}. Run pnpm build first.`);
  }
}

rmSync(packageRoot, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(packageRoot, { recursive: true });

copyDirectory("apps/extension/dist", "extension");
copyDirectory("apps/bridge/dist", "bridge/dist");
copyFile("apps/bridge/package.json", "bridge/package.json");
copyDirectory("packages/protocol/dist", "node_modules/@sidra/protocol/dist");
copyFile("packages/protocol/package.json", "node_modules/@sidra/protocol/package.json");
copyFile("tools/distributable/macos-installer-lib.mjs", "lib/macos-installer-lib.mjs");
copyFile("tools/distributable/install-macos.mjs", "install-macos.mjs");
chmodSync(path.join(packageRoot, "install-macos.mjs"), 0o755);
writeFileSync(path.join(packageRoot, "README-INSTALL.md"), buildInstallReadme(), "utf8");

createZip();

console.log(`Created ${zipPath}`);
console.log(`Unpacked folder: ${packageRoot}`);

function copyDirectory(from, to) {
  cpSync(path.join(repoRoot, from), path.join(packageRoot, to), { recursive: true });
}

function copyFile(from, to) {
  const destination = path.join(packageRoot, to);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(repoRoot, from), destination);
}

function createZip() {
  const ditto = spawnSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", packageName, `${packageName}.zip`], {
    cwd: releaseRoot,
    stdio: "inherit"
  });
  if (ditto.status === 0) return;

  const zip = spawnSync("zip", ["-r", `${packageName}.zip`, packageName], { cwd: releaseRoot, stdio: "inherit" });
  if (zip.status !== 0) throw new Error("Could not create zip with ditto or zip.");
}

function buildInstallReadme() {
  return `# Sidra macOS distributable

This folder is self-contained. Keep it in the location where you want Sidra to run from.

## Install

\`\`\`sh
node install-macos.mjs
\`\`\`

The installer lists supported browsers that are installed on this Mac, lists browsers that are not installed, and lets you install or uninstall the Native Messaging bridge manifests.

After installing the bridge, load the extension manually:

1. Open the browser extensions page.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this folder's \`extension\` directory.
5. Confirm the extension ID is \`mahnogfphkjigcjomjcjifkfdnocbokh\`.

If you move this folder, rerun \`node install-macos.mjs\` and reinstall the bridge.

## Requirements

- macOS.
- Node.js.
- Codex CLI installed and authenticated.
- Google Chrome, Brave, or Helium.
`;
}
