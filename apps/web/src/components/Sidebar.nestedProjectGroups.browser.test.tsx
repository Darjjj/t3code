import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { requestConfirmDialog } from "../confirmDialog";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { __setClientSettingsForTests, getClientSettings } from "../hooks/useSettings";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import {
  EMPTY_NESTED_PROJECT_GROUPS,
  type NestedProjectGroupsState,
  useNestedProjectGroupsStore,
} from "../nestedProjectGroupsStore";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { useProjects, useQuietThreadShells } from "../state/entities";
import { makeThreadFixture } from "../test-fixtures";
import type { Project } from "../types";
import { useUiStateStore } from "../uiStateStore";
import Sidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";

vi.mock("../state/entities", { spy: true });
vi.mock("../hooks/useHandleNewThread", { spy: true });
vi.mock("../hooks/useThreadRouteTarget", { spy: true });
// No themed dialog host is mounted here; a test answers the confirmation itself.
vi.mock("../confirmDialog", { spy: true });
vi.mock("../commandPaletteBus", () => ({
  openCommandPalette: vi.fn(),
  isCommandPaletteOpen: () => false,
}));
vi.mock("./sidebar/SidebarChrome", () => ({
  SidebarChromeHeader: () => null,
  SidebarChromeFooter: () => null,
}));

const environmentId = EnvironmentId.make("local");

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

const projects = [project("image-gen"), project("narrator"), project("loose")];

/** The stable logical keys the sidebar uses, never display names. */
function projectKeyOf(projectId: string) {
  return buildSidebarProjectSnapshots({
    projects,
    settings: selectProjectGroupingSettings(DEFAULT_CLIENT_SETTINGS),
    primaryEnvironmentId: environmentId,
    resolveEnvironmentLabel: () => null,
  }).find((snapshot) => snapshot.id === projectId)!.projectKey;
}

function setup(stack: DisposableStack, settings: Partial<ClientSettings>) {
  const previousSettings = getClientSettings();
  stack.defer(() => __setClientSettingsForTests(previousSettings));
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    boringSidebarEnabled: true,
    ...settings,
  });
  const previousGroups = useNestedProjectGroupsStore.getState();
  stack.defer(() =>
    useNestedProjectGroupsStore.setState({
      groups: previousGroups.groups,
      ungroupedCollapsed: previousGroups.ungroupedCollapsed,
      showInactiveUngrouped: previousGroups.showInactiveUngrouped,
    }),
  );
  const previousExpanded = useUiStateStore.getState().projectExpandedById;
  stack.defer(() => useUiStateStore.setState({ projectExpandedById: previousExpanded }));
  vi.mocked(useProjects).mockReturnValue(projects);
  // Only image-gen has an active thread; the other projects are idle.
  vi.mocked(useQuietThreadShells).mockReturnValue([
    makeThreadFixture({
      environmentId,
      id: ThreadId.make("thread-planning"),
      projectId: projects[0]!.id,
      title: "Planning",
    }),
  ]);
  vi.mocked(useThreadRouteTarget).mockReturnValue(null);
  vi.mocked(useHandleNewThread).mockReturnValue({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: { environmentId, projectId: projects[0]!.id },
    defaultProjectFallbackReady: true,
    handleNewThread: vi.fn().mockResolvedValue(null),
    routeDraftId: null,
    routeThreadRef: null,
  });
}

function seedGroups(state: NestedProjectGroupsState) {
  useNestedProjectGroupsStore.setState(state);
}

const adventureGroup = (
  collapsed = false,
  showInactiveUngrouped = false,
): NestedProjectGroupsState => ({
  groups: [
    {
      id: "group-adm",
      name: "Auto Dungeon Master",
      projectKeys: [projectKeyOf("narrator"), projectKeyOf("image-gen"), "env:removed-project"],
      collapsed,
    },
  ],
  ungroupedCollapsed: false,
  showInactiveUngrouped,
});

const sidebar = () => (
  <SidebarProvider>
    <Sidebar routeReveal={{ observedKey: null, pendingKey: null }} />
  </SidebarProvider>
);

function folderNames(container: HTMLElement) {
  return Array.from(
    // The name span, without the favicon's fallback initials.
    container.querySelectorAll(
      '[data-testid="sidebar-project-folder"] button[aria-expanded] .truncate',
    ),
    (name) => name.textContent?.trim(),
  );
}

describe("nested project groups", () => {
  it("leaves the boring sidebar unchanged while off, then restores it when turned off again", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: false });
    seedGroups(adventureGroup());
    await using screen = await render(sidebar());

    await expect.element(screen.getByText("Planning").first()).toBeInTheDocument();
    expect(screen.container.querySelector('[data-testid="sidebar-project-group"]')).toBeNull();
    // The original boring sidebar shows only projects with active threads.
    expect(folderNames(screen.container)).toEqual(["image-gen"]);

    __setClientSettingsForTests({
      ...getClientSettings(),
      nestedProjectGroupsEnabled: true,
    });
    await screen.rerender(sidebar());
    await expect.element(screen.getByText("Auto Dungeon Master")).toBeInTheDocument();
    // Grouped projects stay listed; the idle ungrouped one hides as the normal sidebar does.
    expect(folderNames(screen.container)).toEqual(["narrator", "image-gen"]);

    __setClientSettingsForTests({
      ...getClientSettings(),
      nestedProjectGroupsEnabled: false,
    });
    await screen.rerender(sidebar());
    await expect.element(screen.getByText("Auto Dungeon Master")).not.toBeInTheDocument();
    expect(folderNames(screen.container)).toEqual(["image-gen"]);
    // Turning the feature off keeps the saved organization.
    expect(useNestedProjectGroupsStore.getState().groups).toEqual(adventureGroup().groups);
  });

  it("collapses a group and restores its projects' own expansion when reopened", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: true });
    seedGroups(adventureGroup());
    await using screen = await render(sidebar());

    await expect.element(screen.getByText("Ungrouped Projects")).toBeInTheDocument();
    await expect.element(screen.getByText("Planning").first()).toBeInTheDocument();
    // Close one project folder first; the group must not forget it.
    await userEvent.click(screen.getByRole("button", { name: "image-gen", exact: true }));
    await expect.element(screen.getByText("Planning").first()).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Auto Dungeon Master/ }));
    expect(useNestedProjectGroupsStore.getState().groups[0]!.collapsed).toBe(true);
    expect(folderNames(screen.container)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /^Auto Dungeon Master/ }));
    expect(folderNames(screen.container)).toEqual(["narrator", "image-gen"]);
    await expect.element(screen.getByText("Planning").first()).not.toBeInTheDocument();
  });

  it("moves a project into a group from its menu and back to Ungrouped", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: true });
    seedGroups(adventureGroup(false, true));
    await using screen = await render(sidebar());

    const openMoveMenu = async () => {
      await userEvent.click(screen.getByRole("button", { name: "loose", exact: true }), {
        button: "right",
      });
      await userEvent.click(screen.getByRole("menuitem", { name: "Move to Group" }));
    };
    await openMoveMenu();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Auto Dungeon Master" }));
    expect(useNestedProjectGroupsStore.getState().groups[0]!.projectKeys).toContain(
      projectKeyOf("loose"),
    );
    await expect.element(screen.getByText("Ungrouped Projects")).not.toBeInTheDocument();

    await openMoveMenu();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Ungrouped" }));
    expect(useNestedProjectGroupsStore.getState().groups[0]!.projectKeys).not.toContain(
      projectKeyOf("loose"),
    );
    await expect.element(screen.getByText("Ungrouped Projects")).toBeInTheDocument();
  });

  it("drags projects into a group, before a member, and reorders groups", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: true });
    seedGroups({
      groups: [
        ...adventureGroup().groups,
        { id: "group-other", name: "Other Projects", projectKeys: [], collapsed: false },
      ],
      ungroupedCollapsed: false,
      showInactiveUngrouped: true,
    });
    await using screen = await render(sidebar());
    const loose = screen.getByRole("button", { name: "loose", exact: true });
    const groupKeys = () =>
      Object.fromEntries(
        useNestedProjectGroupsStore.getState().groups.map((group) => [group.id, group.projectKeys]),
      );

    await expect.element(screen.getByText(/Drag a project here/)).toBeInTheDocument();
    await userEvent.dragAndDrop(loose, screen.getByRole("button", { name: /^Other Projects/ }));
    expect(groupKeys()["group-other"]).toEqual([projectKeyOf("loose")]);

    // Dropping on a project header lands before it, moving between groups.
    await userEvent.dragAndDrop(
      loose,
      screen.getByRole("button", { name: "image-gen", exact: true }),
    );
    expect(groupKeys()["group-adm"]).toEqual([
      projectKeyOf("narrator"),
      projectKeyOf("loose"),
      projectKeyOf("image-gen"),
      "env:removed-project",
    ]);
    expect(groupKeys()["group-other"]).toEqual([]);

    await userEvent.dragAndDrop(
      screen.getByRole("button", { name: /^Other Projects/ }),
      screen.getByRole("button", { name: /^Auto Dungeon Master/ }),
    );
    expect(useNestedProjectGroupsStore.getState().groups.map((group) => group.id)).toEqual([
      "group-other",
      "group-adm",
    ]);
  });

  it("creates a group for a project and names it inline", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: true });
    seedGroups(EMPTY_NESTED_PROJECT_GROUPS);
    await using screen = await render(sidebar());

    // Idle projects hide until shown, so they can be organized without cluttering the list.
    await expect.element(screen.getByText("Ungrouped Projects")).toBeInTheDocument();
    expect(folderNames(screen.container)).toEqual(["image-gen"]);
    await userEvent.click(screen.getByRole("button", { name: "Show 2 inactive projects" }));
    expect(folderNames(screen.container).toSorted()).toEqual(["image-gen", "loose", "narrator"]);
    await userEvent.click(screen.getByRole("button", { name: "Hide inactive projects" }));
    expect(folderNames(screen.container)).toEqual(["image-gen"]);
    expect(useNestedProjectGroupsStore.getState().showInactiveUngrouped).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Show 2 inactive projects" }));

    await userEvent.click(screen.getByRole("button", { name: "narrator", exact: true }), {
      button: "right",
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to Group" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Create New Group…" }));
    const input = screen.getByRole("textbox", { name: "Group name" });
    await expect.element(input).toHaveFocus();
    await userEvent.fill(input, "Auto Dungeon Master");
    await userEvent.keyboard("{Enter}");

    expect(useNestedProjectGroupsStore.getState().groups).toEqual([
      expect.objectContaining({
        name: "Auto Dungeon Master",
        projectKeys: [projectKeyOf("narrator")],
      }),
    ]);
    await expect.element(screen.getByText("Auto Dungeon Master")).toBeInTheDocument();
    expect(folderNames(screen.container)[0]).toBe("narrator");
  });

  it("creates a group from the top bar and deletes one from its header after confirming", async () => {
    using stack = new DisposableStack();
    setup(stack, { nestedProjectGroupsEnabled: true });
    seedGroups(adventureGroup());
    await using screen = await render(sidebar());

    await userEvent.click(screen.getByRole("button", { name: "New project group" }));
    await userEvent.fill(screen.getByRole("textbox", { name: "Group name" }), "Spare");
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Spare")).toBeInTheDocument();
    // Ungrouped Projects can't be deleted, so only the two named groups offer it.
    expect(screen.getByRole("button", { name: /^Delete group / }).elements()).toHaveLength(2);

    const deleteAdventure = screen.getByRole("button", {
      name: "Delete group Auto Dungeon Master",
    });
    vi.mocked(requestConfirmDialog).mockResolvedValueOnce(false);
    await userEvent.click(deleteAdventure);
    expect(requestConfirmDialog).toHaveBeenCalledWith(
      expect.stringContaining('Delete group "Auto Dungeon Master"?'),
      { variant: "destructive" },
    );
    expect(useNestedProjectGroupsStore.getState().groups).toHaveLength(2);

    vi.mocked(requestConfirmDialog).mockResolvedValueOnce(true);
    await userEvent.click(deleteAdventure);
    await expect.element(screen.getByText("Auto Dungeon Master")).not.toBeInTheDocument();
    expect(useNestedProjectGroupsStore.getState().groups.map((group) => group.name)).toEqual([
      "Spare",
    ]);
  });
});
