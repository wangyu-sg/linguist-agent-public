# Linguist Agent Desktop

Electron + React + TypeScript + Vite desktop client for standalone Chats,
Project/CAT work, Library, Package Center, and Settings. The renderer is
sandboxed and receives only `window.linguist.runtime.status()`, an
authenticated loopback-only `/api/` request bridge, and canonical Task event
and chat streams; local credentials and native capabilities stay in the main
process.

Standalone working directories/file grants and Project folders/Batch/Asset
files are accessed only through explicit native pickers. The shell does not
set a Desktop or current-directory default path.

```bash
npm install
npm test
npm run typecheck
npm start
```

`LA_MAC_LOCAL_SERVER_URL=http://127.0.0.1:<port>` may target an isolated local
runtime. Remote, credential-bearing, and path-scoped URLs are rejected.

## Signed macOS package

Local packages reuse the stable `Linguist Agent Local Development` identity in
the login Keychain. Create it once with
`apps/desktop/scripts/setup_local_codesigning_identity.sh`; set
`LA_MAC_CODESIGN_IDENTITY` to select another explicit identity. Missing
identities fail the build—there is no ad-hoc fallback.

```bash
npm run desktop:package
npm run desktop:verify
npm --prefix apps/desktop run verify:signing-stability
npm run desktop:run
```

The arm64 result is
`apps/desktop/out/LinguistAgent-darwin-arm64/LinguistAgent.app`.
Packaging and verification never install or replace `/Applications`; `run`
launches that worktree-local bundle only.

The existing managed-source updater now installs this signed Electron bundle:
`scripts/mac-local-update.sh --check --repo <managed-checkout>` is read-only
apart from fetching Git refs, and `--install` is the explicit confirmation that
fast-forwards, packages, verifies, backup-swaps, and relaunches it. It never
defaults to installation, and documentation-only updates skip both app and
runtime rebuilds. Set `LA_MAC_INSTALL_APP_DIR` to a temporary `.app` path for an
isolated install/rollback test; the test suite never writes `/Applications`.
