import { create } from "zustand";

// Device-local organization for the boring sidebar's Nested Project Groups. Kept out of
// client settings: that struct decodes as a whole, so a bad entry here must not reset it.
export const NESTED_PROJECT_GROUPS_STORAGE_KEY = "t3code:nested-project-groups:v1";
const DEFAULT_GROUP_NAME = "New group";
const MAX_GROUP_NAME_LENGTH = 120;

export interface NestedProjectGroup {
  readonly id: string;
  readonly name: string;
  /** Logical sidebar project keys, in display order. A key belongs to at most one group. */
  readonly projectKeys: readonly string[];
  readonly collapsed: boolean;
}

export interface NestedProjectGroupsState {
  readonly groups: readonly NestedProjectGroup[];
  readonly ungroupedCollapsed: boolean;
  /** Lists ungrouped projects with no active threads, which hide like the normal sidebar's. */
  readonly showInactiveUngrouped: boolean;
}

export const EMPTY_NESTED_PROJECT_GROUPS: NestedProjectGroupsState = {
  groups: [],
  ungroupedCollapsed: false,
  showInactiveUngrouped: false,
};

function normalizeGroupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().slice(0, MAX_GROUP_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

/** Repairs anything read from storage: unknown shapes, duplicate ids, and projects in two groups. */
export function sanitizeNestedProjectGroups(value: unknown): NestedProjectGroupsState {
  if (!value || typeof value !== "object") return EMPTY_NESTED_PROJECT_GROUPS;
  const raw = value as {
    groups?: unknown;
    ungroupedCollapsed?: unknown;
    showInactiveUngrouped?: unknown;
  };
  const seenIds = new Set<string>();
  const claimedProjectKeys = new Set<string>();
  const groups: NestedProjectGroup[] = [];
  for (const entry of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!entry || typeof entry !== "object") continue;
    const group = entry as Record<string, unknown>;
    if (typeof group.id !== "string" || group.id.length === 0 || seenIds.has(group.id)) continue;
    seenIds.add(group.id);
    const projectKeys: string[] = [];
    for (const key of Array.isArray(group.projectKeys) ? group.projectKeys : []) {
      if (typeof key !== "string" || key.length === 0 || claimedProjectKeys.has(key)) continue;
      claimedProjectKeys.add(key);
      projectKeys.push(key);
    }
    groups.push({
      id: group.id,
      name: normalizeGroupName(group.name) ?? DEFAULT_GROUP_NAME,
      projectKeys,
      collapsed: group.collapsed === true,
    });
  }
  return {
    groups,
    ungroupedCollapsed: raw.ungroupedCollapsed === true,
    showInactiveUngrouped: raw.showInactiveUngrouped === true,
  };
}

export function nextNestedProjectGroupName(state: NestedProjectGroupsState): string {
  const names = new Set(state.groups.map((group) => group.name));
  if (!names.has(DEFAULT_GROUP_NAME)) return DEFAULT_GROUP_NAME;
  let suffix = 2;
  while (names.has(`${DEFAULT_GROUP_NAME} ${suffix}`)) suffix += 1;
  return `${DEFAULT_GROUP_NAME} ${suffix}`;
}

function withoutProject(
  groups: readonly NestedProjectGroup[],
  projectKey: string,
): NestedProjectGroup[] {
  return groups.map((group) =>
    group.projectKeys.includes(projectKey)
      ? { ...group, projectKeys: group.projectKeys.filter((key) => key !== projectKey) }
      : group,
  );
}

export function createNestedProjectGroup(
  state: NestedProjectGroupsState,
  input: { readonly id: string; readonly name?: string; readonly projectKey?: string },
): NestedProjectGroupsState {
  if (input.id.length === 0 || state.groups.some((group) => group.id === input.id)) return state;
  const groups = input.projectKey ? withoutProject(state.groups, input.projectKey) : state.groups;
  return {
    ...state,
    groups: [
      ...groups,
      {
        id: input.id,
        name: normalizeGroupName(input.name) ?? nextNestedProjectGroupName(state),
        projectKeys: input.projectKey ? [input.projectKey] : [],
        collapsed: false,
      },
    ],
  };
}

export function renameNestedProjectGroup(
  state: NestedProjectGroupsState,
  groupId: string,
  name: string,
): NestedProjectGroupsState {
  const nextName = normalizeGroupName(name);
  const current = state.groups.find((group) => group.id === groupId);
  if (nextName === null || current === undefined || current.name === nextName) return state;
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id === groupId ? { ...group, name: nextName } : group,
    ),
  };
}

/** Removes only the group; its projects fall back to Ungrouped. */
export function deleteNestedProjectGroup(
  state: NestedProjectGroupsState,
  groupId: string,
): NestedProjectGroupsState {
  if (!state.groups.some((group) => group.id === groupId)) return state;
  return { ...state, groups: state.groups.filter((group) => group.id !== groupId) };
}

/**
 * Puts a project in `groupId` before `beforeProjectKey` (or last), or in Ungrouped when
 * `groupId` is null. Membership is exclusive, so this also leaves any previous group.
 */
export function moveProjectToNestedGroup(
  state: NestedProjectGroupsState,
  projectKey: string,
  groupId: string | null,
  beforeProjectKey?: string | null,
): NestedProjectGroupsState {
  if (projectKey.length === 0 || beforeProjectKey === projectKey) return state;
  if (groupId !== null && !state.groups.some((group) => group.id === groupId)) return state;
  const isMember = state.groups.some((group) => group.projectKeys.includes(projectKey));
  if (groupId === null && !isMember) return state;
  const groups = withoutProject(state.groups, projectKey).map((group) => {
    if (group.id !== groupId) return group;
    const projectKeys = [...group.projectKeys];
    const index = beforeProjectKey ? projectKeys.indexOf(beforeProjectKey) : -1;
    projectKeys.splice(index < 0 ? projectKeys.length : index, 0, projectKey);
    return { ...group, projectKeys };
  });
  const unchanged = groups.every(
    (group, index) =>
      group.projectKeys.length === state.groups[index]!.projectKeys.length &&
      group.projectKeys.every(
        (key, keyIndex) => key === state.groups[index]!.projectKeys[keyIndex],
      ),
  );
  return unchanged ? state : { ...state, groups };
}

/** Moves a group before `beforeGroupId`, or to the end when it is null. */
export function reorderNestedProjectGroup(
  state: NestedProjectGroupsState,
  groupId: string,
  beforeGroupId: string | null,
): NestedProjectGroupsState {
  if (groupId === beforeGroupId) return state;
  const moving = state.groups.find((group) => group.id === groupId);
  if (moving === undefined) return state;
  const rest = state.groups.filter((group) => group.id !== groupId);
  const index = beforeGroupId === null ? -1 : rest.findIndex((group) => group.id === beforeGroupId);
  rest.splice(index < 0 ? rest.length : index, 0, moving);
  return rest.every((group, position) => group === state.groups[position])
    ? state
    : { ...state, groups: rest };
}

export function moveNestedProjectGroupBy(
  state: NestedProjectGroupsState,
  groupId: string,
  offset: -1 | 1,
): NestedProjectGroupsState {
  const index = state.groups.findIndex((group) => group.id === groupId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= state.groups.length) return state;
  const groups = [...state.groups];
  [groups[index], groups[target]] = [groups[target]!, groups[index]!];
  return { ...state, groups };
}

/** Swaps a project with its neighbour in saved group order, skipping keys not in `visibleProjectKeys`. */
export function moveProjectWithinNestedGroup(
  state: NestedProjectGroupsState,
  projectKey: string,
  visibleProjectKeys: readonly string[],
  offset: -1 | 1,
): NestedProjectGroupsState {
  const group = state.groups.find((candidate) => candidate.projectKeys.includes(projectKey));
  if (group === undefined) return state;
  const listed = new Set(visibleProjectKeys);
  const visible = group.projectKeys.filter((key) => listed.has(key));
  const neighbour = visible[visible.indexOf(projectKey) + offset];
  if (neighbour === undefined) return state;
  const projectKeys = [...group.projectKeys];
  const from = projectKeys.indexOf(projectKey);
  const to = projectKeys.indexOf(neighbour);
  [projectKeys[from], projectKeys[to]] = [projectKeys[to]!, projectKeys[from]!];
  return {
    ...state,
    groups: state.groups.map((candidate) =>
      candidate.id === group.id ? { ...candidate, projectKeys } : candidate,
    ),
  };
}

/** `groupId` null addresses the Ungrouped Projects section. */
export function setNestedProjectGroupCollapsed(
  state: NestedProjectGroupsState,
  groupId: string | null,
  collapsed: boolean,
): NestedProjectGroupsState {
  if (groupId === null) {
    return state.ungroupedCollapsed === collapsed
      ? state
      : { ...state, ungroupedCollapsed: collapsed };
  }
  const current = state.groups.find((group) => group.id === groupId);
  if (current === undefined || current.collapsed === collapsed) return state;
  return {
    ...state,
    groups: state.groups.map((group) => (group.id === groupId ? { ...group, collapsed } : group)),
  };
}

export function setShowInactiveUngroupedProjects(
  state: NestedProjectGroupsState,
  show: boolean,
): NestedProjectGroupsState {
  return state.showInactiveUngrouped === show ? state : { ...state, showInactiveUngrouped: show };
}

export type NestedProjectDragItem =
  | { readonly kind: "project"; readonly projectKey: string }
  | { readonly kind: "group"; readonly groupId: string };

/** A group header (null is Ungrouped), or a project header that a drop lands before. */
export type NestedProjectDropTarget =
  | { readonly kind: "group"; readonly groupId: string | null }
  | { readonly kind: "project"; readonly groupId: string | null; readonly projectKey: string };

export function nestedProjectDropTargetKey(target: NestedProjectDropTarget): string {
  return target.kind === "group" ? `group:${target.groupId ?? ""}` : `project:${target.projectKey}`;
}

/** Groups drop only on group headers, and nothing drops on itself. */
export function canDropNestedProjectItem(
  item: NestedProjectDragItem,
  target: NestedProjectDropTarget,
): boolean {
  if (item.kind === "group") return target.kind === "group" && target.groupId !== item.groupId;
  return target.kind === "group" || target.projectKey !== item.projectKey;
}

export function applyNestedProjectDrop(
  state: NestedProjectGroupsState,
  item: NestedProjectDragItem,
  target: NestedProjectDropTarget,
): NestedProjectGroupsState {
  if (!canDropNestedProjectItem(item, target)) return state;
  if (item.kind === "group") return reorderNestedProjectGroup(state, item.groupId, target.groupId);
  return moveProjectToNestedGroup(
    state,
    item.projectKey,
    target.groupId,
    target.kind === "project" ? target.projectKey : null,
  );
}

export interface NestedProjectGroupSection<TFolder> {
  /** Null for Ungrouped Projects. */
  readonly group: NestedProjectGroup | null;
  readonly collapsed: boolean;
  readonly folders: readonly TFolder[];
  /** Ungrouped projects with no active threads, listed or not. Always 0 for custom groups. */
  readonly inactiveCount: number;
}

/**
 * Arranges sidebar project folders into groups. Custom groups list their folders in saved
 * order and Ungrouped keeps input order. Saved keys whose project is not listed are ignored,
 * so a project that disappears and returns lands back in its group. Inactive ungrouped
 * folders hide unless shown, as the normal sidebar hides them; grouped ones stay listed.
 */
export function arrangeNestedProjectGroups<TFolder>(input: {
  readonly state: NestedProjectGroupsState;
  readonly folders: readonly TFolder[];
  readonly projectKeyOf: (folder: TFolder) => string;
  /** Keeps custom groups with no listed folder, so a new group can take a project. */
  readonly showEmptyGroups: boolean;
  readonly isInactive: (folder: TFolder) => boolean;
  readonly showInactiveUngrouped: boolean;
}): NestedProjectGroupSection<TFolder>[] {
  const folderByKey = new Map(input.folders.map((folder) => [input.projectKeyOf(folder), folder]));
  const grouped = new Set<string>();
  const sections: NestedProjectGroupSection<TFolder>[] = [];
  for (const group of input.state.groups) {
    const folders = group.projectKeys.flatMap((key) => {
      const folder = folderByKey.get(key);
      if (folder === undefined) return [];
      grouped.add(key);
      return [folder];
    });
    if (folders.length === 0 && !input.showEmptyGroups) continue;
    sections.push({ group, collapsed: group.collapsed, folders, inactiveCount: 0 });
  }
  const ungrouped = input.folders.filter((folder) => !grouped.has(input.projectKeyOf(folder)));
  const active = ungrouped.filter((folder) => !input.isInactive(folder));
  // Kept while everything in it is inactive, so the way to show those projects stays reachable.
  if (ungrouped.length > 0) {
    sections.push({
      group: null,
      collapsed: input.state.ungroupedCollapsed,
      folders: input.showInactiveUngrouped ? ungrouped : active,
      inactiveCount: ungrouped.length - active.length,
    });
  }
  return sections;
}

export function newNestedProjectGroupId(): string {
  // getRandomValues works in insecure contexts (LAN http), unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `group-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function readPersistedNestedProjectGroups(): NestedProjectGroupsState {
  if (typeof window === "undefined") return EMPTY_NESTED_PROJECT_GROUPS;
  try {
    const raw = window.localStorage.getItem(NESTED_PROJECT_GROUPS_STORAGE_KEY);
    return raw ? sanitizeNestedProjectGroups(JSON.parse(raw)) : EMPTY_NESTED_PROJECT_GROUPS;
  } catch {
    return EMPTY_NESTED_PROJECT_GROUPS;
  }
}

export function persistNestedProjectGroups(state: NestedProjectGroupsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      NESTED_PROJECT_GROUPS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        groups: state.groups,
        ungroupedCollapsed: state.ungroupedCollapsed,
        showInactiveUngrouped: state.showInactiveUngrouped,
      }),
    );
  } catch {}
}

interface NestedProjectGroupsStore extends NestedProjectGroupsState {
  readonly update: (change: (state: NestedProjectGroupsState) => NestedProjectGroupsState) => void;
}

function pickState(store: NestedProjectGroupsState): NestedProjectGroupsState {
  return {
    groups: store.groups,
    ungroupedCollapsed: store.ungroupedCollapsed,
    showInactiveUngrouped: store.showInactiveUngrouped,
  };
}

export const useNestedProjectGroupsStore = create<NestedProjectGroupsStore>((set, get) => ({
  ...readPersistedNestedProjectGroups(),
  update: (change) => {
    const current = pickState(get());
    const next = change(current);
    if (next === current) return;
    set(next);
    // Writes are rare user actions, so persist now instead of debouncing past a quit.
    persistNestedProjectGroups(next);
  },
}));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  // Another window of the same app may reorganize; follow it instead of overwriting it later.
  window.addEventListener("storage", (event) => {
    if (event.key !== NESTED_PROJECT_GROUPS_STORAGE_KEY) return;
    useNestedProjectGroupsStore.setState(readPersistedNestedProjectGroups());
  });
}
