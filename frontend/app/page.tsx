"use client";

import type { LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import {
  BookOpenCheck,
  Download,
  Eye,
  FileLock2,
  FileUp,
  ImageMinus,
  LoaderCircle,
  ScanLine,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import BeforeAfterPreview from "../components/BeforeAfterPreview";
import BatchProgressBar, { BatchJob } from "../components/BatchProgressBar";
import ImageEditor, { DetectionRegion, PageEdits } from "../components/ImageEditor";
import PdfEditor from "../components/PdfEditor";
import AgentCommandBar, { AgentCommand, AgentCommandStatus } from "../components/AgentCommandBar";
import PageThumbnailStrip from "../components/PageThumbnailStrip";
import { useDocumentPages } from "../hooks/useDocumentPages";

type Workflow = "exam" | "scan" | "contract" | "photo";
type Enhancement = "none" | "auto" | "grayscale" | "black_white";
type InpaintMethod = "auto" | "document" | "telea" | "navier_stokes" | "lama";
type OutputFormat = "pdf" | "docx" | "jpg" | "png";
type DetectionTarget = "auto" | "red_marks" | "stamp" | "handwriting" | "printed_answers" | "signature";

type WorkflowDefinition = {
  id: Workflow;
  label: string;
  section: "Teaching" | "Office" | "Image";
  description: string;
  icon: LucideIcon;
  acceptsPdf: boolean;
};

type Settings = {
  perspective: boolean;
  detectRed: boolean;
  detectBlue: boolean;
  restoreLines: boolean;
  enhancement: Enhancement;
  inpaintMethod: InpaintMethod;
  outputFormat: OutputFormat;
  templateApplyAll: boolean;
  detectionTarget: DetectionTarget;
};

type Job = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  stage: string;
  download_url?: string | null;
  error?: { code: string; message: string } | null;
};

type PreviewState = {
  page: number;
  beforeUrl: string;
  afterUrl: string;
  erasedFraction: number;
  changedFraction: number;
  repairEngine: string;
  perspectiveApplied: boolean;
};

type Capabilities = {
  inpainting: "lama" | "opencv-basic";
  segmentation: boolean;
  document_reconstruction?: boolean;
  preview: boolean;
};

// Keep browser requests same-origin. Next.js proxies /api to the FastAPI server,
// avoiding Safari's opaque "Load failed" error when CORS blocks localhost ports.
const API_BASE = "/api";
const EMPTY_REGIONS: DetectionRegion[] = [];

const WORKFLOWS: WorkflowDefinition[] = [
  { id: "exam", label: "Exam restore", section: "Teaching", description: "One-click blank paper reconstruction", icon: BookOpenCheck, acceptsPdf: true },
  { id: "scan", label: "Scan enhancer", section: "Office", description: "Deskew, crop, contrast, monochrome", icon: ScanLine, acceptsPdf: true },
  { id: "contract", label: "Contract privacy", section: "Office", description: "Signatures, personal data, clean export", icon: FileLock2, acceptsPdf: true },
  { id: "photo", label: "Image object erase", section: "Image", description: "Manual mask, original-size output", icon: ImageMinus, acceptsPdf: false },
];

const DEFAULT_SETTINGS: Record<Workflow, Settings> = {
  exam: { perspective: true, detectRed: true, detectBlue: false, restoreLines: true, enhancement: "none", inpaintMethod: "document", outputFormat: "pdf", templateApplyAll: false, detectionTarget: "auto" },
  scan: { perspective: true, detectRed: true, detectBlue: false, restoreLines: false, enhancement: "auto", inpaintMethod: "navier_stokes", outputFormat: "pdf", templateApplyAll: false, detectionTarget: "auto" },
  contract: { perspective: true, detectRed: false, detectBlue: false, restoreLines: false, enhancement: "none", inpaintMethod: "auto", outputFormat: "pdf", templateApplyAll: false, detectionTarget: "signature" },
  photo: { perspective: false, detectRed: false, detectBlue: false, restoreLines: false, enhancement: "none", inpaintMethod: "auto", outputFormat: "png", templateApplyAll: false, detectionTarget: "auto" },
};

function switchField(label: string, checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
  return (
    <label className={`setting-row ${disabled ? "is-disabled" : ""}`}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function WorkspaceApp() {
  const [workflow, setWorkflow] = useState<Workflow>("exam");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS.exam);
  const [source, setSource] = useState<File | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [editsByPage, setEditsByPage] = useState<Record<number, PageEdits>>({});
  const [detectionsByPage, setDetectionsByPage] = useState<Record<number, DetectionRegion[]>>({});
  const [detectingByPage, setDetectingByPage] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [batchPreviewConfirmed, setBatchPreviewConfirmed] = useState(false);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [job, setJob] = useState<Job | null>(null);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const [preparingBatch, setPreparingBatch] = useState(false);
  const [zipPreview, setZipPreview] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectionNotice, setDetectionNotice] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const pollTimer = useRef<number | null>(null);
  const detectionGeneration = useRef(0);
  const batchUploadGeneration = useRef(0);
  const pageFiles = useRef<Record<number, File>>({});
  const pageObjectUrls = useRef<Record<number, string>>({});
  const activePage = useRef(0);
  const lastPreviewEdits = useRef<PageEdits | null>(null);
  const previewRef = useRef<PreviewState | null>(null);
  const {
    pages,
    selectedPageId,
    setSelectedPageId,
    replacePages,
    reorderPages,
    movePage,
    clearPages,
  } = useDocumentPages([]);
  const currentWorkflow = WORKFLOWS.find((item) => item.id === workflow)!;
  const isImage = source?.type.startsWith("image/") ?? false;
  const isBatchSource = source?.type === "application/pdf" || source?.name.toLowerCase().endsWith(".zip") || false;
  const isPdf = source?.type === "application/pdf" || source?.name.toLowerCase().endsWith(".pdf") || false;
  const isZip = source?.name.toLowerCase().endsWith(".zip") || false;
  const isBusy = Boolean(
    preparingBatch ||
    job?.status === "queued" ||
    job?.status === "processing" ||
    (batchJob && !["awaiting_template", "completed", "failed", "cancelled"].includes(batchJob.status)),
  );
  const acceptedTypes = currentWorkflow.acceptsPdf
    ? "image/jpeg,image/png,image/webp,application/pdf,application/zip,.zip"
    : "image/jpeg,image/png,image/webp";

  const syncPageStrip = useCallback(() => {
    const ids = Object.keys(pageFiles.current).map(Number).sort((left, right) => left - right);
    replacePages(ids.map((id) => ({ id, src: pageObjectUrls.current[id] })));
  }, [replacePages]);

  const registerPageFile = useCallback((page: number, file: File) => {
    const previousUrl = pageObjectUrls.current[page];
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    pageFiles.current[page] = file;
    pageObjectUrls.current[page] = URL.createObjectURL(file);
    syncPageStrip();
  }, [syncPageStrip]);

  const clearPageFiles = useCallback(() => {
    Object.values(pageObjectUrls.current).forEach((url) => URL.revokeObjectURL(url));
    pageObjectUrls.current = {};
    pageFiles.current = {};
    clearPages();
  }, [clearPages]);

  useEffect(() => {
    void fetch(`${API_BASE}/health`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setCapabilities(payload.capabilities ?? null))
      .catch(() => setCapabilities(null));
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current.beforeUrl);
        URL.revokeObjectURL(previewRef.current.afterUrl);
      }
      Object.values(pageObjectUrls.current).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const clearPreview = () => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current.beforeUrl);
      URL.revokeObjectURL(previewRef.current.afterUrl);
    }
    previewRef.current = null;
    setPreview(null);
    setBatchPreviewConfirmed(false);
    setView("edit");
  };

  const resetFileState = () => {
    detectionGeneration.current += 1;
    batchUploadGeneration.current += 1;
    clearPageFiles();
    activePage.current = 0;
    lastPreviewEdits.current = null;
    setSource(null);
    setUploadFile(null);
    setEditsByPage({});
    setDetectionsByPage({});
    setDetectingByPage({});
    setJob(null);
    setBatchJob(null);
    setPreparingBatch(false);
    setZipPreview(null);
    setError(null);
    setDetectionNotice(null);
    clearPreview();
  };

  const chooseWorkflow = (next: Workflow) => {
    if (next === workflow) return;
    resetFileState();
    setWorkflow(next);
    setSettings(DEFAULT_SETTINGS[next]);
  };

  const prepareBatchUpload = useCallback(async (file: File) => {
    const generation = ++batchUploadGeneration.current;
    setPreparingBatch(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("prepare_only", "true");
    form.set("workflow", workflow === "photo" ? "scan" : workflow);
    form.set("output_format", settings.outputFormat === "docx" ? "docx" : "pdf");
    try {
      const response = await fetch(`${API_BASE}/v1/scan/upload`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Batch preparation failed.");
      if (generation === batchUploadGeneration.current) setBatchJob(payload);
    } catch (prepareError) {
      if (generation === batchUploadGeneration.current) {
        setBatchJob(null);
        setError(prepareError instanceof Error ? prepareError.message : "Batch preparation failed.");
      }
    } finally {
      if (generation === batchUploadGeneration.current) setPreparingBatch(false);
    }
  }, [settings.outputFormat, workflow]);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    detectionGeneration.current += 1;
    batchUploadGeneration.current += 1;
    clearPageFiles();
    activePage.current = 0;
    setSource(next);
    setUploadFile(next);
    setEditsByPage({});
    setDetectionsByPage({});
    setDetectingByPage({});
    setJob(null);
    setBatchJob(null);
    setPreparingBatch(false);
    setZipPreview(null);
    setError(null);
    setDetectionNotice(null);
    clearPreview();
    event.target.value = "";
    if (next && (next.type === "application/pdf" || next.name.toLowerCase().endsWith(".zip"))) {
      void prepareBatchUpload(next);
    }
  };

  const updatePageEdits = useCallback((next: PageEdits) => {
    activePage.current = next.page;
    setBatchPreviewConfirmed(false);
    setEditsByPage((current) => ({ ...current, [next.page]: next }));
  }, []);

  const detectPreparedPage = useCallback((file: File, page: number, replaceUpload: boolean) => {
    registerPageFile(page, file);
    activePage.current = page;
    if (replaceUpload) setUploadFile(file);
    if (workflow === "photo") {
      setDetectionsByPage((current) => ({ ...current, [page]: [] }));
      setDetectingByPage((current) => ({ ...current, [page]: false }));
      return;
    }
    const generation = ++detectionGeneration.current;
    setDetectionNotice(null);
    setDetectingByPage((current) => ({ ...current, [page]: true }));
    const form = new FormData();
    form.set("file", file);
    form.set("workflow", workflow);
    form.set("detect_red", String(settings.detectRed));
    form.set("detect_blue", String(settings.detectBlue));
    form.set("detection_target", settings.detectionTarget);
    void fetch(`${API_BASE}/v1/detect`, { method: "POST", body: form })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? "Detection failed.");
        if (generation === detectionGeneration.current) {
          setDetectionsByPage((current) => ({ ...current, [page]: payload.regions ?? [] }));
          setDetectionNotice(payload.notice ?? null);
        }
      })
      .catch((detectionError: unknown) => {
        if (generation === detectionGeneration.current) {
          setError(detectionError instanceof Error ? detectionError.message : "Detection failed.");
        }
      })
      .finally(() => {
        if (generation === detectionGeneration.current) {
          setDetectingByPage((current) => ({ ...current, [page]: false }));
        }
      });
  }, [registerPageFile, settings.detectBlue, settings.detectRed, settings.detectionTarget, workflow]);

  const setPreparedImage = useCallback(
    (file: File) => detectPreparedPage(file, 0, true),
    [detectPreparedPage],
  );
  const setPreparedPdfPage = useCallback(
    (page: number, file: File) => detectPreparedPage(file, page, false),
    [detectPreparedPage],
  );
  const setPreparedZipPage = useCallback(
    (file: File) => detectPreparedPage(file, 0, false),
    [detectPreparedPage],
  );

  useEffect(() => {
    if (!isZip || !batchJob?.id || batchJob.status !== "awaiting_template" || zipPreview) return;
    void fetch(`${API_BASE}/v1/scan/preview/${batchJob.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.error?.message ?? "First page preview is unavailable.");
        }
        const blob = await response.blob();
        setZipPreview(new File([blob], "batch-page-001.jpg", { type: "image/jpeg" }));
      })
      .catch((previewError: unknown) => {
        setError(previewError instanceof Error ? previewError.message : "First page preview is unavailable.");
      });
  }, [batchJob?.id, batchJob?.status, isZip, zipPreview]);

  useEffect(() => {
    const page = activePage.current;
    const file = pageFiles.current[page];
    if (file && workflow !== "photo") {
      detectPreparedPage(file, page, false);
    }
  }, [detectPreparedPage, workflow]);

  const appendSettings = (form: FormData) => {
    form.set("workflow", workflow);
    form.set("perspective", String(settings.perspective));
    // Detector suggestions have already been reviewed in the canvas. Running
    // color detection again would override user eraser corrections.
    form.set("detect_red", "false");
    form.set("detect_blue", "false");
    form.set("restore_lines", String(settings.restoreLines));
    form.set("enhancement", settings.enhancement);
    form.set("inpaint_method", settings.inpaintMethod);
  };

  const runPreview = useCallback(async (next: PageEdits) => {
    updatePageEdits(next);
    lastPreviewEdits.current = next;
    const hasRemoval = next.regions.length > 0 || next.strokes.some((stroke) => stroke.mode === "add");
    if (!hasRemoval) {
      setError("No removal area is selected. Use Smart, Circle, or Brush first.");
      return;
    }
    const file = pageFiles.current[next.page];
    if (!file) {
      setError("This page is still preparing. Try preview again in a moment.");
      return;
    }
    setPreviewing(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("edits", JSON.stringify([{ ...next, page: 0 }]));
    appendSettings(form);
    try {
      const response = await fetch(`${API_BASE}/v1/preview`, { method: "POST", body: form, cache: "no-store" });
      if (!response.ok) {
        let message = `Preview failed (${response.status}).`;
        try {
          const payload = await response.json();
          message = payload.error?.message ?? message;
        } catch {
          // Preserve the HTTP status when an upstream proxy returns no JSON.
        }
        throw new Error(message);
      }
      const afterBlob = await response.blob();
      if (!afterBlob.type.startsWith("image/") || afterBlob.size === 0) {
        throw new Error("The server returned an invalid preview image.");
      }
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current.beforeUrl);
        URL.revokeObjectURL(previewRef.current.afterUrl);
      }
      const nextPreview: PreviewState = {
        page: next.page,
        beforeUrl: URL.createObjectURL(file),
        afterUrl: URL.createObjectURL(afterBlob),
        erasedFraction: Number(response.headers.get("x-erased-fraction") ?? 0),
        changedFraction: Number(response.headers.get("x-changed-fraction") ?? 0),
        repairEngine: response.headers.get("x-repair-engine") ?? settings.inpaintMethod,
        perspectiveApplied: response.headers.get("x-perspective-applied") === "true",
      };
      previewRef.current = nextPreview;
      setPreview(nextPreview);
      if (isBatchSource && next.page === 0) setBatchPreviewConfirmed(true);
      setView("preview");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  }, [isBatchSource, settings, updatePageEdits, workflow]);

  const poll = async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not read job status.");
      setJob(payload);
      if (payload.status === "queued" || payload.status === "processing") {
        pollTimer.current = window.setTimeout(() => void poll(jobId), 800);
      }
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Could not read job status.");
    }
  };

  const submit = async () => {
    if (!uploadFile) return;
    setError(null);
    if (isBatchSource) {
      await prepareBatchUpload(uploadFile);
      return;
    }
    setJob({ id: "", status: "queued", progress: 0, stage: "uploading" });
    const form = new FormData();
    form.set("file", uploadFile);
    form.set("edits", JSON.stringify(Object.values(editsByPage).sort((left, right) => left.page - right.page)));
    form.set("output_format", settings.outputFormat);
    appendSettings(form);
    try {
      const response = await fetch(`${API_BASE}/v1/jobs`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Upload failed.");
      setJob(payload);
      void poll(payload.id);
    } catch (submitError) {
      setJob(null);
      setError(submitError instanceof Error ? submitError.message : "Upload failed.");
    }
  };

  const startPreparedBatch = async () => {
    if (!batchJob || batchJob.status !== "awaiting_template") return;
    setError(null);
    const form = new FormData();
    form.set("edits", JSON.stringify(Object.values(editsByPage).sort((left, right) => left.page - right.page)));
    form.set("output_format", settings.outputFormat === "docx" ? "docx" : "pdf");
    form.set("workflow", workflow === "photo" ? "scan" : workflow);
    form.set("perspective", String(settings.perspective));
    form.set("detect_red", String(settings.detectRed));
    form.set("detect_blue", String(settings.detectBlue));
    form.set("restore_lines", String(settings.restoreLines));
    form.set("enhancement", settings.enhancement);
    form.set("inpaint_method", settings.inpaintMethod);
    form.set("template_apply_all", String(settings.templateApplyAll));
    form.set("detection_target", settings.detectionTarget);
    try {
      const response = await fetch(`${API_BASE}/v1/scan/${batchJob.id}/start`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Could not start the prepared batch.");
      setBatchJob(payload);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not start the prepared batch.");
    }
  };

  const outputOptions: OutputFormat[] = workflow === "photo" ? ["png", "jpg"] : ["pdf", "docx"];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand__mark"><Sparkles size={17} /></span><span>ClearPage</span></div>
        {(["Teaching", "Office", "Image"] as const).map((section) => (
          <div className="sidebar__group" key={section}>
            <span className="sidebar__label">{section}</span>
            {WORKFLOWS.filter((item) => item.section === section).map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" className={workflow === item.id ? "is-active" : ""} onClick={() => chooseWorkflow(item.id)}>
                  <Icon size={18} /><span><strong>{item.label}</strong><small>{item.description}</small></span>
                </button>
              );
            })}
          </div>
        ))}
        <div className="model-status">
          <ShieldCheck size={17} />
          <span><strong>{capabilities?.inpainting === "lama" ? "HD photo model ready" : "Document engine ready"}</strong><small>{capabilities?.segmentation ? "Handwriting AI online" : "Color marks + structure rebuild"}</small></span>
        </div>
      </aside>

      <section className="main-workspace">
        <header className="workspace-bar">
          <div><span>{currentWorkflow.section}</span><strong>{currentWorkflow.label}</strong></div>
          {source ? (
            <div className="view-switch">
              <button type="button" className={view === "edit" ? "is-active" : ""} onClick={() => setView("edit")}><SlidersHorizontal size={16} /> Review objects</button>
              <button type="button" className={view === "preview" ? "is-active" : ""} onClick={() => preview && setView("preview")} disabled={!preview}><Eye size={16} /> Preview</button>
            </div>
          ) : null}
          <label className="file-button"><FileUp size={17} /> Open<input type="file" accept={acceptedTypes} onChange={handleFile} /></label>
        </header>

        <div className="workspace-stage">
          {!source ? (
            <label className="dropzone">
              <span className="dropzone__icon"><FileUp size={28} /></span>
              <strong>{workflow === "exam" ? "Turn a completed paper into a clean, printable copy" : currentWorkflow.label}</strong>
              <span>{currentWorkflow.acceptsPdf ? "JPG, PNG, WEBP, PDF or ZIP" : "JPG, PNG or WEBP"}</span>
              {workflow === "exam" && <div className="dropzone__pipeline"><span>1. Straighten</span><span>2. Find marks</span><span>3. Rebuild paper</span></div>}
              <input type="file" accept={acceptedTypes} onChange={handleFile} />
            </label>
          ) : view === "preview" && preview ? (
            <BeforeAfterPreview beforeUrl={preview.beforeUrl} afterUrl={preview.afterUrl} erasedFraction={preview.erasedFraction} changedFraction={preview.changedFraction} repairEngine={preview.repairEngine} perspectiveApplied={preview.perspectiveApplied} processing={previewing} onBackToEdit={() => setView("edit")} onRefresh={() => lastPreviewEdits.current && void runPreview(lastPreviewEdits.current)} />
          ) : isImage ? (
            <ImageEditor source={source} detections={detectionsByPage[0] ?? EMPTY_REGIONS} detecting={detectingByPage[0] ?? false} processing={previewing} initialStrokes={editsByPage[0]?.strokes ?? []} initialRegions={editsByPage[0]?.regions ?? EMPTY_REGIONS} onPreparedFile={setPreparedImage} onMaskChange={updatePageEdits} onApply={runPreview} />
          ) : isPdf ? (
            <PdfEditor file={source} editsByPage={editsByPage} detectionsByPage={detectionsByPage} previewing={previewing} onPageEdits={updatePageEdits} onPagePrepared={setPreparedPdfPage} onPreview={runPreview} activePage={activePage.current} onPageChange={(page) => { activePage.current = page; setSelectedPageId(page); }} />
          ) : zipPreview ? (
            <ImageEditor source={zipPreview} detections={detectionsByPage[0] ?? EMPTY_REGIONS} detecting={detectingByPage[0] ?? false} processing={previewing} initialStrokes={editsByPage[0]?.strokes ?? []} initialRegions={editsByPage[0]?.regions ?? EMPTY_REGIONS} onPreparedFile={setPreparedZipPage} onMaskChange={updatePageEdits} onApply={runPreview} />
          ) : (
            <div className="zip-batch-selected"><FileUp size={32} /><strong>{source.name}</strong><span>ZIP image batch</span></div>
          )}
        </div>
        <PageThumbnailStrip pages={pages} selectedPageId={selectedPageId} onSelect={(pageId) => { activePage.current = pageId; setSelectedPageId(pageId); }} onReorder={reorderPages} onMove={movePage} />

        {error && <div className="workspace-error">{error}</div>}
      </section>

      <aside className="inspector">
        <div className="inspector__heading"><WandSparkles size={17} /><strong>Smart restore</strong></div>
        <section className="inspector__section">
          <span className="inspector__label">Geometry</span>
          {switchField("Perspective correction", settings.perspective, (value) => setSettings((current) => ({ ...current, perspective: value })))}
          {switchField("Restore ruled lines", settings.restoreLines, (value) => setSettings((current) => ({ ...current, restoreLines: value })), !["exam", "scan"].includes(workflow))}
          {isBatchSource && switchField("Align first-page mask", settings.templateApplyAll, (value) => setSettings((current) => ({ ...current, templateApplyAll: value })))}
        </section>

        {workflow !== "photo" && (
          <section className="inspector__section">
            <span className="inspector__label">Detection suggestions</span>
            <label className="select-setting"><span>Removal target</span><select value={settings.detectionTarget} onChange={(event) => setSettings((current) => ({ ...current, detectionTarget: event.target.value as DetectionTarget }))}>
              <option value="auto">Auto suggestions</option>
              <option value="red_marks">Red grading marks</option>
              <option value="stamp">Red stamp / seal</option>
              <option value="handwriting">Handwriting</option>
              <option value="printed_answers">Printed answers</option>
              <option value="signature">Signature</option>
            </select></label>
            {settings.detectionTarget === "auto" && switchField("Include red marks", settings.detectRed, (value) => setSettings((current) => ({ ...current, detectRed: value })))}
            {settings.detectionTarget === "auto" && switchField("Include blue marks", settings.detectBlue, (value) => setSettings((current) => ({ ...current, detectBlue: value })))}
            {detectionNotice && <p className="quality-note">{detectionNotice}</p>}
          </section>
        )}

        <section className="inspector__section">
          <label className="select-setting"><span>Page finish</span><select value={settings.enhancement} onChange={(event) => setSettings((current) => ({ ...current, enhancement: event.target.value as Enhancement }))}>
            <option value="none">Original color</option><option value="auto">Auto contrast</option><option value="grayscale">Grayscale</option><option value="black_white">Print black & white</option>
          </select></label>
          <label className="select-setting"><span>Repair engine</span><select value={settings.inpaintMethod} onChange={(event) => setSettings((current) => ({ ...current, inpaintMethod: event.target.value as InpaintMethod }))}>
            {workflow === "exam" && <option value="document">Paper reconstruction</option>}<option value="auto">Smart default</option><option value="navier_stokes">Structure flow</option><option value="telea">Fast fill</option><option value="lama" disabled={capabilities?.inpainting !== "lama"}>LaMa HD {capabilities?.inpainting !== "lama" ? "(offline)" : ""}</option>
          </select></label>
          {workflow === "photo" && capabilities?.inpainting !== "lama" && <p className="quality-note">Complex photos need the optional LaMa model. Basic repair is intended for small, simple masks.</p>}
        </section>

        <section className="inspector__section">
          <span className="inspector__label">Output</span>
          <div className="format-switch">{outputOptions.map((format) => <button key={format} type="button" className={settings.outputFormat === format ? "is-active" : ""} onClick={() => setSettings((current) => ({ ...current, outputFormat: format }))}>{format.toUpperCase()}</button>)}</div>
        </section>

        <div className="inspector__footer">
          {job && <div className="progress" aria-live="polite"><div className="progress__row"><span>{job.stage}</span><span>{job.progress}%</span></div><div className="progress__track"><span style={{ width: `${job.progress}%` }} /></div></div>}
          {batchJob && (
            <BatchProgressBar
              apiBase={API_BASE}
              task={batchJob}
              onUpdate={setBatchJob}
              onError={setError}
            />
          )}
          {job?.status === "failed" && <p className="error-message">{job.error?.message}</p>}
          {batchJob?.status === "failed" && <p className="error-message">{batchJob.error?.message}</p>}
          <button
            className="preview-button"
            type="button"
            disabled={!source || previewing || (!isImage && !isPdf && !zipPreview)}
            onClick={() => {
              const page = activePage.current;
              const edits = editsByPage[page] ?? { page, strokes: [], regions: detectionsByPage[page] ?? [] };
              void runPreview(edits);
            }}
          >
            {previewing ? <LoaderCircle className="spin" size={17} /> : <Eye size={17} />}
            Generate preview
          </button>
          {batchJob?.status === "completed" && batchJob.download_url ? (
            <a className="primary-button" href={`${API_BASE}${batchJob.download_url}`}><Download size={17} /> Download {settings.outputFormat.toUpperCase()}</a>
          ) : job?.status === "completed" ? (
            <a className="primary-button" href={`${API_BASE}${job.download_url}`}><Download size={17} /> Download {settings.outputFormat.toUpperCase()}</a>
          ) : batchJob?.status === "awaiting_template" ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (batchPreviewConfirmed) {
                  void startPreparedBatch();
                  return;
                }
                const edits = editsByPage[0] ?? { page: 0, strokes: [], regions: detectionsByPage[0] ?? [] };
                void runPreview(edits);
              }}
              disabled={isBusy || previewing || (isZip && !zipPreview)}
            >
              {previewing ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}
              {previewing ? "Building preview" : batchPreviewConfirmed ? "Process batch" : "Preview first page"}
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={submit} disabled={!uploadFile || isBusy}>{isBusy ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />} {isBatchSource ? "Prepare batch" : "Process file"}</button>
          )}
        </div>
      </aside>

      <AgentCommandBar
        imageId={source?.name}
        pageIds={pages.map((page) => page.id)}
        onCommand={(command: AgentCommand, status: AgentCommandStatus) => {
          if (status !== "executed") return;
          if (command.action === "reorder_pages") reorderPages(command.pages);
          if (command.action === "optimize_layout") setSelectedPageId(command.page_id);
        }}
      />
    </main>
  );
}

const ClientOnlyWorkspace = dynamic(() => Promise.resolve(WorkspaceApp), {
  ssr: false,
  loading: () => (
    <main className="workspace-boot" aria-busy="true">
      <span className="brand__mark"><Sparkles size={17} /></span>
      <LoaderCircle className="spin" size={20} />
    </main>
  ),
});

export default ClientOnlyWorkspace;
