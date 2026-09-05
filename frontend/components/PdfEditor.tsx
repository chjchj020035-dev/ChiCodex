"use client";

import { ChevronLeft, ChevronRight, FileWarning, LoaderCircle } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";

import ImageEditor, { DetectionRegion, PageEdits } from "./ImageEditor";

type PdfEditorProps = {
  file: File;
  editsByPage: Record<number, PageEdits>;
  detectionsByPage: Record<number, DetectionRegion[]>;
  activePage?: number;
  previewing?: boolean;
  onPageEdits: (edits: PageEdits) => void;
  onPagePrepared: (page: number, file: File) => void;
  onPreview?: (edits: PageEdits) => void;
  onPageChange?: (page: number) => void;
};

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the PDF page."))),
      "image/jpeg",
      0.92,
    );
  });
}

export default function PdfEditor({
  file,
  editsByPage,
  detectionsByPage,
  activePage,
  previewing = false,
  onPageEdits,
  onPagePrepared,
  onPreview,
  onPageChange,
}: PdfEditorProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageFile, setPageFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const renderGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    setError(null);
    setDocument(null);
    setPageFile(null);
    setPageIndex(0);
    void file.arrayBuffer()
      .then(async (data) => {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
        loadedDocument = await loadingTask.promise;
        if (loadedDocument.numPages > 50) {
          await loadedDocument.destroy();
          loadedDocument = null;
          throw new Error("PDFs are limited to 50 pages.");
        }
        if (!cancelled) setDocument(loadedDocument);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "PDF could not be opened.");
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadedDocument?.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!document) return;
    const generation = ++renderGeneration.current;
    let cancelled = false;
    setPageFile(null);
    setError(null);
    renderTaskRef.current?.cancel();
    void document.getPage(pageIndex + 1)
      .then(async (page) => {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(3.2, 2400 / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is not available.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled || generation !== renderGeneration.current) return;
        const blob = await canvasToJpeg(canvas);
        if (cancelled || generation !== renderGeneration.current) return;
        setPageFile(
          new File([blob], `page-${String(pageIndex + 1).padStart(3, "0")}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
        );
        page.cleanup();
      })
      .catch((renderError: unknown) => {
        if (cancelled || generation !== renderGeneration.current) return;
        if (renderError instanceof Error && renderError.name === "RenderingCancelledException") return;
        setError(renderError instanceof Error ? renderError.message : "PDF page could not be rendered.");
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [document, pageIndex]);

  useEffect(() => {
    if (activePage === undefined || !document) return;
    setPageIndex(Math.min(Math.max(0, activePage), Math.max(0, document.numPages - 1)));
  }, [activePage, document]);

  useEffect(() => {
    onPageChange?.(pageIndex);
  }, [onPageChange, pageIndex]);

  const currentEdits = editsByPage[pageIndex];
  const currentDetections = detectionsByPage[pageIndex] ?? [];
  const editedPages = useMemo(() => Object.keys(editsByPage).length, [editsByPage]);

  if (error) {
    return (
      <div className="pdf-editor__error">
        <FileWarning size={22} />
        {error}
      </div>
    );
  }

  return (
    <section className="pdf-editor">
      <div className="pdf-editor__navigation">
        <button
          type="button"
          onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
          disabled={pageIndex === 0}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={18} />
        </button>
        <label>
          <span>Page</span>
          <input
            type="number"
            min={1}
            max={document?.numPages ?? 1}
            value={pageIndex + 1}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                setPageIndex(Math.min((document?.numPages ?? 1) - 1, Math.max(0, value - 1)));
              }
            }}
          />
          <span>/ {document?.numPages ?? "-"}</span>
        </label>
        <button
          type="button"
          onClick={() => setPageIndex((value) => Math.min((document?.numPages ?? 1) - 1, value + 1))}
          disabled={!document || pageIndex >= document.numPages - 1}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={18} />
        </button>
        <span className="pdf-editor__edited">{editedPages} edited</span>
      </div>

      {pageFile ? (
        <ImageEditor
          key={`${file.name}:${pageIndex}`}
          source={pageFile}
          page={pageIndex}
          detections={currentDetections}
          initialStrokes={currentEdits?.strokes ?? []}
          onPreparedFile={(prepared) => onPagePrepared(pageIndex, prepared)}
          onMaskChange={onPageEdits}
          onApply={onPreview ?? onPageEdits}
          processing={previewing}
        />
      ) : (
        <div className="pdf-editor__loading">
          <LoaderCircle className="spin" size={24} />
        </div>
      )}
    </section>
  );
}
