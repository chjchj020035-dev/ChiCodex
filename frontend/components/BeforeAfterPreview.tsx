"use client";

import { Columns2, Images, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

type BeforeAfterPreviewProps = {
  beforeUrl: string;
  afterUrl: string;
  processing?: boolean;
  erasedFraction?: number;
  changedFraction?: number;
  repairEngine?: string;
  perspectiveApplied?: boolean;
  onBackToEdit: () => void;
  onRefresh: () => void;
};

export default function BeforeAfterPreview({
  beforeUrl,
  afterUrl,
  processing = false,
  erasedFraction = 0,
  changedFraction = 0,
  repairEngine,
  perspectiveApplied = false,
  onBackToEdit,
  onRefresh,
}: BeforeAfterPreviewProps) {
  const [layout, setLayout] = useState<"split" | "overlay">("split");
  const [position, setPosition] = useState(50);

  return (
    <section className="comparison">
      <div className="comparison__toolbar">
        <button type="button" className="text-command" onClick={onBackToEdit}>Back to mask</button>
        <div className="comparison__segment">
          <button
            type="button"
            className={layout === "split" ? "is-active" : ""}
            onClick={() => setLayout("split")}
            aria-label="Side by side"
            title="Side by side"
          >
            <Columns2 size={17} />
          </button>
          <button
            type="button"
            className={layout === "overlay" ? "is-active" : ""}
            onClick={() => setLayout("overlay")}
            aria-label="Overlay comparison"
            title="Overlay comparison"
          >
            <Images size={17} />
          </button>
        </div>
        <div className="comparison__metrics">
          <span>{(erasedFraction * 100).toFixed(2)}% masked</span>
          {changedFraction > 0 && <span>{(changedFraction * 100).toFixed(2)}% changed</span>}
          {repairEngine && <span>{repairEngine}</span>}
          {perspectiveApplied && <span>Perspective corrected</span>}
        </div>
        <button type="button" className="icon-command" onClick={onRefresh} disabled={processing} aria-label="Refresh preview" title="Refresh preview">
          {processing ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
        </button>
      </div>

      {layout === "split" ? (
        <div className="comparison__split">
          <figure><figcaption>Original</figcaption><img src={beforeUrl} alt="Original page" /></figure>
          <figure><figcaption>Cleaned</figcaption><img src={afterUrl} alt="Cleaned page" /></figure>
        </div>
      ) : (
        <div className="comparison__overlay">
          <img src={beforeUrl} alt="Original page" />
          <div className="comparison__after" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
            <img src={afterUrl} alt="Cleaned page" />
          </div>
          <span className="comparison__divider" style={{ left: `${position}%` }} />
          <input
            type="range"
            min="0"
            max="100"
            value={position}
            onChange={(event) => setPosition(Number(event.target.value))}
            aria-label="Comparison position"
          />
        </div>
      )}
    </section>
  );
}
