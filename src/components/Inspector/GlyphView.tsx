import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore } from '../../state/store';
import { readToken } from '../../theme/readToken';
import {
  buildChildCloud,
  centerChildCloud,
  childCloudPositions,
  childRadius,
} from '../../viewer/ChildOverlay';
import { cssToRgb } from '../../viewer/colors';
import { buildLmTriad, buildSmGlyph, disposeObject } from '../../viewer/Glyphs';
import { useViewer } from '../../viewer/sceneRegistry';

export const GLYPH_W = 320;
export const GLYPH_H = 176;
const FOV = 35;
/** Child preview radius relative to the unit triad (uniform scale; orientation unchanged). */
const CHILD_PREVIEW_RADIUS = 1.2;

export type GlyphContent =
  | { kind: 'sm'; row9: readonly number[]; fullyDefined: boolean }
  | { kind: 'lm'; row9: readonly number[]; child: ObjectGraph | null };

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  glyphGroup: THREE.Group;
  d: number;
}

function buildContent(content: GlyphContent): THREE.Group {
  const g = new THREE.Group();
  if (content.kind === 'sm') {
    g.add(buildSmGlyph(content.row9, content.fullyDefined, 1));
    return g;
  }
  g.add(buildLmTriad(content.row9, 1));
  const child = content.child;
  if (child) {
    const cloud = buildChildCloud(child);
    if (cloud) {
      const r = childRadius(child, childCloudPositions(child));
      centerChildCloud(cloud, content.row9, child.centroid, CHILD_PREVIEW_RADIUS / r);
      g.add(cloud);
    }
  }
  return g;
}

/** Fit the glyph camera distance / clip planes to the content (spec "Glyph sync"). */
function fitCamera(c: Ctx) {
  const q = c.glyphGroup.quaternion.clone();
  c.glyphGroup.quaternion.identity();
  c.glyphGroup.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c.glyphGroup);
  c.glyphGroup.quaternion.copy(q);
  let r = 0;
  if (!box.isEmpty()) {
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) r = Math.max(r, Math.hypot(x, y, z));
  }
  if (!Number.isFinite(r) || r < 1e-6) r = 1;
  const d = (1.15 * r) / Math.sin(THREE.MathUtils.degToRad(FOV / 2));
  c.d = d;
  c.camera.near = Math.max(d - 2 * r, d * 0.01);
  c.camera.far = d + 2 * r;
  c.camera.updateProjectionMatrix();
}

/**
 * Small three.js preview of the active node's pose glyph (SM: normal + curvature directions on a
 * disk; LM: child-axes triad + centered child cloud). Its camera orientation and position follow
 * the main viewport camera every frame, and it applies the same object rotation, so it matches
 * the in-viewport glyph. Renders a placeholder while no viewer is registered.
 */
export function GlyphView({
  content,
  caption,
}: {
  content: GlyphContent | null;
  caption: ReactNode;
}) {
  const viewer = useViewer();
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);

  // Renderer lifetime = mount lifetime. The canvas is created here (not in JSX) so that every
  // mount gets a fresh canvas: a canvas keeps its (force-lost) context, so reusing a DOM canvas
  // across remounts would hand the next renderer a dead context.
  useEffect(() => {
    const host = hostRef.current;
    if (!viewer || !host) return;
    const canvas = document.createElement('canvas');
    canvas.width = GLYPH_W;
    canvas.height = GLYPH_H;
    canvas.style.width = `${GLYPH_W}px`;
    canvas.style.height = `${GLYPH_H}px`;
    canvas.style.display = 'block';
    host.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(GLYPH_W, GLYPH_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, GLYPH_W / GLYPH_H, 0.01, 100);
    const glyphGroup = new THREE.Group();
    scene.add(glyphGroup);
    ctxRef.current = { renderer, scene, camera, glyphGroup, d: 5 };
    return () => {
      for (const child of [...glyphGroup.children]) disposeObject(child);
      renderer.dispose();
      // Release the GL context now rather than at GC time: switching SM/LM tabs remounts this
      // view, and browsers cap live WebGL contexts (Chrome evicts the oldest, which could be the
      // main viewport's).
      renderer.forceContextLoss();
      canvas.remove();
      ctxRef.current = null;
    };
  }, [viewer]);

  // Content (and theme colors): rebuilt one frame later so tokens reflect the current theme.
  useEffect(() => {
    if (!viewer) return;
    let built: THREE.Group | null = null;
    const id = requestAnimationFrame(() => {
      const c = ctxRef.current;
      if (!c) return;
      const [r, g, b] = cssToRgb(readToken('--viewport'));
      c.scene.background = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
      if (content) {
        built = buildContent(content);
        c.glyphGroup.add(built);
      }
      fitCamera(c);
    });
    return () => {
      cancelAnimationFrame(id);
      if (built) disposeObject(built);
    };
  }, [viewer, content, resolvedTheme]);

  // Follow the main camera (orientation and position about the origin) and the object rotation.
  useEffect(() => {
    if (!viewer) return;
    return viewer.onFrame(() => {
      const c = ctxRef.current;
      if (!c) return;
      const q = viewer.camera.quaternion; // active persp or ortho camera
      c.camera.quaternion.copy(q);
      c.camera.position.set(0, 0, c.d).applyQuaternion(q);
      c.glyphGroup.quaternion.copy(viewer.objectGroup.quaternion);
      c.renderer.render(c.scene, c.camera);
    });
  }, [viewer]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-viewport">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 px-3 pt-2">
        <div className="min-w-0 truncate text-[11px] text-muted">{caption}</div>
        <span className="flex shrink-0 items-center gap-1 rounded bg-accent-bg px-1.5 py-0.5 text-[10px] font-medium text-accent">
          <span aria-hidden="true">⟲</span> synced
        </span>
      </div>
      {viewer ? (
        <div
          ref={hostRef}
          style={{ width: GLYPH_W, height: GLYPH_H }}
          role="img"
          aria-label="Pose glyph synced to the viewport camera"
        />
      ) : (
        <div
          style={{ width: GLYPH_W, height: GLYPH_H }}
          className="flex items-center justify-center"
        >
          <span className="text-[11px] text-faint">Viewport not ready</span>
        </div>
      )}
    </div>
  );
}
