"use client";

import {
  Check,
  Eraser,
  Paintbrush,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export type NormalizedPoint = { x: number; y: number };

export type MaskStroke = {
  points: NormalizedPoint[];
  radius: number;
  mode: "add" | "erase";
};

export type DetectionRegion = {
  points: NormalizedPoint[];
  kind: "handwriting" | "red_mark" | "stamp" | "signature" | "unknown";
  score: number;
};

export type PageEdits = {
  page: number;
  strokes: MaskStroke[];
  regions: DetectionRegion[];
};

type PreparedImage = {
  file?: File;
  image: HTMLImageElement;
  objectUrl?: string;
};

type ImageEditorProps = {
  source: File | Blob | string;
  page?: number;
  detections?: DetectionRegion[];
  initialStrokes?: MaskStroke[];
  initialRegions?: DetectionRegion[];
  detecting?: boolean;
  processing?: boolean;
  maxLongEdge?: number;
  className?: string;
  onPreparedFile?: (file: File) => void;
  onMaskChange?: (edits: PageEdits) => void;
  onApply?: (edits: PageEdits) => void;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Browser could not encode the image."))),
      type,
      quality,
    );
  });
}

async function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image could not be decoded."));
    image.src = url;
  });
  return image;
}

async function normalizeExifAndCompress(source: File | Blob, maxLongEdge: number): Promise<PreparedImage> {
  let bitmap: ImageBitmap | null = null;
  try {
    // `from-image` applies EXIF exactly once. Encoding the canvas strips EXIF,
    // making the displayed pixels and backend upload share one orientation.
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas is not available.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
    const originalName = source instanceof File ? source.name.replace(/\.[^.]+$/, "") : "page";
    const file = new File([blob], `${originalName}-normalized.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const objectUrl = URL.createObjectURL(file);
    const image = await loadHtmlImage(objectUrl);
    return { file, image, objectUrl };
  } finally {
    bitmap?.close();
  }
}

async function prepareSource(source: File | Blob | string, maxLongEdge: number): Promise<PreparedImage> {
  if (typeof source === "string") {
    return { image: await loadHtmlImage(source) };
  }
  return normalizeExifAndCompress(source, maxLongEdge);
}

function drawStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, width: number, height: number) {
  if (!stroke.points.length) return;
  const radius = stroke.radius * Math.min(width, height);
  context.save();
  context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  context.strokeStyle = "#ff3d71";
  context.fillStyle = "#ff3d71";
  context.lineWidth = radius * 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  const first = stroke.points[0];
  context.moveTo(first.x * width, first.y * height);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x * width, point.y * height);
  }
  if (stroke.points.length === 1) {
    context.arc(first.x * width, first.y * height, radius, 0, Math.PI * 2);
    context.fill();
  } else {
    context.stroke();
  }
  context.restore();
}

export default function ImageEditor({
  source,
  page = 0,
  detections = [],
  initialStrokes = [],
  initialRegions = [],
  detecting = false,
  processing = false,
  maxLongEdge = 3000,
  className = "",
  onPreparedFile,
  onMaskChange,
  onApply,
}: ImageEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1, dpr: 1 });
  const [strokes, setStrokes] = useState<MaskStroke[]>(initialStrokes);
  const [redoStack, setRedoStack] = useState<MaskStroke[]>([]);
  const [draft, setDraft] = useState<MaskStroke | null>(null);
  const [mode, setMode] = useState<"add" | "erase">("add");
  const [brushRadius, setBrushRadius] = useState(0.012);

  useEffect(() => {
    let cancelled = false;
    let loaded: PreparedImage | null = null;
    setLoadError(null);
    setPrepared(null);
    setStrokes(initialStrokes);
    setRedoStack([]);
    void prepareSource(source, maxLongEdge)
      .then((result) => {
        loaded = result;
        if (cancelled) {
          if (result.objectUrl) URL.revokeObjectURL(result.objectUrl);
          return;
        }
        setPrepared(result);
        if (result.file) onPreparedFile?.(result.file);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Image could not be loaded.");
      });
    return () => {
      cancelled = true;
      if (loaded?.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
    };
  }, [source, maxLongEdge, onPreparedFile]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !prepared) return;
    const resize = () => {
      const width = Math.max(1, Math.floor(container.clientWidth));
      const height = Math.max(1, Math.round(width * (prepared.image.naturalHeight / prepared.image.naturalWidth)));
      setCanvasSize({ width, height, dpr: Math.min(window.devicePixelRatio || 1, 3) });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [prepared]);

  useEffect(() => {
    const canvas = imageCanvasRef.current;
    if (!canvas || !prepared) return;
    const { width, height, dpr } = canvasSize;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(prepared.image, 0, 0, width, height);
  }, [prepared, canvasSize]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = canvasSize;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const mask = document.createElement("canvas");
    mask.width = Math.round(width * dpr);
    mask.height = Math.round(height * dpr);
    const maskContext = mask.getContext("2d");
    if (!maskContext) return;
    maskContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    maskContext.fillStyle = "#ff3d71";
    for (const region of detections) {
      if (region.points.length < 3) continue;
      maskContext.beginPath();
      maskContext.moveTo(region.points[0].x * width, region.points[0].y * height);
      for (const point of region.points.slice(1)) maskContext.lineTo(point.x * width, point.y * height);
      maskContext.closePath();
      maskContext.fill();
    }
    for (const stroke of draft ? [...strokes, draft] : strokes) {
      drawStroke(maskContext, stroke, width, height);
    }
    context.save();
    context.globalAlpha = 0.38;
    context.drawImage(mask, 0, 0, width, height);
    context.restore();
  }, [canvasSize, detections, draft, strokes]);

  useEffect(() => {
    onMaskChange?.({ page, strokes, regions: detections });
  }, [detections, onMaskChange, page, strokes]);

  const pointerToNormalized = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rectangle = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rectangle.left) / rectangle.width),
      y: clamp01((event.clientY - rectangle.top) / rectangle.height),
    };
  }, []);

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ points: [pointerToNormalized(event)], radius: brushRadius, mode });
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const next = pointerToNormalized(event);
    setDraft((current) => {
      if (!current) return null;
      const previous = current.points[current.points.length - 1];
      const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
      // Pointer events can fire hundreds of times per second. Removing nearly
      // identical points bounds JSON size without changing the visible stroke.
      if (distance < 0.0008) return current;
      return { ...current, points: [...current.points, next] };
    });
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setStrokes((current) => [...current, draft]);
    setRedoStack([]);
    setDraft(null);
  };

  const cancelStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
  };

  const undo = () => {
    setStrokes((current) => {
      const last = current[current.length - 1];
      if (!last) return current;
      setRedoStack((redo) => [...redo, last]);
      return current.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((current) => {
      const last = current[current.length - 1];
      if (!last) return current;
      setStrokes((existing) => [...existing, last]);
      return current.slice(0, -1);
    });
  };

  if (loadError) {
    return <div className={`image-editor image-editor--error ${className}`}>{loadError}</div>;
  }

  return (
    <section className={`image-editor ${className}`} aria-busy={!prepared}>
      <div className="image-editor__toolbar" role="toolbar" aria-label="Mask tools">
        <div className="image-editor__segment" aria-label="Drawing mode">
          <button
            type="button"
            className={mode === "add" ? "is-active" : ""}
            onClick={() => setMode("add")}
            aria-label="Add to mask"
            title="Add to mask"
          >
            <Paintbrush size={18} />
          </button>
          <button
            type="button"
            className={mode === "erase" ? "is-active" : ""}
            onClick={() => setMode("erase")}
            aria-label="Erase from mask"
            title="Erase from mask"
          >
            <Eraser size={18} />
          </button>
        </div>
        <label className="image-editor__brush-size">
          <span>Brush</span>
          <input
            type="range"
            min="0.003"
            max="0.05"
            step="0.001"
            value={brushRadius}
            onChange={(event) => setBrushRadius(Number(event.target.value))}
          />
        </label>
        <div className="image-editor__actions">
          <button type="button" onClick={undo} disabled={!strokes.length} aria-label="Undo" title="Undo">
            <Undo2 size={18} />
          </button>
          <button type="button" onClick={redo} disabled={!redoStack.length} aria-label="Redo" title="Redo">
            <Redo2 size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setStrokes([]);
              setRedoStack([]);
            }}
            disabled={!strokes.length}
            aria-label="Clear manual edits"
            title="Clear manual edits"
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            className="image-editor__apply"
            onClick={() => onApply?.({ page, strokes, regions: detections.length ? detections : initialRegions })}
            disabled={processing || detecting}
          >
            <Check size={18} />
            Apply
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="image-editor__canvas-shell"
        style={{ aspectRatio: prepared ? `${prepared.image.naturalWidth} / ${prepared.image.naturalHeight}` : "4 / 3" }}
      >
        {!prepared && <RotateCcw className="image-editor__loading" aria-label="Loading image" />}
        <canvas ref={imageCanvasRef} className="image-editor__canvas" aria-hidden="true" />
        <canvas
          ref={overlayCanvasRef}
          className="image-editor__canvas image-editor__canvas--interactive"
          onPointerDown={startStroke}
          onPointerMove={continueStroke}
          onPointerUp={finishStroke}
          onPointerCancel={cancelStroke}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Document mask editor"
        />
      </div>
    </section>
  );
}
