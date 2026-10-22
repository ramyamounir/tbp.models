import { useMemo } from 'react';
import type { ModelFile, ObjectGraph } from '../../model/types';
import { useViewerStore, type InspectorTab } from '../../state/store';
import { childLook, type ChildLook } from '../../viewer/ChildOverlay';
import { useThemeColors } from '../Viewport/useThemeColors';

/**
 * Inspector tab to show: the stored tab while the node has a child object to style
 * (`hasChild`), FEATURES otherwise (the stored choice is kept for the next LM node).
 */
export function useInspectorTab(hasChild: boolean): InspectorTab {
  const stored = useViewerStore((s) => s.inspectorTab);
  return hasChild ? stored : 'features';
}

/** The child's look for the stored child settings (recomputed one frame after a theme change). */
export function useChildLook(
  model: ModelFile,
  child: ObjectGraph | undefined,
): ChildLook | undefined {
  const mode = useViewerStore((s) => s.childColorMode);
  const display = useViewerStore((s) => s.childDisplay);
  const theme = useThemeColors();
  return useMemo(
    () => (child ? childLook(model, child, mode, display, theme) : undefined),
    [model, child, mode, display, theme],
  );
}
