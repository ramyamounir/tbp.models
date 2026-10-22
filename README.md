# TBP Model Viewer

A browser-based viewer for [Monty](https://github.com/thousandbrainsproject/tbp.monty) pretrained
models (`model.pt`). Pick or drop a `model.pt` and the page parses it **locally in your browser**
(zip + pickle + tensor storages, in a Web Worker) and renders the stored object graphs with
three.js. Nothing is uploaded: the site is a set of static files and the hosting server never
receives model data.

## Usage

1. Open the site and click **Open model…** (or drop a `model.pt` anywhere on the page).
2. Choose a learning module (LM) and an object graph in the sidebar, or with the breadcrumb pickers
   (`model.pt › LM 1 › 002_cube_tbp_horz · 929 nodes`; click the LM or graph crumb).
3. Explore the graph:
   - **Viewport**: orbit / pan / pick / rotate-object tools (hold the middle mouse button to pan
     with any tool), Reset view, Fit, Ortho, axis gizmo, status pill with the input channels and
     their node counts.
   - **Object rotation**: x/y/z sliders or the rotate tool; points, normal glyphs and child overlays
     rotate together.
   - **Color points by**: All, SM feature (`hsv` / `rgba`), LM feature (`object_id`, with a legend
     that decodes ids to child graph names), Channel source, Scalar feature (any component of any
     mapped feature, viridis). In the object_id and channel-source legends, drag a row's grip (or
     press ↑ / ↓ on it) to set color priority: where nodes overlap, the higher row is drawn on top.
     The eye button hides a row's nodes ("Show all" brings them back).
   - **Display as**: Points (every node a dot, with the point size slider, 1–32 px) or Edges:
     nodes of a 2D sensor-module channel are drawn as short segments along their detected edge
     tangent (the second `pose_vectors` row), the other nodes stay dots; edge length (% of the
     object radius) and edge width (px) are adjustable. Available when the graph has an SM channel
     with `edge_strength` / `coherence`.
   - **Display**: surface normals, center on centroid, dim nodes outside the selected channel.
4. Click a node to open the **inspector**: one tab per input channel (other channels show the
   nearest node and its distance), a pose glyph whose camera follows the viewport, the feature
   table (click a feature name to color the cloud by it), and for LM-channel nodes the decoded child
   object, "Overlay child in viewport" and **Open in LM k →** (the browser Back button returns to
   the parent graph).
5. **Screenshot** saves the viewport as PNG. "Copy as JSON" copies the node's values.

Keyboard: `R` rotate tool, `Esc` clear selection, `F` fit, `[` / `]` cycle inspector tabs,
`←` / `→` previous / next node, `↑` / `↓` / `Home` / `End` in the graph list.

The theme follows the OS setting; the top-bar toggle cycles light → dark → system. The theme
choice is the only thing the app stores (`localStorage` key `tbp-viewer-theme`).

Below 1100 px width the inspector becomes a bottom sheet; the sidebar can be hidden with the
top-left button.

## Supported formats

| Format                      | `_graph` type                                                                                               | Notes                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GridObjectModel` (current) | `NumpyGraph` with `x` (float64), `pos` (float64), `feature_mapping`                                         |                                                           |
| `GraphObjectModel` (legacy) | `torch_geometric.data.Data` with `x` (float32), `pos`, `norm`, `edge_index`, `edge_attr`, `feature_mapping` | leading `node_ids` column is dropped; edges are not drawn |

- Zip containers with `model/` (current) or `archive/` (older) prefixes, STORED entries only
  (what `torch.save` writes), zip64 supported. `data.pkl` must be < 2 GiB.
- `feat.top_down` files (LM feature `location_rel_model`) load without special handling because
  features are always read through `feature_mapping`.
- `object_id` decoding supports both encodings: pre-v0.50 `sum(ord(c) for c in graph_id)` and v0.50+
  first 3 bytes of `sha256(graph_id)`. An id is resolved only against the LM named by the node's
  `learning_module_<s>` channel; an id shared by several graphs of that LM is shown as ambiguous and
  needs an explicit choice before overlaying or opening the child.
- A graph that fails validation is listed as unreadable (with the reason); the rest of the file
  still loads. Container, pickle or top-level structure errors show a readable error message.

### Model-format notes

- `model.pt` is a zip: `<prefix>/data.pkl` (protocol-2 pickle), `<prefix>/version`,
  `<prefix>/data/<key>` (raw little-endian tensor storages). Only `data.pkl` and the storages
  referenced by graph `pos` / `x` are read.
- State layout: `lm_dict[lm].graph_memory[graph_id][channel] = ObjectModel`; channels are
  `patch` / `patch_<i>` (sensor-module input) or `learning_module_<i>` (input from a lower LM).
- Feature columns come from `feature_mapping` (`{name: [start, end)}` into `x`). SM channels map
  `pose_vectors[0:9]` (rows: normal, curv_dir_1, curv_dir_2), `pose_fully_defined`, `on_object`,
  `object_coverage`, `hsv`, `principal_curvatures_log`, …; LM channels map `pose_vectors`
  (rows: child x/y/z axes in the parent frame), `pose_fully_defined`, `on_object`, `object_id` and,
  on `feat.top_down`, `location_rel_model`.
- All `pos` and `pose_vectors` of a graph share the parent object's model frame. A child-frame point
  `c` maps to the parent frame as `p = Mᵀ·c + t`, `M` = the LM node's `pose_vectors` as a row-major
  3×3, `t = node.pos − Mᵀ·location_rel_model` (or `− Mᵀ·child_centroid` when
  `location_rel_model` is absent; shown as "approximate placement").
- Large inline numpy payloads (e.g. `sm_dict[*].raw_observations`) are kept as unread zero-copy
  views of `data.pkl`; the pickle is never executed (closed class table, inert placeholders).
- **2D sensor modules** (`TwoDSensorModule`, `tbp.monty` `models/two_d_sensor_module.py`): the
  graph is planar (`pos = [u, v, 0]` in the module's tangent-plane frame) and, when the module
  extracts `edge_strength` / `coherence`, a node whose patch contains an edge stores
  `pose_vectors = [normal, edge_tangent, edge_perp]` with `normal = [0, 0, 1]` and
  `pose_fully_defined = 1`; nodes without an edge keep the curvature pose with
  `pose_fully_defined = 0`. "Display as: Edges" draws `p ± t̂ · len/2` along that tangent (as
  `tbp.teleop` `draw_2d_segments` does); the tangent is normalized because voxel averaging can
  shrink it. The inspector labels these rows `edge_tangent` / `edge_perp`.

## Development

Requires Node 24 / npm 11.

```sh
npm ci              # install exactly what package-lock.json pins
npm run dev         # dev server on http://127.0.0.1:5173 (loopback only; never pass --host)
npm test            # vitest unit tests
npm run lint
npx tsc -b          # type check
npm run build       # production build into dist/
npm run preview     # serve dist/ on http://127.0.0.1:4173
```

In dev builds the console logs the time from the file drop / pick to the first rendered frame.

Dev-only loader spot checks (never part of the build):

```sh
npx tsx scripts/check_loader.ts <model.pt>                     # one-line summary (sweep mode)
npx tsx scripts/check_loader.ts <model.pt> <lm> <graph> > ts.json
/path/to/tbp.monty/.venv/bin/python scripts/dump_fixture.py <model.pt> <lm> <graph> > py.json  # runs pickle code: own files only
python3 scripts/compare.py py.json ts.json [--tol 1e-7]
```

## Deployment

`npm run build` produces a self-contained static site in `dist/` (`index.html` + hashed assets,
including the loader worker chunk). It uses relative URLs (`base: './'`), so it works from any
static file server and from a sub-path. No server-side code, no COOP/COEP headers are needed.

- Serve **only** the contents of `dist/` (never the repo or a parent directory).
- Any host other than `localhost` must use **HTTPS** (secure context for `crypto.subtle` and the
  Clipboard API). Over plain HTTP the app still works in a degraded mode (bundled SHA-256, a
  selectable text box instead of the clipboard), but that is not a deployment target.
- `dist/index.html` carries a Content-Security-Policy `<meta>` (`default-src 'none'`,
  `connect-src 'self'`, no inline scripts). The app loads no CDN scripts, remote fonts or analytics.
- Recommended host headers (nginx: `add_header … always;`, `autoindex off`):
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: frame-ancestors 'none'` (a `<meta>` CSP cannot set `frame-ancestors`).

### GitHub Pages

`.github/workflows/pages.yml` builds and deploys `dist/` on pushes to `main` (and manual runs):
`npm ci`, `npm test`, `npm run build`, upload, deploy. Actions are pinned to commit SHAs and the
workflow has minimal permissions. Enable Pages with source "GitHub Actions" in the repository
settings. Pages cannot set custom headers, so the `<meta>` CSP is the only policy there.

## Performance

Measured 2026-10-20 on Linux (x86-64), production build served from `127.0.0.1`, headless
Chrome 148.0.7778.96 (SwiftShader WebGL). Load time = file chosen → first frame rendered.
Node figures are `parseModelFile` alone (Node 24.13).

| File                                            | Size   | Node parse | Chrome load (to first frame)                  | Peak memory                                                                                        |
| ----------------------------------------------- | ------ | ---------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `heterarch_3sm_composite/…stickers_comp_models` | 28 MB  | 73–101 ms  | 186 ms                                        | Node RSS 118 MB                                                                                    |
| `pretrained_ycb_v13/…logos_lvl1_comp_models`    | 7.5 MB | —          | 162–183 ms                                    | renderer RSS ≈ 315 MB (≈ idle)                                                                     |
| `everything_is_awesome_train/0`                 | 393 MB | 373 ms     | 354 ms                                        | Node RSS 912 MB (855 MB of it is Node's own `Blob` read of `data.pkl`); Chrome renderer RSS 551 MB |
| Firefox                                         | —      | —          | not measured (no automation driver available) | —                                                                                                  |

Peak memory for the browser is the largest RSS of any Chrome process sampled every 50 ms (the
loader worker lives in the renderer process), so short peaks may be missed.

## Verification

Best-effort checks from the final implementation phase (2026-10-20).

| Check                               | Command / method                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests, type check, lint, build | `npx vitest run`, `npx tsc -b`, `npm run lint`, `npm run build`                                                        | pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CSP build check                     | the five `grep` commands in the spec (Phase 1)                                                                         | print nothing (pass)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Loader sweep                        | `find /home/ramy/tbp/results/monty -name model.pt -print0 \| xargs -0 -n1 timeout 120 npx tsx scripts/check_loader.ts` | 202 files found (the spec expected 141; the extra files are experiment logs under `projects/`). All 136 files under `pretrained_models/` load with 0 unreadable graphs. 187/202 load overall; 15 fail: 12 eval-log files (`ParseError: SETITEM on non-dict`, a pickled `MotorSystemState` dict subclass in `motor_system_dict`), 1 × `data.pkl too large` (3.3 GB file, over the 2 GiB limit), 1 × `No data.pkl in the zip` (an incomplete file containing only `model/version`), 1 × `Not a zip file` for a 4.8 GB file (a Node `fs.openAsBlob` size overflow above 4 GiB in the script harness, not a loader bug; Python reads the zip fine) |
| Equality vs `torch.load`            | `dump_fixture.py` + `check_loader.ts` + `compare.py`                                                                   | legacy `mug` (tol 1e-7): exit 0; grid `002_cube_tbp_horz`: exit 0; 3-LM LM 2 `001_cube`: exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Parse timing (15–30 MB)             | sweep + headless Chrome                                                                                                | 28 MB file: 101 ms Node, 186 ms Chrome (target < 2 s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 393 MB file                         | Node + headless Chrome                                                                                                 | 373 ms Node parse, 354 ms Chrome load; no OOM (target < 10 s). Firefox not run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Serve check                         | `npm run preview`; `python3 -m http.server -b 127.0.0.1 -d dist`; `dist/` copied to `/viewer/` sub-path                | page, every asset, worker chunk and logo return 200 at root and sub-path; a model opens from the sub-path in headless Chrome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No-network check                    | headless Chrome via the DevTools protocol, file set with `DOM.setFileInputFiles`                                       | no foreign-origin request; after the initial page load only the worker chunk and a lazily used font file (both same-origin) are requested; no CSP violation; no console errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Edges mode                          | headless Chrome on `2d_sensor/learning_2d` (`021_logo_tbp`, 980/1,489 edge nodes) and the `_2d_children_3lm` model     | Edges draws the logo text as segments in light and dark mode with every color mode; Edges is disabled on the 3D `001_cube` graph (LM 0) and enabled on the 2D `021_logo_tbp` (LM 1); switching back to a 3D graph falls back to Points; no console errors                                                                                                                                                                                                                                                                                                                                                                                      |
| Glyph / inspector check             | headless Chrome screenshots on `002_cube_tbp_horz` (LM 1, logos model)                                                 | SM node: the inspector glyph stays centered and matches the viewport glyph after a horizontal orbit, an over-the-top orbit and the rotate tool; ortho toggle, slider rotation, channel tabs (nearest node + mm), dark mode, breadcrumb pickers, "Open in LM 0 →" and browser Back work. Not checked visually: a full 360° orbit and an LM-node viewport triad                                                                                                                                                                                                                                                                                  |
