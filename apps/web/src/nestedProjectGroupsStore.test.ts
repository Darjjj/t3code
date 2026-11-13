import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyNestedProjectDrop,
  arrangeNestedProjectGroups,
  canDropNestedProjectItem,
  createNestedProjectGroup,
  deleteNestedProjectGroup,
  EMPTY_NESTED_PROJECT_GROUPS,
  moveNestedProjectGroupBy,
  moveProjectToNestedGroup,
  moveProjectWithinNestedGroup,
  NESTED_PROJECT_GROUPS_STORAGE_KEY,
  type NestedProjectGroupsState,
  nextNestedProjectGroupName,
  persistNestedProjectGroups,
  readPersistedNestedProjectGroups,
  renameNestedProjectGroup,
  reorderNestedProjectGroup,
  sanitizeNestedProjectGroups,
  setNestedProjectGroupCollapsed,
} from "./nestedProjectGroupsStore";

function stateWith(
  ...groups: Array<[id: string, projectKeys: string[]]>
): NestedProjectGroupsState {
  return {
    groups: groups.map(([id, projectKeys]) => ({ id, name: id, projectKeys, collapsed: false })),
    ungroupedCollapsed: false,
  };
}

function membership(state: NestedProjectGroupsState) {
  return Object.fromEntries(state.groups.map((group) => [group.id, group.projectKeys]));
}

describe("nested project group edits", () => {
  it("creates, renames, and deletes a group without touching its projects' identity", () => {
    const created = createNestedProjectGroup(EMPTY_NESTED_PROJECT_GROUPS, {
      id: "adm",
      name: "  Auto Dungeon Master  ",
      projectKey: "env:image-gen",
    });
    expect(created.groups).toEqual([
      { id: "adm", name: "Auto Dungeon Master", projectKeys: ["env:image-gen"], collapsed: false },
    ]);

    const renamed = renameNestedProjectGroup(created, "adm", "ADM");
    expect(renamed.groups[0]!.name).toBe("ADM");
    // Blank names and unknown groups are ignored rather than saved.
    expect(renameNestedProjectGroup(renamed, "adm", "   ")).toBe(renamed);
    expect(renameNestedProjectGroup(renamed, "missing", "x")).toBe(renamed);

    const deleted = deleteNestedProjectGroup(renamed, "adm");
    expect(deleted.groups).toEqual([]);
    // The project returns to Ungrouped, keyed exactly as before.
    expect(
      arrangeNestedProjectGroups({
        state: deleted,
        folders: ["env:image-gen"],
        projectKeyOf: (key) => key,
        showEmptyGroups: true,
      }),
    ).toEqual([{ group: null, collapsed: false, folders: ["env:image-gen"] }]);
  });

  it("names new groups uniquely and refuses duplicate ids", () => {
    const first = createNestedProjectGroup(EMPTY_NESTED_PROJECT_GROUPS, { id: "a" });
    const second = createNestedProjectGroup(first, { id: "b" });
    expect(second.groups.map((group) => group.name)).toEqual(["New group", "New group 2"]);
    expect(nextNestedProjectGroupName(second)).toBe("New group 3");
    expect(createNestedProjectGroup(second, { id: "a" })).toBe(second);
  });

  it("keeps a project in at most one group as it moves between groups and out", () => {
    let state = stateWith(["one", ["p1", "p2"]], ["two", ["p3"]]);
    state = moveProjectToNestedGroup(state, "p1", "two");
    expect(membership(state)).toEqual({ one: ["p2"], two: ["p3", "p1"] });

    state = moveProjectToNestedGroup(state, "p1", "two", "p3");
    expect(membership(state)).toEqual({ one: ["p2"], two: ["p1", "p3"] });

    state = moveProjectToNestedGroup(state, "p1", null);
    expect(membership(state)).toEqual({ one: ["p2"], two: ["p3"] });

    // Creating a group for a grouped project moves it rather than duplicating it.
    state = createNestedProjectGroup(state, { id: "three", projectKey: "p2" });
    expect(membership(state)).toEqual({ one: [], two: ["p3"], three: ["p2"] });

    expect(moveProjectToNestedGroup(state, "p9", null)).toBe(state);
    expect(moveProjectToNestedGroup(state, "p2", "missing")).toBe(state);
  });

  it("reorders groups by drop target and by step", () => {
    const state = stateWith(["a", []], ["b", []], ["c", []]);
    const ids = (next: NestedProjectGroupsState) => next.groups.map((group) => group.id);
    expect(ids(reorderNestedProjectGroup(state, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(reorderNestedProjectGroup(state, "a", null))).toEqual(["b", "c", "a"]);
    expect(reorderNestedProjectGroup(state, "a", "b")).toBe(state);
    expect(ids(moveNestedProjectGroupBy(state, "b", -1))).toEqual(["b", "a", "c"]);
    expect(moveNestedProjectGroupBy(state, "a", -1)).toBe(state);
  });

  it("moves a project past its neighbour in group order, skipping hidden members", () => {
    const state = stateWith(["g", ["p1", "gone", "p2", "p3"]]);
    // Listed in sidebar order, which differs from the group's saved order.
    const visible = ["p3", "other", "p2", "p1"];
    expect(membership(moveProjectWithinNestedGroup(state, "p1", visible, 1))).toEqual({
      g: ["p2", "gone", "p1", "p3"],
    });
    expect(moveProjectWithinNestedGroup(state, "p3", visible, 1)).toBe(state);
  });

  it("collapses groups and Ungrouped independently", () => {
    let state = stateWith(["a", []], ["b", []]);
    state = setNestedProjectGroupCollapsed(state, "a", true);
    state = setNestedProjectGroupCollapsed(state, null, true);
    expect(state.groups.map((group) => group.collapsed)).toEqual([true, false]);
    expect(state.ungroupedCollapsed).toBe(true);
    expect(setNestedProjectGroupCollapsed(state, "a", true)).toBe(state);
  });
});

describe("nested project drag and drop", () => {
  const state = stateWith(["a", ["p1", "p2"]], ["b", ["p3"]]);

  it("moves projects into, within, and out of groups", () => {
    const project = { kind: "project", projectKey: "p1" } as const;
    expect(
      membership(applyNestedProjectDrop(state, project, { kind: "group", groupId: "b" })),
    ).toEqual({ a: ["p2"], b: ["p3", "p1"] });
    expect(
      membership(
        applyNestedProjectDrop(state, project, { kind: "project", groupId: "b", projectKey: "p3" }),
      ),
    ).toEqual({ a: ["p2"], b: ["p1", "p3"] });
    expect(
      membership(
        applyNestedProjectDrop(
          state,
          { kind: "project", projectKey: "p2" },
          { kind: "project", groupId: "a", projectKey: "p1" },
        ),
      ),
    ).toEqual({ a: ["p2", "p1"], b: ["p3"] });
    expect(
      membership(applyNestedProjectDrop(state, project, { kind: "group", groupId: null })),
    ).toEqual({ a: ["p2"], b: ["p3"] });
  });

  it("reorders groups on group headers and rejects invalid drops", () => {
    const group = { kind: "group", groupId: "b" } as const;
    expect(
      applyNestedProjectDrop(state, group, { kind: "group", groupId: "a" }).groups.map(
        (entry) => entry.id,
      ),
    ).toEqual(["b", "a"]);
    expect(canDropNestedProjectItem(group, { kind: "group", groupId: "b" })).toBe(false);
    expect(
      canDropNestedProjectItem(group, { kind: "project", groupId: "a", projectKey: "p1" }),
    ).toBe(false);
    expect(
      canDropNestedProjectItem(
        { kind: "project", projectKey: "p1" },
        { kind: "project", groupId: "a", projectKey: "p1" },
      ),
    ).toBe(false);
    expect(applyNestedProjectDrop(state, group, { kind: "group", groupId: "b" })).toBe(state);
  });
});

describe("arrangeNestedProjectGroups", () => {
  const folders = ["pinned", "p1", "p2", "p3", "p4"];
  const arrange = (state: NestedProjectGroupsState, showEmptyGroups = true) =>
    arrangeNestedProjectGroups({
      state,
      folders,
      projectKeyOf: (key) => key,
      showEmptyGroups,
    }).map((section) => [section.group?.id ?? "ungrouped", section.folders]);

  it("lists groups in saved order, then Ungrouped in sidebar order", () => {
    const state = stateWith(["adm", ["p3", "p1"]], ["empty", []]);
    expect(arrange(state)).toEqual([
      ["adm", ["p3", "p1"]],
      ["empty", []],
      ["ungrouped", ["pinned", "p2", "p4"]],
    ]);
    // A project filter hides groups with nothing to show.
    expect(arrange(state, false)).toEqual([
      ["adm", ["p3", "p1"]],
      ["ungrouped", ["pinned", "p2", "p4"]],
    ]);
  });

  it("ignores saved projects that are missing and keeps them for when they return", () => {
    const state = stateWith(["adm", ["removed", "p2"]]);
    expect(arrange(state)).toEqual([
      ["adm", ["p2"]],
      ["ungrouped", ["pinned", "p1", "p3", "p4"]],
    ]);
    expect(state.groups[0]!.projectKeys).toEqual(["removed", "p2"]);
  });

  it("shows every project in Ungrouped before any group exists, and nothing without projects", () => {
    expect(arrange(EMPTY_NESTED_PROJECT_GROUPS)).toEqual([["ungrouped", folders]]);
    expect(
      arrangeNestedProjectGroups({
        state: EMPTY_NESTED_PROJECT_GROUPS,
        folders: [],
        projectKeyOf: (key: string) => key,
        showEmptyGroups: true,
      }),
    ).toEqual([]);
  });
});

describe("nested project groups persistence", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    };
    vi.stubGlobal("window", { localStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads back what it wrote, as after a restart", () => {
    const state = setNestedProjectGroupCollapsed(
      createNestedProjectGroup(EMPTY_NESTED_PROJECT_GROUPS, {
        id: "adm",
        name: "Auto Dungeon Master",
        projectKey: "env:image-gen",
      }),
      "adm",
      true,
    );
    persistNestedProjectGroups(state);
    expect(readPersistedNestedProjectGroups()).toEqual(state);
  });

  it("starts empty when storage is missing or unreadable", () => {
    expect(readPersistedNestedProjectGroups()).toEqual(EMPTY_NESTED_PROJECT_GROUPS);
    storage.set(NESTED_PROJECT_GROUPS_STORAGE_KEY, "{not json");
    expect(readPersistedNestedProjectGroups()).toEqual(EMPTY_NESTED_PROJECT_GROUPS);
  });
});

describe("sanitizeNestedProjectGroups", () => {
  it("restores a persisted state unchanged", () => {
    const state: NestedProjectGroupsState = {
      groups: [
        { id: "adm", name: "Auto Dungeon Master", projectKeys: ["a", "b"], collapsed: true },
        { id: "other", name: "Other Projects", projectKeys: [], collapsed: false },
      ],
      ungroupedCollapsed: true,
    };
    expect(
      sanitizeNestedProjectGroups(JSON.parse(JSON.stringify({ version: 1, ...state }))),
    ).toEqual(state);
  });

  it("repairs corrupted metadata instead of failing", () => {
    expect(sanitizeNestedProjectGroups(null)).toEqual(EMPTY_NESTED_PROJECT_GROUPS);
    expect(sanitizeNestedProjectGroups("garbage")).toEqual(EMPTY_NESTED_PROJECT_GROUPS);
    expect(sanitizeNestedProjectGroups({ groups: "nope" })).toEqual(EMPTY_NESTED_PROJECT_GROUPS);
    expect(
      sanitizeNestedProjectGroups({
        groups: [
          null,
          { id: "", name: "no id" },
          { id: "a", name: "  ", projectKeys: ["p1", "p1", 7, "", "p2"], collapsed: "yes" },
          { id: "a", name: "duplicate id", projectKeys: ["p3"] },
          { id: "b", name: "B", projectKeys: ["p2", "p3"] },
        ],
        ungroupedCollapsed: 1,
      }),
    ).toEqual({
      groups: [
        { id: "a", name: "New group", projectKeys: ["p1", "p2"], collapsed: false },
        // p2 already belongs to "a", so it is not duplicated here.
        { id: "b", name: "B", projectKeys: ["p3"], collapsed: false },
      ],
      ungroupedCollapsed: false,
    });
  });
});
