"""Compare the normalized JSON of scripts/dump_fixture.py and scripts/check_loader.ts.

Usage: python3 scripts/compare.py <py.json> <ts.json> [--tol T]
Exit 0 when equal, 1 with a per-field report otherwise (stdlib only).
"""

import argparse
import json
import sys

EXACT_FIELDS = ("n", "F", "features", "nonFiniteRows", "posSha256", "xSha256")


def values_equal(a, b, tol):
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    return abs(a - b) <= tol


def compare(py, ts, tol):
    problems = []
    for key in ("lm", "graph"):
        if py.get(key) != ts.get(key):
            problems.append(f"{key}: py={py.get(key)!r} ts={ts.get(key)!r}")
    pch, tch = py.get("channels", {}), ts.get("channels", {})
    if sorted(pch) != sorted(tch):
        problems.append(f"channel sets differ: py={sorted(pch)} ts={sorted(tch)}")
    for name in sorted(set(pch) & set(tch)):
        a, b = pch[name], tch[name]
        for field in EXACT_FIELDS:
            if a.get(field) != b.get(field):
                problems.append(f"{name}.{field}: py={a.get(field)!r} ts={b.get(field)!r}")
        ra, rb = a.get("rows", []), b.get("rows", [])
        if [r["i"] for r in ra] != [r["i"] for r in rb]:
            problems.append(f"{name}.rows indices: py={[r['i'] for r in ra]} ts={[r['i'] for r in rb]}")
            continue
        for x, y in zip(ra, rb):
            for field in ("pos", "x"):
                va, vb = x[field], y[field]
                if len(va) != len(vb):
                    problems.append(f"{name}.rows[i={x['i']}].{field}: length {len(va)} != {len(vb)}")
                    continue
                for k, (u, v) in enumerate(zip(va, vb)):
                    if not values_equal(u, v, tol):
                        problems.append(f"{name}.rows[i={x['i']}].{field}[{k}]: py={u!r} ts={v!r}")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("py_json")
    ap.add_argument("ts_json")
    ap.add_argument("--tol", type=float, default=0.0)
    args = ap.parse_args()
    with open(args.py_json) as f:
        py = json.load(f)
    with open(args.ts_json) as f:
        ts = json.load(f)
    problems = compare(py, ts, args.tol)
    if problems:
        print(f"MISMATCH ({len(problems)}):")
        for p in problems:
            print("  " + p)
        sys.exit(1)
    chans = ", ".join(f"{k} n={v['n']} F={v['F']}" for k, v in sorted(py["channels"].items()))
    print(f"OK: LM {py['lm']} {py['graph']}: {chans}")
    sys.exit(0)


if __name__ == "__main__":
    main()
