import { type DragEvent, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import {
  canDropNestedProjectItem,
  type NestedProjectDragItem,
  type NestedProjectDropTarget,
  nestedProjectDropTargetKey,
} from "../../nestedProjectGroupsStore";

// Native HTML5 drag for group and project headers. dnd-kit owns thread rows and file drops
// carry `Files`, so this private type keeps the three from accepting each other's drags.
const NESTED_PROJECT_DRAG_TYPE = "application/x-t3code-nested-project-group-item";

export interface NestedProjectGroupDnd {
  readonly onDragStart: (item: NestedProjectDragItem, event: DragEvent) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (target: NestedProjectDropTarget, event: DragEvent) => void;
  readonly onDragLeave: (target: NestedProjectDropTarget, event: DragEvent) => void;
  readonly onDrop: (target: NestedProjectDropTarget, event: DragEvent) => void;
}

export function useNestedProjectGroupDnd(
  onMove: (item: NestedProjectDragItem, target: NestedProjectDropTarget) => void,
) {
  // dragover cannot read the payload, so the item lives here for the drag's length.
  const draggingRef = useRef<NestedProjectDragItem | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const accepts = (target: NestedProjectDropTarget, event: DragEvent) => {
    const item = draggingRef.current;
    return item !== null &&
      event.dataTransfer.types.includes(NESTED_PROJECT_DRAG_TYPE) &&
      canDropNestedProjectItem(item, target)
      ? item
      : null;
  };
  const reset = () => {
    draggingRef.current = null;
    setOverKey(null);
  };
  const dnd: NestedProjectGroupDnd = {
    onDragStart: useStableCallback((item: NestedProjectDragItem, event: DragEvent) => {
      draggingRef.current = item;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(NESTED_PROJECT_DRAG_TYPE, JSON.stringify(item));
    }),
    onDragEnd: useStableCallback(reset),
    onDragOver: useStableCallback((target: NestedProjectDropTarget, event: DragEvent) => {
      if (accepts(target, event) === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      const key = nestedProjectDropTargetKey(target);
      setOverKey((current) => (current === key ? current : key));
    }),
    onDragLeave: useStableCallback((target: NestedProjectDropTarget, event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      const key = nestedProjectDropTargetKey(target);
      setOverKey((current) => (current === key ? null : current));
    }),
    onDrop: useStableCallback((target: NestedProjectDropTarget, event: DragEvent) => {
      const item = accepts(target, event);
      if (item === null) return;
      event.preventDefault();
      event.stopPropagation();
      reset();
      onMove(item, target);
    }),
  };
  return { dnd, overKey };
}
