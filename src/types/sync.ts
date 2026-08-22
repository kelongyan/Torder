export type InitialSyncMode = "merge" | "upload" | "download";

export interface SyncStatus {
  state:
    | "disabled"
    | "configured"
    | "syncing"
    | "success"
    | "error"
    | "needsAuth"
    | "needsConflict"
    | "incompatible";
  configured: boolean;
  hasCredential: boolean;
  serverUrl: string | null;
  remotePath: string | null;
  username: string | null;
  deviceName: string | null;
  pendingChanges: number;
  conflictCount: number;
  phase: "prepare" | "download" | "merge" | "upload" | null;
  lastSyncAt: string | null;
  lastError: string | null;
  encryptionEnabled: boolean;
  encryptionKeyAvailable: boolean;
  encryptionKeyId: string | null;
}

export interface SyncConflict {
  id: string;
  entity: string;
  objectId: string;
  localRevision: number;
  remoteRevision: number;
  localPayloadJson: string;
  remotePayloadJson: string;
  detectedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface SyncDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastRemoteSequence: number;
  enabled: boolean;
  current: boolean;
}

export interface SyncCleanupResult {
  changesRemoved: number;
  tombstonesRemoved: number;
}

export interface SyncRemoteInspection {
  initialized: boolean;
  requiresConfirmation: boolean;
  unknownEntries: string[];
  encryptionEnabled: boolean;
  encryptionKeyId: string | null;
}
