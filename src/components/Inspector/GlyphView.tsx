import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../model/childPose';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore } from '../../state/store';
import { readToken } from '../../theme/readToken';
import {
  buildChildObject,
  centerChildCloud,
  childCloudPositions,
  childRadius,
  type ChildLook,
} from '../../viewer/ChildOverlay';
import { cssToRgb } from '../../viewer/colors';
import { buildLmTriad, buildRingMarker, buildSmGlyph, disposeObject } from '../../viewer/Glyphs';
import { useViewer } from '../../viewer/sceneRegistry';

export const GLYPH_W = 320;
export const GLYPH_H = 176;
const FOV = 35;
/** Child preview radius relative to the unit triad (uniform scale; orientation unchanged). */
const CHILD_PREVIEW_RADIUS = 1.2;
/** `location_rel_model` ring: diameter in CSS px, and the extra px it grows to while pulsing. */
const ANCHOR_RING_PX = 18;
const ANCHOR_PULSE_PX = 8;

export type GlyphContent =
  | { kind: 'sm'; row9: readonly number[]; fullyDefined: boolean }
  | {
      kind: 'lm';
      row9: readonly number[];
      /** The child object, drawn as set in the inspector COLOR and DISPLAY tabs. */
      child: { graph: ObjectGraph; look: ChildLook } | null;
      /** The node's `location_rel_model` (child frame): ringed, and the triad is drawn from it. */
      anchor?: Vec3;
    };

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  glyphGroup: THREE.Group;
  d: number;
  /** `location_rel_model` ring (in glyphGroup), when shown. */
  ring: THREE.Points | null;
}

function buildContent(
  content: GlyphContent,
  pixelRatio: number,
): { group: THREE.Group; ring: THREE.Points | null } {
  const g = new THREE.Group();
  if (content.kind === 'sm') {
    g.add(buildSmGlyph(content.row9, content.fullyDefined, 1));
    return { group: g, ring: null };
  }
  const triad = buildLmTriad(content.row9, 1);
  g.add(triad);
  let ring: THREE.Points | null = null;
  if (content.child) {
    const { graph: child, look } = content.child;
    const cloud = buildChildObject(child, look, cssToRgb(readToken('--viewport')));
    if (cloud) {
      const r = childRadius(child, childCloudPositions(child));
      centerChildCloud(cloud, content.row9, child.centroid, CHILD_PREVIEW_RADIUS / r);
      g.add(cloud);
      if (content.anchor) {
        // l in the preview: the same transform as the cloud; the child axes start there.
        const at = new THREE.Vector3(...content.anchor).applyMatrix4(cloud.matrix);
        triad.position.copy(at);
        ring = buildRingMarker({
          color: cssToRgb(readToken('--select')),
          sizePx: ANCHOR_RING_PX,
          pixelRatio,
        });
        ring.name = 'location-rel-model';
        ring.position.copy(at);
        g.add(ring);
      }
    }
  }
  return { group: g, ring };
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
  anchorLabel,
  pulse = false,
  footer,
}: {
  content: GlyphContent | null;
  caption: ReactNode;
  /** Tag next to the `location_rel_model` ring (e.g. the node id). */
  anchorLabel?: string;
  /** Pulse the `location_rel_model` ring (its feature row is hovered). */
  pulse?: boolean;
  /** Strip along the bottom of the preview (child legend). */
  footer?: ReactNode;
}) {
  const viewer = useViewer();
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef(pulse);
  useEffect(() => {
    pulseRef.current = pulse;
  }, [pulse]);

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
    ctxRef.current = { renderer, scene, camera, glyphGroup, d: 5, ring: null };
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
        const b = buildContent(content, c.renderer.getPixelRatio());
        built = b.group;
        c.ring = b.ring;
        c.glyphGroup.add(built);
      }
      fitCamera(c);
    });
    return () => {
      cancelAnimationFrame(id);
      if (built) disposeObject(built);
      if (ctxRef.current) ctxRef.current.ring = null;
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
      placeAnchorTag(c, tagRef.current, pulseRef.current);
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
      {anchorLabel && (
        <div
          ref={tagRef}
          className="pointer-events-none absolute top-0 left-0 z-10 hidden rounded bg-text px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-panel"
        >
          <span className="font-semibold">{anchorLabel}</span>{' '}
          <span className="font-sans opacity-75">is here</span>
        </div>
      )}
      {footer && (
        <div className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-panel/90 px-3 py-1">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Pulse the `location_rel_model` ring and pin its tag above-left of it (right when it would leave
 * the preview); the tag is hidden while there is no ring or it is off-screen.
 */
function placeAnchorTag(c: Ctx, tag: HTMLDivElement | null, pulse: boolean) {
  const ring = c.ring;
  if (ring) {
    const mat = ring.material as THREE.ShaderMaterial;
    const t = performance.now() / 1000;
    mat.uniforms.size.value =
      ANCHOR_RING_PX + (pulse ? ANCHOR_PULSE_PX * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI)) : 0);
  }
  if (!tag) return;
  if (!ring) {
    tag.style.display = 'none';
    return;
  }
  const p = ring.getWorldPosition(new THREE.Vector3()).project(c.camera);
  if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1) {
    tag.style.display = 'none';
    return;
  }
  tag.style.display = 'block';
  const x = ((p.x + 1) / 2) * GLYPH_W;
  const y = ((1 - p.y) / 2) * GLYPH_H;
  const gap = ANCHOR_RING_PX / 2;
  const w = tag.offsetWidth;
  const h = tag.offsetHeight;
  const left = x - gap - w >= 4 ? x - gap - w : x + gap;
  const top = Math.max(4, y - gap - h);
  tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
