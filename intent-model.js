// Classificador semantico por similaridade: embeddings dos exemplos x embedding da entrada.
// Recebe `pipeline` da biblioteca (navegador ou Node) para usar o mesmo codigo nos dois ambientes.
import { CONFIG } from "./config.js";

export async function createIntentModel(pipeline, { onProgress } = {}) {
  const m = CONFIG.model;
  const extractor = await pipeline(m.task, m.id, {
    revision: m.revision,
    dtype: m.dtype,
    device: m.device,
    progress_callback: onProgress,
  });
  const embed = async (texts) => {
    const out = await extractor(texts, { pooling: m.pooling, normalize: m.normalize });
    return out.tolist();
  };
  const labels = Object.keys(CONFIG.examples);
  const refs = {};
  for (const label of labels) refs[label] = await embed(CONFIG.examples[label]);
  const dims = refs[labels[0]][0].length;
  if (dims !== m.dimensions) throw new Error(`Dimensão inesperada: ${dims}`);

  return {
    dims,
    async scores(text) {
      const [v] = await embed([text]);
      const result = {};
      for (const label of labels) {
        // Vetores normalizados: produto interno = similaridade cosseno.
        result[label] = Math.max(...refs[label].map((r) => r.reduce((s, x, i) => s + x * v[i], 0)));
      }
      return result;
    },
  };
}
