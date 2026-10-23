#!/usr/bin/env python3
"""Cut YAMNet-sized windows, keep the ones with a call, and train a linear head.

Train and test are split by observation id, never by window.
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))
sys.path.insert(0, str(ROOT / "training" / "third_party" / "yamnet"))

import tensorflow as tf  # noqa: E402
import yamnet as yamnet_model  # noqa: E402
from params import Params  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from download_sounds import class_label as to_class  # noqa: E402

SR = 16000
PATCH = int(0.96 * SR)
HOP = int(0.48 * SR)
MAX_SECONDS = 18
MANIFEST = ROOT / "id-data" / "manifest.csv"
HEAD = ROOT / "models" / "id-head.json"
REPORT = ROOT / "training" / "accuracy.json"
PUBLIC_MANIFEST = ROOT / "data" / "training-manifest.csv"

# Expected call bands (Hz). Windows outside the band are dropped.
BANDS = {
    "pseudacris-crucifer": (2200, 4000), "pseudacris-feriarum": (1500, 4000),
    "pseudacris-collinsorum": (1800, 4500), "pseudacris-nigrita": (1800, 4500),
    "dryophytes-cinereus": (700, 2800), "dryophytes-chrysoscelis": (1200, 3500),
    "dryophytes-avivoca": (1500, 4000), "dryophytes-squirellus": (700, 3500),
    "dryophytes-gratiosus": (400, 2200), "dryophytes-femoralis": (1500, 7500),
    "gastrophryne-carolinensis": (1500, 5000),
    "lithobates-catesbeianus": (80, 700), "lithobates-clamitans": (100, 1600),
    "lithobates-sphenocephalus": (300, 2500), "lithobates-grylio": (80, 800),
    "lithobates-palustris": (200, 1800),
    "anaxyrus-terrestris": (1000, 3000), "anaxyrus-fowleri": (1400, 3400),
    "anaxyrus-americanus": (1100, 2600),
    "acris-gryllus": (2000, 7500), "acris-crepitans": (2500, 7500),
    "scaphiopus-holbrookii": (200, 1600),
    "neocurtilla-hexadactyla": (800, 3500), "neoscapteriscus-borellii": (1500, 4000),
    "velarifictorus-micado": (2500, 7500), "hapithus-saltator": (4000, 7500),
    "anaxipha-rosamacula": (5000, 7500), "oecanthus-latipennis": (1800, 5000),
    "oecanthus-argentinus": (1800, 5000), "gryllus-rubens": (3500, 6500),
    "pictonemobius-ambitiosus": (4500, 7500),
    "pterophylla-camellifolia": (2000, 7500),
    "microcentrum-retinerve": (3000, 7500), "microcentrum-rhombifolium": (3000, 7500),
    "orchelimum-pulchellum": (4000, 7500), "orchelimum-erythrocephalum": (4000, 7500),
    "neoconocephalus-triops": (5000, 7500),
    "neotibicen-robinsonianus": (2000, 7500), "neotibicen-tibicen": (2000, 7500),
    "neotibicen-pruinosus": (2000, 7500),
    "megatibicen-grossus": (1200, 7500), "megatibicen-pronotalis": (1200, 7500),
    "magicicada-tredecim": (800, 4500), "magicicada-tredecassini": (2000, 7500),
    "neocicada-hieroglyphica": (3000, 7500),
}
LUMP_NOTES = {
    "lump-oecanthus": "Broad-winged and prairie tree crickets are lumped. Their trills are very similar, and the prairie tree cricket has only a handful of commercial-safe recordings.",
    "lump-anglewing": "Lesser and greater anglewings are lumped. Both make sparse high ticks, and the lesser anglewing has very few recordings.",
    "lump-meadow-katydid": "Handsome and red-headed meadow katydids are lumped. Both have thin high songs and only a few commercial-safe recordings.",
    "lump-13-year-cicada": "Riley's and Cassin's 13-year cicadas are lumped. Choruses of the two often occur together and are hard to separate from a phone mic.",
}


def load_wav(path):
    import subprocess
    try:
        process = subprocess.run(
            ["ffmpeg", "-v", "error", "-t", str(MAX_SECONDS), "-i", str(path),
             "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
            capture_output=True, check=True,
        )
    except subprocess.CalledProcessError:
        return None
    if len(process.stdout) < SR:
        return None
    return np.frombuffer(process.stdout, np.int16).astype(np.float32) / 32768.0


def band_rms(window, f0, f1):
    spec = np.fft.rfft(window)
    freqs = np.fft.rfftfreq(len(window), 1 / SR)
    band = (freqs >= f0) & (freqs <= min(f1, 7500))
    spec2 = np.zeros_like(spec)
    spec2[band] = spec[band]
    filtered = np.fft.irfft(spec2, n=len(window))
    return float(np.sqrt(np.mean(filtered * filtered) + 1e-18))


def keep_starts(samples, species_id, role):
    if len(samples) < PATCH:
        return []
    starts = list(range(0, len(samples) - PATCH + 1, HOP))
    if role.startswith("background"):
        scored = []
        for start in starts:
            window = samples[start:start + PATCH]
            energy = float(np.sqrt(np.mean(window * window) + 1e-18))
            if energy > 0.01:
                scored.append((energy, start))
        scored.sort(reverse=True)
        return [start for _, start in scored[:4]]
    f0, f1 = BANDS[species_id]
    scored = []
    for start in starts:
        window = samples[start:start + PATCH]
        score = band_rms(window, f0, f1)
        peak = float(np.max(np.abs(window)))
        if score >= 0.008 and peak >= 0.02:
            scored.append((score, start))
    scored.sort(reverse=True)
    return [start for _, start in scored[:6]]


def main():
    rows = list(csv.DictReader(open(MANIFEST)))
    print("manifest rows", len(rows), flush=True)
    params = Params()
    model = yamnet_model.yamnet_frames_model(params)
    model.load_weights(str(Path("/tmp/yamnet.h5")))

    examples = []  # (class, obs_id, embedding)
    used_rows = []
    per_species_windows = defaultdict(int)
    per_species_obs = defaultdict(set)
    for index, row in enumerate(rows):
        path = ROOT / row["local_file"]
        if not path.exists():
            continue
        samples = load_wav(path)
        if samples is None:
            continue
        species_key = row["species_id"] if not row["role"].startswith("background") else row["species_id"]
        band_key = row["species_id"] if row["species_id"] in BANDS else None
        if row["role"] == "target" and band_key is None:
            continue
        starts = keep_starts(samples, band_key or row["species_id"], row["role"])
        if not starts:
            continue
        waveform = tf.constant(samples, dtype=tf.float32)
        _, embeddings, _ = model(waveform)
        embeddings = embeddings.numpy()
        # YAMNet patch i is centered on the same hop. Map our start index to a patch.
        for start in starts:
            patch = int(round(start / HOP))
            patch = min(max(patch, 0), len(embeddings) - 1)
            examples.append((row["class_label"], str(row["observation_id"]), embeddings[patch]))
            per_species_windows[row["species_id"]] += 1
        per_species_obs[row["species_id"]].add(str(row["observation_id"]))
        used_rows.append(row)
        if index % 25 == 0:
            print(f"embedded {index}/{len(rows)} examples {len(examples)}", flush=True)

    # observation-level split, stratified by class
    by_class_obs = defaultdict(set)
    for label, obs, _ in examples:
        by_class_obs[label].add(obs)
    rng = np.random.default_rng(23)
    test_obs = set()
    for label, obs_ids in by_class_obs.items():
        ids = sorted(obs_ids)
        if len(ids) < 4:
            continue
        hold = max(1, int(round(0.2 * len(ids))))
        hold = min(hold, len(ids) - 2)
        chosen = rng.choice(ids, size=hold, replace=False)
        test_obs.update(str(item) for item in chosen)

    x_train, y_train, x_test, y_test = [], [], [], []
    for label, obs, embedding in examples:
        if obs in test_obs:
            x_test.append(embedding)
            y_test.append(label)
        else:
            x_train.append(embedding)
            y_train.append(label)
    x_train = np.stack(x_train)
    x_test = np.stack(x_test) if x_test else np.zeros((0, x_train.shape[1]))
    print("train", len(y_train), "test", len(y_test), "classes", len(set(y_train)), flush=True)

    scaler = StandardScaler()
    x_train_s = scaler.fit_transform(x_train)
    x_test_s = scaler.transform(x_test) if len(y_test) else x_test
    clf = LogisticRegression(max_iter=400, class_weight="balanced", C=1.0)
    clf.fit(x_train_s, y_train)
    labels = list(clf.classes_)

    per_class = {}
    if len(y_test):
        pred = clf.predict(x_test_s)
        print("overall window accuracy", round(accuracy_score(y_test, pred), 3), flush=True)
        # also observation-level: majority vote
        obs_true = defaultdict(list)
        obs_pred = defaultdict(list)
        test_examples = [(label, obs, emb) for label, obs, emb in examples if obs in test_obs]
        test_pred = pred
        for (label, obs, _), guess in zip(test_examples, test_pred):
            obs_true[obs].append(label)
            obs_pred[obs].append(guess)
        # per class window recall
        for label in labels:
            mask = np.array(y_test) == label
            if mask.sum() == 0:
                per_class[label] = {"test_windows": 0, "window_recall": None, "obs_correct": None, "obs_total": 0}
                continue
            recall = float((test_pred[mask] == label).mean())
            obs_ids = [obs for obs, truths in obs_true.items() if truths and truths[0] == label]
            correct = 0
            for obs in obs_ids:
                votes = obs_pred[obs]
                top = max(set(votes), key=votes.count)
                correct += int(top == label)
            per_class[label] = {
                "test_windows": int(mask.sum()),
                "window_recall": round(recall, 3),
                "obs_correct": correct,
                "obs_total": len(obs_ids),
            }
            print(f"  {label:28} recall {recall:.2f} obs {correct}/{len(obs_ids)}", flush=True)

    species = json.load(open(ROOT / "data" / "species.json"))
    names = {item["id"]: item["common"] for item in species}
    members = defaultdict(list)
    for item in species:
        members[to_class(item["id"])].append(item["id"])
    members["background"] = []

    classes = []
    for index, label in enumerate(labels):
        obs_count = len(by_class_obs[label])
        unreliable = label != "background" and obs_count < 12
        classes.append({
            "id": label,
            "species": members.get(label, []),
            "unreliable": bool(unreliable and label != "background"),
            "lumpNote": LUMP_NOTES.get(label, ""),
            "observations": obs_count,
        })

    head = {
        "base": "YAMNet",
        "baseLicense": "Apache-2.0",
        "baseSource": "https://www.kaggle.com/models/google/yamnet",
        "sampleRate": SR,
        "patchSeconds": 0.96,
        "classes": classes,
        "mean": scaler.mean_.round(6).tolist(),
        "scale": np.maximum(scaler.scale_, 1e-6).round(6).tolist(),
        "weights": clf.coef_.round(6).tolist(),
        "bias": clf.intercept_.round(6).tolist(),
    }
    HEAD.write_text(json.dumps(head))
    counts = {
        "files": len(used_rows),
        "windows": len(examples),
        "train_windows": len(y_train),
        "test_windows": len(y_test),
        "per_species_files_used": {key: len(value) for key, value in per_species_obs.items()},
        "per_species_windows": dict(per_species_windows),
        "per_class": per_class,
        "overall_window_accuracy": round(float(accuracy_score(y_test, clf.predict(x_test_s))), 3) if len(y_test) else None,
        "species_without_windows": [
            item["id"] for item in species
            if item["id"] not in per_species_obs and to_class(item["id"]) not in by_class_obs
        ],
    }
    REPORT.write_text(json.dumps(counts, indent=2))
    # Public credit list: every downloaded file, without local paths.
    public_fields = [key for key in rows[0].keys() if key != "local_file"]
    with PUBLIC_MANIFEST.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=public_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row[key] for key in public_fields})
    print("wrote", HEAD, "and", PUBLIC_MANIFEST, flush=True)


if __name__ == "__main__":
    main()
