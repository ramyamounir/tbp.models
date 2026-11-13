import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Tool } from '../../state/store';
import {
  createDiffScene,
  type DiffScene,
  type DiffSceneInput,
  type DiffSceneNode,
} from '../../viewer/DiffScene';

/**
 * Mounts one `DiffScene` (spec multi-file-edit-diff Phase 7a) in an absolutely positioned host
 * and keeps it in sync with its props. `onReady` receives the scene after creation and null
 * before disposal (camera linking in `DiffViewport`).
 */
export function DiffCanvas({
  input,
  pointSize,
  tool,
  ortho,
  ariaLabel,
  onPick,
  onReady,
}: {
  input: DiffSceneInput;
  pointSize: number;
  tool: Tool;
  ortho: boolean;
  ariaLabel: string;
  onPick(node: DiffSceneNode): void;
  onReady(scene: DiffScene | null): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<DiffScene | null>(null);
  const onPickRef = useRef(onPick);
  const onReadyRef = useRef(onReady);
  useLayoutEffect(() => {
    onPickRef.current = onPick;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const created = createDiffScene(host, {
      onPick: (n) => onPickRef.current(n),
      ariaLabel,
    });
    setScene(created);
    onReadyRef.current(created);
    return () => {
      onReadyRef.current(null);
      setScene(null);
      created.dispose();
    };
    // The aria label is fixed for the lifetime of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scene?.setOrtho(ortho);
  }, [scene, ortho]);
  useEffect(() => {
    scene?.setTool(tool);
  }, [scene, tool]);
  useEffect(() => {
    scene?.setPointSize(pointSize);
  }, [scene, pointSize]);
  useEffect(() => {
    scene?.setInput(input);
  }, [scene, input]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
