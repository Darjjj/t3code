import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { FolderPlusIcon } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, memo, useRef } from "react";

import { cn } from "~/lib/utils";
import type { NestedProjectDropTarget, NestedProjectGroup } from "../../nestedProjectGroupsStore";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  FOLDER_DOT_CLASS_NAME,
  FOLDER_DOT_LABEL,
  useSidebarFolderDot,
} from "./SidebarProjectFolderHeader";
import type { NestedProjectGroupDnd } from "./useNestedProjectGroupDnd";

export const UNGROUPED_PROJECTS_LABEL = "Ungrouped Projects";

/** The group's sidebar tree row; its project folders name it as their parent. */
export function sidebarProjectGroupRowId(groupId: string | null) {
  return groupId === null ? "project-group:ungrouped" : `project-group:${groupId}`;
}

function GroupNameInput(props: { name: string; onCommit: (name: string | null) => void }) {
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit(null);
    }
  };
  return (
    <input
      autoFocus
      defaultValue={props.name}
      dir="auto"
      maxLength={120}
      aria-label="Group name"
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!settledRef.current) props.onCommit(event.currentTarget.value);
      }}
      className="h-7 w-full min-w-0 rounded-sm border border-input bg-card px-1.5 text-xs font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}

/**
 * A Nested Project Groups section header. It reads like the Snoozed and Settled shelves,
 * so groups stay a level above project folders without indenting thread titles further.
 */
export const SidebarProjectGroupHeader = memo(function SidebarProjectGroupHeader(props: {
  /** Null for Ungrouped Projects, which can't be renamed, moved, or deleted. */
  group: NestedProjectGroup | null;
  collapsed: boolean;
  projectCount: number;
  hiddenThreads: readonly EnvironmentThreadShell[];
  isEditing: boolean;
  isDropTarget: boolean;
  dnd: NestedProjectGroupDnd;
  onToggle: (groupId: string | null) => void;
  onContextMenu: (groupId: string | null, position: { x: number; y: number }) => void;
  onCommitRename: (groupId: string, name: string | null) => void;
  onCreateGroup: () => void;
}) {
  const { group, collapsed, dnd } = props;
  const groupId = group?.id ?? null;
  const label = group?.name ?? UNGROUPED_PROJECTS_LABEL;
  const rowId = sidebarProjectGroupRowId(groupId);
  const dot = useSidebarFolderDot(props.hiddenThreads, collapsed);
  const dropTarget: NestedProjectDropTarget = { kind: "group", groupId };
  return (
    <li
      data-testid="sidebar-project-group"
      data-thread-selection-safe
      className="group/project-group relative mx-0.5 mt-3 list-none first:mt-0"
      onDragOver={(event) => dnd.onDragOver(dropTarget, event)}
      onDragLeave={(event) => dnd.onDragLeave(dropTarget, event)}
      onDrop={(event) => dnd.onDrop(dropTarget, event)}
    >
      {props.isEditing && group !== null ? (
        <div className="flex h-8 items-center px-1">
          <GroupNameInput
            name={group.name}
            onCommit={(name) => props.onCommitRename(group.id, name)}
          />
        </div>
      ) : (
        <div
          className={cn(
            "rounded-md",
            props.isDropTarget && "bg-primary/5 ring-1 ring-inset ring-primary/40",
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <CollapsibleSectionHeader
                  data-sidebar-row={rowId}
                  data-testid="sidebar-project-group-toggle"
                  expanded={!collapsed}
                  tone={props.isDropTarget ? "accent" : "emphasized"}
                  draggable={group !== null}
                  onDragStart={
                    group === null
                      ? undefined
                      : (event) => dnd.onDragStart({ kind: "group", groupId: group.id }, event)
                  }
                  onDragEnd={dnd.onDragEnd}
                  onClick={() => props.onToggle(groupId)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    props.onContextMenu(groupId, { x: event.clientX, y: event.clientY });
                  }}
                  accessory={
                    <span className="flex items-center gap-1.5 font-normal tabular-nums">
                      {dot ? (
                        <span className={cn("size-1.5 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
                          <span className="sr-only">{FOLDER_DOT_LABEL[dot]}</span>
                        </span>
                      ) : null}
                      <span className="group-hover/project-group:invisible pointer-coarse:invisible">
                        {props.projectCount}
                        <span className="sr-only">
                          {props.projectCount === 1 ? " project" : " projects"}
                        </span>
                      </span>
                    </span>
                  }
                />
              }
            >
              {label}
            </TooltipTrigger>
            <TooltipPopup>{label}</TooltipPopup>
          </Tooltip>
        </div>
      )}
      {group !== null && props.projectCount === 0 && !collapsed ? (
        <p
          className={cn(
            "mx-1 mb-1 rounded-md border border-dashed px-2 py-1.5 text-xs text-sidebar-muted-foreground",
            props.isDropTarget ? "border-primary/40 text-primary" : "border-sidebar-foreground/20",
          )}
        >
          Drag a project here, or choose Move to Group from its menu.
        </p>
      ) : null}
      {props.isEditing ? null : (
        // Sits over the count, which hides on hover, and left of the chevron.
        <span className="absolute top-0 right-5 flex h-8 items-center opacity-0 focus-within:opacity-100 group-hover/project-group:opacity-100 pointer-coarse:opacity-100">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-sidebar-action-for={rowId}
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label="New project group"
                  onClick={props.onCreateGroup}
                />
              }
            >
              <FolderPlusIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup>New project group</TooltipPopup>
          </Tooltip>
        </span>
      )}
    </li>
  );
});
