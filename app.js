// Orquestracao da interface: estados, Worker de IA, sessao e renderizacao segura (textContent).
import { CONFIG } from "./config.js";
import { runTurn, newSession, fetchDataset } from "./core.js";

const $ = (id) => document.getElementById(id);
const els = {
  log: $("log"), form: $("form"), msg: $("msg"), send: $("send"), reset: $("reset"), retry: $("retry"),
  statusText: $("status-text"), progress: $("progress"), counter: $("counter"), sim: $("sim-banner"),
};

// Estados: initial, loading, ready, processing, failed, recovering.
let state = "initial";
let worker = null;
let generation = 0;
let loadTimer = null;
let reqSeq = 0;
const pending = new Map();
let session = newSession();
const feedback = [];

const simulate = new URLSearchParams(location.search).get("simular");
const simulated503 = simulate === "fonte503";
if (simulated503) els.sim.hidden = false;

const STATUS = {
  initial: "Preparando a IA…",
  loading: "Carregando o modelo de IA no navegador (cerca de 135 MB no primeiro acesso)…",
  ready: "IA pronta. Pode enviar sua mensagem.",
  processing: "Analisando o pedido…",
  failed: "A IA ficou indisponível.",
  recovering: "Reiniciando a IA…",
};

function setState(next, detail = "") {
  state = next;
  document.body.dataset.state = next;
  els.statusText.textContent = detail ? `${STATUS[next]} ${detail}` : STATUS[next];
  const canSend = next === "ready";
  els.send.disabled = !canSend;
  document.querySelectorAll("[data-example]").forEach((b) => { b.disabled = !canSend; });
  document.querySelectorAll("[data-retry-query]").forEach((b) => { b.disabled = !canSend; });
  els.retry.hidden = next !== "failed";
  els.progress.hidden = !(next === "loading" || next === "recovering");
  if (next === "processing") els.send.textContent = "Aguarde"; else els.send.textContent = "Enviar";
}

function teardown(reason) {
  clearTimeout(loadTimer);
  loadTimer = null;
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason || "Worker encerrado")); }
  pending.clear();
}

function fail(message) {
  teardown(message);
  generation++; // invalida respostas em andamento
  setState("failed", message);
  addSystem(`A IA ficou indisponível (${message}). Nenhuma resposta foi gerada sem o modelo. Use “Tentar carregar a IA novamente”.`);
}

function startWorker() {
  teardown("reinício");
  generation++;
  setState(state === "failed" ? "recovering" : "loading");
  els.progress.value = 0;
  const w = new Worker(new URL("./ai-worker.js", import.meta.url), { type: "module" });
  worker = w;
  w.onmessage = (ev) => { if (w === worker) onWorkerMessage(ev.data); };
  w.onerror = (ev) => { if (w === worker) { ev.preventDefault?.(); fail("erro no Worker"); } };
  w.onmessageerror = () => { if (w === worker) fail("mensagem inválida do Worker"); };
  loadTimer = setTimeout(() => { if (w === worker) fail("tempo limite de carga excedido"); }, CONFIG.timeouts.loadMs);
  w.postMessage({ type: "init" });
}

function onWorkerMessage(m) {
  if (m.type === "progress") {
    if (m.total > 0) els.progress.value = Math.round((m.loaded / m.total) * 100);
    const mb = (m.loaded / 1e6).toFixed(0);
    els.statusText.textContent = `${STATUS[state]} ${mb} MB recebidos.`;
  } else if (m.type === "ready") {
    clearTimeout(loadTimer);
    loadTimer = null;
    if (state === "loading" || state === "recovering") setState("ready");
  } else if (m.type === "result") {
    const p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); p.resolve(m.scores); }
  } else if (m.type === "error") {
    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id);
      clearTimeout(p.timer);
      pending.delete(m.id);
      p.reject(new Error(m.message));
    }
    fail(m.stage === "load" ? "falha ao carregar o modelo" : "falha durante a inferência");
  }
}

function classify(text) {
  return new Promise((resolve, reject) => {
    if (!worker || state !== "processing") { reject(new Error("IA não está pronta")); return; }
    const id = ++reqSeq;
    const timer = setTimeout(() => { fail("tempo limite de inferência excedido"); }, CONFIG.timeouts.inferMs);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ type: "classify", id, text });
  });
}

const fetchSource = simulated503
  ? () => fetchDataset(CONFIG.sourceUrl, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
  : () => fetchDataset(CONFIG.sourceUrl);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function scrollEnd() { els.log.scrollTop = els.log.scrollHeight; }

function addUser(text) {
  const li = el("li", "msg user");
  li.dataset.kind = "user";
  li.append(el("p", null, text || "(mensagem vazia)"));
  els.log.append(li);
  scrollEnd();
}

function addSystem(text) {
  const li = el("li", "msg bot");
  li.dataset.kind = "system";
  li.append(el("p", null, text));
  els.log.append(li);
  scrollEnd();
}

function renderUnit(u, source) {
  const card = document.getElementById("unit-tpl").content.firstElementChild.cloneNode(true);
  card.dataset.unitId = u.id;
  card.querySelector(".u-name").textContent = u.name;
  card.querySelector(".u-addr").textContent = `${u.address} · CEP ${u.cep} · ${u.district}, ${u.city}/${u.state}`;
  const ph = card.querySelector(".u-phone");
  if (u.phone) ph.textContent = `Telefone cadastrado: ${u.phone}`; else ph.remove();
  const src = card.querySelector(".u-src");
  src.append(`Fonte: ${source.publisher}, ${source.reference}, p. ${u.sourcePage} do PDF · obtida em ${source.retrievedAt} · `);
  const a = el("a", null, "documento original");
  a.href = source.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  src.append(a);
  return card;
}

function renderBot(r, text) {
  const res = r.response;
  const li = el("li", "msg bot");
  li.dataset.kind = res.kind;
  li.dataset.code = res.code;
  li.append(el("p", null, res.text));
  if (res.units?.length) {
    const box = el("div", "units");
    for (const u of res.units) box.append(renderUnit(u, res.source));
    li.append(box);
  }
  if (res.notes?.length) {
    const ul = el("ul", "notes");
    for (const n of res.notes) ul.append(el("li", null, n));
    li.append(ul);
  }
  const det = el("details", "trace");
  det.append(el("summary", null, "Rastreio da decisão"));
  const ol = el("ol");
  for (const t of r.trace) {
    const item = el("li");
    item.append(el("strong", null, `${t.step}: `), document.createTextNode(t.detail));
    ol.append(item);
  }
  for (const c of r.toolCalls) {
    const item = el("li");
    const ret = c.status === "ok" ? `retornou [${c.returned.join(", ")}]` : `erro ${c.error}`;
    item.append(el("strong", null, "registro da ferramenta: "), el("code", null, `${c.tool}(${JSON.stringify(c.query)}) → ${ret}`));
    ol.append(item);
  }
  det.append(ol);
  li.append(det);

  const actions = el("div", "actions");
  if (res.retryable) {
    const b = el("button", "small-btn", "Tentar novamente");
    b.type = "button";
    b.dataset.retryQuery = "1";
    // Reenvia o texto desta mensagem, não o da última enviada.
    b.addEventListener("click", () => submit(text));
    actions.append(b);
  }
  if (res.kind !== "reject") {
    actions.append(el("span", null, "Esta resposta ajudou?"));
    for (const [label, val] of [["Sim", "up"], ["Não", "down"]]) {
      const b = el("button", "small-btn", label);
      b.type = "button";
      b.addEventListener("click", () => {
        feedback.push({ code: res.code, val, at: Date.now() });
        actions.replaceChildren(el("span", null, "Obrigado. O retorno fica só nesta aba e não treina o modelo; serve para revisão manual futura."));
      });
      actions.append(b);
    }
  }
  li.append(actions);
  els.log.append(li);
  scrollEnd();
}

async function submit(text) {
  if (state !== "ready") return;
  const myGen = generation;
  addUser(text);
  setState("processing");
  try {
    const r = await runTurn({ text, session, classify, fetchSource });
    if (myGen !== generation) return; // resposta antiga apos reinicio: descartada
    session = r.session;
    renderBot(r, text);
  } catch {
    // Falha do Worker ja tratada em fail(); nada a renderizar sem o modelo.
  } finally {
    if (myGen === generation && state === "processing") setState("ready");
  }
}

els.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const text = els.msg.value;
  if (state !== "ready") return;
  els.msg.value = "";
  updateCounter();
  submit(text);
});
els.msg.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); els.form.requestSubmit(); }
});
function updateCounter() {
  const n = els.msg.value.trim().length;
  els.counter.textContent = `${n}/${CONFIG.limits.maxChars}`;
  els.counter.classList.toggle("over", n > CONFIG.limits.maxChars);
}
els.msg.addEventListener("input", updateCounter);
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => submit(b.dataset.example)));
els.retry.addEventListener("click", () => startWorker());
els.reset.addEventListener("click", () => {
  session = newSession();
  feedback.length = 0;
  [...els.log.children].slice(1).forEach((n) => n.remove());
  els.msg.value = "";
  updateCounter();
  els.msg.focus();
});

startWorker();
