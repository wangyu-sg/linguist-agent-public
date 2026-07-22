# New Machine Setup

Use this when moving Linguist Agent to another Mac or recovering a local setup.

## Checklist

1. Install Node.js.
2. Clone this repo to a stable path, for example `~/Projects/linguist-agent`.
3. For development-only server use, from the repo run:

   ```bash
   npm install
   npm run server:install
   ```

   The installer writes/starts the user LaunchAgent through `packages/cat-server/src/resident_runtime.ts`, prints the health URL, and exits. The long-lived Node server is owned by launchd, not the Electron client.

4. For normal app use, open the Electron app and use its runtime recovery/installer flow to install or sync the managed runtime under `~/Library/Application Support/Linguist Agent/runtime`. Development/self-use builds without a bundled `runtime.tar.gz` can sync this checkout into that managed root and keep launchd pointed there.
5. Copy the old `data/` folder back under the active runtime root if you are moving machines. In current app use that is usually `~/Library/Application Support/Linguist Agent/runtime/data`; in direct development use it can still be the repo `data/`. `data/` contains local projects, TM/glossary/termbase artifacts, workflow artifacts, overrides, logs, and runtime state. It is gitignored and does not travel with a code clone.
6. Open the Electron app and re-enter provider/web-search API keys in Settings. Keychain secrets do not travel with git.
7. Provider/model config in `.pi/settings.json` travels with the repo, but the LaunchAgent plist is machine-specific. Re-run the Electron runtime installer/recovery action or `npm run server:install` on each Mac instead of copying an old plist.

The Electron runtime installer/recovery flow checks Node/runtime/server state,
restores the Application Support managed runtime, and waits for `/api/health`.
After setup, a server-down recovery can restore the managed runtime first and
use a no-HTTP temporary server only as a bounded fallback.
