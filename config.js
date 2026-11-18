// Configuracao nao sensivel. Nenhuma chave ou credencial e necessaria.
export const CONFIG = Object.freeze({
  appVersion: "2.0.0",
  model: Object.freeze({
    id: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    revision: "2c4055b12046f11709e9df2c122e59ffbdc2f900",
    task: "feature-extraction",
    dtype: "q8",
    device: "wasm",
    pooling: "mean",
    normalize: true,
    dimensions: 384,
    library: "@huggingface/transformers",
    libraryVersion: "3.8.1",
    libraryUrl: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1",
  }),
  // Limiares de similaridade cosseno (nao sao probabilidades calibradas).
  thresholds: Object.freeze({ minScore: 0.35, minMargin: 0.04 }),
  limits: Object.freeze({ maxChars: 600 }),
  timeouts: Object.freeze({ loadMs: 180000, inferMs: 20000, sourceMs: 8000 }),
  session: Object.freeze({ idleMs: 15 * 60 * 1000 }),
  sourceUrl: "./units.json",
  examples: Object.freeze({
    SEARCH: [
      "Quero localizar um posto de saúde perto do meu bairro.",
      "Preciso do endereço de uma Unidade Básica de Saúde.",
      "Gostaria de saber onde fica a UBS da minha região.",
    ],
    INFO: [
      "Olá, bom dia!",
      "Explique suas funções e como posso usar este assistente.",
      "Como funciona a privacidade desta conversa?",
    ],
    CLINICAL: [
      "Estou doente, preciso de um diagnóstico e tratamento.",
      "Que medicamento e dosagem são indicados para os meus sintomas?",
      "Estou sentindo dor e quero orientação médica.",
    ],
    OTHER: [
      "Faça um script de programação e resolva um problema de software.",
      "Informe a previsão do tempo e as notícias de futebol.",
      "Quero investir dinheiro e preparar uma receita de bolo.",
    ],
  }),
});
