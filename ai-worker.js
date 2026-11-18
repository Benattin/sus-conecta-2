// Web Worker (modulo): carrega Transformers.js e o modelo ONNX q8 em WASM e responde classificacoes.
import { CONFIG } from "./config.js";
import { createIntentModel } from "./intent-model.js";

let model = null;

async function init() {
  const lib = await import(CONFIG.model.libraryUrl);
  lib.env.allowLocalModels = false;
  let loaded = 0;
  const files = {};
  model = await createIntentModel(lib.pipeline, {
    onProgress: (p) => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        loaded = Object.values(files).reduce((s, f) => s + f.loaded, 0);
        const total = Object.values(files).reduce((s, f) => s + f.total, 0);
        postMessage({ type: "progress", loaded, total });
      }
    },
  });
  postMessage({ type: "ready", dims: model.dims, model: CONFIG.model.id, revision: CONFIG.model.revision });
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "init") {
    try { await init(); } catch (e) { postMessage({ type: "error", stage: "load", message: String(e?.message || e) }); }
    return;
  }
  if (msg.type === "classify") {
    if (!model) { postMessage({ type: "error", id: msg.id, stage: "infer", message: "Modelo não carregado." }); return; }
    const t0 = performance.now();
    try {
      const scores = await model.scores(msg.text);
      postMessage({ type: "result", id: msg.id, scores, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      postMessage({ type: "error", id: msg.id, stage: "infer", message: String(e?.message || e) });
    }
  }
};
