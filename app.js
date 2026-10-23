const GROUPS = [
  { id: "frogs", name: "Frogs & toads" },
  { id: "crickets", name: "Crickets" },
  { id: "cicadas", name: "Cicadas" },
  { id: "katydids", name: "Katydids" }
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const app = document.getElementById("app");
const live = document.getElementById("live");
const audio = new Audio();
let species = [];
let order = [];
let playingKey = null;
let wantPlay = false;
let query = "";

audio.preload = "none";
audio.addEventListener("ended", () => {
  playingKey = null;
  wantPlay = false;
  syncPlayButtons();
  live.textContent = "Playback finished";
});

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[ch]));

const prettyLicense = (value) => String(value || "")
  .replaceAll("CC-BY-NC-ND", "CC BY-NC-ND")
  .replaceAll("CC-BY-NC-SA", "CC BY-NC-SA")
  .replaceAll("CC-BY-ND", "CC BY-ND")
  .replaceAll("CC-BY-SA", "CC BY-SA")
  .replaceAll("CC-BY-NC", "CC BY-NC")
  .replaceAll("CC-BY", "CC BY");

function orderedSpecies() {
  const map = new Map(species.map((item) => [item.id, item]));
  const list = [];
  order.forEach((id) => {
    if (map.has(id)) list.push(map.get(id));
  });
  species.forEach((item) => {
    if (!order.includes(item.id)) list.push(item);
  });
  return list;
}

function inGroup(id) {
  return orderedSpecies().filter((item) => item.group === id);
}

function findSpecies(id) {
  return species.find((item) => item.id === id);
}

function groupOf(id) {
  return GROUPS.find((group) => group.id === id);
}

function groupPhoto(id) {
  const match = inGroup(id).find((item) => item.photo && item.photo.url);
  return match ? match.photo.url : "";
}

function firstSound(item) {
  return (item.sounds || [])[0] || null;
}

function playIcon(on) {
  if (on) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
}

function thumb(item) {
  if (item.photo && item.photo.url) {
    return `<img class="thumb" src="${esc(item.photo.url)}" alt="">`;
  }
  const letter = esc((item.common || "?").slice(0, 1));
  return `<span class="thumb-ph" aria-hidden="true">${letter}</span>`;
}

function searchBox() {
  return `<form class="search-wrap" role="search" id="searchform">
    <label class="sr-only" for="q">Search by name</label>
    <input class="search" id="q" type="search" placeholder="Search by name" autocomplete="off" enterkeyhint="search" value="${esc(query)}">
  </form>`;
}

function bindSearch() {
  const form = document.getElementById("searchform");
  const input = document.getElementById("q");
  if (!form || !input) return;
  form.addEventListener("submit", (event) => event.preventDefault());
  input.addEventListener("input", () => {
    query = input.value;
    const pos = input.selectionStart;
    renderView(false);
    const again = document.getElementById("q");
    if (again) {
      again.focus();
      again.setSelectionRange(pos, pos);
    }
  });
}

function row(item) {
  const sound = firstSound(item);
  const play = sound
    ? `<button type="button" class="play" data-play="${esc(sound.url)}" data-key="list:${esc(item.id)}" aria-label="Play ${esc(item.common)}" aria-pressed="false">${playIcon(false)}</button>`
    : `<button type="button" class="play" disabled aria-label="No recording for ${esc(item.common)}">${playIcon(false)}</button>`;
  return `<li class="row">
    <button type="button" class="row-open" data-open="${esc(item.id)}">
      ${thumb(item)}
      <span>
        <span class="common">${esc(item.common)}</span>
        <span class="sci">${esc(item.scientific)}</span>
      </span>
    </button>
    ${play}
  </li>`;
}

function monthLabel(item) {
  const values = MONTHS.map((_, index) => Number(item.months_AL?.[String(index + 1)] || 0));
  const max = Math.max(1, ...values);
  const top = MONTHS.filter((_, index) => values[index] >= max * 0.66);
  const when = top.length ? `Highest in ${top.join(", ")}.` : "Recorded in every season.";
  return `Months with iNaturalist records in Alabama. ${when}`;
}

function monthBars(item) {
  const values = MONTHS.map((_, index) => Number(item.months_AL?.[String(index + 1)] || 0));
  const max = Math.max(1, ...values);
  const bars = values.map((value, index) => {
    const height = Math.max(4, Math.round(64 * value / max));
    return `<div class="month"><span class="bar" style="height:${height}px"></span><small>${MONTH_LETTERS[index]}</small></div>`;
  }).join("");
  return `<div class="months" role="img" aria-label="${esc(monthLabel(item))}">${bars}</div>`;
}

function soundCredit(sound) {
  const bits = [sound.recordist, prettyLicense(sound.license)];
  if (sound.note) bits.push(sound.note);
  return bits.filter(Boolean).join(" · ");
}

function detail(item) {
  const summary = (item.summary || "").trim();
  const photo = item.photo && item.photo.url
    ? `<img class="hero" src="${esc(item.photo.url)}" alt="${esc(item.common)}">`
    : `<div class="hero-ph" role="img" aria-label=""></div>`;
  const photoLine = item.photo && item.photo.credit
    ? `<p class="photo-credit">${esc(item.photo.credit)}</p>`
    : "";
  const summaryHtml = summary
    ? `<p class="summary clamp" id="short-summary">${esc(summary)}</p>`
    : "";
  const wiki = item.wikipedia ? `<p><a href="${esc(item.wikipedia)}">Wikipedia</a></p>` : "";
  const photoMore = item.photo
    ? `<p>Photo: ${esc(item.photo.credit || "iNaturalist contributor")}
        ${item.photo.license ? ` (${esc(prettyLicense(item.photo.license))})` : ""}
        ${item.photo.source ? ` · <a href="${esc(item.photo.source)}">photo source</a>` : ""}</p>`
    : "";
  const soundMore = (item.sounds || []).map((sound, index) => `<p>Recording ${index + 1}: ${esc(sound.recordist || "Unknown")}
      (${esc(prettyLicense(sound.license))})${sound.date ? `, ${esc(sound.date)}` : ""}${sound.place ? `, ${esc(sound.place)}` : ""}
      ${sound.note ? `. ${esc(sound.note)}` : ""}
      ${sound.source ? ` · <a href="${esc(sound.source)}">iNaturalist</a>` : ""}</p>`).join("");
  const recordings = (item.sounds || []).map((sound, index) => `<li>
      <button type="button" class="rec" data-play="${esc(sound.url)}" data-key="detail:${esc(item.id)}:${index}" aria-pressed="false" aria-label="Play recording ${index + 1} by ${esc(sound.recordist || "unknown recordist")}">
        <span class="play" aria-hidden="true">${playIcon(false)}</span>
        <span>
          <span class="rec-title">Recording ${index + 1}</span>
          <span class="fine">${esc(soundCredit(sound))}</span>
        </span>
      </button>
    </li>`).join("");
  const recordingBlock = recordings
    ? `<h2>Recordings</h2><ul class="recs">${recordings}</ul>`
    : `<p class="empty">No recording yet.</p>`;
  return `<button type="button" class="back" data-back="#/g/${esc(item.group)}">Back</button>
    <article>
      <div class="hero-wrap">${photo}${photoLine}</div>
      <h1>${esc(item.common)}</h1>
      <p class="sci">${esc(item.scientific)}</p>
      ${summaryHtml}
      <button type="button" class="more" data-more aria-expanded="false" aria-controls="more-panel">More</button>
      <div class="extra" id="more-panel" hidden>
        ${summary ? `<p>${esc(summary)}</p>` : ""}
        ${wiki}
        ${photoMore}
        ${soundMore}
        <p>Month bars show iNaturalist observations in Alabama, not a formal calling calendar.</p>
      </div>
      <h2>In Alabama</h2>
      ${monthBars(item)}
      ${recordingBlock}
    </article>`;
}

const PATCH_16K = 15600;
let idModel = null;
let idHead = null;
let mic = null;
let listenGen = 0;

function concatArrayBuffers(buffers) {
  let total = 0;
  buffers.forEach((buffer) => { total += buffer.byteLength; });
  const out = new Uint8Array(total);
  let offset = 0;
  buffers.forEach((buffer) => {
    out.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return out.buffer;
}

async function cachedResponse(url) {
  const abs = new URL(url, location.href).href;
  const cache = await caches.open("critter-listen-v1");
  const hit = await cache.match(abs);
  if (hit) return hit;
  const response = await fetch(abs);
  if (!response.ok) throw new Error(url);
  await cache.put(abs, response.clone());
  return response;
}

async function ensureModels() {
  if (idModel && idHead) return;
  if (typeof tf === "undefined") throw new Error("TensorFlow.js did not load");
  const modelJSON = await (await cachedResponse("models/yamnet/model.json")).json();
  const specs = tf.io.getWeightSpecs(modelJSON.weightsManifest);
  const buffers = [];
  for (const group of modelJSON.weightsManifest) {
    for (const path of group.paths) {
      buffers.push(await (await cachedResponse("models/yamnet/" + path)).arrayBuffer());
    }
  }
  const artifacts = tf.io.getModelArtifactsForJSONSync(modelJSON, specs, concatArrayBuffers(buffers));
  idModel = await tf.loadGraphModel(tf.io.fromMemory(artifacts));
  idHead = await (await cachedResponse("models/id-head.json")).json();
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

function scoreEmbedding(embedding) {
  const z = embedding.map((value, index) => (value - idHead.mean[index]) / (idHead.scale[index] || 1e-6));
  const logits = idHead.bias.map((bias, classIndex) => {
    const weights = idHead.weights[classIndex];
    let sum = bias;
    for (let i = 0; i < z.length; i++) sum += weights[i] * z[i];
    return sum;
  });
  const probs = softmax(logits);
  return idHead.classes.map((cls, index) => ({ cls, p: probs[index] }));
}

async function embeddingOf(samples) {
  const waveform = tf.tensor1d(samples);
  const started = performance.now();
  let result;
  try {
    result = idModel.predict(waveform);
  } finally {
    waveform.dispose();
  }
  const ms = performance.now() - started;
  const tensors = result instanceof tf.Tensor ? [result] : Array.isArray(result) ? result : Object.values(result);
  const embTensor = tensors.find((tensor) => tensor.shape && tensor.shape[tensor.shape.length - 1] === 1024);
  if (!embTensor) {
    tensors.forEach((tensor) => tensor.dispose());
    throw new Error("The listener did not return an embedding");
  }
  const data = await embTensor.data();
  const dim = 1024;
  const patches = Math.floor(data.length / dim);
  const start = Math.max(0, patches - 1) * dim;
  const embedding = Array.from(data.slice(start, start + dim));
  tensors.forEach((tensor) => tensor.dispose());
  return { embedding, ms };
}

function resampleTo16k(samples, fromRate) {
  if (Math.abs(fromRate - 16000) < 1) return samples;
  const outLen = Math.max(1, Math.round(samples.length * 16000 / fromRate));
  const out = new Float32Array(outLen);
  const step = (samples.length - 1) / Math.max(outLen - 1, 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = samples[index] || 0;
    const b = samples[Math.min(index + 1, samples.length - 1)] || 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function identifySamples(samples) {
  await ensureModels();
  const audio = samples.length > PATCH_16K ? samples.subarray(samples.length - PATCH_16K) : samples;
  const padded = audio.length === PATCH_16K ? audio : (() => {
    const next = new Float32Array(PATCH_16K);
    next.set(audio, PATCH_16K - audio.length);
    return next;
  })();
  const { embedding, ms } = await embeddingOf(padded);
  return { rows: scoreEmbedding(embedding), ms };
}

function matchMarkup(row) {
  const pct = Math.max(1, Math.round(row.p * 100));
  const note = row.cls.lumpNote ? `<span class="match-meta">${esc(row.cls.lumpNote)}</span>` : "";
  const caution = row.cls.unreliable ? `<span class="match-meta">Few training recordings, so this match is less reliable.</span>` : "";
  const ids = row.cls.species && row.cls.species.length ? row.cls.species : [row.cls.id];
  return ids.map((id) => {
    const item = findSpecies(id);
    const name = item ? item.common : id;
    const photo = item && item.photo && item.photo.url
      ? `<img class="thumb" src="${esc(item.photo.url)}" alt="">`
      : `<span class="thumb-ph" aria-hidden="true">${esc(name.slice(0, 1))}</span>`;
    return `<li><a class="match" href="#/s/${esc(id)}">
      ${photo}
      <span>
        <span class="match-name">${esc(name)}</span>
        <span class="match-meta">${pct}% possible match</span>
        ${note}
        ${caution}
        <span class="meter" aria-hidden="true"><span style="width:${Math.min(pct, 100)}%"></span></span>
      </span>
    </a></li>`;
  }).join("");
}

function renderMatches(rows) {
  const host = document.getElementById("matches");
  if (!host) return;
  const animals = rows.filter((row) => row.cls.id !== "background").sort((a, b) => b.p - a.p);
  const background = rows.find((row) => row.cls.id === "background");
  const top = animals[0];
  const bg = background ? background.p : 0;
  if (!top || (top.p < 0.12 && bg >= top.p)) {
    host.innerHTML = `<li class="empty">No clear animal match.</li>`;
    live.textContent = "No clear animal match";
    return;
  }
  const shown = animals.filter((row, index) => index < 3 && (index === 0 || row.p >= 0.12));
  host.innerHTML = shown.map(matchMarkup).join("");
  const names = shown.map((row) => (row.cls.species || []).map((id) => {
    const item = findSpecies(id);
    return item ? item.common : id;
  }).join(" or ")).join(", ");
  live.textContent = `Possible match: ${names}`;
}

function listenView() {
  return `<button type="button" class="back" data-back="#/">Back</button>
    <h1>Listen</h1>
    <p class="listen-note">Possible matches, not a certain identification. The sound stays on this phone and is not uploaded.</p>
    <button type="button" class="listen-toggle" data-listen-toggle aria-pressed="false">Start listening</button>
    <p class="listen-status" id="listen-status">Tap start, then hold the phone near the animal.</p>
    <ul class="matches" id="matches"></ul>
    <p class="fine">Very high songs and very low grunts are harder for this listener. <button type="button" class="linkish" data-credits>How this works</button></p>`;
}

function stopListen() {
  listenGen += 1;
  if (!mic) return;
  mic.processor.onaudioprocess = null;
  try { mic.source.disconnect(); } catch (error) { /* already stopped */ }
  try { mic.processor.disconnect(); } catch (error) { /* already stopped */ }
  try { mic.mute.disconnect(); } catch (error) { /* already stopped */ }
  mic.stream.getTracks().forEach((track) => track.stop());
  mic.context.close();
  mic = null;
}

async function toggleListen() {
  const button = document.querySelector("[data-listen-toggle]");
  const status = document.getElementById("listen-status");
  if (mic) {
    stopListen();
    if (button) {
      button.textContent = "Start listening";
      button.classList.remove("is-on");
      button.setAttribute("aria-pressed", "false");
    }
    if (status) status.textContent = "Stopped.";
    live.textContent = "Stopped listening";
    return;
  }
  const gen = listenGen + 1;
  listenGen = gen;
  if (status) status.textContent = "Getting the listener ready…";
  try {
    await ensureModels();
    if (gen !== listenGen) return;
    stopAudio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    });
    if (gen !== listenGen) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    const rate = context.sampleRate;
    const need = Math.ceil(0.975 * rate);
    const hop = Math.ceil(0.48 * rate);
    let pending = new Float32Array(0);
    let since = hop;
    let busy = false;
    processor.onaudioprocess = (event) => {
      if (gen !== listenGen) return;
      const input = event.inputBuffer.getChannelData(0);
      const merged = new Float32Array(pending.length + input.length);
      merged.set(pending, 0);
      merged.set(input, pending.length);
      const keep = Math.min(merged.length, need + hop);
      pending = merged.slice(merged.length - keep);
      since += input.length;
      if (busy || pending.length < need || since < hop) return;
      since = 0;
      busy = true;
      const slice = pending.slice(pending.length - need);
      const samples = resampleTo16k(slice, rate);
      identifySamples(samples).then((scored) => {
        busy = false;
        if (gen !== listenGen) return;
        renderMatches(scored.rows);
        if (status) status.textContent = "Listening…";
      }).catch(() => { busy = false; });
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    mic = { stream, context, source, processor, mute };
    if (button) {
      button.textContent = "Stop listening";
      button.classList.add("is-on");
      button.setAttribute("aria-pressed", "true");
    }
    if (status) status.textContent = "Listening…";
    live.textContent = "Listening";
  } catch (error) {
    if (gen === listenGen) listenGen += 1;
    if (status) status.textContent = "The microphone is not available here. You can still open each animal and play its recordings.";
    live.textContent = "Microphone unavailable";
  }
}

window.critterIdentifySamples = identifySamples;

function credits() {
  const blocks = orderedSpecies().map((item) => {
    const sounds = (item.sounds || []).map((sound, index) => `Recording ${index + 1}: ${esc(sound.recordist || "Unknown")} (${esc(prettyLicense(sound.license))})${sound.note ? `, ${esc(sound.note)}` : ""}${sound.source ? ` · <a href="${esc(sound.source)}">source</a>` : ""}`).join("<br>");
    const photo = item.photo ? `<br>Photo: ${esc(item.photo.credit || "iNaturalist")} ${item.photo.source ? `<a href="${esc(item.photo.source)}">source</a>` : ""}` : "";
    return `<h2>${esc(item.common)}</h2><p class="fine">${sounds}${photo}</p>`;
  }).join("");
  return `<button type="button" class="back" data-back="#/">Back</button>
    <div class="credits">
      <h1>Credits</h1>
      <h2>Sound identification</h2>
      <p>Listen runs on this phone. Audio is not uploaded. A result is a possible match, not a certain identification.</p>
      <p>The listener is a small classifier trained on <a href="https://www.kaggle.com/models/google/yamnet">YAMNet</a> embeddings. YAMNet is a Google model under the Apache License 2.0. It hears from about 125 Hz to 7,500 Hz, so very low grunts and very high insect songs are harder to match. The model files in this app stay under that same Apache license.</p>
      <p>Google Perch 2.0 is also Apache 2.0 and allows commercial use (<a href="https://www.kaggle.com/models/google/bird-vocalization-classifier/tensorFlow2/perch_v2">model card</a>). Its published file is 410 MB, which is too large to load in a phone browser, so it is not included.</p>
      <p>Training sounds are research-grade iNaturalist recordings under CC0, CC BY, or CC BY-SA only, plus background clips of speech, traffic, wind, and common birds under those same licenses. Recordists, licenses, and links are in the <a href="data/training-manifest.csv">training manifest</a>. Abundant species were capped at 40 observations. Four pairs that sound alike share one match: broad-winged and prairie tree crickets, lesser and greater anglewings, handsome and red-headed meadow katydids, and Riley's and Cassin's 13-year cicadas.</p>
      <p>Sounds and photos come from iNaturalist contributors under the Creative Commons license on each item. Many are non-commercial only. Local recordings were given short fades and matched in level, with no noise reduction. Speech was cut only when it did not cover the call. Clips marked CC BY-NC-ND were not edited.</p>
      <p>Short descriptions are from Wikipedia and stay under CC BY-SA.</p>
      <p class="legal">© 2026 Rachael Aswege. Critter Whisperer™. All rights reserved for app design, text and code. Recordings and photos belong to their credited creators under their own licenses.</p>
      ${blocks}
    </div>`;
}

function home() {
  const cards = GROUPS.map((group) => {
    const count = inGroup(group.id).length;
    const photo = groupPhoto(group.id);
    const image = photo
      ? `<img src="${esc(photo)}" alt="">`
      : `<span class="ph" aria-hidden="true"></span>`;
    return `<button type="button" class="gcard" data-group="${esc(group.id)}" aria-label="${esc(group.name)}, ${count} species">
      ${image}
      <span class="gcard-text">
        <span class="gcard-name">${esc(group.name)}</span>
        <span class="gcard-count">${count} species</span>
      </span>
    </button>`;
  }).join("");
  return `<p class="kicker">Alabama</p>
    <h1>Critter Whisperer</h1>
    <p class="lede">Pick a group, or listen for a possible match.</p>
    <button type="button" class="listen-go" data-listen>Listen</button>
    ${searchBox()}
    <div class="groups">${cards}</div>
    <p class="foot"><button type="button" class="linkish" data-credits>Credits and licenses</button></p>
    <p class="legal">© 2026 Rachael Aswege. Critter Whisperer™.</p>`;
}

function groupView(id) {
  const group = groupOf(id);
  if (!group) return `<button type="button" class="back" data-back="#/">Back</button><h1>Group not found</h1>`;
  const items = inGroup(id);
  return `<button type="button" class="back" data-back="#/">Back</button>
    <h1 class="view-title">${esc(group.name)}</h1>
    ${searchBox()}
    <ul class="rows">${items.map(row).join("") || '<li class="empty">Nothing in this group.</li>'}</ul>`;
}

function searchView(query) {
  const q = query.toLowerCase();
  const items = orderedSpecies().filter((item) => `${item.common} ${item.scientific}`.toLowerCase().includes(q));
  return `<h1 class="view-title">Search</h1>
    ${searchBox()}
    <ul class="rows">${items.map(row).join("") || '<li class="empty">No matches.</li>'}</ul>`;
}

function screenFromHash() {
  const hash = (location.hash || "#/").replace(/^#/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "g" && parts[1]) return { name: "group", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "s" && parts[1]) return { name: "detail", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "credits") return { name: "credits" };
  if (parts[0] === "listen") return { name: "listen" };
  return { name: "home" };
}

function renderView(moveFocus) {
  const text = query.trim();
  const screen = text ? { name: "search", query: text } : screenFromHash();
  const view = document.getElementById("view");
  document.body.dataset.screen = screen.name;
  if (screen.name === "home") view.innerHTML = home();
  else if (screen.name === "group") view.innerHTML = groupView(screen.id);
  else if (screen.name === "detail") {
    const item = findSpecies(screen.id);
    view.innerHTML = item
      ? detail(item)
      : `<button type="button" class="back" data-back="#/">Back</button><h1>Not found</h1>`;
  }   else if (screen.name === "credits") view.innerHTML = credits();
  else if (screen.name === "listen") view.innerHTML = listenView();
  else view.innerHTML = searchView(screen.query);
  syncPlayButtons();
  bindSearch();
  if (moveFocus) {
    const heading = view.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
}

function shell() {
  app.innerHTML = `<div class="shell"><div id="view"></div></div>`;
  app.addEventListener("click", onClick);
  app.addEventListener("error", (event) => {
    const img = event.target;
    if (!img || img.tagName !== "IMG") return;
    const fallback = document.createElement("span");
    if (img.classList.contains("hero")) fallback.className = "hero-ph";
    else if (img.classList.contains("thumb")) fallback.className = "thumb-ph";
    else fallback.className = "ph";
    fallback.setAttribute("aria-hidden", "true");
    img.replaceWith(fallback);
  }, true);
  renderView(false);
}

function stopAudio() {
  wantPlay = false;
  playingKey = null;
  audio.pause();
  syncPlayButtons();
}

function syncPlayButtons() {
  document.querySelectorAll("[data-play]").forEach((button) => {
    const on = wantPlay && button.dataset.key === playingKey;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    const iconHost = button.classList.contains("play") ? button : button.querySelector(".play");
    if (iconHost) iconHost.innerHTML = playIcon(on);
  });
}

function togglePlay(url, key, label) {
  if (mic) stopListen();
  if (wantPlay && playingKey === key) {
    wantPlay = false;
    playingKey = null;
    audio.pause();
    syncPlayButtons();
    live.textContent = "Paused";
    return;
  }
  audio.pause();
  audio.src = url;
  playingKey = key;
  wantPlay = true;
  syncPlayButtons();
  live.textContent = `Playing ${label}`;
  const started = audio.play();
  if (started) {
    started.catch(() => {
      if (playingKey !== key) return;
      wantPlay = false;
      playingKey = null;
      syncPlayButtons();
      live.textContent = "Could not play that recording";
    });
  }
}

function go(hash) {
  query = "";
  if (location.hash === hash) {
    stopAudio();
    stopListen();
    renderView(true);
    return;
  }
  location.hash = hash;
}

function onClick(event) {
  const more = event.target.closest("[data-more]");
  if (more) {
    const panel = document.getElementById("more-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    more.setAttribute("aria-expanded", open ? "true" : "false");
    more.textContent = open ? "Less" : "More";
    const short = document.getElementById("short-summary");
    if (short) short.hidden = open;
    return;
  }
  const play = event.target.closest("[data-play]");
  if (play && !play.disabled) {
    const label = play.getAttribute("aria-label") || "recording";
    togglePlay(play.dataset.play, play.dataset.key, label.replace(/^Play\s+/i, ""));
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) {
    go(`#/s/${open.dataset.open}`);
    return;
  }
  const group = event.target.closest("[data-group]");
  if (group) {
    go(`#/g/${group.dataset.group}`);
    return;
  }
  if (event.target.closest("[data-credits]")) {
    go("#/credits");
    return;
  }
  if (event.target.closest("[data-listen]")) {
    go("#/listen");
    return;
  }
  if (event.target.closest("[data-listen-toggle]")) {
    toggleListen();
    return;
  }
  const back = event.target.closest("[data-back]");
  if (back) go(back.dataset.back);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const panel = document.getElementById("more-panel");
  const more = document.querySelector("[data-more]");
  if (panel && !panel.hidden) {
    panel.hidden = true;
    if (more) {
      more.setAttribute("aria-expanded", "false");
      more.textContent = "More";
      more.focus();
    }
    return;
  }
  const screen = screenFromHash();
  if (query) {
    query = "";
    renderView(false);
    return;
  }
  if (screen.name === "detail") {
    const item = findSpecies(screen.id);
    go(item ? `#/g/${item.group}` : "#/");
  } else if (screen.name !== "home") {
    go("#/");
  }
});

window.addEventListener("hashchange", () => {
  stopAudio();
  stopListen();
  renderView(true);
});

Promise.all([
  fetch("data/species.json").then((response) => response.json()),
  fetch("data/states.json").then((response) => response.json())
]).then(([loaded, states]) => {
  species = loaded;
  order = states.AL?.species || [];
  shell();
}).catch(() => {
  app.innerHTML = `<div class="shell"><h1>Critter Whisperer</h1><p>The species list could not be loaded.</p></div>`;
});
