# Nested Project Groups: fork maintenance guide

This branch (`feature/nested-project-groups`) adds an optional Labs feature that arranges the
boring sidebar's project folders into user-defined, collapsible groups:
**Group → Project → Threads**. It is a client-only change. It adds no server, wire-protocol, or
database schema changes and no new dependencies.

To set it up on your own Windows machine, follow
[Building the customized app](#building-the-customized-app), then
[Installing over the official app](#installing-over-the-official-app).

## Baseline

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Upstream        | `https://github.com/pingdotgg/t3code`                              |
| Baseline commit | `24e77473ecf41bc1f7142529c7911c1c1aae1d76` (desktop release 0.1.9) |
| Branch          | `feature/nested-project-groups`                                    |

The baseline is the commit the installed desktop app was built from, so a build of this branch
differs from the installed app only by this feature.

## How it works

- **Toggle.** The `nestedProjectGroupsEnabled` client setting (`packages/contracts/src/settings.ts`)
  defaults to `false`. It is shown under Boring sidebar in Settings → Labs and only takes effect
  while `boringSidebarEnabled` is on. Like the boring sidebar toggle, it is device-local.
- **Organization data.** `apps/web/src/nestedProjectGroupsStore.ts` is a zustand store persisted
  to `localStorage` under `t3code:nested-project-groups:v1`. It holds the groups (stable random
  `id`, `name`, ordered `projectKeys`, `collapsed`), `ungroupedCollapsed`, and `showInactiveUngrouped`. Every read goes
  through `sanitizeNestedProjectGroups`, so corrupt data is repaired entry by entry.
  - It is deliberately _not_ stored in client settings. That struct is decoded strictly as a
    whole, so a bad entry could reset every client setting, and upstream builds drop unknown
    fields when they next write it.
  - It is local to one device and one origin. It is not synchronized between machines or
    between the desktop app and app.t3.codes.
- **Identity.** Membership uses `SidebarProjectSnapshot.projectKey`. That is the same stable
  logical key the sidebar already persists for pins and the project filter. It never uses display
  names. If the user changes **project grouping mode**, logical keys can change; affected projects
  then show in Ungrouped, and their saved keys are kept (not pruned) so switching back restores
  them. Saved keys for removed or disconnected projects are kept the same way and are simply not
  rendered.
- **Expansion.** Group collapse lives in the store above. Project folder collapse reuses the
  existing `uiStateStore.projectExpandedById` (`sidebarFolderExpansionKeys`), so a project keeps
  its open or closed state whether or not it is inside a group.
- **Rendering.** `useSidebarThreads` in `Sidebar.tsx` runs `arrangeNestedProjectGroups` over the
  existing project folders before building `orderedThreadKeys`. That keeps keyboard navigation,
  jump hints, and range selection in visual order. While the feature is on, every open
  (non-archived, non-scratch) project gets a folder, even without active threads, so grouped
  projects stay listed. `arrangeNestedProjectGroups` then hides inactive _ungrouped_ folders
  behind a "Show N inactive projects" row (unless a project filter is active), so settling a
  project's last thread still removes it from Ungrouped like the plain sidebar.
- **Drag and drop.** Native HTML5 drag on the group and folder headers, with a private MIME type
  (`components/sidebar/useNestedProjectGroupDnd.ts`). It does not use or interfere with dnd-kit,
  which owns thread rows, or with file drops onto threads. Drop rules are pure functions
  (`canDropNestedProjectItem`, `applyNestedProjectDrop`).

## Files

New (owned by this feature; they rarely conflict):

- `apps/web/src/nestedProjectGroupsStore.ts` and `.test.ts`
- `apps/web/src/components/sidebar/SidebarProjectGroupHeader.tsx`
- `apps/web/src/components/sidebar/useNestedProjectGroupDnd.ts`
- `apps/web/src/components/Sidebar.nestedProjectGroups.browser.test.tsx`
- `docs/nested-project-groups-maintenance.md` (this file)

Modified upstream files (expected merge-conflict areas, most likely first):

1. `apps/web/src/components/Sidebar.tsx`: a 3.6k-line, frequently edited file. Touch points:
   - `useSidebarThreads`: two inputs, the `projectGroupSections` block, `orderedThreads`, and
     the returned `projectGroupSections`.
   - The main component: settings and store selectors after `folderRowsMultiline`, the
     nested-group handlers just before `handleProjectFolderContextMenu`, the two extra lines in
     that menu, `keepEmptyFolders`, `hasProjectFolders`, and the
     `projectGroupSections !== null` render branch before the original folder loop.
2. `apps/web/src/components/sidebar/SidebarProjectFolderHeader.tsx`: the optional `nesting`
   prop, plus `useSidebarFolderDot` and the dot constants exported for reuse.
3. `packages/contracts/src/settings.ts`: one field in `ClientSettingsSchema` and one in
   `ClientSettingsPatch`, after `boringSidebarMultilineRows`.
4. `apps/web/src/components/settings/LabsSettingsPanel.tsx` and `settingsSearch.ts`: one row
   and one search entry.
5. `apps/desktop/src/settings/DesktopClientSettings.test.ts`: one fixture field.
6. `docs/user/thread-sidebar.md`: one subsection under "Group threads by project".

Upstream pieces the feature depends on: `useSidebarThreads` and its `projectFolders` shape
(`group`, `collapsed`, `threads`, `hiddenThreads`), `SidebarProjectSnapshot.projectKey`,
`CollapsibleSectionHeader`, `sidebarTree.ts` (`data-sidebar-row`/`data-sidebar-parent`),
`readLocalApi().contextMenu` (submenus via `children`) and `dialogs.confirm`, and
`useClientSettings`. If upstream renames or reshapes any of these, adapt the call sites rather
than reintroducing the old shape.

## Updating from upstream

Work in a separate worktree and never force-push this branch.

```sh
git fetch origin
git switch feature/nested-project-groups
git switch -c feature/nested-project-groups-update   # keep the original branch intact
git merge origin/main          # or: git rebase origin/main
```

If upstream changed the boring sidebar, resolve conflicts in `Sidebar.tsx` by re-applying the
touch points listed above to the new code. Then rerun verification. If an update turns out
broken, delete the update branch; `feature/nested-project-groups` is unchanged.

To track a specific desktop release instead of `main`, merge the commit in that release's
`app.asar` `package.json` (`t3codeCommitHash`).

## Verification

From the repository root, after `vp i`:

```sh
vp test run apps/web/src/nestedProjectGroupsStore.test.ts
vp test run apps/web/src/components/Sidebar.nestedProjectGroups.browser.test.tsx \
  apps/web/src/components/Sidebar.browser.test.tsx \
  apps/web/src/components/Sidebar.drag.browser.test.tsx \
  apps/web/src/components/Sidebar.logic.test.ts
(cd apps/web && vp run typecheck)
(cd packages/contracts && vp run typecheck)
vp run check:changed            # format, lint, knip, affected typechecks
```

Browser tests need Playwright's Chromium: `npx playwright install chromium-headless-shell`.
Set `PLAYWRIGHT_BROWSERS_PATH` first to keep it out of the user cache.

Manual check: run `vp run dev`, open the pairing URL, turn on Settings → Labs → Boring sidebar,
then Nested Project Groups. Create a group from a project's **Move to Group** menu, drag a
second project onto it, collapse and expand it, reload the page, and confirm the arrangement
remains.

## Building the customized app

An upstream release replaces a custom build, and a custom build does not auto-update. To try the
branch without installing anything, `vp run dev:desktop` runs the Electron client from source
with this worktree's own state directory.

### Windows desktop build (the recipe that has worked)

Build a release with the same version as the installed official app. A build that is older than
the user's database can fail to start, so if the installed app is newer than the baseline,
update this branch onto that release first (see Updating from upstream).

1. **T3 Connect values.** Official builds embed four public values (`VITE_CLERK_PUBLISHABLE_KEY`,
   `VITE_CLERK_JWT_TEMPLATE`, `VITE_CLERK_CLI_OAUTH_CLIENT_ID`, `VITE_T3CODE_RELAY_URL`). They
   are in the installed app's `resources/app.asar` web bundle as `KEY:` followed by a template
   literal. Copy them into the gitignored `.env.local` at the repository root as
   `T3CODE_CLERK_PUBLISHABLE_KEY`, `T3CODE_CLERK_JWT_TEMPLATE`,
   `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`, and `T3CODE_RELAY_URL`. Without them the build works, but
   T3 Connect is off. Skip telemetry tokens.
2. **WSL runtime.** Copy `resources/wsl-runtime.tar.gz` out of the installed app; the build
   requires it.
3. **Build an unpacked app directory:**

   ```sh
   T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=1 node scripts/build-desktop-artifact.ts \
     --platform win --target dir --arch x64 --build-version <installed version> \
     --keep-stage --output-dir <out dir> --wsl-runtime <path to wsl-runtime.tar.gz>
   ```

   It ends with `Windows packaged payload contains 90 files; expected at most 80`. That stop is
   expected: `--keep-stage` leaves the app in `%TEMP%\t3code-desktop-win-stage-*\app\dist`.
   Delete `win-unpacked\resources\server-compile-cache` there, which leaves about 68 files.

4. **Validate** the stage with the build script's own check. Node cannot strip types under
   `node_modules`, so save this as plain JavaScript in the gitignored
   `scripts/node_modules/.cache/validate-win-payload.mjs` and run it with the stage's `dist`
   directory as the argument:

   ```js
   import * as NodeServices from "@effect/platform-node/NodeServices";
   import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
   import * as Effect from "effect/Effect";
   import { validateWindowsPackagedPayload } from "../../build-desktop-artifact.ts";

   validateWindowsPackagedPayload({
     stageDistDir: process.argv[2],
     appExecutableName: "T3 Code (Beta).exe",
     targetArch: "x64",
     appVersion: "<installed version>",
     expectWslRuntime: true,
     verbose: false,
   }).pipe(
     Effect.tap((r) => Effect.log(`OK: ${r.fileCount} files`)),
     Effect.scoped,
     Effect.provide(NodeServices.layer),
     NodeRuntime.runMain,
   );
   ```

5. Copy `win-unpacked` somewhere permanent, then delete the stage and the validator.

### Installing over the official app

The app lives in `%LOCALAPPDATA%\Programs\t3code`. User data lives in `~/.t3/userdata` and
`%APPDATA%\t3code-v2`, and the swap never touches it.

1. Quit T3 Code fully. Nothing may listen on 127.0.0.1:3773 or 3774. Do not kill processes by
   name; ask the user to quit.
2. Back up `~/.t3/userdata`, `%APPDATA%\t3code-v2`, and the app folder, and verify the copies.
3. Rename the app folder aside (for example `t3code.official-<version>`). Copy `win-unpacked` in
   as `t3code`, and copy the official `Uninstall T3 Code (Beta).exe` into it so the uninstaller
   still works.
4. Start T3 Code through Explorer or the Start menu, not from a console it would stay attached
   to. Closing that console would quit T3. Confirm that the new exe owns 127.0.0.1:3773.
5. Turn on Settings → Labs → Boring sidebar, then Nested Project Groups.

To roll back, quit T3 Code, rename the custom folder aside, and rename the official folder back
to `t3code`.

An agent running inside T3 Code is stopped when T3 quits, so the user must run the swap from a
standalone script or by hand.

## Reverting to upstream

- **In the app:** turn off Settings → Labs → Nested Project Groups. The sidebar returns to the
  plain boring layout immediately, and saved groups stay in `localStorage`.
- **In code:** use the upstream commit (`git switch --detach 24e77473ec` or `origin/main`), or
  revert this branch's commits with `git revert`.
- **Installed app:** reinstall the official release from https://t3.codes. Groups remain in
  `localStorage` but unused. Upstream builds ignore the `nestedProjectGroupsEnabled` client
  setting and drop it on their next settings write. To clear the groups, remove the
  `t3code:nested-project-groups:v1` key from the app's local storage.

No project, repository, thread, or session data is changed by this feature at any point.
