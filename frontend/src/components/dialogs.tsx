"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getCase } from "@/lib/api";
import { useLibrary } from "@/lib/library-context";
import { useSearch } from "@/lib/search-context";
import type { CaseDetail, CaseSummary, Folder } from "@/lib/types";
import { Modal, useToast } from "@/lib/ui";
import { Icon } from "./Icon";

export function FolderDialog({ folder, onClose }: { folder: Folder | null; onClose: () => void }) {
  const { folders, errors, saveFolder, deleteFolder } = useLibrary();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function commit() {
    const n = name.trim();
    if (!n) return setError("Введите название папки");
    if (errors.folders) return setError("Список папок не загрузился — обновите страницу и повторите");
    if (folders.some((f) => f.name.toLowerCase() === n.toLowerCase() && f.id !== folder?.id)) {
      return setError("Папка с таким названием уже существует");
    }
    setBusy(true);
    try {
      await saveFolder(folder?.id ?? null, n, description.trim());
      onClose();
      toast("Папка сохранена");
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 404 ? e.message : "Не удалось сохранить папку");
      setBusy(false);
    }
  }

  async function remove() {
    if (!folder) return;
    setBusy(true);
    try {
      await deleteFolder(folder.id);
      onClose();
      router.push("/folders");
      toast("Папка удалена");
    } catch (e) {
      setBusy(false);
      toast(e instanceof ApiError ? e.message : "Не удалось удалить папку");
    }
  }

  if (confirmDelete) {
    return (
      <Modal
        title="Удалить папку?"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="btn danger" onClick={remove} disabled={busy}>
              Удалить папку
            </button>
          </>
        }
      >
        <p>Папка будет удалена. Документы останутся в поиске и избранном.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={folder ? "Настройки папки" : "Новая папка"}
      onClose={onClose}
      footer={
        <>
          {folder && (
            <button type="button" className="btn danger tiny" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" />
              Удалить
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn primary" onClick={commit} disabled={busy}>
            {folder ? "Сохранить" : "Создать папку"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <label className="field">
          Название
          <input
            type="text"
            maxLength={70}
            placeholder="Например, Спор с подрядчиком"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
          />
        </label>
        <label className="field" style={{ marginTop: 16 }}>
          Описание
          <input
            type="text"
            maxLength={150}
            placeholder="Какие материалы вы собираете"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="error" aria-live="polite">
          {error}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function SaveToFolderDialog({ doc, onClose }: { doc: CaseSummary; onClose: () => void }) {
  const { folders, errors, setDocFolders } = useLibrary();
  const toast = useToast();
  const [checked, setChecked] = useState<string[]>(
    folders.filter((f) => f.items.some((i) => i.document_id === doc.id)).map((f) => f.id),
  );
  const [busy, setBusy] = useState(false);

  async function commit() {
    setBusy(true);
    try {
      await setDocFolders(doc, checked);
      onClose();
      toast("Документ сохранен");
    } catch (e) {
      setBusy(false);
      toast(e instanceof ApiError ? e.message : "Не удалось сохранить документ");
    }
  }

  return (
    <Modal
      title="Сохранить в папку"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn primary" onClick={commit} disabled={busy || !folders.length}>
            Сохранить
          </button>
        </>
      }
    >
      <p>{errors.folders ? "Список папок не загрузился — обновите страницу и повторите." : "Выберите папки для документа."}</p>
      {folders.map((f) => (
        <label key={f.id} className="folder-choice">
          <input
            type="checkbox"
            checked={checked.includes(f.id)}
            onChange={(e) =>
              setChecked(e.target.checked ? [...checked, f.id] : checked.filter((x) => x !== f.id))
            }
          />
          <Icon name="folder" />
          <span>{f.name}</span>
        </label>
      ))}
      {!folders.length && !errors.folders && <p>Создайте первую папку в разделе «Папки».</p>}
    </Modal>
  );
}

export function ChooseCasesDialog({ onClose }: { onClose: () => void }) {
  const { result, selected, setSelected } = useSearch();
  const router = useRouter();
  const [checked, setChecked] = useState<string[]>(selected);
  const cases = result?.cases ?? [];

  return (
    <Modal
      title="Дела в сравнительной таблице"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              // порядок столбцов — как в выдаче
              setSelected(cases.filter((c) => checked.includes(c.id)).map((c) => c.id));
              onClose();
              router.push("/compare");
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <p>Отметьте дела из выдачи, которые нужно сопоставить.</p>
      {cases.map((c) => (
        <label key={c.id} className="folder-choice">
          <input
            type="checkbox"
            checked={checked.includes(c.id)}
            onChange={(e) => setChecked(e.target.checked ? [...checked, c.id] : checked.filter((x) => x !== c.id))}
          />
          <span>{c.title}</span>
        </label>
      ))}
      {!cases.length && <p>Сначала выполните поиск — здесь появятся найденные решения.</p>}
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{text}</p>
    </Modal>
  );
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Где цитата в полном тексте: кавычки и многоточие по краям цитаты в тексте акта не
 * встречаются, а пробелы и переносы строк в цитате и в тексте могут не совпадать.
 */
function locateQuote(text: string, quote: string): [number, number] | null {
  const q = quote.replace(/^[\s«"„]+|[\s»"“…]+$/g, "");
  if (!q) return null;
  for (const needle of [q, q.slice(0, 80)]) {
    const words = needle.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const m = new RegExp(words.map(escapeRegExp).join("\\s+")).exec(text);
    if (m) return [m.index, m.index + m[0].length];
  }
  return null;
}

export function FullTextDialog({
  doc,
  demo,
  highlightQuote = false,
  onClose,
}: {
  doc: CaseDetail;
  demo: boolean;
  /** Открыть сразу на ключевом фрагменте и подсветить его */
  highlightQuote?: boolean;
  onClose: () => void;
}) {
  const markRef = useRef<HTMLElement>(null);
  // В выдаче полного текста нет (он большой) — догружаем карточку при открытии окна.
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null);
  const needsLoad = doc.full_text == null && !demo;
  useEffect(() => {
    if (!needsLoad) return;
    let cancelled = false;
    getCase(doc.id)
      .then((c) => !cancelled && setLoaded({ id: doc.id, text: c.full_text ?? "" }))
      .catch(() => !cancelled && setLoaded({ id: doc.id, text: "" }));
    return () => {
      cancelled = true;
    };
  }, [doc.id, needsLoad]);
  const loading = needsLoad && loaded?.id !== doc.id;
  const text = doc.full_text ?? (loaded?.id === doc.id ? loaded.text : "");
  const range = highlightQuote && text ? locateQuote(text, doc.quote) : null;

  // текст может прийти позже открытия окна — прокручиваем к цитате, когда она появилась
  const rangeStart = range?.[0];
  useEffect(() => {
    if (rangeStart !== undefined) markRef.current?.scrollIntoView({ block: "center" });
  }, [rangeStart]);

  return (
    <Modal
      title="Текст документа"
      wide
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Закрыть
        </button>
      }
    >
      {demo && <p className="small">Демонстрационный материал — текст судебного акта вымышлен.</p>}
      <h3>{doc.long_title}</h3>
      {loading ? (
        <div aria-busy="true" aria-label="Загружаем текст документа" style={{ marginTop: 16 }}>
          <span className="skeleton w80" />
          <span className="skeleton" />
          <span className="skeleton w60" />
        </div>
      ) : text ? (
        <>
          {highlightQuote && !range && <p className="small">Фрагмент не найден в тексте документа.</p>}
          <div className="full-text">
            {range ? (
              <>
                {text.slice(0, range[0])}
                <mark ref={markRef} id="quote-in-text">
                  {text.slice(range[0], range[1])}
                </mark>
                {text.slice(range[1])}
              </>
            ) : (
              text
            )}
          </div>
        </>
      ) : (
        <>
          <p className="small" style={{ marginTop: 12 }}>
            Полный текст судебного акта пока недоступен.
          </p>
          {doc.quote && (
            <blockquote style={{ padding: 17, background: "#edf5ff", margin: 0, fontSize: 14, lineHeight: 1.8 }}>
              {doc.quote}
            </blockquote>
          )}
        </>
      )}
    </Modal>
  );
}
