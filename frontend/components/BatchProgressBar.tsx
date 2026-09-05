"use client";

import { CircleAlert, LoaderCircle, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type BatchJob = {
  id: string;
  status: "queued" | "ingesting" | "processing" | "awaiting_template" | "cancel_requested" | "cancelled" | "completed" | "failed";
  progress: number;
  stage: string;
  page_count?: number;
  completed_pages?: number;
  current_page?: number;
  blank_pages?: number[];
  warnings?: Array<{ page: number; code: string; fallback: string }>;
  download_url?: string | null;
  error?: { code: string; message: string } | null;
};

type BatchProgressBarProps = {
  apiBase: string;
  task: BatchJob;
  onUpdate: (task: BatchJob) => void;
  onError: (message: string) => void;
};

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);

function stageLabel(task: BatchJob): string {
  if (task.status === "cancel_requested") return "Cancelling batch";
  if (task.status === "cancelled") return "Batch cancelled";
  if (task.stage === "splitting_pages") return "Scanning pages";
  if (task.stage === "cleaning_pages") return `Processing page ${task.current_page ?? 0}/${task.page_count ?? "-"}`;
  if (task.stage === "page_fallback") return `Page ${task.current_page ?? "-"} preserved with fallback`;
  if (task.status === "completed") return "Batch ready";
  if (task.status === "failed") return "Batch failed";
  return "Batch queued";
}

export default function BatchProgressBar({ apiBase, task, onUpdate, onError }: BatchProgressBarProps) {
  const [cancelling, setCancelling] = useState(false);
  const callbackRef = useRef({ onUpdate, onError });
  callbackRef.current = { onUpdate, onError };

  useEffect(() => {
    if (!task.id || TERMINAL_STATES.has(task.status)) return;
    const source = new EventSource(`${apiBase}/v1/scan/progress/${task.id}`);
    source.addEventListener("progress", (event) => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as BatchJob;
        callbackRef.current.onUpdate(next);
        if (TERMINAL_STATES.has(next.status)) source.close();
      } catch {
        callbackRef.current.onError("The batch server returned invalid progress data.");
        source.close();
      }
    });
    source.addEventListener("expired", () => {
      callbackRef.current.onError("This batch expired and its temporary files were removed.");
      source.close();
    });
    source.onerror = () => {
      // EventSource reconnects automatically. Report only when the browser has
      // permanently closed the stream, avoiding noisy errors during Wi-Fi hops.
      if (source.readyState === EventSource.CLOSED && !TERMINAL_STATES.has(task.status)) {
        callbackRef.current.onError("Live progress disconnected. Reopen the task to reconnect.");
      }
    };
    return () => source.close();
  }, [apiBase, task.id, task.status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const response = await fetch(`${apiBase}/v1/scan/${task.id}`, { method: "DELETE" });
      const payload = await response.json() as BatchJob & { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not cancel the batch.");
      onUpdate(payload);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not cancel the batch.");
    } finally {
      setCancelling(false);
    }
  };

  const running = !TERMINAL_STATES.has(task.status);
  const warningCount = task.warnings?.length ?? 0;
  return (
    <section className="batch-progress" aria-live="polite" aria-busy={running}>
      <div className="batch-progress__heading">
        <span>{running && <LoaderCircle className="spin" size={15} />}{stageLabel(task)}</span>
        <strong>{Math.max(0, Math.min(100, task.progress))}%</strong>
      </div>
      <div
        className="batch-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={task.progress}
      >
        <span style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} />
      </div>
      {(warningCount > 0 || (task.blank_pages?.length ?? 0) > 0) && (
        <div className="batch-progress__meta">
          <CircleAlert size={14} />
          <span>{warningCount} fallback · {task.blank_pages?.length ?? 0} blank preserved</span>
        </div>
      )}
      {running && task.status !== "cancel_requested" && (
        <button type="button" className="batch-progress__cancel" onClick={cancel} disabled={cancelling}>
          <Square size={13} fill="currentColor" /> Stop
        </button>
      )}
    </section>
  );
}
