"use client";

import { FormEvent, useState } from "react";
import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";

export type AgentCommand =
  | { action: "erase"; target: string; region?: number[] }
  | { action: "reorder_pages"; pages: number[] }
  | { action: "optimize_layout"; page_id: number };
export type AgentCommandStatus = "command_ready" | "executed";
type Props = { imageId?: string; pageIds?: number[]; onCommand?: (command: AgentCommand, status: AgentCommandStatus) => void };

export default function AgentCommandBar({ imageId, pageIds, onCommand }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastCommand, setLastCommand] = useState<AgentCommand | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/v1/agent/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value, ...(imageId ? { image_id: imageId } : {}), ...(pageIds?.length ? { page_ids: pageIds } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "无法理解这条指令");
      setLastCommand(payload.command);
      onCommand?.(payload.command, payload.status === "executed" ? "executed" : "command_ready");
      setText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-bar" aria-label="AI 图片处理指令">
      <div className="agent-bar__title"><Sparkles size={16} aria-hidden="true" /><span>AI 指令</span></div>
      <form onSubmit={submit} className="agent-bar__form">
        <label htmlFor="agent-command" className="sr-only">描述要处理的内容</label>
        <input id="agent-command" value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：清除这张图的红笔字迹" maxLength={2000} disabled={busy} />
        {text && <button type="button" className="agent-bar__clear" onClick={() => setText("")} aria-label="清空指令"><X size={16} /></button>}
        <button type="submit" className="agent-bar__submit" disabled={!text.trim() || busy} aria-label="执行指令">
          {busy ? <Loader2 size={17} className="spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
      {lastCommand && <p className="agent-bar__result" role="status">已识别：{lastCommand.action === "erase" ? (lastCommand.target === "red_ink" ? "红笔字迹" : lastCommand.target) : lastCommand.action === "reorder_pages" ? "页面顺序" : `第 ${lastCommand.page_id + 1} 页版面`}</p>}
      {error && <p className="agent-bar__error" role="alert">{error}</p>}
    </div>
  );
}
