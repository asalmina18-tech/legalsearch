// Эмбеддинги multilingual-e5 (ONNX, CPU) через transformers.js.
// Одна и та же модель и квантизация — и при сборке корпуса, и при поиске,
// иначе векторы запроса и документов окажутся в разных пространствах.

import { pipeline, env } from "@huggingface/transformers";

export const EMBED_MODEL = process.env.EMBED_MODEL ?? "Xenova/multilingual-e5-small";
export const EMBED_DTYPE = "q8";

let extractorPromise = null;

function extractor() {
  if (process.env.MODELS_DIR) env.cacheDir = process.env.MODELS_DIR;
  extractorPromise ??= pipeline("feature-extraction", EMBED_MODEL, { dtype: EMBED_DTYPE });
  return extractorPromise;
}

async function embed(texts) {
  const ex = await extractor();
  const out = await ex(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

/** e5 обучена с префиксами: «query: » для запроса, «passage: » для текста. */
export async function embedQuery(text) {
  return (await embed([`query: ${text}`]))[0];
}

export async function embedPassages(texts, batchSize = 16, onProgress) {
  const result = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    result.push(...(await embed(texts.slice(i, i + batchSize).map((t) => `passage: ${t}`))));
    onProgress?.(Math.min(i + batchSize, texts.length), texts.length);
  }
  return result;
}

export async function warmUp() {
  await embedQuery("прогрев");
}
