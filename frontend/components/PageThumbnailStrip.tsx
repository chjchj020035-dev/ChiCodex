"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, GripVertical, Loader2 } from "lucide-react";
import type { DocumentPage } from "../hooks/useDocumentPages";

type Props = {
  pages: DocumentPage[];
  selectedPageId: number | null;
  onSelect: (pageId: number) => void;
  onReorder: (orderedIds: number[]) => void;
  onMove: (pageId: number, offset: -1 | 1) => void;
};

export default function PageThumbnailStrip({ pages, selectedPageId, onSelect, onReorder, onMove }: Props) {
  const [draggedId, setDraggedId] = useState<number | null>(null);

  function dropOn(targetId: number) {
    if (draggedId === null || draggedId === targetId) return;
    const ids = pages.map((page) => page.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    ids.splice(from, 1);
    ids.splice(to, 0, draggedId);
    onReorder(ids);
    setDraggedId(null);
  }

  return (
    <section className="page-strip" aria-label="文档页面缩略图">
      <div className="page-strip__header"><span>页面</span><span className="page-strip__count">{pages.length} 页</span></div>
      {pages.length === 0 ? <p className="page-strip__empty">上传多页图片后将在这里显示</p> : <div className="page-strip__list">
        {pages.map((page, index) => (
            <div key={page.id} className={`page-thumb ${selectedPageId === page.id ? "is-selected" : ""} ${draggedId === page.id ? "is-dragging" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(page.id)}>
            <button type="button" className="page-thumb__select" onClick={() => onSelect(page.id)} aria-label={`选择第 ${index + 1} 页`} aria-pressed={selectedPageId === page.id}>
              <span className="page-thumb__image-wrap"><img src={page.thumbnailSrc} alt={`第 ${index + 1} 页`} /><span className="page-thumb__status">{page.status === "optimizing" && <Loader2 size={14} className="spin" />}{page.status === "optimized" && <Check size={14} />}{page.status === "error" && <AlertCircle size={14} />}</span></span>
              <span className="page-thumb__label">{index + 1}</span>
            </button>
            <div className="page-thumb__tools">
              <button type="button" draggable aria-label={`拖动第 ${index + 1} 页`} title="拖动排序" onDragStart={() => setDraggedId(page.id)} onDragEnd={() => setDraggedId(null)}><GripVertical size={15} /></button>
              <button type="button" aria-label="向前移动" title="向前移动" disabled={index === 0} onClick={() => onMove(page.id, -1)}><ChevronLeft size={15} /></button>
              <button type="button" aria-label="向后移动" title="向后移动" disabled={index === pages.length - 1} onClick={() => onMove(page.id, 1)}><ChevronRight size={15} /></button>
            </div>
          </div>
        ))}
      </div>}
    </section>
  );
}
