"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "./api";
import { toSummary } from "./format";
import type { CaseSummary, Folder, HistoryEntry } from "./types";
import { useToast } from "./ui";

export type LibraryList = "folders" | "favorites" | "history";
type LoadErrors = Record<LibraryList, boolean>;
const NO_ERRORS: LoadErrors = { folders: false, favorites: false, history: false };

type LibraryState = {
  loaded: boolean;
  /** Какие списки не удалось загрузить — экран должен показать ошибку, а не «пусто» */
  errors: LoadErrors;
  reload: () => void;
  folders: Folder[];
  favorites: CaseSummary[];
  history: HistoryEntry[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (doc: CaseSummary) => Promise<void>;
  saveFolder: (id: string | null, name: string, description: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  setDocFolders: (doc: CaseSummary, folderIds: string[]) => Promise<void>;
  removeFromFolder: (folderId: string, docId: string) => Promise<void>;
  refreshHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
};

const LibraryContext = createContext<LibraryState | null>(null);

const without = (list: CaseSummary[], id: string) => list.filter((d) => d.id !== id);
const withDoc = (list: CaseSummary[], doc: CaseSummary) => (list.some((d) => d.id === doc.id) ? list : [...list, doc]);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<LoadErrors>(NO_ERRORS);
  const [attempt, setAttempt] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [favorites, setFavorites] = useState<CaseSummary[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.getFolders(), api.getFavorites(), api.getHistory()]).then(
      ([f, fav, h]) => {
        if (cancelled) return;
        if (f.status === "fulfilled") setFolders(f.value);
        if (fav.status === "fulfilled") setFavorites(fav.value);
        if (h.status === "fulfilled") setHistory(h.value);
        setErrors({
          folders: f.status === "rejected",
          favorites: fav.status === "rejected",
          history: h.status === "rejected",
        });
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setLoaded(false);
    setAttempt((n) => n + 1);
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      setFolders(await api.getFolders());
      setErrors((e) => ({ ...e, folders: false }));
    } catch {
      // данные на сервере уже изменены; список просто обновится при следующей загрузке
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.getHistory());
      setErrors((e) => ({ ...e, history: false }));
    } catch {
      // история не критична — оставляем прежнюю
    }
  }, []);

  const fail = useCallback(
    (e: unknown) => toast(e instanceof api.ApiError ? e.message : "Не удалось сохранить изменения. Попробуйте ещё раз."),
    [toast],
  );

  const isFavorite = useCallback((id: string) => favorites.some((d) => d.id === id), [favorites]);

  // Оптимистичное изменение откатываем точечно (только затронутый документ),
  // чтобы не затереть параллельные успешные изменения других документов.
  const toggleFavorite = useCallback(
    async (doc: CaseSummary) => {
      const summary = toSummary(doc);
      const was = favorites.some((d) => d.id === doc.id);
      setFavorites((list) => (was ? without(list, doc.id) : withDoc(list, summary)));
      try {
        if (was) await api.removeFavorite(doc.id);
        else await api.addFavorite(summary);
      } catch (e) {
        setFavorites((list) => (was ? withDoc(list, summary) : without(list, doc.id)));
        fail(e);
      }
    },
    [favorites, fail],
  );

  const saveFolder = useCallback(
    async (id: string | null, name: string, description: string) => {
      // Ошибка самого сохранения пробрасывается в диалог; сбой последующего
      // обновления списка — нет (иначе повтор создаст дубликат папки).
      const saved = id ? await api.updateFolder(id, name, description) : await api.createFolder(name, description);
      if (saved) {
        setFolders((list) => (list.some((f) => f.id === saved.id) ? list.map((f) => (f.id === saved.id ? saved : f)) : [...list, saved]));
      }
      await refreshFolders();
    },
    [refreshFolders],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      await api.deleteFolder(id);
      setFolders((list) => list.filter((f) => f.id !== id));
      await refreshFolders();
    },
    [refreshFolders],
  );

  const setDocFolders = useCallback(
    async (doc: CaseSummary, folderIds: string[]) => {
      const ops: Promise<unknown>[] = [];
      for (const f of folders) {
        const item = f.items.find((i) => i.document_id === doc.id);
        const want = folderIds.includes(f.id);
        if (item && !want) ops.push(api.deleteFolderItem(f.id, item.id));
        if (!item && want) ops.push(api.addFolderItem(f.id, doc));
      }
      try {
        await Promise.all(ops);
      } finally {
        await refreshFolders();
      }
    },
    [folders, refreshFolders],
  );

  const removeFromFolder = useCallback(
    async (folderId: string, docId: string) => {
      const item = folders.find((f) => f.id === folderId)?.items.find((i) => i.document_id === docId);
      if (!item) return;
      try {
        await api.deleteFolderItem(folderId, item.id);
      } finally {
        await refreshFolders();
      }
    },
    [folders, refreshFolders],
  );

  const clearHistory = useCallback(async () => {
    await api.clearHistory();
    setHistory([]);
  }, []);

  return (
    <LibraryContext.Provider
      value={{
        loaded,
        errors,
        reload,
        folders,
        favorites,
        history,
        isFavorite,
        toggleFavorite,
        saveFolder,
        deleteFolder,
        setDocFolders,
        removeFromFolder,
        refreshHistory,
        clearHistory,
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary должен использоваться внутри LibraryProvider");
  return ctx;
}
