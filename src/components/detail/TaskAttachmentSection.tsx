import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Link,
  Loader2,
  MapPin,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Attachment } from "../../types/database";
import type { ToastKind } from "../../types/ui";
import {
  addLocalAttachmentReference,
  addManagedAttachment,
  addWebLinkAttachment,
  deleteAttachment,
  listTaskAttachments,
  openAttachment,
  revealAttachment,
} from "../../services/attachmentService";
import { openDownloadPage } from "../../services/appService";
import type { PendingTaskAttachment } from "../../services/pendingAttachmentService";
import { normalizeError } from "../../utils/normalizeError";

type AttachmentAddKind = "managed" | "localReference";

type ToastSink = (message: string, type: ToastKind) => void;

export function TaskAttachmentSection({
  taskId,
  onToast,
}: {
  taskId: string;
  onToast: ToastSink;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAttachments() {
    setLoading(true);
    setError(null);
    try {
      setAttachments(await listTaskAttachments(taskId));
    } catch (loadError) {
      setError(normalizeError(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setLoading(true);
      setError(null);
      void listTaskAttachments(taskId)
        .then((next) => {
          if (active) setAttachments(next);
        })
        .catch((loadError) => {
          if (active) setError(normalizeError(loadError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  async function addFiles(paths: string[], kind: AttachmentAddKind) {
    if (paths.length === 0 || mutating) return;
    setMutating(true);
    setError(null);
    let success = 0;
    const errors: string[] = [];
    for (const path of paths) {
      try {
        const input = {
          taskId,
          sourcePath: path,
          displayName: fileNameFromPath(path),
        };
        if (kind === "managed") {
          await addManagedAttachment(input);
        } else {
          await addLocalAttachmentReference(input);
        }
        success += 1;
      } catch (addError) {
        errors.push(`${fileNameFromPath(path)}：${normalizeError(addError)}`);
      }
    }
    await loadAttachments();
    setMutating(false);
    if (success > 0) {
      onToast(
        kind === "managed"
          ? `已复制 ${success} 个附件`
          : `已引用 ${success} 个本机文件`,
        "success",
      );
    }
    if (errors.length > 0) {
      setError(errors[0]);
      onToast(`${errors.length} 个附件添加失败`, "error");
    }
  }

  async function addWebLink(url: string, displayName: string) {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      await addWebLinkAttachment({ taskId, url, displayName });
      await loadAttachments();
      onToast("链接附件已添加", "success");
    } catch (addError) {
      const message = normalizeError(addError);
      setError(message);
      onToast(message, "error");
    } finally {
      setMutating(false);
    }
  }

  async function openItem(attachment: Attachment) {
    try {
      if (attachment.kind === "webLink") {
        if (!attachment.externalUrl) throw new Error("链接地址为空");
        await openDownloadPage(attachment.externalUrl);
        return;
      }
      await openAttachment(attachment.id);
    } catch (openError) {
      onToast(normalizeError(openError), "error");
    }
  }

  async function revealItem(attachment: Attachment) {
    try {
      await revealAttachment(attachment.id);
    } catch (revealError) {
      onToast(normalizeError(revealError), "error");
    }
  }

  async function removeItem(attachment: Attachment) {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      await deleteAttachment(attachment.id);
      await loadAttachments();
      onToast("附件已删除", "info");
    } catch (deleteError) {
      const message = normalizeError(deleteError);
      setError(message);
      onToast(message, "error");
    } finally {
      setMutating(false);
    }
  }

  return (
    <section className="detail-section attachment-section">
      <div className="detail-section-header">
        <strong>附件</strong>
        <span className="attachment-section-meta">
          {loading ? "加载中" : `${attachments.length}/50`}
        </span>
      </div>

      <AttachmentDropZone
        disabled={mutating}
        onAddFiles={(paths, kind) => void addFiles(paths, kind)}
        onAddWebLink={(url, displayName) => void addWebLink(url, displayName)}
        onError={(message) => {
          setError(message);
          onToast(message, "error");
        }}
      />

      {error && (
        <div className="attachment-inline-alert" role="alert">
          <AlertCircle aria-hidden="true" className="icon-sm" />
          <span>{error}</span>
        </div>
      )}

      <div className="attachment-list">
        {attachments.map((attachment) => (
          <AttachmentRow
            key={attachment.id}
            attachment={attachment}
            disabled={mutating}
            onOpen={() => void openItem(attachment)}
            onReveal={() => void revealItem(attachment)}
            onDelete={() => void removeItem(attachment)}
          />
        ))}
        {!loading && attachments.length === 0 && (
          <p className="attachment-empty">拖入文件，或添加一个链接。</p>
        )}
      </div>

      {mutating && (
        <div className="attachment-busy">
          <Loader2 aria-hidden="true" className="icon-sm is-spinning" />
          <span>处理中...</span>
        </div>
      )}
    </section>
  );
}

export function PendingAttachmentSection({
  value,
  onChange,
  disabled = false,
  onToast,
}: {
  value: PendingTaskAttachment[];
  onChange: (value: PendingTaskAttachment[]) => void;
  disabled?: boolean;
  onToast?: ToastSink;
}) {
  function addFiles(paths: string[], kind: AttachmentAddKind) {
    const next = paths.map<PendingTaskAttachment>((path) => ({
      id: `pending-attachment-${crypto.randomUUID()}`,
      kind,
      sourcePath: path,
      displayName: fileNameFromPath(path),
    }));
    onChange([...value, ...next]);
    onToast?.(
      kind === "managed"
        ? `已暂存 ${next.length} 个待复制附件`
        : `已暂存 ${next.length} 个本机引用`,
      "info",
    );
  }

  function addWebLink(url: string, displayName: string) {
    onChange([
      ...value,
      {
        id: `pending-attachment-${crypto.randomUUID()}`,
        kind: "webLink",
        url,
        displayName,
      },
    ]);
    onToast?.("已暂存链接附件", "info");
  }

  function remove(id: string) {
    onChange(value.filter((attachment) => attachment.id !== id));
  }

  return (
    <section className="detail-section attachment-section">
      <div className="detail-section-header">
        <strong>附件</strong>
        <span className="attachment-section-meta">{value.length} 个待添加</span>
      </div>
      <AttachmentDropZone
        disabled={disabled}
        onAddFiles={(paths, kind) => addFiles(paths, kind)}
        onAddWebLink={(url, displayName) => addWebLink(url, displayName)}
        onError={(message) => onToast?.(message, "error")}
      />
      <div className="attachment-list">
        {value.map((attachment) => (
          <div key={attachment.id} className="attachment-row pending">
            <div className="attachment-row-icon">
              {attachment.kind === "webLink" ? (
                <Link aria-hidden="true" />
              ) : (
                <Paperclip aria-hidden="true" />
              )}
            </div>
            <div className="attachment-row-main">
              <strong>{attachment.displayName}</strong>
              <span>{kindLabel(attachment.kind)}</span>
            </div>
            <button
              type="button"
              className="icon-button compact"
              onClick={() => remove(attachment.id)}
              disabled={disabled}
              aria-label="移除待添加附件"
              title="移除"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
        {value.length === 0 && (
          <p className="attachment-empty">可先添加附件，创建任务后自动绑定。</p>
        )}
      </div>
    </section>
  );
}

function AttachmentDropZone({
  disabled,
  onAddFiles,
  onAddWebLink,
  onError,
}: {
  disabled: boolean;
  onAddFiles: (paths: string[], kind: AttachmentAddKind) => void;
  onAddWebLink: (url: string, displayName: string) => void;
  onError: (message: string) => void;
}) {
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const zoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed || disabled) return;
        const payload = event.payload;
        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(
            isPointInsideZone(
              payload.position.x,
              payload.position.y,
              zoneRef.current,
            ),
          );
          return;
        }
        if (payload.type === "drop") {
          const inside = isPointInsideZone(
            payload.position.x,
            payload.position.y,
            zoneRef.current,
          );
          setDragActive(false);
          if (inside) setPendingPaths(payload.paths.filter(Boolean));
        }
      })
      .then((dispose) => {
        // 竞态防护：effect 可能在 Promise 解决前已卸载，直接释放避免累积失效监听
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch((error) => onError(normalizeError(error)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [disabled, onError]);

  async function chooseFiles() {
    if (disabled) return;
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await openFileDialog({
        multiple: true,
        directory: false,
        title: "选择附件",
      });
      const paths = normalizeSelectedPaths(selected);
      if (paths.length > 0) setPendingPaths(paths);
    } catch (error) {
      onError(normalizeError(error));
    }
  }

  function handleBrowserDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled || isTauri()) return;
    const paths = Array.from(event.dataTransfer.files)
      .filter((file) => file.name)
      .map((file) => file.name);
    if (paths.length > 0) setPendingPaths(paths);
  }

  function confirmFiles(kind: AttachmentAddKind) {
    const paths = [...pendingPaths];
    setPendingPaths([]);
    if (paths.length > 0) onAddFiles(paths, kind);
  }

  function submitLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const displayName = linkName.trim() || webLinkDisplayName(url);
    setLinkUrl("");
    setLinkName("");
    setLinkOpen(false);
    onAddWebLink(url, displayName);
  }

  return (
    <div className="attachment-composer">
      <div
        ref={zoneRef}
        className={`attachment-drop-zone ${dragActive ? "is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled && !isTauri()) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleBrowserDrop}
      >
        <Paperclip aria-hidden="true" className="icon-sm" />
        <span>拖入文件到这里</span>
        <div className="attachment-drop-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void chooseFiles()}
            disabled={disabled}
          >
            <FilePlus2 aria-hidden="true" className="icon-sm" />
            选择文件
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setLinkOpen((open) => !open)}
            disabled={disabled}
          >
            <Link aria-hidden="true" className="icon-sm" />
            添加链接
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => {
            const paths = Array.from(event.currentTarget.files ?? [])
              .filter((file) => file.name)
              .map((file) => file.name);
            event.currentTarget.value = "";
            if (paths.length > 0) setPendingPaths(paths);
          }}
        />
      </div>

      {pendingPaths.length > 0 && (
        <div className="attachment-mode-panel">
          <div>
            <strong>添加 {pendingPaths.length} 个文件</strong>
            <span>选择复制到应用内，或只引用本机路径。</span>
          </div>
          <div className="attachment-mode-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => confirmFiles("managed")}
              disabled={disabled}
            >
              <Upload aria-hidden="true" className="icon-sm" />
              复制文件
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => confirmFiles("localReference")}
              disabled={disabled}
            >
              <MapPin aria-hidden="true" className="icon-sm" />
              引用路径
            </button>
            <button
              type="button"
              className="icon-button compact"
              onClick={() => setPendingPaths([])}
              disabled={disabled}
              aria-label="取消添加附件"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {linkOpen && (
        <form
          className="attachment-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitLink();
          }}
        >
          <input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://example.com/file"
            disabled={disabled}
          />
          <input
            value={linkName}
            onChange={(event) => setLinkName(event.target.value)}
            placeholder="显示名称，可选"
            disabled={disabled}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={disabled || !linkUrl.trim()}
          >
            添加
          </button>
        </form>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  disabled,
  onOpen,
  onReveal,
  onDelete,
}: {
  attachment: Attachment;
  disabled: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const status = attachmentStatusText(attachment);
  return (
    <div
      className={`attachment-row ${attachment.syncState === "failed" || attachment.syncState === "missing" ? "has-error" : ""}`}
    >
      <div className="attachment-row-icon">
        {attachment.kind === "webLink" ? (
          <Link aria-hidden="true" />
        ) : (
          <Paperclip aria-hidden="true" />
        )}
      </div>
      <div className="attachment-row-main">
        <strong>{attachment.displayName}</strong>
        <span>
          {kindLabel(attachment.kind)}
          {attachment.sizeBytes !== null
            ? ` · ${formatBytes(attachment.sizeBytes)}`
            : ""}
          {status ? ` · ${status}` : ""}
        </span>
      </div>
      <div className="attachment-row-actions">
        <button
          type="button"
          className="icon-button compact"
          onClick={onOpen}
          disabled={disabled}
          aria-label={
            attachment.kind === "webLink" ? "打开链接附件" : "打开附件"
          }
          title={attachment.kind === "webLink" ? "打开链接" : "打开"}
        >
          <ExternalLink aria-hidden="true" />
        </button>
        {attachment.kind !== "webLink" && (
          <button
            type="button"
            className="icon-button compact"
            onClick={onReveal}
            disabled={disabled}
            aria-label="定位附件"
            title="定位"
          >
            <FolderOpen aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="icon-button compact danger"
          onClick={onDelete}
          disabled={disabled}
          aria-label="删除附件"
          title="删除"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function normalizeSelectedPaths(value: string | string[] | null): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function isPointInsideZone(
  x: number,
  y: number,
  element: HTMLElement | null,
): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const cssX = x / scale;
  const cssY = y / scale;
  return (
    cssX >= rect.left &&
    cssX <= rect.right &&
    cssY >= rect.top &&
    cssY <= rect.bottom
  );
}

function fileNameFromPath(path: string): string {
  return (
    path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "attachment"
  );
}

function webLinkDisplayName(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function kindLabel(
  kind: Attachment["kind"] | PendingTaskAttachment["kind"],
): string {
  if (kind === "managed") return "复制文件";
  if (kind === "localReference") return "本机引用";
  return "网页链接";
}

function attachmentStatusText(attachment: Attachment): string {
  if (attachment.kind !== "managed") return "";
  if (attachment.syncState === "pendingUpload") return "待同步";
  if (attachment.syncState === "uploaded") return "已同步";
  if (attachment.syncState === "pendingDownload") return "待下载";
  if (attachment.syncState === "downloaded") return "已下载";
  if (attachment.syncState === "missing") return "文件缺失";
  if (attachment.syncState === "failed")
    return attachment.lastError ?? "同步失败";
  return "";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
