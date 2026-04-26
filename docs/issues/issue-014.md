# Install Native Messaging Host For macOS Browsers

## Status

Open

## Type

HITL

## What to build

Provide the manual developer installation flow for macOS Native Messaging host manifests for Chrome, Brave, and Helium, including extension ID pinning and verification of Helium support.

## Acceptance criteria

- [ ] Build output includes a deterministic/pinned development extension ID strategy suitable for allowlisting in host manifests.
- [ ] Installer script writes valid Native Messaging host manifests for Chrome and Brave.
- [ ] Helium manifest path and `sidePanel` compatibility are verified before claiming support.
- [ ] Developer docs explain dependency install, build commands, host installation, loading the unpacked extension, running tests, and bridge troubleshooting.
- [ ] Smoke verification confirms toolbar action opens/focuses the side panel and can connect to the installed bridge.

## Blocked by

- Blocked by #013
