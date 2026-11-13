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
   - **COLOR** tab (color points by): All, SM feature (`hsv` / `rgba`), LM feature (`object_id`, with a legend
     that decodes ids to child graph names), Channel source, Scalar feature (any component of any
     mapped feature, viridis). In the object_id and channel-source legends, drag a row's grip (or
     press ↑ / ↓ on it) to set color priority: where nodes overlap, the higher row is drawn on top.
     The eye button hides a row's nodes ("Show all" brings them back).
   - **DISPLAY** tab (display as): Points (every node a dot, with the point size slider, 1–32 px) or Edges:
     nodes of a 2D sensor-module channel are drawn as short segments along their detected edge
     tangent (the second `pose_vectors` row), the other nodes stay dots; edge length (% of the
     object radius) and edge width (px) are adjustable. Available when the graph has an SM channel
     with `edge_strength` / `coherence`.
     Below them: surface normals, center on centroid, dim nodes outside the selected channel.
4. Click a node to open the **inspector**: one tab per input channel. Channels store their nodes
   independently, so another channel's tab shows its node at this location: the nearest one
   within the **match radius** (slider; drawn as a sphere around the selected node; far left =
   exact matches only), or none. Then a pose glyph whose camera follows the viewport, and
   FEATURES / COLOR / DISPLAY tabs: the feature table (click a feature name to color the cloud by
   it) and, for LM-channel nodes, the coloring and display of the decoded child object in its
   preview (with its own legend and a ring at `location_rel_model`) and overlay. Also
   "Overlay child in viewport" (stays on while stepping with ‹ / › or ← / →) and
   **Open in LM k →** (the browser Back button returns to the parent graph).
5. **Screenshot** saves the viewport as PNG. "Copy as JSON" copies the node's values.

Keyboard: `R` rotate tool, `Esc` clear selection, `F` fit, `[` / `]` cycle inspector tabs,
`←` / `→` previous / next node, `↑` / `↓` / `Home` / `End` in the graph list.

The theme follows the OS setting; the top-bar toggle cycles light → dark → system. The theme
choice is the only thing the app stores (`localStorage` key `tbp-viewer-theme`).

Below 1100 px width the inspector becomes a bottom sheet; the sidebar can be hidden with the
top-left button. On phone widths (640 px and below) the sidebar opens as a drawer over the
viewport, and undo, redo, screenshot and the theme move into the top bar's `⋯` menu.

## Open files

- Several `model.pt` files can be open at once. **Open model…** (several files can be picked),
  the "Open another model.pt" row and dropping files anywhere add files and make the last one
  active; nothing is replaced. A repeated file name is shown as `model.pt (2)`.
- The sidebar **Open files** list shows each file's graph count, an amber dot for unsaved edits
  and a close button. Clicking a row switches the LM selector, graph list, breadcrumb, viewport
  and inspector to that file; each file remembers its own LM and graph.
- Closing a file with unsaved edits asks first; leaving or reloading the page with unsaved edits
  triggers the browser's leave confirmation. A non-blocking warning appears when the graph data
  of all open files exceeds 512 MB.

## Editing and export

Edits act on whole models (object graphs) and whole LMs, in memory; nothing is written until
export. Node data, sensor-module and motor-system state are never edited.

- **Models**: rename (`F2`, double-click or the row "⋯" menu), duplicate (`Ctrl D`, gets a
  `_copy` suffix), delete (`Del`), and **Copy to…** another LM of this file or any LM of another
  open file (also by dragging rows onto an LM button or a file row). `Ctrl`/`Cmd`+click and
  `Shift`+click select several rows. Name collisions are resolved with `_copy`, `_copy2`, …;
  nothing is overwritten. Edited rows carry a green (added) or amber (renamed) marker until export.
- **References**: renaming a model that other graphs reference through `object_id` offers
  "Update references" (on by default), which rewrites those ids with the encoding each reference
  already uses. Deleting a referenced model warns that its references will stop resolving.
  Copying a parent without its children offers to copy the children too.
- **LMs**: add (the "+" button), duplicate, delete (later LMs are renumbered down, as Monty
  numbers them) and copy all graphs to another LM.
- **Undo / redo** per file: top-bar buttons, `Ctrl`/`Cmd`+`Z`, `Ctrl`/`Cmd`+`Shift`+`Z`,
  `Ctrl Y`. Edits of a file run one at a time in order.
- **Export…** (top bar; the badge counts unsaved edits) exports the active file. The dialog shows
  the file name (default `<name>_edited.pt`), a before / after summary, and the edits since the
  file was opened or last exported (the most recent can be undone there, "Undo all" returns to the
  last exported state). Export runs in a Web Worker: it re-reads the original files, rebuilds the
  pickle through a lossless pickle tree (same container and protocol, untouched content written
  back unchanged in value), re-parses the result with the viewer's own loader and checks it
  against the edited view before the download starts. The opened files are never modified.
  Models copied from another file are read from that file at export time, so the source must
  still be readable on disk (it may be closed in the app).
- The export dialog warns when the file references Python classes or functions outside the usual
  Monty / numpy / torch / scipy / omegaconf set, and downloads only after "Download anyway". This
  is a heuristic: an exported file is a pickle that `torch.load` executes, and it is only as
  trustworthy as every file it took content from.
- Files with repeated dictionary keys, malformed tensor storage references, unusual zip layouts
  or pickle structures that cannot be re-encoded are refused with a message.

## Diff view

**Diff** in the top bar replaces the viewport and inspector with a visual comparison of two
models; the sidebar stays, so files and models can still be browsed. Toggling it off and on keeps
the slots, settings, view mode and selected node (the button shows a dot while a slot is set).

- **Slots A and B** take any model from any open file, including two models of the same file:
  drag a row onto a pane or the slot in its header, use "Send to diff slot ▸ A / B" in the row menu (or "Send
  to diff" in the bulk bar with two rows selected), or pick file, LM and model in **Settings**.
  A slot follows its model through renames, LM renumbering and their undo / redo, and empties
  when the model, its LM or its file goes away. Unreadable graphs cannot be put in a slot.
- **Node matching** (Settings): _nearest node in space_ (default; each A node is paired with the
  closest unpaired B node of the same channel within the position tolerance, deterministically)
  or _same row index_, optionally after aligning the centroids.
- **Tolerances**: node position (% of A's bounding radius, or metres for a single-point model),
  unmatched node count, `pose_vectors` (degrees per vector), `hsv` (hue circular), other numeric
  features (largest absolute difference), exact `pose_fully_defined` / `on_object`, and
  `object_id` by resolved model name. Strict / Default / Loose presets fill the table; each
  property can be left out. Settings last for the session.
- **Classes and colours**: equal (grey), changed (amber), only in A (red), only in B (green).
  Views: Overlay, Side by side (linked cameras), A only, B only. A legend in each pane lists the
  classes drawn there and toggles them; in Side by side each pane has its own.
- **Summary panel**: verdict ("Equal within tolerance" / "Different"), a histogram of the distance from each A
  node to its nearest B node with the tolerance marked, per-property share outside tolerance and
  largest difference (click a property to colour by it), structural differences (channels or
  features present in one model only, differing feature widths), and **Copy A / B to…**.
- **Node diff**: click a node in any view to compare it with its partner: both node ids, a pose
  glyph (A solid, B dashed) synced to the diff camera, and a Property / A / B / Δ table with the
  rows outside tolerance first and highlighted ("only differences" hides the rest).
- **Keys** while the diff view is open: `←` / `→` previous / next difference, `F` fit, `Esc`
  clears the node selection. Below 1100 px the panel becomes a bottom sheet that its "Summary" handle
  collapses to one row; on phone widths in portrait Side by side stacks the panes. In a short
  pane the legend starts as a one-row chip of counts; tap it to expand.

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

- **Fields export rewrites** (everything else, including `sm_dict`, `motor_system_dict`,
  configs, voxel grids and KD-trees, is written back unchanged):
  - `lm_dict` keys (the LM numbers shown in the viewer; a gap in the original keys stays a gap
    while that LM is empty) and each LM's `graph_memory` (entry order kept; renamed models stay in
    place, duplicates and copies are appended; keys of models that were not renamed keep their
    original type);
  - `graph_id_to_target` (the model's target set; a target equal to the old name is renamed with
    the model) and `target_to_graph_id`, rebuilt as its inverse;
  - each channel object model's `object_id` (set to the model's name when it equalled the old
    name);
  - `object_id` feature values in the `x` arrays of referencing graphs when "Update references"
    was chosen (inline numpy arrays or torch storages; C-contiguous loader-supported dtypes only);
  - `lm_to_lm_matrix`, `lm_to_lm_vote_matrix` and `sm_to_lm_matrix` after LM add / duplicate /
    delete, rebuilt from which original LM each exported LM came from (plain lists and omegaconf
    `ListConfig`, whose parent links and stored indices are renumbered); a matrix in another form
    is left unchanged with a warning in the export dialog.

  Tensors that share a storage still share one storage in the exported file, including in
  duplicated and copied models.

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

## License

[MIT](LICENSE). Not affiliated with or endorsed by the Thousand Brains Project; provided as-is, without warranty.
