"""Build the PY2027 ZIP/county release from the reviewed CMS publication (Python 3 stdlib)."""
import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import tempfile
import urllib.request
import time
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

HERE = Path(__file__).resolve().parent
RELEASE = json.loads((HERE / "sources.json").read_text())
YEAR = RELEASE["planYear"]
AGE_BUCKETS = range(14, 65)
DENTAL_BENEFITS = {"Dental Check-Up for Children", "Basic Dental Care - Child", "Major Dental Care - Child"}


def download(url, path):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as response, path.open("wb") as output:
                shutil.copyfileobj(response, output)
                length = response.headers.get("Content-Length")
                if length and output.tell() != int(length):
                    raise OSError("Incomplete CMS download")
            return
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def checked_inputs(directory, offline):
    for key, source in RELEASE["files"].items():
        path = directory / (key + ".zip")
        if not offline:
            download(source["url"], path)
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != source["sha256"]:
                raise ValueError(f"{key}: CMS source changed; reconcile against the Marketplace before release")
    for key, source in RELEASE["geography"].items():
        path = directory / (key + ".json")
        if offline:
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != source["observedFileSha256"]:
                    raise ValueError(f"{key}: offline snapshot differs from the registered original")
        else:
            download(source["publicUrl"], path)


def canonical_hash(rows):
    data = json.dumps(sorted(rows), ensure_ascii=True, separators=(",", ":")).encode("ascii")
    return hashlib.sha256(data).hexdigest()


@contextmanager
def table(directory, name, required):
    with zipfile.ZipFile(directory / (name + ".zip")) as archive:
        [member] = [p for p in archive.namelist() if p.lower().endswith(".csv")]
        with archive.open(member) as data, io.TextIOWrapper(data, encoding="utf-8-sig", newline="") as text:
            rows = csv.DictReader(text)
            if set(required) - set(rows.fieldnames or []):
                raise ValueError(f"{name}: required CMS columns are missing")
            yield rows


def landscape_rows(directory, name, wanted):
    """Stream the individual medical worksheet. Trim headers but retain ZIP/FIPS leading zeros."""
    with zipfile.ZipFile(directory / (name + ".zip")) as outer:
        [book] = [p for p in outer.namelist() if p.endswith(".xlsx")]
        with zipfile.ZipFile(io.BytesIO(outer.read(book))) as workbook:
            strings = ["".join(si.itertext()).strip() for si in ET.fromstring(workbook.read("xl/sharedStrings.xml"))]
            columns = {}
            with workbook.open("xl/worksheets/sheet1.xml") as sheet:
                for _, row in ET.iterparse(sheet, events=("end",)):
                    if not row.tag.endswith("}row"):
                        continue
                    values = {}
                    for cell in row:
                        col = cell.get("r", "").rstrip("0123456789")
                        if columns and col not in columns:
                            continue
                        value = cell.findtext("{*}v", "")
                        if value and cell.get("t") == "s":
                            value = strings[int(value)]
                        values[col] = value
                    if columns:
                        yield {name: values.get(col, "") for col, name in columns.items()}
                    elif wanted <= set(values.values()):
                        columns = {col: name for col, name in values.items() if name in wanted}
                    row.clear()
            if not columns:
                raise ValueError("Landscape headers changed")


def cents(raw):
    return int((Decimal(raw.strip().replace("$", "").replace(",", "")) * 100).quantize(1, ROUND_HALF_UP))


def medical_plans(directory):
    attrs = {}
    with table(directory, "attrs", ["PlanId", "ServiceAreaId", "EHBPercentTotalPremium", "CSRVariationType"]) as rows:
        for r in rows:
            if (r["BusinessYear"] != str(YEAR) or r["MarketCoverage"] != "Individual" or r["DentalOnlyPlan"] != "No"
                    or r["CSRVariationType"] != "Standard Silver On Exchange Plan" or r["MetalLevel"] != "Silver"):
                continue
            pid = r["StandardComponentId"]
            if r["PlanId"] != pid + "-01":
                raise ValueError(f"Unexpected on-exchange silver variant for {pid}")
            share = Decimal(r["EHBPercentTotalPremium"])
            if not 0 < share <= 1 or pid in attrs:
                raise ValueError(f"Invalid or duplicate standard silver plan {pid}")
            # Every silver filing in this release accepts both enrollment types. A new
            # type needs composition-specific Marketplace comparisons before publication.
            if r["ChildOnlyOffering"] != "Allows Adult and Child-Only":
                raise ValueError(f"Unverified silver household offering in {pid}: {r['ChildOnlyOffering']}")
            attrs[pid] = (r["IssuerId"], r["ServiceAreaId"], share)

    covered = defaultdict(set)
    with table(directory, "benefits", ["PlanId", "BenefitName", "IsCovered"]) as rows:
        for r in rows:
            if (r["BusinessYear"] == str(YEAR) and r["PlanId"] == r["StandardComponentId"] + "-01"
                    and r["StandardComponentId"] in attrs and r["BenefitName"] in DENTAL_BENEFITS and r["IsCovered"] == "Covered"):
                covered[r["StandardComponentId"]].add(r["BenefitName"])

    rates = defaultdict(dict)
    with table(directory, "rate", ["PlanId", "Age", "IndividualRate", "RatingAreaId", "RateEffectiveDate", "RateExpirationDate"]) as rows:
        for r in rows:
            pid = r["PlanId"]
            if pid not in attrs or r["BusinessYear"] != str(YEAR):
                continue
            # Individual QHP rates must cover the full policy year. Do not select a cheaper quarter.
            if r["RateEffectiveDate"] != f"{YEAR}-01-01" or r["RateExpirationDate"] != f"{YEAR}-12-31":
                continue
            age = {"0-14": "14", "64 and over": "64"}.get(r["Age"], r["Age"])
            if not age.isdigit() or int(age) not in AGE_BUCKETS:
                continue
            key = (pid, r["RatingAreaId"])
            amount = cents(r["IndividualRate"])
            if amount <= 0 or rates[key].setdefault(int(age), amount) != amount:
                raise ValueError(f"Conflicting filed rates: {key}, age {age}")
    return attrs, rates, covered


def service_areas(directory, dental=False):
    # Each key describes a whole state, a full county, or an explicit set of ZIPs.
    areas = defaultdict(dict)
    with table(directory, "service", ["IssuerId", "ServiceAreaId", "CoverEntireState", "County", "PartialCounty", "ZipCodes"]) as rows:
        for r in rows:
            if r["BusinessYear"] != str(YEAR) or r["MarketCoverage"] != "Individual" or r["DentalOnlyPlan"] != ("Yes" if dental else "No"):
                continue
            scope = areas[r["IssuerId"], r["ServiceAreaId"]]
            if r["CoverEntireState"] == "Yes":
                scope["*"] = None
            else:
                fips = r["County"]
                if not re.fullmatch(r"\d{5}", fips) or r["PartialCounty"] not in {"Yes", "No"}:
                    raise ValueError("Unrecognized CMS service area")
                if r["PartialCounty"] == "No":
                    scope[fips] = None
                else:
                    zips = {z.strip() for z in r["ZipCodes"].split(",")}
                    if not all(re.fullmatch(r"\d{5}", z) for z in zips):
                        raise ValueError(f"Invalid partial-county ZIPs in {fips}")
                    scope.setdefault(fips, set()).update(zips)
    return areas


def geography(directory):
    info = {}
    zips = defaultdict(set)
    for state in json.loads((directory / "county-zips.json").read_bytes()):
        for county in state["counties"]:
            fips = county["fips"]
            loc = (state["state"], county["name"])
            if not re.fullmatch(r"\d{5}", fips) or info.setdefault(fips, loc) != loc:
                raise ValueError(f"Invalid county in Marketplace geography: {fips}")
            for z in county["zips"]:
                if not re.fullmatch(r"\d{5}", z):
                    raise ValueError(f"Invalid Marketplace ZIP {z}")
                zips[z].add(fips)
    rating = defaultdict(set)
    for state in json.loads((directory / "rate-areas.json").read_bytes()):
        if state["type"] not in {"Combined", "Individual"}:
            continue
        for area in state["rateAreas"]:
            for county in area["counties"]:
                for z in county["zips"] or []:
                    fips = county["fips"]
                    if fips in zips.get(z, ()) and info[fips][0] == state["state"]:
                        rating[z, fips].add("Rating Area " + str(area["rateArea"]))
    digests = {
        "county-zips": canonical_hash((z, f, *info[f]) for z, fs in zips.items() for f in fs),
        "rate-areas": canonical_hash((z, f, a) for (z, f), areas in rating.items() for a in areas),
    }
    for key, actual in digests.items():
        if RELEASE["geography"][key]["canonicalSha256"] != actual:
            raise ValueError(f"{key}: Marketplace geographic relationships have changed; review the new release")
    return info, zips, rating


def load_landscape(directory):
    counties = {}
    offers = defaultdict(lambda: defaultdict(dict))
    wanted = {"State Code", "FIPS County Code", "Metal Level", "Plan ID (Standard Component)",
              "Rating Area", "EHB Percent of Total Premium", "Premium Adult Individual Age 40"}
    for r in landscape_rows(directory, "landscape", wanted):
        fips = r["FIPS County Code"].zfill(5)
        if not re.fullmatch(r"\d{5}", fips) or fips == "00000":
            raise ValueError("Invalid county in landscape")
        counties[fips] = r["State Code"]
        if r["Metal Level"] != "Silver":
            continue
        share = r["EHB Percent of Total Premium"]
        if not share.endswith("%"):
            raise ValueError("Unrecognized landscape EHB unit")
        entry = (cents(r["Premium Adult Individual Age 40"]), Decimal(share[:-1]) / 100)
        by_area = offers[fips][r["Plan ID (Standard Component)"]]
        if by_area.setdefault(r["Rating Area"], entry) != entry:
            raise ValueError(f"Conflicting landscape rows in {fips}")
    return counties, offers


def dental_plans(directory):
    attrs = {}
    with table(directory, "attrs", ["EHBPediatricDentalApportionmentQuantity", "StandardComponentId"]) as rows:
        for r in rows:
            if (r["BusinessYear"] == str(YEAR) and r["MarketCoverage"] == "Individual" and r["DentalOnlyPlan"] == "Yes"
                    and r["PlanId"] == r["StandardComponentId"] + "-01"):
                share = Decimal(r["EHBPediatricDentalApportionmentQuantity"])
                if not 0 < share <= 1 or r["IsGuaranteedRate"] != "Guaranteed Rate":
                    raise ValueError("Unverified pediatric dental apportionment or rate")
                attrs[r["StandardComponentId"]] = (r["IssuerId"], r["ServiceAreaId"], share)
    tables = defaultdict(dict)
    tier_fields = ("IndividualRate", "PrimarySubscriberAndOneDependent", "PrimarySubscriberAndTwoDependents",
                   "PrimarySubscriberAndThreeOrMoreDependents")
    with table(directory, "rate", tier_fields) as rows:
        for r in rows:
            pid = r["PlanId"]
            if (pid not in attrs or r["BusinessYear"] != str(YEAR) or r["RateEffectiveDate"] != f"{YEAR}-01-01"
                    or r["RateExpirationDate"] != f"{YEAR}-12-31"):
                continue
            rates = tables[pid, r["RatingAreaId"]]
            if r["Age"] == "Family Option":
                values = tuple(cents(r[k]) for k in tier_fields)
                if rates.setdefault("tiers", values) != values:
                    raise ValueError("Conflicting dental family tiers")
            elif r["Age"] in {"0-14", "15", "16", "17", "18"}:
                age = 14 if r["Age"] == "0-14" else int(r["Age"])
                value = cents(r["IndividualRate"])
                if rates.setdefault(age, value) != value:
                    raise ValueError("Conflicting dental age rates")

    offers = defaultdict(lambda: defaultdict(dict))
    wanted = {"FIPS County Code", "Plan ID (Standard Component)", "Rating Area", "Premium Child Age 0-14"}
    for r in landscape_rows(directory, "dental", wanted):
        pid = r["Plan ID (Standard Component)"]
        raw = r["Premium Child Age 0-14"]
        amount = cents(raw) if re.fullmatch(r"\$?[0-9,.]+", raw) else None
        offers[r["FIPS County Code"].zfill(5)][pid][r["Rating Area"]] = amount
    plans = {}
    for key, rates in tables.items():
        pid, _ = key
        if set(rates) == {"tiers"}:
            amounts = rates["tiers"]
            kind = "tiers"
        elif set(rates) == set(range(14, 19)):
            amounts = tuple(rates[age] for age in range(14, 19))
            kind = "ages"
        else:
            continue
        if min(amounts) <= 0:
            continue
        plans[key] = (amounts[0], {kind: [int((v * attrs[pid][2]).quantize(1, ROUND_HALF_UP)) for v in amounts]})
    return attrs, offers, plans


def local_service(plans, attributes, services, fips):
    local = {}
    for pid in plans:
        scope = services.get(attributes[pid][:2], {})
        if "*" in scope:
            local[pid] = None
        elif fips in scope:
            local[pid] = scope[fips]
    return local


def build(directory, output):
    print("Reading 2027 medical and dental PUFs and reconciling Marketplace geography", flush=True)
    attrs, rates, covered = medical_plans(directory)
    services = service_areas(directory)
    dental_attrs, dental_offers, dental = dental_plans(directory)
    dental_services = service_areas(directory, dental=True)
    geo, zips, ratings = geography(directory)
    counties, offers = load_landscape(directory)
    plans = {}
    for (pid, area), by_age in rates.items():
        if set(by_age) != set(AGE_BUCKETS):
            continue
        share = attrs[pid][2]
        plans[pid, area] = {
            "planId": pid,
            "cents": [int((by_age[age] * share).quantize(1, ROUND_HALF_UP)) for age in AGE_BUCKETS],
            "embeddedDental": covered[pid] == DENTAL_BENEFITS,
        }
    state_plans = defaultdict(list)
    for pid in attrs:
        state_plans[pid[5:7]].append(pid)

    state_dental = defaultdict(list)
    for pid in dental_attrs:
        state_dental[pid[5:7]].append(pid)
    county_areas = defaultdict(set)
    for (_, fips), areas in ratings.items():
        county_areas[fips].update(areas)
    groups = {}
    default_group = {}
    overrides = defaultdict(dict)
    errors = Counter()
    derived = set()
    prepared = set()
    # Every competing plan must join. Dropping an unpriced competitor changes the rank.
    for fips, state in sorted(counties.items()):
        local = offers[fips]
        service = local_service(state_plans[state], attrs, services, fips)
        dental_service = local_service(state_dental[state], dental_attrs, dental_services, fips)
        local_dental = dental_offers[fips]
        dental_agrees = set(dental_service) == set(local_dental)
        if set(service) != set(local):
            errors["service-landscape-plan-set"] += 1
            continue
        if not local:
            errors["no-source-silver"] += 1
            continue
        prepared.add(fips)
        areas = county_areas[fips] | {area for by_area in local.values() for area in by_area}
        partial = set().union(*(zs for zs in [*service.values(), *dental_service.values()] if zs is not None))
        for area in areas:
            def choose(z):
                eligible = tuple(sorted(p for p, zs in service.items() if zs is None or z in zs))
                if not eligible:
                    return None
                for pid in eligible:
                    if (pid, area) not in plans:
                        return None
                    # The Landscape lists a representative area in split counties. Reconcile all
                    # listed prices; the official ZIP/county rate-area file selects the local PUF table.
                    for listed, (gross, share) in local[pid].items():
                        if (rates.get((pid, listed), {}).get(40) != gross
                                or abs(share - attrs[pid][2]) > Decimal("0.00005")):
                            return None
                dental_ids = tuple(sorted(p for p, zs in dental_service.items() if zs is None or z in zs))
                if not dental_agrees or any((p, area) not in dental or
                        any(dental.get((p, listed), (None,))[0] != gross or gross is None
                            for listed, gross in local_dental[p].items()) for p in dental_ids):
                    dental_ids = ()
                identity = (area, eligible, dental_ids)
                if identity not in groups:
                    groups[identity] = str(len(groups))
                return groups[identity]
            base = choose(None)
            default_group[fips, area] = base
            for z in partial:
                choice = choose(z)
                if choice != base:
                    overrides[fips, area][z] = choice
                if choice is not None:
                    derived.add(fips)
            if base is not None:
                derived.add(fips)
        if fips not in derived:
            errors["rate-or-landscape-reconciliation"] += 1

    generated = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    lookup = {value: key for key, value in groups.items()}
    shards = {}
    reached = set()
    priced_pairs = 0
    priced_zips = set()
    missing_pairs = Counter()
    for z, candidates in sorted(zips.items()):
        prefix = z[:3]
        shard = shards.setdefault(prefix, {
            "planYear": YEAR, "generated": generated, "sourceFile": RELEASE["sourceFile"],
            "sourcePublished": RELEASE["ratePublished"], "zipToCounties": {}, "counties": {},
            "market": {"counties": {}, "locations": {}, "groups": {}, "plans": {}, "dental": {}},
        })
        market = shard["market"]
        shard["zipToCounties"][z] = sorted(candidates)
        for fips in sorted(candidates):
            state, name = geo[fips]
            market["counties"][fips] = {"stateCode": state, "countyName": name}
            if fips not in counties:
                missing_pairs["outside-landscape"] += 1
                continue
            if counties[fips] != state:
                raise ValueError(f"Conflicting state for {fips}")
            areas = ratings.get((z, fips), set())
            if len(areas) != 1:
                missing_pairs["missing-or-ambiguous-rating-area"] += 1
                continue
            area, = areas
            group = overrides[fips, area].get(z, default_group.get((fips, area)))
            if group is None:
                missing_pairs["unreconciled-silver-offer"] += 1
                continue
            reached.add(fips)
            priced_zips.add(z)
            priced_pairs += 1
            market["locations"].setdefault(z, {})[fips] = group
            if group not in market["groups"]:
                _, pids, dental_ids = lookup[group]
                keys = []
                for pid in pids:
                    key = pid + "/" + area.split()[-1]
                    keys.append(key)
                    market["plans"][key] = plans[pid, area]
                dental_keys = []
                for pid in dental_ids:
                    key = pid + "/" + area.split()[-1]
                    dental_keys.append(key)
                    market["dental"][key] = dental[pid, area][1]
                market["groups"][group] = {"ratingAreaId": area, "plans": keys, "dental": dental_keys}

    coverage = {
        "sourceCountyCount": len(counties), "silverSourceCounties": sum(bool(offers[f]) for f in counties),
        "serviceMatchedCounties": len(prepared), "countiesBuilt": len(derived),
        "crosswalkMatchedCounties": len(set(counties) & set(geo)), "reachableCounties": len(reached),
        "crosswalkZips": len(zips), "pricedZips": len(priced_zips), "pricedZipCountyPairs": priced_pairs,
        "crosswalkPairs": sum(map(len, zips.values())), "countyExclusions": dict(errors),
        "pairExclusions": dict(missing_pairs),
    }
    if (sum(errors.values()) + len(derived) != len(counties)
            or sum(missing_pairs.values()) + priced_pairs != coverage["crosswalkPairs"]):
        raise ValueError("Coverage stages did not reconcile")
    dest = output / str(YEAR)
    dest.mkdir(parents=True, exist_ok=True)
    for prefix, shard in shards.items():
        (dest / (prefix + ".json")).write_text(json.dumps(shard, separators=(",", ":")))
    index = {**coverage, "countiesSkipped": len(counties) - len(derived), "generated": generated, "planYear": YEAR,
             "shardCount": len(shards), "prefixes": sorted(shards), "shardsFailedValidation": 0}
    (dest / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(json.dumps(coverage, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--from-dir", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        directory = args.from_dir or Path(temp)
        checked_inputs(directory, bool(args.from_dir))
        build(directory, args.out)
