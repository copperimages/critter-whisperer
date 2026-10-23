#!/usr/bin/env python3
"""Download research-grade iNaturalist sounds licensed CC0, CC BY, or CC BY-SA.

Raw audio stays in id-data/ (gitignored). The manifest CSV is the public record.
Abundant species are capped so every species is represented without pulling
thousands of near-duplicate chorus files.
"""
import csv
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

UA = "CritterWhisperer/1.0 (commercial-safe sound-id training; copperimages@gmail.com)"
ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "id-data" / "audio"
MANIFEST = ROOT / "id-data" / "manifest.csv"
CAP = 40  # observations per target species
ALLOWED = {"cc0", "cc-by", "cc-by-sa"}
COLUMNS = [
    "species_id", "common_name", "class_label", "taxon_id", "observation_id",
    "sound_id", "recordist", "license", "source_url", "file_url", "date",
    "place", "role", "local_file",
]

# Near-identical callers share one class. Documented in training/README.md.
LUMPS = {
    "oecanthus-latipennis": "lump-oecanthus",
    "oecanthus-argentinus": "lump-oecanthus",
    "microcentrum-retinerve": "lump-anglewing",
    "microcentrum-rhombifolium": "lump-anglewing",
    "orchelimum-pulchellum": "lump-meadow-katydid",
    "orchelimum-erythrocephalum": "lump-meadow-katydid",
    "magicicada-tredecim": "lump-13-year-cicada",
    "magicicada-tredecassini": "lump-13-year-cicada",
}


def class_label(species_id):
    return LUMPS.get(species_id, species_id)


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1000:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as response:
        data = response.read(16_000_000)
    if len(data) < 2000:
        return False
    dest.write_bytes(data)
    return True


def fetch_observations(taxon_id, cap):
    found = []
    seen = set()
    for page in range(1, 8):
        if len(found) >= cap:
            break
        query = urllib.parse.urlencode({
            "taxon_id": taxon_id,
            "sounds": "true",
            "quality_grade": "research",
            "sound_license": "cc0,cc-by,cc-by-sa",
            "order_by": "votes",
            "per_page": 30,
            "page": page,
        })
        data = get_json("https://api.inaturalist.org/v1/observations?" + query)
        results = data.get("results") or []
        if not results:
            break
        for obs in results:
            if obs.get("id") in seen:
                continue
            tax = (obs.get("taxon") or {}).get("id")
            if tax != taxon_id:
                continue
            sounds = []
            for sound in obs.get("sounds") or []:
                lic = (sound.get("license_code") or "").lower()
                if lic in ALLOWED and sound.get("file_url"):
                    sounds.append(sound)
            if not sounds:
                continue
            seen.add(obs["id"])
            found.append((obs, sounds))
            if len(found) >= cap:
                break
        time.sleep(0.55)
    return found


def rows_for(species_id, common, taxon_id, role, cap):
    rows = []
    jobs = []
    observations = fetch_observations(taxon_id, cap)
    for obs, sounds in observations:
        user = obs.get("user") or {}
        recordist = user.get("name") or user.get("login") or "iNaturalist contributor"
        for sound in sounds:
            lic = (sound.get("license_code") or "").lower()
            ext = ".m4a"
            low = sound["file_url"].split("?")[0].lower()
            for candidate in (".wav", ".mp3", ".ogg", ".flac", ".mpga"):
                if low.endswith(candidate):
                    ext = ".mp3" if candidate == ".mpga" else candidate
                    break
            local = AUDIO / species_id / f"{obs['id']}-{sound.get('id')}{ext}"
            label = "background" if role != "target" else class_label(species_id)
            row = {
                "species_id": species_id,
                "common_name": common,
                "class_label": label,
                "taxon_id": taxon_id,
                "observation_id": obs["id"],
                "sound_id": sound.get("id"),
                "recordist": recordist,
                "license": {"cc0": "CC0", "cc-by": "CC-BY", "cc-by-sa": "CC-BY-SA"}[lic],
                "source_url": f"https://www.inaturalist.org/observations/{obs['id']}",
                "file_url": sound["file_url"],
                "date": obs.get("observed_on") or "",
                "place": obs.get("place_guess") or "",
                "role": role,
                "local_file": str(local.relative_to(ROOT)),
            }
            rows.append(row)
            jobs.append((sound["file_url"], local, row))
    return jobs


def commons_audio(query, role, limit=12):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"filetype:audio {query}",
        "gsrnamespace": 6,
        "gsrlimit": 20,
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|mime|size",
    })
    data = get_json(url)
    pages = (data.get("query") or {}).get("pages") or {}
    jobs = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        mime = info.get("mime") or ""
        if not (mime.startswith("audio") or mime in {"application/ogg", "application/ogg; codecs=vorbis"}):
            continue
        if (info.get("size") or 0) > 12_000_000:
            continue
        title = (page.get("title") or "").lower()
        if any(word in title for word in ("didgeridoo", "chime", "dove coo", "chiptune")):
            continue
        meta = info.get("extmetadata") or {}
        short = ((meta.get("LicenseShortName") or {}).get("value") or "").lower()
        if "nc" in short or "nd" in short:
            continue
        ok = ("cc0" in short) or ("public domain" in short) or (
            "cc by" in short and "nc" not in short and "nd" not in short
        )
        if not ok:
            continue
        artist = ((meta.get("Artist") or {}).get("value") or "Wikimedia Commons")
        artist = artist.replace("\n", " ")
        # strip simple tags
        while "<" in artist and ">" in artist:
            artist = artist[:artist.find("<")] + artist[artist.find(">") + 1:]
        artist = " ".join(artist.split())[:120] or "Wikimedia Commons"
        lic = "CC0" if ("cc0" in short or "public domain" in short) else (
            "CC-BY-SA" if "sa" in short else "CC-BY"
        )
        file_url = info.get("url")
        if not file_url:
            continue
        ext = Path(urllib.parse.urlparse(file_url).path).suffix.lower() or ".ogg"
        if ext not in {".wav", ".ogg", ".mp3", ".flac", ".oga"}:
            ext = ".ogg"
        title = page.get("title", "file").split(":", 1)[-1][:60].replace("/", "-")
        local = AUDIO / "background" / f"{role}-{page.get('pageid')}{ext}"
        row = {
            "species_id": f"background-{role}",
            "common_name": role,
            "class_label": "background",
            "taxon_id": "",
            "observation_id": f"commons-{page.get('pageid')}",
            "sound_id": page.get("pageid"),
            "recordist": artist,
            "license": lic,
            "source_url": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(page.get('title',''))}",
            "file_url": file_url,
            "date": ((meta.get("DateTimeOriginal") or {}).get("value") or "")[:10],
            "place": "",
            "role": f"background-{role}",
            "local_file": str(local.relative_to(ROOT)),
        }
        jobs.append((file_url, local, row))
        if len(jobs) >= limit:
            break
    return jobs


def main():
    species = json.load(open(ROOT / "data" / "species.json"))
    jobs = []
    for item in species:
        print(f"search {item['id']}", flush=True)
        try:
            jobs.extend(rows_for(item["id"], item["common"], item["inat_id"], "target", CAP))
        except Exception as error:
            print("  fail", item["id"], error, flush=True)
        print(f"  files {sum(1 for j in jobs if j[2]['species_id']==item['id'])}", flush=True)
    print("background birds", flush=True)
    birds = [
        ("background-cardinal", "Northern Cardinal", 9083),
        ("background-robin", "American Robin", 12727),
        ("background-bluejay", "Blue Jay", 8229),
        ("background-carolina-wren", "Carolina Wren", 7513),
    ]
    # taxon ids are checked; if a lookup is wrong the exact-id filter drops them
    for sid, common, tid in birds:
        try:
            jobs.extend(rows_for(sid, common, tid, "background-bird", 8))
        except Exception as error:
            print("  bird fail", sid, error, flush=True)
    for query, role in (("wind ambience", "wind"), ("road traffic", "traffic"), ("human speech", "speech")):
        print("commons", role, flush=True)
        try:
            jobs.extend(commons_audio(query, role, 10))
        except Exception as error:
            print("  commons fail", role, error, flush=True)
    print(f"downloading {len(jobs)} files", flush=True)

    def one(job):
        url, dest, row = job
        try:
            ok = download(url, dest)
        except Exception as error:
            print("  dl", row["observation_id"], error, flush=True)
            return None
        return row if ok else None

    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(one, job) for job in jobs]
        for future in as_completed(futures):
            row = future.result()
            if row:
                rows.append(row)
    rows.sort(key=lambda row: (row["species_id"], str(row["observation_id"])))
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    public = ROOT / "data" / "training-manifest.csv"
    public_fields = [key for key in COLUMNS if key != "local_file"]
    with public.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=public_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row[key] for key in public_fields})
    print("manifest", len(rows), "rows", MANIFEST)


if __name__ == "__main__":
    main()
