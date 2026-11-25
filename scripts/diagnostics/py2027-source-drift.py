"""Read-only PY2027 source-drift diagnostic. Never changes sources.json, public/data or the release gate.

Reports every registered archive digest (the release gate stops at the first mismatch), then can
rebuild the release from a candidate input directory with the unmodified build() and compare the
resolved outcomes with a reference shard tree, such as the published release.

  python3 scripts/diagnostics/py2027-source-drift.py --inputs DIR [--download] [--rebuild OUT] [--reference ROOT]
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("py2027_build", ROOT / "src/etl/py2027/build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def digest_report(directory, download):
    report = {}
    for key, source in build.RELEASE["files"].items():
        path = directory / (key + ".zip")
        if download:
            build.download(source["url"], path)
        actual = sha256(path)
        with zipfile.ZipFile(path) as archive:
            members = [{"name": i.filename, "size": i.file_size, "crc32": f"{i.CRC:08x}", "modified": "%04d-%02d-%02dT%02d:%02d:%02d" % i.date_time}
                       for i in archive.infolist()]
        report[key] = {"registered": source["sha256"], "actual": actual, "matches": actual == source["sha256"],
                       "bytes": path.stat().st_size, "members": members}
    for key, source in build.RELEASE["geography"].items():
        path = directory / (key + ".json")
        if download:
            build.download(source["publicUrl"], path)
        actual = sha256(path)
        report[key] = {"registeredObserved": source["observedFileSha256"], "actual": actual,
                       "bytesMatch": actual == source["observedFileSha256"]}
    return report


def resolved(root):
    """Map each ZIP/county pair to its rating area, plan tables and dental tables, independent of group numbering."""
    tables = {"locations": {}, "plans": {}, "dental": {}, "zipToCounties": {}, "counties": {}}
    for path in sorted((root / str(build.YEAR)).glob("[0-9]*.json")):
        shard = json.loads(path.read_text())
        market = shard["market"]
        tables["zipToCounties"].update(shard["zipToCounties"])
        for name in ("counties", "plans", "dental"):
            tables[name].update(market[name])
        for z, by_county in market["locations"].items():
            for fips, group in by_county.items():
                g = market["groups"][group]
                tables["locations"][f"{z}/{fips}"] = [g["ratingAreaId"], g["plans"], g["dental"]]
    return tables


def compare(reference, candidate):
    before, after = resolved(reference), resolved(candidate)
    result = {}
    for name in before:
        a, b = before[name], after[name]
        changed = sorted(k for k in a.keys() & b.keys() if a[k] != b[k])
        result[name] = {"reference": len(a), "candidate": len(b), "removed": sorted(a.keys() - b.keys())[:20],
                        "added": sorted(b.keys() - a.keys())[:20], "changed": len(changed),
                        "changedSamples": [{"key": k, "reference": a[k], "candidate": b[k]} for k in changed[:10]]}
    strip = lambda p: {k: v for k, v in json.loads(p.read_text()).items() if k != "generated"}
    result["indexEqualExcludingGenerated"] = (strip(reference / str(build.YEAR) / "index.json")
                                              == strip(candidate / str(build.YEAR) / "index.json"))
    result["outcomeDeltas"] = sum(len(v["removed"]) + len(v["added"]) + v["changed"]
                                  for v in result.values() if isinstance(v, dict))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", type=Path, required=True, help="directory holding the six archives and two geography files")
    parser.add_argument("--download", action="store_true", help="fetch the registered URLs into --inputs first")
    parser.add_argument("--rebuild", type=Path, help="write a diagnostic build here, skipping only the raw archive digest gate")
    parser.add_argument("--reference", type=Path, help="shard root (containing 2027/) to compare the rebuild against")
    args = parser.parse_args()
    args.inputs.mkdir(parents=True, exist_ok=True)
    output = {"digests": digest_report(args.inputs, args.download)}
    if args.rebuild:
        if (args.rebuild / str(build.YEAR)).exists():
            sys.exit(f"{args.rebuild} already contains {build.YEAR}; choose an empty directory")
        with contextlib.redirect_stdout(sys.stderr):
            build.build(args.inputs, args.rebuild)
        if args.reference:
            output["comparison"] = compare(args.reference, args.rebuild)
    print(json.dumps(output, indent=1))
