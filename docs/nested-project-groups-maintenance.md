# Nested Project Groups: fork maintenance guide

This branch (`feature/nested-project-groups`) adds an optional Labs feature that arranges the
boring sidebar's project folders into user-defined, collapsible groups:
**Group → Project → Threads**. It is a client-only change. It adds no server, wire-protocol, or
database schema changes and no new dependencies.

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

The installed app auto-updates from upstream releases, so an upstream update replaces a custom
build. To run this branch:

- **Development (no install):** `vp run dev:desktop` runs the Electron client from source with
  this worktree's own state directory.
- **Installer:** `vp run dist:desktop:win` (x64 NSIS) produces an installer under `release/`.
  Installing it replaces the installed T3 Code. Back up `~/.t3/userdata` first and expect the
  next upstream auto-update to replace it again.

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
