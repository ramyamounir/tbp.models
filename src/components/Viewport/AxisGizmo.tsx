import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useViewerStore } from '../../state/store';
import { readToken } from '../../theme/readToken';
import { cssToRgb } from '../../viewer/colors';
import { disposeObject } from '../../viewer/Glyphs';
import { useViewer } from '../../viewer/sceneRegistry';

const SIZE = 72;

function srgb(css: string): THREE.Color {
  const [r, g, b] = cssToRgb(css);
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
}

function labelSprite(text: string, css: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = css;
    ctx.font = '500 40px "JetBrains Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  s.scale.setScalar(0.42);
  return s;
}

/** Object axes x/y/z, colored with the `--axis-*` tokens. */
function buildAxes(): THREE.Group {
  const g = new THREE.Group();
  const axes: [THREE.Vector3, string, string][] = [
    [new THREE.Vector3(1, 0, 0), '--axis-x', 'x'],
    [new THREE.Vector3(0, 1, 0), '--axis-y', 'y'],
    [new THREE.Vector3(0, 0, 1), '--axis-z', 'z'],
  ];
  for (const [dir, token, name] of axes) {
    const css = readToken(token);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        dir.clone().multiplyScalar(0.8),
      ]),
      new THREE.LineBasicMaterial({ color: srgb(css) }),
    );
    g.add(line);
    const s = labelSprite(name, css);
    s.position.copy(dir).multiplyScalar(1.0);
    g.add(s);
  }
  return g;
}

/**
 * Axis gizmo (bottom-left): its own 72×72 canvas and orthographic scene, showing the object's
 * axes as seen by the main camera (rotation = camera⁻¹ · objectGroup). Not part of screenshots.
 */
export function AxisGizmo() {
  const viewer = useViewer();
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const hostRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    axes: THREE.Group | null;
  } | null>(null);

  // Renderer lifetime = component lifetime. The canvas is created here so each mount gets a
  // fresh one (a DOM canvas would keep the context force-lost in the previous cleanup).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    canvas.style.display = 'block';
    host.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, -10, 10);
    camera.position.set(0, 0, 5);
    ctxRef.current = { renderer, scene, camera, axes: null };
    return () => {
      const c = ctxRef.current;
      if (c?.axes) disposeObject(c.axes);
      renderer.dispose();
      renderer.forceContextLoss(); // release the GL context deterministically (see GlyphView)
      canvas.remove();
      ctxRef.current = null;
    };
  }, []);

  // Axis colors follow the theme (deferred one frame so the new tokens are applied).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const c = ctxRef.current;
      if (!c) return;
      if (c.axes) disposeObject(c.axes);
      c.axes = buildAxes();
      c.scene.add(c.axes);
      c.renderer.render(c.scene, c.camera);
    });
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  // Follow the main camera and object rotation every frame.
  useEffect(() => {
    if (!viewer) return;
    const q = new THREE.Quaternion();
    return viewer.onFrame(() => {
      const c = ctxRef.current;
      if (!c || !c.axes) return;
      q.copy(viewer.camera.quaternion).invert().multiply(viewer.objectGroup.quaternion);
      c.axes.quaternion.copy(q);
      c.renderer.render(c.scene, c.camera);
    });
  }, [viewer]);

  return (
    <div ref={hostRef} style={{ width: SIZE, height: SIZE }} aria-label="Axis gizmo" role="img" />
  );
}
