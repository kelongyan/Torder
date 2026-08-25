import type { CreateAttachmentInput } from "../types/database";
import {
  addLocalAttachmentReference,
  addManagedAttachment,
  addWebLinkAttachment,
} from "./attachmentService";
import { normalizeError } from "../utils/normalizeError";

export type PendingTaskAttachment =
  | {
      id: string;
      kind: "managed";
      sourcePath: string;
      displayName: string;
    }
  | {
      id: string;
      kind: "localReference";
      sourcePath: string;
      displayName: string;
    }
  | {
      id: string;
      kind: "webLink";
      url: string;
      displayName: string;
    };

export async function attachPendingAttachments(
  taskId: string,
  attachments: PendingTaskAttachment[],
): Promise<{ created: number; failed: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];
  for (const attachment of attachments) {
    try {
      if (
        attachment.kind === "managed" ||
        attachment.kind === "localReference"
      ) {
        const input: CreateAttachmentInput = {
          taskId,
          sourcePath: attachment.sourcePath,
          displayName: attachment.displayName,
        };
        if (attachment.kind === "managed") {
          await addManagedAttachment(input);
        } else {
          await addLocalAttachmentReference(input);
        }
      } else {
        await addWebLinkAttachment({
          taskId,
          url: attachment.url,
          displayName: attachment.displayName,
        });
      }
      created += 1;
    } catch (error) {
      errors.push(`${attachment.displayName}：${normalizeError(error)}`);
    }
  }
  return { created, failed: errors.length, errors };
}
