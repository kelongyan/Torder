import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Attachment,
  AttachmentTransferStatus,
  CreateAttachmentInput,
  CreateWebLinkAttachmentInput,
} from "../types/database";
import {
  addBrowserLocalAttachmentReference,
  addBrowserManagedAttachment,
  addBrowserWebLinkAttachment,
  deleteBrowserAttachment,
  getBrowserAttachmentTransferStatus,
  listBrowserTaskAttachments,
} from "./browserAttachmentMock";

export function listTaskAttachments(taskId: string): Promise<Attachment[]> {
  if (!isTauri()) {
    return Promise.resolve(listBrowserTaskAttachments(taskId));
  }
  return invoke<Attachment[]>("list_task_attachments", { taskId });
}

export function addManagedAttachment(
  input: CreateAttachmentInput,
): Promise<Attachment> {
  if (!isTauri()) {
    return Promise.resolve(addBrowserManagedAttachment(input));
  }
  return invoke<Attachment>("add_managed_attachment", { input });
}

export function addLocalAttachmentReference(
  input: CreateAttachmentInput,
): Promise<Attachment> {
  if (!isTauri()) {
    return Promise.resolve(addBrowserLocalAttachmentReference(input));
  }
  return invoke<Attachment>("add_local_attachment_reference", { input });
}

export function addWebLinkAttachment(
  input: CreateWebLinkAttachmentInput,
): Promise<Attachment> {
  if (!isTauri()) {
    return Promise.resolve(addBrowserWebLinkAttachment(input));
  }
  return invoke<Attachment>("add_web_link_attachment", { input });
}

export function deleteAttachment(id: string): Promise<void> {
  if (!isTauri()) {
    deleteBrowserAttachment(id);
    return Promise.resolve();
  }
  return invoke<void>("delete_attachment", { id });
}

export function openAttachment(id: string): Promise<void> {
  if (!isTauri()) {
    return Promise.reject(new Error("浏览器预览模式不支持打开附件"));
  }
  return invoke<void>("open_attachment", { id });
}

export function revealAttachment(id: string): Promise<void> {
  if (!isTauri()) {
    return Promise.reject(new Error("浏览器预览模式不支持定位附件"));
  }
  return invoke<void>("reveal_attachment", { id });
}

export function getAttachmentTransferStatus(): Promise<AttachmentTransferStatus> {
  if (!isTauri()) {
    return Promise.resolve(getBrowserAttachmentTransferStatus());
  }
  return invoke<AttachmentTransferStatus>("get_attachment_transfer_status");
}
