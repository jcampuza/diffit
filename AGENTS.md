# Diffit

Local Git diff viewer. Uses **Bun**, **React**, and **Tauri**.

## Layout

```
bin/          CLI launcher
src/          React frontend (Vite)
src-tauri/    Tauri / Rust backend
index.html    Vite entry HTML
package.json  Frontend deps & scripts
```

## Releases and updates

Every push to `main` runs `.github/workflows/release.yml`, which builds an Apple
Silicon bundle and publishes it as release `v0.1.<run number>`. Installed copies check
that release on launch and update themselves from it.

The version in `src-tauri/tauri.conf.json` stays at `0.1.0` in the repository; CI
overwrites it per build, so there is no version bump commit. `tauri.conf.json` wins
over the crate version, so it is the only place the version is set.

The bundle is signed with a minisign key. The public half is `plugins.updater.pubkey`
in `src-tauri/tauri.conf.json`; the private half is the `TAURI_SIGNING_PRIVATE_KEY`
repository secret. Losing the private key means installed copies can no longer verify
an update and have to be replaced by hand.

Releases must not be marked as prereleases: the updater reads
`releases/latest/download/latest.json`, which GitHub only resolves to a full release.
