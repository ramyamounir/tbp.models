# WARNING: this script runs arbitrary code from the pickle (torch.load with weights_only=False).
# Only use it on model.pt files you produced yourself. Never run it on a file someone sent you;
# open untrusted files in the browser viewer instead, which never executes pickle code.
# Usage: /home/ramy/tbp/tbp.monty/.venv/bin/python scripts/dump_fixture.py <model.pt> <lm> <graph> > py.json
import hashlib
import json
import math
import os
import sys

import numpy as np
import torch


def num(v):
    v = float(v)
    return v if math.isfinite(v) else ("NaN" if math.isnan(v) else ("Infinity" if v > 0 else "-Infinity"))


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a, dtype="<f8").tobytes()).hexdigest()


path, lm, graph_id = sys.argv[1], int(sys.argv[2]), sys.argv[3]
sd = torch.load(path, weights_only=False, map_location="cpu")
out = {"model": os.path.basename(path), "lm": lm, "graph": graph_id, "channels": {}}
for ch, m in sorted(sd["lm_dict"][lm]["graph_memory"][graph_id].items()):
    g = m._graph
    pos = np.asarray(g.pos, dtype=np.float64).reshape(-1, 3)
    x = np.asarray(g.x, dtype=np.float64)
    x = x.reshape(pos.shape[0], -1)
    fm = {k: [int(v[0]), int(v[1])] for k, v in dict(g.feature_mapping).items()}
    if "node_ids" in fm:  # legacy: same normalization as monty.ts
        a, b = fm.pop("node_ids")
        x = np.delete(x, np.s_[a:b], axis=1)
        fm = {k: ([s - (b - a), e - (b - a)] if s >= b else [s, e]) for k, (s, e) in fm.items()}
    n, F = x.shape
    rows = [
        {"i": i, "pos": [num(v) for v in pos[i]], "x": [num(v) for v in x[i]]}
        for i in ((0, n // 2, n - 1) if n else ())
    ]
    out["channels"][ch] = {
        "n": n,
        "F": F,
        "features": dict(sorted(fm.items())),
        "nonFiniteRows": int((~np.isfinite(pos)).any(axis=1).sum()),
        "posSha256": sha(pos),
        "xSha256": sha(x),
        "rows": rows,
    }
print(json.dumps(out, indent=1))
