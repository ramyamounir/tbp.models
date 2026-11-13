"""Runs pickle code from <in.pt>, <out.pt> and every --copy-from file (out.pt contains content from all of them). Use only files you produced yourself.

Dev spot check of an exported model.pt against real torch.load (spec multi-file-edit-diff,
Phase 4b "Dev spot check"). Loads both files with torch.load(weights_only=False) and prints,
per LM, the graph_memory keys, graph_id_to_target, target_to_graph_id, each object model's
object_id and SHA-256 of pos / x, whether the untouched top-level keys compare equal, and the
connectivity matrices (for a ListConfig also each row's / element's metadata key and parent link).

Usage (in the Monty venv):
  /home/ramy/tbp/tbp.monty/.venv/bin/python scripts/check_export.py <in.pt> <out.pt> \
      [--copy-from other.pt:lm:name:destLm ...]
Only the file path part of --copy-from is used (to list the inputs about to be loaded); the
other edit flags of scripts/check_export.ts are accepted and ignored.
"""

import hashlib
import sys

import numpy as np
import torch

WARNING = (
    "Runs pickle code from <in.pt>, <out.pt> and every --copy-from file "
    "(out.pt contains content from all of them). Use only files you produced yourself."
)
MATRICES = ("lm_to_lm_matrix", "lm_to_lm_vote_matrix", "sm_to_lm_matrix")
UNTOUCHED = ("sm_dict", "motor_system_dict")


def sha(a):
    if a is None:
        return "-"
    if hasattr(a, "detach"):
        a = a.detach().cpu().numpy()
    return hashlib.sha256(np.ascontiguousarray(np.asarray(a, dtype=np.float64)).tobytes()).hexdigest()[:16]


def graph_fields(model):
    g = getattr(model, "_graph", None)
    if g is None:
        return None, None
    store = getattr(g, "_store", None)
    if store is not None:  # legacy torch_geometric Data
        m = getattr(store, "_mapping", {})
        return m.get("pos"), m.get("x")
    return getattr(g, "pos", None), getattr(g, "x", None)


def show_sets(d):
    return {k: sorted(v) if isinstance(v, (set, frozenset)) else v for k, v in (d or {}).items()}


def show_matrix(label, m):
    try:
        from omegaconf import ListConfig, OmegaConf
    except ImportError:  # omegaconf not installed
        ListConfig = None
    if ListConfig is not None and isinstance(m, ListConfig):
        print(f"  {label}: ListConfig {OmegaConf.to_container(m)}")
        for i in range(len(m)):
            row = m._get_node(i)
            keys = [row._get_node(j)._metadata.key for j in range(len(row))]
            parents = [row._get_node(j)._get_parent() is row for j in range(len(row))]
            print(
                f"    row {i}: key={row._metadata.key} parent_ok={row._get_parent() is m} "
                f"element_keys={keys} element_parents_ok={parents}"
            )
    else:
        print(f"  {label}: {m!r}")


def describe(path):
    print(f"== {path}")
    sd = torch.load(path, weights_only=False, map_location="cpu")
    for lm_id, lm in sd["lm_dict"].items():
        print(f" LM {lm_id!r}: keys {list(lm.keys())}")
        gm = lm.get("graph_memory", {})
        print(f"  graph_memory: {list(gm.keys())}")
        print(f"  graph_id_to_target: {show_sets(lm.get('graph_id_to_target'))}")
        print(f"  target_to_graph_id: {show_sets(lm.get('target_to_graph_id'))}")
        for gid, channels in gm.items():
            if not isinstance(channels, dict):
                print(f"   {gid!r}: {type(channels).__name__}")
                continue
            for ch, model in channels.items():
                pos, x = graph_fields(model)
                print(
                    f"   {gid!r} / {ch}: object_id={getattr(model, 'object_id', None)!r} "
                    f"pos={sha(pos)} x={sha(x)}"
                )
    for key in MATRICES:
        if key in sd:
            show_matrix(key, sd[key])
    return sd


def same(a, b):
    try:
        return bool(a == b)
    except Exception as err:  # e.g. ambiguous array comparison
        return f"not comparable ({type(err).__name__})"


def main():
    print(WARNING)
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    in_path, out_path = args[0], args[1]
    copy_from = []
    k = 2
    while k < len(args):
        if args[k] == "--copy-from" and k + 1 < len(args):
            copy_from.append(args[k + 1].rsplit(":", 3)[0])
            k += 2
        elif args[k] == "--add-lm":
            k += 1
        else:
            k += 2
    print(f"inputs: {in_path}, {out_path}" + "".join(f", {p}" for p in copy_from))
    a = describe(in_path)
    b = describe(out_path)
    for key in UNTOUCHED:
        if key in a or key in b:
            print(f"{key} equal: {same(a.get(key), b.get(key))}")


if __name__ == "__main__":
    main()
