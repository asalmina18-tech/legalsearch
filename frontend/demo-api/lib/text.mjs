// Работа с текстом судебных актов: очистка, метаданные из шапки, нарезка на фрагменты.

const MONTHS = {
  января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6,
  июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12,
};

/**
 * Текст из pdftotext → связный текст: убираем колонтитулы (номер страницы и номер дела
 * сверху каждой страницы, служебные коды документа), отметки об электронной подписи,
 * склеиваем переносы и предложения, разорванные границей страницы.
 */
export function cleanText(raw) {
  const lines = String(raw).replace(/\r/g, "").replace(/\f/g, "\n");
  // свой номер дела — из шапки; только его отдельные строки и есть колонтитул.
  // Номера других дел на отдельной строке — это ссылки в тексте, их не трогаем.
  const own = findCaseNumber(lines.slice(0, 4000));
  return lines
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^\d{1,3}$/gm, "") // номера страниц
    .replace(/^[АA]\d{1,3}-\d{1,7}\/\d{2,4}$/gm, (line) => (line.replace(/^A/, "А") === own ? "" : line)) // колонтитул
    .replace(/^(\d{1,6}\/\d{4}-\d+\(\d+\)|\d{4,}_\d{4,})$/gm, "") // служебные коды документа
    // штамп электронной подписи (бывает наложен на подписи судей — убираем построчно)
    .replace(/^(Электронная подпись действительна\.?|Данные ЭП:.*|Дата \d{2}\.\d{2}\.\d{4} \d{1,2}:\d{2}:\d{2}|Кому выдана .*)$/gm, "")
    .replace(/(\p{L})-\n+(\p{Ll})/gu, "$1$2") // перенос слова, в том числе через страницу
    .replace(/([^\n.:;])\n{2,}(\p{Ll})/gu, "$1\n$2") // предложение продолжается на следующей странице
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Строки PDF → абзацы для чтения: перенос строки оставляем только там, где закончилось
 * предложение и началось новое, и вокруг строк заглавными (шапка, «ПОСТАНОВЛЕНИЕ»,
 * «УСТАНОВИЛ:»); остальные переносы — это ширина страницы, их склеиваем пробелом.
 */
export function reflowText(text) {
  const parts = String(text).split(/(\n+)/); // [строка, разделитель, строка, …]
  let out = parts[0] ?? "";
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const prev = out.slice(out.lastIndexOf("\n") + 1);
    const next = parts[i + 1];
    // строка заглавными — заголовок; строка из цифр и знаков («№32514649373.») — нет
    const isHeader = (s) => !/\p{Ll}/u.test(s) && /\p{Lu}{2}/u.test(s);
    const header = isHeader(prev) || isHeader(next);
    const sentenceBreak =
      (/[.;!?]$/.test(prev) && /^[\p{Lu}\d«"(–—-]/u.test(next)) || (/:$/.test(prev) && /^[\p{Lu}«"(–—-]/u.test(next));
    out += header || sentenceBreak ? (parts[i].length > 1 ? "\n\n" : "\n") : " ";
    out += next;
  }
  return out;
}

const pad = (n) => String(n).padStart(2, "0");
const DATE_RE = /[«"]?(\d{1,2})[»"]?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})|(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/giu;

/** Существующая календарная дата в разумном диапазоне лет → ГГГГ-ММ-ДД, иначе "". */
function isoDate(y, m, d) {
  const [Y, M, D] = [Number(y), Number(m), Number(d)];
  if (Y < 1990 || Y > 2100 || M < 1 || M > 12 || D < 1) return "";
  if (D > new Date(Date.UTC(Y, M, 0)).getUTCDate()) return ""; // 31.02 и т. п.
  return `${Y}-${pad(M)}-${pad(D)}`;
}

/**
 * Дата акта из шапки: «14 марта 2024 года», «"14" марта 2024 г.» или «14.03.2024».
 * Дату объявления резолютивной части пропускаем — датой акта считается дата изготовления
 * в полном объеме (так же акт датирован в картотеке арбитражных дел). Даты доверенностей
 * и выписок из реестров («по доверенности от 16.12.2025») — не даты акта.
 */
export function findDate(head) {
  let first = "";
  for (const m of String(head).matchAll(DATE_RE)) {
    const iso = m[1] ? isoDate(m[3], MONTHS[m[2].toLowerCase()], m[1]) : isoDate(m[6], m[5], m[4]);
    if (!iso) continue;
    const clause = String(head).slice(Math.max(0, m.index - 100), m.index).split(/[.;]\s|\n/).pop();
    if (/доверенн|(?<!\p{L})дов\.|паспорт|выписк|ЕГРЮЛ|ЕГРИП|ОГРН|свидетельств/iu.test(clause)) continue;
    if (/резолютивн/i.test(clause) && !/изготовлен|полн/i.test(clause)) {
      first ||= iso; // если других дат нет — лучше она, чем ничего
      continue;
    }
    return iso;
  }
  return first;
}

/** Любая из форм даты («2024-03-14», «14.03.2024», «14 марта 2024») → ГГГГ-ММ-ДД или "". */
export function normalizeDate(value) {
  const s = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return findDate(s);
}

/** Номер арбитражного дела: А40-12345/2024. */
// \b в JS не считает кириллицу буквами — границы слова задаём явно.
export function findCaseNumber(text) {
  const m = /(?<![\p{L}\d])([АA]\s?\d{1,3}\s?-\s?\d{1,7}\s?\/\s?\d{2,4})(?!\d)/u.exec(text);
  return m ? m[1].replace(/\s/g, "").replace(/^A/, "А") : "";
}

const COURT_NAME = String.raw`Арбитражный суд [^.,;:()]{3,90}?|[\p{L}-]+ арбитражный апелляционный суд|Суд по интеллектуальным правам|Верховный Суд Российской Федерации`;

/**
 * Наименование суда. Надёжнее всего — из фразы «Арбитражный суд Московского округа в составе…»
 * (уже в нужном регистре); иначе из шапки, где название бывает разбито на две строки:
 * «АРБИТРАЖНЫЙ СУД» / «ЗАПАДНО-СИБИРСКОГО ОКРУГА».
 */
export function findCourt(head) {
  const body = new RegExp(`(${COURT_NAME})\\s+в\\s+составе`, "u").exec(String(head).replace(/\s+/g, " "));
  if (body) return body[1].trim();
  const lines = head.split("\n").map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /арбитражн\S*\s+(апелляционн\S*\s+)?суд|суд\s+по\s+интеллектуальным|верховн\S*\s+суд/i.test(l) && l.length < 160);
  if (i < 0) return "";
  let line = lines[i];
  if (/суд$/i.test(line) && /^[А-ЯЁ\s–-]{3,80}$/u.test(lines[i + 1] ?? "")) line += ` ${lines[i + 1]}`;
  return courtCase(line);
}

// Слова, которые в названии суда пишутся со строчной (всё остальное — имена собственные).
const COURT_LOWER = new Set([
  "арбитражный", "апелляционный", "суд", "округа", "области", "края", "города",
  "автономного", "автономной", "по", "интеллектуальным", "правам", "и", "федерации",
]);

/** «АРБИТРАЖНЫЙ СУД МОСКОВСКОГО ОКРУГА» → «Арбитражный суд Московского округа». */
export function courtCase(name) {
  const words = String(name).toLowerCase().replace(/\s+/g, " ").trim().split(" ");
  return words
    .map((w, i) => {
      if (i === 0 || (!COURT_LOWER.has(w) && /^\p{L}/u.test(w))) {
        return w.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-");
      }
      return w;
    })
    .join(" ")
    .replace(/^Верховный суд/, "Верховный Суд")
    .replace(/Российской федерации/, "Российской Федерации");
}

/**
 * Название суда в родительном падеже — для «Постановление Арбитражного суда …».
 * Склоняем слова до «суд» включительно: прилагательные (-ый/-ой → -ого, -ий → -ьего), «суд» → «суда».
 */
export function courtGenitive(court) {
  const words = String(court).split(" ");
  const idx = words.findIndex((w) => /^суд$/i.test(w));
  if (idx < 0) return court;
  return words
    .map((w, i) => {
      if (i > idx) return w;
      if (/^суд$/i.test(w)) return `${w}а`;
      if (/ий$/.test(w)) return w.replace(/ий$/, "ьего");
      if (/(ый|ой)$/.test(w)) return w.replace(/(ый|ой)$/, "ого");
      return w;
    })
    .join(" ");
}

/** «№ А40-1/2024» / «Дело № А40…» → «А40-1/2024». */
export function cleanCaseNumber(value) {
  return String(value ?? "")
    .replace(/^\s*(дело|по делу)?\s*№\s*/i, "")
    .replace(/\s+/g, "")
    .replace(/^A/, "А")
    .replace(/\/(\d{2})$/, "/20$1") // «А41-51162/26» → «А41-51162/2026»
    .trim();
}

export function findDocType(head) {
  const m = /(?<!\p{L})(ПОСТАНОВЛЕНИЕ|РЕШЕНИЕ|ОПРЕДЕЛЕНИЕ)(?!\p{L})/u.exec(head);
  return m ? m[1].charAt(0) + m[1].slice(1).toLowerCase() : "";
}

/** Метаданные, которые надёжно достаются из шапки без LLM. */
export function headerMeta(text) {
  const head = text.slice(0, 2500);
  return {
    court: findCourt(head),
    date: findDate(head),
    case_number: findCaseNumber(head) || findCaseNumber(text.slice(0, 8000)),
    doc_type: findDocType(head),
  };
}

/** Короткое имя суда для ссылок: «АС Московского округа», «9 ААС». */
const ORDINALS = [
  "первый", "второй", "третий", "четвертый", "пятый", "шестой", "седьмой", "восьмой", "девятый", "десятый",
  "одиннадцатый", "двенадцатый", "тринадцатый", "четырнадцатый", "пятнадцатый", "шестнадцатый",
  "семнадцатый", "восемнадцатый", "девятнадцатый", "двадцатый", "двадцать первый",
];

export function shortCourt(court) {
  if (!court) return "";
  return court
    .replace(/^Арбитражный суд /i, "АС ")
    // «Восемнадцатый арбитражный апелляционный суд» → «18 ААС» — так их и пишут юристы
    .replace(/^(.+?) арбитражный апелляционный суд/i, (m, ord) => {
      const n = ORDINALS.indexOf(ord.toLowerCase().replace(/ё/g, "е"));
      return `${n >= 0 ? n + 1 : ord} ААС`;
    })
    .replace(/^Суд по интеллектуальным правам/i, "СИП")
    .replace(/^Верховный Суд Российской Федерации/i, "ВС РФ");
}

export const ddmmyyyy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso);

/**
 * Нарезка на фрагменты ~size символов по границам предложений с перекрытием.
 * Возвращает [{start, end}] — сам текст не дублируем, режем из документа.
 */
export function chunkSpans(text, size = 900, overlap = 150) {
  const spans = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const window = text.slice(start + size * 0.6, end);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"), window.lastIndexOf("\n\n"));
      if (cut > 0) end = start + Math.floor(size * 0.6) + cut + 1;
    }
    spans.push({ start, end });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return spans;
}

/** Ищет цитату в тексте (с нормализацией пробелов); возвращает точный фрагмент текста или "". */
export function verbatimQuote(text, quote) {
  const q = String(quote ?? "").replace(/^[\s«"„]+|[\s»"“…]+$/g, "");
  if (q.length < 30) return "";
  const flat = text.replace(/\s+/g, " ");
  const qq = q.replace(/\s+/g, " ");
  for (const needle of [qq, qq.slice(0, 120), qq.slice(0, 70)]) {
    const i = flat.indexOf(needle);
    if (i >= 0) {
      // до конца предложения
      const endDot = flat.indexOf(".", i + Math.min(needle.length, qq.length) - 1);
      return flat.slice(i, endDot > 0 && endDot - i < 700 ? endDot + 1 : i + Math.min(qq.length, 600));
    }
  }
  return "";
}

// Сравнение по «основам» слов: первые 6 букв без учёта регистра и ё — грубо, но для поиска
// перефразированной цитаты среди предложений того же акта достаточно.
const stems = (s) => (String(s).match(/[\p{L}\d]{3,}/gu) ?? []).map((w) => w.toLowerCase().replace(/ё/g, "е").slice(0, 6));

// Слова вопроса, которые ничего не говорят о предмете спора.
const QUESTION_WORDS = new Set(
  ("можно ли как какой какая какое какие каких каким какими каков почему зачем когда где кто что чем если или либо " +
    "нужно надо должен должна должны вправе может могут мочь будет есть мне нам меня нас наш наша наше наши мой моя мое мои " +
    "свой своя свое свои этот эта это эти этого этом такой такая такие тот того том очень также только еще уже лиц " +
    "случае случаях вопрос вопросу ситуация ситуации пожалуйста подскажите скажите")
    .split(" "),
);

/**
 * Основы значимых слов для лексической проверки поиска: слова от 4 букв, без вопросительных
 * и служебных, первые 5 букв (грубая замена стеммингу для русского).
 */
export function contentStems(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().replace(/ё/g, "е").match(/[\p{L}\d]+/gu) ?? []) {
    if (w.length < 4 || QUESTION_WORDS.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

const sentencesOf = (s) =>
  String(s).replace(/\s+/g, " ").split(/(?<=[.;])\s+(?=[А-ЯЁ«"(])/u).map((x) => x.trim()).filter(Boolean);

/** F-мера совпадения двух наборов основ слов. */
function overlap(a, b) {
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  const recall = hit / (a.size || 1);
  const precision = hit / (b.size || 1);
  return recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
}

/**
 * Модель иногда пересказывает или склеивает фрагменты вместо дословной цитаты. Тогда
 * находим в тексте предложение, которое лучше всего совпадает с одним из предложений
 * «цитаты», и продолжаем, пока совпадают следующие предложения. Показываем только то,
 * что действительно написано в акте; если похожего предложения нет — "".
 */
export function closestPassage(text, quote, { minF = 0.6 } = {}) {
  const qRaw = sentencesOf(quote).filter((s) => new Set(stems(s)).size >= 5);
  const qs = qRaw.map((s) => new Set(stems(s)));
  if (!qs.length) return "";
  const ts = sentencesOf(text);
  const tw = ts.map((s) => new Set(stems(s)));
  let best = { f: 0, k: -1, j: -1 };
  for (let k = 0; k < qs.length; k++) {
    for (let j = 0; j < ts.length; j++) {
      const f = overlap(qs[k], tw[j]);
      if (f > best.f) best = { f, k, j };
    }
  }
  if (best.f < minF) return "";
  let passage = ts[best.j];
  // длинное предложение акта, а модель цитировала его хвост — начинаем с того же места
  // (заодно отрезаем «мусор» от наложенного штампа подписи в начале предложения)
  const at = passage.toLowerCase().indexOf(qRaw[best.k].toLowerCase().slice(0, 24));
  if (at > 60) passage = passage.slice(at);
  for (let k = best.k + 1, j = best.j + 1; k < qs.length && j < ts.length && passage.length < 600; k++, j++) {
    if (overlap(qs[k], tw[j]) < minF) break;
    passage += ` ${ts[j]}`;
  }
  return passage;
}
