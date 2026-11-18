// Controlador do agente: validacao, extracao de slots, decisao, consulta e resposta.
// Funcoes puras sempre que possivel; usado pela interface e pelos testes.
import { CONFIG } from "./config.js";

export const COVERED_DISTRICTS = ["Bela Vista", "Bom Retiro", "Cambuci", "Santa Cecília", "Sé"];
export const COVERED_CITY = "São Paulo";
export const COVERED_STATE = "SP";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

// Municipios conhecidos fora da cobertura (lista parcial; padroes "Cidade/UF" e "Município: X" cobrem os demais).
const OTHER_CITIES = {
  "Osasco": "SP", "Santo André": "SP", "São Bernardo do Campo": "SP", "São Caetano do Sul": "SP",
  "Diadema": "SP", "Mauá": "SP", "Guarulhos": "SP", "Barueri": "SP", "Carapicuíba": "SP", "Cotia": "SP",
  "Taboão da Serra": "SP", "Embu das Artes": "SP", "Itapecerica da Serra": "SP", "Mogi das Cruzes": "SP",
  "Suzano": "SP", "Itaquaquecetuba": "SP", "Ferraz de Vasconcelos": "SP", "Poá": "SP", "Franco da Rocha": "SP",
  "Francisco Morato": "SP", "Caieiras": "SP", "Mairiporã": "SP", "Santana de Parnaíba": "SP", "Jandira": "SP",
  "Itapevi": "SP", "Ribeirão Pires": "SP", "Campinas": "SP", "Santos": "SP", "Sorocaba": "SP", "Jundiaí": "SP",
  "São José dos Campos": "SP", "Ribeirão Preto": "SP", "Rio de Janeiro": "RJ", "Belo Horizonte": "MG",
  "Curitiba": "PR", "Porto Alegre": "RS", "Florianópolis": "SC", "Joinville": "SC", "Salvador": "BA",
  "Recife": "PE", "Fortaleza": "CE", "Brasília": "DF", "Manaus": "AM", "Goiânia": "GO", "Natal": "RN",
  "João Pessoa": "PB", "Maceió": "AL", "Aracaju": "SE", "Teresina": "PI", "São Luís": "MA", "Cuiabá": "MT",
  "Campo Grande": "MS", "Palmas": "TO", "Porto Velho": "RO", "Macapá": "AP", "Rio Branco": "AC",
};
const CITY_UF = { [COVERED_CITY]: COVERED_STATE, ...OTHER_CITIES };

// Distritos do municipio de Sao Paulo fora do recorte (exigem inicial maiuscula para evitar palavras comuns).
const OTHER_DISTRICTS = ["Pinheiros", "Liberdade", "República", "Consolação", "Mooca", "Lapa", "Vila Mariana",
  "Butantã", "Santana", "Tatuapé", "Itaquera", "Jabaquara", "Ipiranga", "Brás", "Perdizes", "Barra Funda",
  "Moema", "Pari", "Belém", "Jardim Paulista", "Vila Prudente", "Penha", "Sacomã", "Cursino"];

const STATE_NAMES = { "sao paulo": "SP", "rio de janeiro": "RJ", "minas gerais": "MG", "santa catarina": "SC",
  "parana": "PR", "rio grande do sul": "RS", "bahia": "BA", "pernambuco": "PE" };

const SERVICES = [
  { key: "UBS", terms: ["ubs", "unidade basica de saude", "unidade basica", "posto de saude", "postinho", "posto"] },
  { key: "VACINA", terms: ["vacina", "vacinas", "vacinacao", "vacinar", "imunizacao"] },
  { key: "UPA", terms: ["upa", "upas", "pronto socorro", "pronto-socorro", "pronto atendimento"] },
  { key: "HOSPITAL", terms: ["hospital", "hospitais"] },
  { key: "OUTRA_UNIDADE", terms: ["caps", "ama", "farmacia", "laboratorio"] },
  { key: "DISPONIBILIDADE", terms: ["estoque", "vaga", "vagas", "agendar", "agendamento", "marcar consulta", "horario de hoje", "aberta agora", "disponiveis hoje", "disponivel hoje"] },
];

const CLINICAL_TERMS = ["diagnostico", "tratamento", "remedio", "remedios", "medicamento", "medicamentos",
  "dosagem", "dose", "sintoma", "sintomas", "estou com dor", "sinto dor", "sentindo dor", "febre", "receita medica",
  "o que eu tenho", "estou doente"];

const INVENT_RE = /\b(invente|inventar|crie|criar|cadastre|adicione|acrescente|simule)\b[^.?!]*\b(ubs|unidade|endereco|telefone)\b/;
const INJECTION_RE = /\b(ignore|ignorar|desconsidere)\b[^.?!]*\b(instruc|regra|limite)|\b(url|endpoint|fonte)\b[^.?!]*\bhttps?:/;
const YES_RE = /^(sim|isso|isso mesmo|correto|exato|pode ser|confirmo|ok)[.! ]*$/;

// Dobra acentos e caixa preservando o comprimento (posicoes alinhadas ao texto original).
export function fold(text) {
  let out = "";
  for (const ch of String(text)) {
    const base = ch.normalize("NFD")[0].toLowerCase();
    out += base.length === ch.length ? base : ch.toLowerCase();
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (term) => new RegExp(`(?<![a-z0-9])${esc(term)}(?![a-z0-9])`, "g");

export function validateInput(text, maxChars = CONFIG.limits.maxChars) {
  if (typeof text !== "string") return { ok: false, code: "invalid_type" };
  const t = text.trim();
  if (!t) return { ok: false, code: "empty" };
  if (t.length > maxChars) return { ok: false, code: "too_long", length: t.length, max: maxChars };
  return { ok: true, text: t };
}

// Limites de oracao: pontuacao e conectivos adversativos ou de nova acao.
function clauseIndex(folded) {
  const ids = new Array(folded.length).fill(0);
  const re = /[,.;:!?\n]|\s(?:mas|porem|e sim|e)\s(?=(?:quero|preciso|procuro|gostaria|so|apenas|busco))|\s(?:mas|porem)\s/g;
  const cuts = [];
  let m;
  while ((m = re.exec(folded))) cuts.push(m.index);
  let c = 0, k = 0;
  for (let i = 0; i < folded.length; i++) {
    while (k < cuts.length && cuts[k] <= i) { c++; k++; }
    ids[i] = c;
  }
  return ids;
}

function negationCues(folded) {
  const cues = [];
  const re = /(?<![a-z])(nao|nem|exceto|menos|salvo|sem)(?![a-z])/g;
  let m;
  while ((m = re.exec(folded))) {
    const before = folded.slice(Math.max(0, m.index - 6), m.index);
    const after = folded.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (m[1] === "menos" && /(pelo|ao|a) $/.test(before)) continue;
    // "nao sei/encontro/consigo..." expressa dificuldade, nao exclusao do local.
    if (m[1] === "nao" && /^\s+(sei|encontro|acho|consigo|conheco|lembro|tenho certeza)/.test(after)) continue;
    cues.push(m.index);
  }
  return cues;
}

function polarityAt(pos, clauses, cues) {
  return cues.some((c) => c < pos && clauses[c] === clauses[pos]) ? "neg" : "pos";
}

function removeOverlaps(items) {
  const sorted = [...items].sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const it of sorted) {
    if (!kept.some((k) => it.start < k.end && k.start < it.end)) kept.push(it);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function findTerm(folded, term) {
  const out = [];
  const re = wordRe(fold(term));
  let m;
  while ((m = re.exec(folded))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Extrai sinais observaveis do texto. `districts` permite testar ordem invertida da lista.
export function analyze(text, { districts = COVERED_DISTRICTS } = {}) {
  const original = String(text);
  const folded = fold(original);
  const clauses = clauseIndex(folded);
  const cues = negationCues(folded);
  const pol = (pos) => polarityAt(pos, clauses, cues);
  const loc = [];

  // Estados por nome ("estado de Sao Paulo") e por sigla em maiusculas.
  for (const [name, uf] of Object.entries(STATE_NAMES)) {
    const re = new RegExp(`estado (?:de|do|da) ${esc(name)}(?![a-z])`, "g");
    let m;
    while ((m = re.exec(folded))) loc.push({ kind: "state", value: uf, start: m.index, end: m.index + m[0].length });
  }
  const ufRe = /(?<![\p{L}\d])([A-Z]{2})(?![\p{L}\d])/gu;
  let m;
  while ((m = ufRe.exec(original))) {
    if (UFS.includes(m[1])) loc.push({ kind: "state", value: m[1], start: m.index, end: m.index + 2 });
  }

  // Municipios conhecidos.
  for (const city of Object.keys(CITY_UF)) {
    for (const r of findTerm(folded, city)) loc.push({ kind: "city", value: city, start: r.start, end: r.end });
  }
  // Padrao "Cidade/UF", "Cidade - UF" ou "Cidade, UF" para municipios fora da lista.
  const cityUfRe = /(\p{Lu}[\p{L}]+(?:\s+(?:d[aeo]s?\s+)?\p{Lu}[\p{L}]+)*)\s*(?:\/|-|,)\s*([A-Z]{2})(?![\p{L}])/gu;
  while ((m = cityUfRe.exec(original))) {
    const name = m[1].replace(/^(Em|Na|No|De|Da|Do)\s+/, "");
    const f = fold(name);
    const isDistrict = [...districts, ...OTHER_DISTRICTS].some((d) => fold(d) === f);
    if (UFS.includes(m[2]) && !isDistrict && f !== "ubs" && !CITY_UF[name]) {
      const start = m.index + m[1].length - name.length;
      loc.push({ kind: "city", value: name, start, end: start + name.length, generic: true });
    }
  }
  // Marcadores explicitos "Município: X", "cidade de X".
  const markRe = /(?:municipio|cidade)\s*(?:de\s+|:\s*)([a-z][a-z\s]*?)(?=\s*(?:[,.;!?]|$|\s(?:no|na|em|e)\s))/g;
  while ((m = markRe.exec(folded))) {
    const start = m.index + m[0].length - m[1].length;
    const raw = original.slice(start, start + m[1].length).trim();
    const known = Object.keys(CITY_UF).find((c) => fold(c) === fold(raw));
    loc.push({ kind: "city", value: known || raw, start: m.index, end: start + m[1].length, marker: true });
  }

  // Distritos cobertos, na ordem recebida; o significado depende da posicao no texto, nao da lista.
  for (const d of districts) {
    if (d === "Sé") {
      const re = /(?<![a-z])se(?![a-z])/g;
      while ((m = re.exec(folded))) {
        const accented = /[éÉ]/.test(original[m.index + 1]);
        const marked = /(?:na|da|distrito d[ae]|bairro d[ae]|regiao d[ae]|praca d[ae]) $/.test(folded.slice(0, m.index));
        const isUf = original.slice(m.index, m.index + 2) === "SE";
        if ((accented || marked) && !isUf) loc.push({ kind: "district", value: d, covered: true, start: m.index, end: m.index + 2 });
      }
      continue;
    }
    for (const r of findTerm(folded, d)) loc.push({ kind: "district", value: d, covered: true, ...r });
  }
  for (const d of OTHER_DISTRICTS) {
    for (const r of findTerm(folded, d)) {
      if (/\p{Lu}/u.test(original[r.start])) loc.push({ kind: "district", value: d, covered: false, ...r });
    }
  }

  const mentions = removeOverlaps(loc).map((x) => ({ ...x, polarity: pol(x.start) }));
  const services = [];
  const svc = [];
  for (const s of SERVICES) for (const t of s.terms) for (const r of findTerm(folded, t)) svc.push({ key: s.key, ...r });
  for (const s of removeOverlaps(svc)) services.push({ key: s.key, polarity: pol(s.start), start: s.start });

  const clinical = CLINICAL_TERMS.some((t) => findTerm(folded, t).some((r) => pol(r.start) === "pos"));

  let typo = null;
  if (!mentions.some((x) => x.kind === "district")) {
    const words = folded.split(/[^a-z]+/).filter(Boolean);
    for (let n = 1; n <= 2 && !typo; n++) {
      for (let i = 0; i + n <= words.length && !typo; i++) {
        const w = words.slice(i, i + n).join(" ");
        if (w.length < 5) continue;
        for (const d of districts) {
          const dist = levenshtein(w, fold(d));
          if (dist > 0 && dist <= 2 && fold(d).split(" ").length === n) { typo = d; break; }
        }
      }
    }
  }

  const posCovered = mentions.filter((x) => x.kind === "district" && x.polarity === "pos");
  let alternatives = false;
  if (posCovered.length >= 2) {
    const between = folded.slice(posCovered[0].end, posCovered[posCovered.length - 1].start);
    alternatives = /(?<![a-z])ou(?![a-z])/.test(between);
  }

  return {
    folded,
    mentions,
    services,
    clinical,
    invent: INVENT_RE.test(folded),
    injection: INJECTION_RE.test(folded),
    confirmYes: YES_RE.test(folded.trim()),
    typo,
    alternatives,
  };
}

// Converte scores do encoder em rotulo; abaixo dos limiares ha abstencao (INVALID).
export function classifyScores(scores, { minScore, minMargin } = CONFIG.thresholds) {
  const ranked = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { label: "INVALID", top: null, score: 0, margin: 0, ranked };
  const [top, second] = ranked;
  const score = top[1];
  const margin = second ? score - second[1] : score;
  const ok = Number.isFinite(score) && score >= minScore && margin >= minMargin;
  return { label: ok ? top[0] : "INVALID", top: top[0], score, margin, ranked };
}

export function newSession(now = Date.now()) {
  return { service: null, city: null, state: null, district: null, pendingSuggestion: null, updatedAt: now, turns: 0 };
}

const coverageText = () => `${COVERED_DISTRICTS.slice(0, -1).join(", ")} e ${COVERED_DISTRICTS.at(-1)}, no município de São Paulo/SP`;
const uniq = (arr) => [...new Set(arr)];

function reply(action, code, text, session, extra = {}) {
  return { action, code, text, session, ...extra };
}

// Decide o proximo passo a partir do texto, da intencao do encoder e da sessao.
export function decide({ text, intent, session: prev, now = Date.now(), options = {} }) {
  const expired = prev && now - prev.updatedAt > CONFIG.session.idleMs;
  const session = { ...(expired || !prev ? newSession(now) : prev), updatedAt: now, turns: (prev?.turns || 0) + 1 };
  const s = analyze(text, options);
  const label = intent?.label || "INVALID";
  const notes = [];
  const signals = {
    intent: label,
    services: s.services.map((x) => `${x.key}:${x.polarity}`),
    locations: s.mentions.map((x) => `${x.kind}:${x.value}:${x.polarity}`),
    clinical: s.clinical,
    typo: s.typo,
    expired: Boolean(expired),
  };
  const out = (action, code, msg, sess, extra) => reply(action, code, msg, sess, { signals, notes, ...extra });

  // Confirmacao de sugestao de distrito pendente.
  if (session.pendingSuggestion && s.confirmYes) {
    session.district = session.pendingSuggestion;
    session.pendingSuggestion = null;
    return finishLocation(session, out, notes);
  }
  session.pendingSuggestion = null;

  if (s.invent) {
    return out("LIMIT", "invent_refused", "Não crio nem altero cadastros. Só mostro UBS que constam na base documental consultada. Informe o distrito e o município para eu consultar a base.", session);
  }
  if (s.injection) notes.push("injection_ignored");

  const ubsPos = s.services.some((x) => x.key === "UBS" && x.polarity === "pos");
  const ubsNeg = !ubsPos && s.services.some((x) => x.key === "UBS" && x.polarity === "neg");
  const othersPos = uniq(s.services.filter((x) => x.key !== "UBS" && x.polarity === "pos").map((x) => x.key));
  const hasLoc = s.mentions.length > 0 || Boolean(s.typo);

  if (s.clinical && !ubsPos) {
    return out("LIMIT", "clinical", "Não faço diagnóstico, triagem nem indico medicamentos. Procure um profissional de saúde; em emergência, ligue 192 (SAMU). Se quiser, posso consultar o endereço de uma UBS no recorte: informe distrito e município.", session);
  }
  if (ubsNeg && !othersPos.length) {
    return out("CLARIFY", "ubs_negated", "Entendi que você não quer uma UBS nesse local. Pode dizer o que procura? Eu só consulto endereços de UBS em " + coverageText() + ".", session);
  }
  if (othersPos.length && !ubsPos) {
    const realtime = othersPos.includes("VACINA") || othersPos.includes("DISPONIBILIDADE");
    const msg = realtime
      ? "Não tenho dados de vacinas, estoque, vagas ou horários. A base consultada é um cadastro documental de endereços de UBS, sem informação em tempo real. Confirme essas informações diretamente na unidade ou nos canais oficiais da Prefeitura (156)."
      : "Este protótipo consulta apenas Unidades Básicas de Saúde (UBS). Não tenho cadastro de UPA, hospital ou outros serviços. Em emergência, ligue 192 (SAMU).";
    return out("LIMIT", realtime ? "realtime_unavailable" : "service_out_of_scope", msg, { ...session, service: null });
  }

  const searchContext = ubsPos || label === "SEARCH" || (session.service === "UBS" && hasLoc);
  if (!searchContext) {
    if (hasLoc) {
      return out("CLARIFY", "service_unclear", "Você quer localizar uma UBS nesse local? Responda, por exemplo: \"Procuro uma UBS na Bela Vista, São Paulo\".", session);
    }
    if (label === "INFO") {
      return out("INFO", "info", "Sou um agente informativo: localizo endereços de UBS em " + coverageText() + ", a partir de uma base documental pública da SMS-SP (outubro/2026). Não faço diagnóstico, agendamento nem informo vagas. Não peça nem envie CPF, nome ou endereço residencial; basta distrito e município.", session);
    }
    if (label === "CLINICAL") {
      return out("LIMIT", "clinical", "Não faço diagnóstico, triagem nem indico medicamentos. Procure um profissional de saúde; em emergência, ligue 192 (SAMU).", session);
    }
    if (label === "OTHER") {
      return out("LIMIT", "out_of_scope", "Esse assunto está fora do meu escopo. Eu só localizo endereços de UBS em " + coverageText() + ".", session);
    }
    return out("CLARIFY", "rephrase", "Não tenho segurança para interpretar o pedido. Você procura o endereço de uma UBS? Exemplo: \"Onde encontro uma UBS na Bela Vista, São Paulo?\"", session);
  }

  session.service = "UBS";
  if (othersPos.length) notes.push("combined_limit");
  if (s.clinical) notes.push("clinical_limit");

  // Municipio.
  const cityPos = uniq(s.mentions.filter((x) => x.kind === "city" && x.polarity === "pos").map((x) => x.value));
  const cityNeg = uniq(s.mentions.filter((x) => x.kind === "city" && x.polarity === "neg").map((x) => x.value));
  if (cityPos.length > 1) {
    return out("CLARIFY", "multiple_cities", `Você citou mais de um município (${cityPos.join(", ")}). Em qual deles procura a UBS?`, { ...session, city: null, district: null });
  }
  const statePos = uniq(s.mentions.filter((x) => x.kind === "state" && x.polarity === "pos").map((x) => x.value));
  if (cityPos.length === 1) {
    if (cityPos[0] !== session.city) session.district = null;
    session.city = cityPos[0];
    session.state = CITY_UF[cityPos[0]] || (statePos.length === 1 ? statePos[0] : null);
  } else if (cityNeg.length) {
    if (cityNeg.includes(session.city) || !session.city) {
      return out("CLARIFY", "city_negated", `Entendi que não é em ${cityNeg.join(", ")}. Em qual município você procura? Eu cubro apenas ${coverageText()}.`, { ...session, city: null, state: null, district: null });
    }
  }
  if (statePos.length > 1) {
    return out("CLARIFY", "multiple_states", "Você citou mais de uma UF. Qual é o município e a UF?", { ...session, city: null, state: null });
  }
  if (statePos.length === 1) {
    const uf = statePos[0];
    const cityUf = session.city ? CITY_UF[session.city] : null;
    if (cityPos.length === 1 && cityUf && cityUf !== uf) {
      return out("CLARIFY", "city_state_conflict", `${session.city} não fica em ${uf}. Pode confirmar o município e a UF?`, { ...session, city: null, state: null, district: null });
    }
    if (!cityPos.length && session.state && session.state !== uf) {
      session.city = null;
      session.district = null;
    }
    session.state = uf;
  }

  // Distrito.
  const dPos = uniq(s.mentions.filter((x) => x.kind === "district" && x.polarity === "pos").map((x) => x.value));
  const dNeg = uniq(s.mentions.filter((x) => x.kind === "district" && x.polarity === "neg").map((x) => x.value));
  if (dPos.length > 1) {
    const q = s.alternatives
      ? `Você citou ${dPos.join(" ou ")}. Qual dos dois distritos devo consultar?`
      : `Você citou mais de um distrito (${dPos.join(", ")}). Qual deles devo consultar?`;
    return out("CLARIFY", s.alternatives ? "alternatives" : "multiple_districts", q, { ...session, district: null });
  }
  if (dPos.length === 1) session.district = dPos[0];
  else if (dNeg.includes(session.district)) session.district = null;
  if (!dPos.length && s.typo) {
    return out("CLARIFY", "typo_suggestion", `Não encontrei esse distrito. Você quis dizer ${s.typo}? Responda "sim" para confirmar ou escreva o distrito.`, { ...session, district: null, pendingSuggestion: s.typo });
  }
  if (dNeg.length && !dPos.length && !session.district) notes.push("district_excluded");

  return finishLocation(session, out, notes);
}

function finishLocation(session, out, notes) {
  if (!session.city) {
    const code = session.state ? "ask_city_state_only" : "ask_location";
    const msg = session.state
      ? `${session.state} é uma UF, não um município. Em qual município e distrito você procura a UBS? Eu cubro ${coverageText()}.`
      : session.district
        ? `Em qual município fica ${session.district}? O nome pode existir em mais de uma cidade. Eu cubro ${coverageText()}.`
        : `Em qual distrito e município você procura a UBS? Eu cubro ${coverageText()}.`;
    return out("ASK", code, msg, session);
  }
  if (session.city !== COVERED_CITY || (session.state && session.state !== COVERED_STATE)) {
    return out("LIMIT", "coverage_city", `Ainda não tenho dados de ${session.city}${session.state ? "/" + session.state : ""}. Não vou mostrar unidades de outro município. A cobertura atual é ${coverageText()}.`, { ...session, district: null });
  }
  session.state = COVERED_STATE;
  if (!session.district) {
    return out("ASK", "ask_district", `Em qual distrito de São Paulo você procura a UBS? Opções do recorte: ${COVERED_DISTRICTS.join(", ")}.`, session);
  }
  if (!COVERED_DISTRICTS.includes(session.district)) {
    return out("LIMIT", "coverage_district", `${session.district} fica fora do recorte deste protótipo. A ausência no recorte não significa que não exista UBS lá. Cobertura: ${coverageText()}.`, { ...session, district: null });
  }
  return out("SEARCH", "search", null, session, {
    query: { city: COVERED_CITY, state: COVERED_STATE, district: session.district, type: "UBS" },
  });
}

// ---------- Ferramenta: base estruturada ----------

export class ToolError extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

export function validateDataset(data) {
  const fail = (msg) => { throw new ToolError("schema", msg); };
  if (!data || typeof data !== "object") fail("Base sem objeto JSON.");
  if (data.schemaVersion !== 1) fail("Versão de esquema não suportada.");
  if (typeof data.datasetVersion !== "string" || !data.datasetVersion) fail("datasetVersion ausente.");
  const src = data.source;
  if (!src || typeof src.url !== "string" || !/^https:\/\//.test(src.url) || !/^[0-9a-f]{64}$/.test(src.sha256 || "")) fail("Origem da base inválida.");
  if (!Array.isArray(data.units)) fail("Lista de unidades ausente.");
  const ids = new Set();
  for (const u of data.units) {
    for (const k of ["id", "name", "type", "district", "city", "state", "address"]) {
      if (typeof u?.[k] !== "string" || !u[k].trim()) fail(`Registro sem campo ${k}.`);
    }
    if (!Number.isInteger(u.sourcePage)) fail(`Registro ${u.id} sem página de origem.`);
    if (u.phone != null && typeof u.phone !== "string") fail(`Telefone inválido em ${u.id}.`);
    if (ids.has(u.id)) fail(`ID duplicado: ${u.id}.`);
    ids.add(u.id);
  }
  return data;
}

// Consulta HTTP a base com timeout real; erros sao classificados para a resposta.
export async function fetchDataset(url, { fetchImpl = globalThis.fetch, timeoutMs = CONFIG.timeouts.sourceMs } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new ToolError("http", `HTTP ${res.status}`, { status: res.status });
    let data;
    try { data = await res.json(); } catch { throw new ToolError("schema", "Resposta não é JSON válido."); }
    return validateDataset(data);
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e?.name === "AbortError") throw new ToolError("timeout", `Tempo limite de ${timeoutMs} ms excedido.`);
    throw new ToolError("network", "Falha de conexão com a base.");
  } finally {
    clearTimeout(timer);
  }
}

export function searchUnits(data, q) {
  const eq = (a, b) => fold(a).trim() === fold(b).trim();
  return data.units.filter((u) => eq(u.city, q.city) && eq(u.state, q.state) && eq(u.district, q.district) && eq(u.type, q.type));
}

const NOTE_TEXT = {
  combined_limit: "Sobre vacinas, UPA, hospital, vagas ou estoque: a base não traz esses dados; confirme na unidade.",
  clinical_limit: "Não faço avaliação de sintomas; procure um profissional. Em emergência, ligue 192 (SAMU).",
  injection_ignored: "Instruções para mudar regras ou a fonte foram ignoradas; a consulta usa sempre a base configurada.",
};

// Executa um turno completo: classificacao (injetada), decisao, ferramenta e resposta.
export async function runTurn({ text, session, classify, fetchSource, now = Date.now(), options = {} }) {
  const trace = [];
  const v = validateInput(text);
  if (!v.ok) {
    const msg = v.code === "too_long"
      ? `A mensagem tem ${v.length} caracteres; o limite é ${v.max}. Resuma o pedido, por exemplo: "UBS na Bela Vista, São Paulo".`
      : "Digite uma mensagem para começar.";
    trace.push({ step: "validação", detail: v.code });
    return { session: session || newSession(now), response: { kind: "reject", code: v.code, text: msg, units: [] }, trace, toolCalls: [] };
  }
  trace.push({ step: "validação", detail: `ok (${v.text.length} caracteres)` });
  const scores = await classify(v.text);
  const intent = classifyScores(scores);
  trace.push({ step: "intenção (encoder)", detail: `${intent.label} · maior ${intent.top} ${intent.score.toFixed(3)} · margem ${intent.margin.toFixed(3)}` });
  const d = decide({ text: v.text, intent, session, now, options });
  trace.push({ step: "sinais (regras)", detail: [...d.signals.services, ...d.signals.locations].join(", ") || "nenhum" });
  trace.push({ step: "decisão", detail: `${d.action} · ${d.code}` });
  const toolCalls = [];
  const notes = d.notes.map((n) => NOTE_TEXT[n]).filter(Boolean);
  if (d.action !== "SEARCH") {
    return { session: d.session, response: { kind: d.action.toLowerCase(), code: d.code, text: d.text, units: [], notes }, trace, toolCalls, intent, decision: d };
  }
  const call = { tool: "consultar_base_ubs", query: d.query, startedAt: now };
  toolCalls.push(call);
  try {
    const data = await fetchSource();
    const units = searchUnits(data, d.query);
    call.status = "ok";
    call.returned = units.map((u) => u.id);
    call.datasetVersion = data.datasetVersion;
    trace.push({ step: "ferramenta", detail: `GET base (${data.datasetVersion}) · ${units.length} registro(s) compatível(is)` });
    const where = `${d.query.district}, ${d.query.city}/${d.query.state}`;
    if (!units.length) {
      return { session: d.session, response: { kind: "empty", code: "no_results", text: `A base consultada não tem UBS cadastrada em ${where}. Isso não prova que não exista unidade na região.`, units: [], notes, source: data.source }, trace, toolCalls, intent, decision: d };
    }
    trace.push({ step: "validação dos registros", detail: "esquema, IDs únicos, município, UF, distrito e tipo conferidos" });
    return {
      session: d.session,
      response: {
        kind: "results",
        code: "results",
        text: `Encontrei ${units.length} UBS cadastrada${units.length > 1 ? "s" : ""} em ${where}. A busca é por distrito e não indica a UBS de referência do seu endereço.`,
        units,
        notes,
        source: data.source,
        datasetVersion: data.datasetVersion,
      },
      trace, toolCalls, intent, decision: d,
    };
  } catch (e) {
    const kind = e instanceof ToolError ? e.kind : "unknown";
    call.status = "error";
    call.error = kind;
    trace.push({ step: "ferramenta", detail: `falha: ${kind}${e?.detail?.status ? " " + e.detail.status : ""}` });
    const reason = kind === "http" ? `a fonte respondeu ${e.message}` : kind === "timeout" ? "a fonte não respondeu a tempo" : kind === "schema" ? "a base veio em formato inválido" : "houve falha de conexão";
    return {
      session: d.session,
      response: { kind: "tool_error", code: `tool_${kind}`, text: `Não consegui consultar a base agora (${reason}). Não vou mostrar endereços sem a consulta. Use "Tentar novamente".`, units: [], notes: [], retryable: true },
      trace, toolCalls, intent, decision: d,
    };
  }
}
