# SUS Conecta 2.0 — agente CitizenTech

Protótipo acadêmico (FIAP, Global Solution 2026, AI in Digital Transformation). Localiza endereços de UBS nos 96 distritos do município de São Paulo a partir de uma base documental pública da SMS-SP/CEInfo (outubro/2026). Não é serviço oficial do SUS nem da Prefeitura.

Acesso: https://benattin.github.io/sus-conecta-2/

- Encoder `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (revisão 2c4055b, ONNX q8) no navegador via Transformers.js 3.8.1, em Web Worker. Classifica intenção; não gera texto.
- `units.json`: 483 UBS (incluindo AMA/UBS integradas) extraídas das páginas 6 a 65 do PDF oficial, com página de origem e SHA-256 do documento.
- `?simular=fonte503` ativa falha simulada e identificada da base (cenário C).
