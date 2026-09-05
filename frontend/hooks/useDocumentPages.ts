"use client";

import { useCallback, useState } from "react";

export type PageStatus = "ready" | "optimizing" | "optimized" | "error";

export type DocumentPage = {
  id: number;
  src: string;
  thumbnailSrc: string;
  status: PageStatus;
};

export type DocumentPageInput = {
  id: number;
  src: string;
  thumbnailSrc?: string;
};

function normalize(input: DocumentPageInput[]): DocumentPage[] {
  return input.map((page) => ({
    id: page.id,
    src: page.src,
    thumbnailSrc: page.thumbnailSrc ?? page.src,
    status: "ready",
  }));
}

export function useDocumentPages(initialPages: DocumentPageInput[] = []) {
  const [pages, setPages] = useState<DocumentPage[]>(() => normalize(initialPages));
  const [selectedPageId, setSelectedPageId] = useState<number | null>(pages[0]?.id ?? null);

  const replacePages = useCallback((nextPages: DocumentPageInput[]) => {
    const normalized = normalize(nextPages);
    setPages(normalized);
    setSelectedPageId(normalized[0]?.id ?? null);
  }, []);

  const reorderPages = useCallback((orderedIds: number[]) => {
    setPages((current) => {
      if (orderedIds.length !== current.length || new Set(orderedIds).size !== current.length) return current;
      const byId = new Map(current.map((page) => [page.id, page]));
      if (orderedIds.some((id) => !byId.has(id))) return current;
      return orderedIds.map((id) => byId.get(id)!);
    });
  }, []);

  const movePage = useCallback((pageId: number, offset: -1 | 1) => {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === pageId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const setPageStatus = useCallback((pageId: number, status: PageStatus) => {
    setPages((current) => current.map((page) => (page.id === pageId ? { ...page, status } : page)));
  }, []);

  const clearPages = useCallback(() => {
    setPages([]);
    setSelectedPageId(null);
  }, []);

  return {
    pages,
    selectedPageId,
    selectedPage: pages.find((page) => page.id === selectedPageId) ?? null,
    setSelectedPageId,
    replacePages,
    reorderPages,
    movePage,
    setPageStatus,
    clearPages,
  };
}
