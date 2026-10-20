/**
 * Pose glyphs shared by the viewport overlay (Phase 3) and the inspector `GlyphView` (Phase 4),
 * so both are built by the same code. Every builder returns a group centered at the origin; the
 * caller positions it. Colors come from the design tokens (`readToken`) unless passed in.
 */
import * as THREE from 'three';
import { childRotation } from '../model/childPose';
import { readToken } from '../theme/readToken';
import { cssToRgb, type RGB } from './colors';

export interface GlyphColors {
  normal: string; // --glyph-normal
  curv1: string; // --glyph-curv1
  curv2: string; // --glyph-curv2
  axisX: string; // --axis-x
  axisY: string; // --axis-y
  axisZ: string; // --axis-z
  outline: string; // --muted (disk outline)
}

export function readGlyphColors(): GlyphColors {
  return {
    normal: readToken('--glyph-normal'),
    curv1: readToken('--glyph-curv1'),
    curv2: readToken('--glyph-curv2'),
    axisX: readToken('--axis-x'),
    axisY: readToken('--axis-y'),
    axisZ: readToken('--axis-z'),
    outline: readToken('--muted'),
  };
}

/** Glyph render order: above points, disk first then arrows. */
const RENDER_ORDER = 10;

function row(row9: ArrayLike<number>, k: number): THREE.Vector3 | null {
  const v = new THREE.Vector3(row9[3 * k], row9[3 * k + 1], row9[3 * k + 2]);
  const len = v.length();
  if (!Number.isFinite(len) || len < 1e-9) return null;
  return v.divideScalar(len);
}

function color(css: string): THREE.Color {
  const [r, g, b] = cssToRgb(css);
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

function overlayMaterial<M extends THREE.Material>(m: M): M {
  m.depthTest = false;
  m.depthWrite = false;
  m.transparent = true;
  return m;
}

function arrow(dir: THREE.Vector3, length: number, css: string): THREE.Group {
  const g = new THREE.Group();
  const c = color(css);
  const headLen = length * 0.22;
  const headW = length * 0.09;
  const shaft = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    dir.clone().multiplyScalar(length - headLen),
  ]);
  const line = new THREE.Line(shaft, overlayMaterial(new THREE.LineBasicMaterial({ color: c })));
  line.renderOrder = RENDER_ORDER + 1;
  g.add(line);
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(headW, headLen, 16).translate(0, -headLen / 2, 0),
    overlayMaterial(new THREE.MeshBasicMaterial({ color: c })),
  );
  cone.position.copy(dir).multiplyScalar(length);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  cone.renderOrder = RENDER_ORDER + 1;
  g.add(cone);
  return g;
}

/**
 * SM pose glyph: disk ⟂ normal, normal arrow, and the two curvature directions only when
 * `fullyDefined`. Rows of `row9` are `[normal, curv_dir_1, curv_dir_2]`, each normalized for
 * display. Returns an empty group when the normal is degenerate.
 */
export function buildSmGlyph(
  row9: ArrayLike<number>,
  fullyDefined: boolean,
  scale: number,
  colors: GlyphColors = readGlyphColors(),
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'sm-glyph';
  const n = row(row9, 0);
  if (!n) return g;
  const d1 = fullyDefined ? row(row9, 1) : null;
  const d2 = fullyDefined ? row(row9, 2) : null;

  // Disk in the plane ⟂ normal.
  const diskR = scale * 0.55;
  const disk = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(diskR, 48),
    overlayMaterial(
      new THREE.MeshBasicMaterial({
        color: color(colors.normal),
        opacity: 0.14,
        side: THREE.DoubleSide,
      }),
    ),
  );
  fill.renderOrder = RENDER_ORDER;
  const ring = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 48 }, (_, k) => {
        const a = (k / 48) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * diskR, Math.sin(a) * diskR, 0);
      }),
    ),
    overlayMaterial(new THREE.LineBasicMaterial({ color: color(colors.outline), opacity: 0.7 })),
  );
  ring.renderOrder = RENDER_ORDER;
  disk.add(fill, ring);
  disk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  g.add(disk);

  g.add(arrow(n, scale, colors.normal));
  if (d1) g.add(arrow(d1, scale * 0.8, colors.curv1));
  if (d2) g.add(arrow(d2, scale * 0.8, colors.curv2));
  return g;
}

/**
 * LM child-axes triad: x/y/z = `childRotation(row9)` applied to the unit axes (the columns of
 * `Mᵀ` = rows of `M`), normalized for display, colored `--axis-x/-y/-z`.
 */
export function buildLmTriad(
  row9: ArrayLike<number>,
  scale: number,
  colors: GlyphColors = readGlyphColors(),
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lm-triad';
  const R = childRotation(row9);
  const css = [colors.axisX, colors.axisY, colors.axisZ];
  const units = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ];
  units.forEach((u, k) => {
    const v = u.applyMatrix4(R);
    const len = v.length();
    if (!Number.isFinite(len) || len < 1e-9) return;
    g.add(arrow(v.divideScalar(len), scale, css[k]));
  });
  return g;
}

const ringVertex = /* glsl */ `
  uniform float size;
  uniform float pixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * pixelRatio;
  }
`;
const ringFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float dashed;
  uniform float fill;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float ring = smoothstep(0.66, 0.74, r) * (1.0 - smoothstep(0.92, 1.0, r));
    if (dashed > 0.5) {
      float a = atan(d.y, d.x) / 6.2831853 + 0.5;
      ring *= step(fract(a * 12.0), 0.55);
    }
    float alpha = max(ring, fill * (1.0 - step(0.7, r)));
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

/**
 * Screen-space ring marker (a one-vertex `Points` at the origin; constant pixel size in both
 * cameras). Used for the selection ring, the hover highlight and the Phase 4 dashed
 * active-node marker. Drawn without depth test above everything else.
 */
export function buildRingMarker(opts: {
  color: RGB;
  sizePx: number;
  pixelRatio: number;
  opacity?: number;
  dashed?: boolean;
  fill?: number;
}): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    uniforms: {
      color: { value: new THREE.Vector3(...opts.color) },
      opacity: { value: opts.opacity ?? 1 },
      size: { value: opts.sizePx },
      pixelRatio: { value: opts.pixelRatio },
      dashed: { value: opts.dashed ? 1 : 0 },
      fill: { value: opts.fill ?? 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const p = new THREE.Points(geometry, material);
  p.renderOrder = RENDER_ORDER + 5;
  p.frustumCulled = false;
  p.raycast = () => {}; // never pickable
  return p;
}

/** Dispose every geometry / material / texture under `obj` and detach it. */
export function disposeObject(obj: THREE.Object3D): void {
  obj.removeFromParent();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}
