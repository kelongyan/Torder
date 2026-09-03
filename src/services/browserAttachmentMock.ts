import type {
  Attachment,
  AttachmentTransferStatus,
  CreateAttachmentInput,
  CreateWebLinkAttachmentInput,
} from "../types/database";
import { findBrowserTask } from "./browserTaskMock";

let browserAttachments: Attachment[] = [];

export function listBrowserTaskAttachments(taskId: string): Attachment[] {
  return browserAttachments
    .filter(
      (attachment) => attachment.taskId === taskId && !attachment.deletedAt,
    )
    .sort(compareAttachments)
    .map(cloneAttachment);
}

/** F1 · T-15：与 Rust `count_task_attachments` 同口径（未删除附件按任务聚合计数）。 */
export function countBrowserTaskAttachments(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const attachment of browserAttachments) {
    if (attachment.deletedAt) continue;
    counts[attachment.taskId] = (counts[attachment.taskId] ?? 0) + 1;
  }
  return counts;
}

export function addBrowserManagedAttachment(
  input: CreateAttachmentInput,
): Attachment {
  const sourceName = sourcePathName(input.sourcePath);
  const now = new Date().toISOString();
  const attachment: Attachment = {
    ...baseAttachment(input.taskId, now),
    kind: "managed",
    blobId: `browser-blob-${crypto.randomUUID()}`,
    displayName: normalizeDisplayName(input.displayName, sourceName),
    originalName: sourceName,
    contentSha256: "browser-mock",
    sizeBytes: 0,
    localRelativePath: null,
    remotePath: null,
    syncState: "uploaded",
    localPath: null,
  };
  browserAttachments = [...browserAttachments, attachment];
  return cloneAttachment(attachment);
}

export function addBrowserLocalAttachmentReference(
  input: CreateAttachmentInput,
): Attachment {
  const sourceName = sourcePathName(input.sourcePath);
  const now = new Date().toISOString();
  const attachment: Attachment = {
    ...baseAttachment(input.taskId, now),
    kind: "localReference",
    displayName: normalizeDisplayName(input.displayName, sourceName),
    originalName: sourceName,
    localPath: input.sourcePath,
  };
  browserAttachments = [...browserAttachments, attachment];
  return cloneAttachment(attachment);
}

export function addBrowserWebLinkAttachment(
  input: CreateWebLinkAttachmentInput,
): Attachment {
  const now = new Date().toISOString();
  const attachment: Attachment = {
    ...baseAttachment(input.taskId, now),
    kind: "webLink",
    displayName: normalizeDisplayName(input.displayName, input.url),
    externalUrl: input.url.trim(),
  };
  browserAttachments = [...browserAttachments, attachment];
  return cloneAttachment(attachment);
}

export function deleteBrowserAttachment(id: string): void {
  const index = browserAttachments.findIndex(
    (attachment) => attachment.id === id && !attachment.deletedAt,
  );
  if (index < 0) throw new Error("附件不存在");
  const deletedAt = new Date().toISOString();
  browserAttachments = browserAttachments.map((attachment, attachmentIndex) =>
    attachmentIndex === index
      ? { ...attachment, updatedAt: deletedAt, deletedAt }
      : attachment,
  );
}

export function getBrowserAttachmentTransferStatus(): AttachmentTransferStatus {
  return browserAttachments.reduce<AttachmentTransferStatus>(
    (status, attachment) => {
      if (attachment.deletedAt) return status;
      if (attachment.syncState === "pendingUpload") status.pendingUpload += 1;
      if (attachment.syncState === "pendingDownload")
        status.pendingDownload += 1;
      if (attachment.syncState === "failed") status.failed += 1;
      if (attachment.syncState === "missing") status.missing += 1;
      return status;
    },
    { pendingUpload: 0, pendingDownload: 0, failed: 0, missing: 0 },
  );
}

function baseAttachment(taskId: string, timestamp: string): Attachment {
  if (!findBrowserTask(taskId)) throw new Error("任务不存在");
  return {
    id: `browser-attachment-${crypto.randomUUID()}`,
    taskId,
    kind: "managed",
    blobId: null,
    displayName: "attachment",
    originalName: null,
    externalUrl: null,
    contentSha256: null,
    sizeBytes: null,
    mimeType: null,
    localRelativePath: null,
    remotePath: null,
    encryptionKeyId: null,
    syncState: null,
    lastError: null,
    localPath: null,
    sortOrder: nextSortOrder(taskId),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function nextSortOrder(taskId: string): number {
  const current = browserAttachments
    .filter(
      (attachment) => attachment.taskId === taskId && !attachment.deletedAt,
    )
    .map((attachment) => attachment.sortOrder);
  return current.length ? Math.max(...current) + 1000 : 0;
}

function normalizeDisplayName(
  value: string | null | undefined,
  fallback: string,
): string {
  const displayName = (value?.trim() || fallback.trim() || "attachment").slice(
    0,
    512,
  );
  return displayName || "attachment";
}

function sourcePathName(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? "attachment";
}

function compareAttachments(left: Attachment, right: Attachment): number {
  if (left.sortOrder !== right.sortOrder)
    return left.sortOrder - right.sortOrder;
  return left.createdAt.localeCompare(right.createdAt);
}

function cloneAttachment(attachment: Attachment): Attachment {
  return { ...attachment };
}
