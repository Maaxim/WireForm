import type { ProjectAttachment } from "./model.ts";

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENTS_SIZE = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

export function projectFileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validFilename(filename: unknown): filename is string {
  return typeof filename === "string" && Boolean(filename.trim()) &&
    filename.length <= 1024 && filename !== "." && filename !== ".." &&
    !/[\\/]/.test(filename) &&
    !Array.from(filename).some((character) => character.charCodeAt(0) < 32);
}

function safeMimeType(value: unknown) {
  return typeof value === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)
    ? value.toLowerCase()
    : "application/octet-stream";
}

/** Validates Base64 without allocating the decoded binary during project load. */
export function attachmentDataSize(data: string) {
  if (data.length % 4 !== 0) throw new Error("Invalid Base64 length.");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const body = data.slice(0, data.length - padding);
  if (/[^A-Za-z0-9+/]/.test(body)) throw new Error("Invalid Base64 content.");
  if (data && btoa(atob(data.slice(-4))) !== data.slice(-4)) {
    throw new Error("Invalid Base64 padding.");
  }
  return data.length / 4 * 3 - padding;
}

/** Reject malformed imports rather than silently dropping reference files. */
export function normalizeProjectAttachments(value: unknown): ProjectAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Project Files must be an array.");
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const label = `Project file ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${label} has invalid metadata; no files were discarded.`);
    }
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== "string" || !source.id.trim() || ids.has(source.id)) {
      throw new Error(`${label} has a missing or duplicate attachment ID.`);
    }
    ids.add(source.id);
    if (!validFilename(source.filename)) throw new Error(`${label} has an invalid filename.`);
    if (typeof source.data !== "string" || !Number.isSafeInteger(source.sizeBytes) ||
        (source.sizeBytes as number) < 0) {
      throw new Error(`${label} has invalid embedded file data or size.`);
    }
    let actualSize: number;
    try {
      actualSize = attachmentDataSize(source.data);
    } catch {
      throw new Error(`${label} (${source.filename}) contains malformed Base64; the project was not loaded.`);
    }
    if (actualSize !== source.sizeBytes) {
      throw new Error(`${label} (${source.filename}) has a size mismatch; the project was not loaded.`);
    }
    if (source.sha256 !== undefined &&
        (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.sha256))) {
      throw new Error(`${label} has an invalid SHA-256 checksum.`);
    }
    if (source.description !== undefined && typeof source.description !== "string") {
      throw new Error(`${label} has an invalid description.`);
    }
    if (source.addedAt !== undefined &&
        (typeof source.addedAt !== "string" || !Number.isFinite(Date.parse(source.addedAt)))) {
      throw new Error(`${label} has an invalid timestamp.`);
    }
    return {
      id: source.id,
      filename: source.filename,
      mimeType: safeMimeType(source.mimeType),
      sizeBytes: actualSize,
      data: source.data,
      ...(typeof source.description === "string" ? { description: source.description } : {}),
      ...(typeof source.addedAt === "string" ? { addedAt: source.addedAt } : {}),
      ...(typeof source.sha256 === "string" ? { sha256: source.sha256.toLowerCase() } : {}),
    };
  });
}

export function totalAttachmentSize(attachments: readonly ProjectAttachment[]) {
  return attachments.reduce((total, file) => total + file.sizeBytes, 0);
}

/** Existing valid over-limit files remain loadable, downloadable and removable. */
export function projectAttachmentLimitWarnings(attachments: readonly ProjectAttachment[]) {
  const warnings = attachments.flatMap((file) => file.sizeBytes > MAX_ATTACHMENT_SIZE
    ? [`${file.filename} exceeds the ${projectFileSizeLabel(MAX_ATTACHMENT_SIZE)} upload limit; its original content is preserved.`]
    : []);
  if (totalAttachmentSize(attachments) > MAX_TOTAL_ATTACHMENTS_SIZE) {
    warnings.push(`Project Files exceed the ${projectFileSizeLabel(MAX_TOTAL_ATTACHMENTS_SIZE)} total upload limit; all files are preserved. Remove or replace files before adding more.`);
  }
  return warnings;
}

export function assertProjectFilesFit(
  existing: readonly ProjectAttachment[],
  files: readonly { size: number; name: string }[],
  replacingId?: string,
) {
  let total = totalAttachmentSize(existing.filter((file) => file.id !== replacingId));
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !validFilename(file.name)) {
      throw new Error("The selected file has an invalid filename or size.");
    }
    if (file.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(`Cannot add ${file.name}. Maximum attachment size is ${projectFileSizeLabel(MAX_ATTACHMENT_SIZE)}; selected file is ${projectFileSizeLabel(file.size)}.`);
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_ATTACHMENTS_SIZE) {
    throw new Error(`Cannot add files. Maximum total Project Files size is ${projectFileSizeLabel(MAX_TOTAL_ATTACHMENTS_SIZE)}.`);
  }
}

export function attachmentBytes(file: ProjectAttachment) {
  if (attachmentDataSize(file.data) !== file.sizeBytes) throw new Error("Attachment size mismatch.");
  return Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareProjectAttachment(file: File): Promise<ProjectAttachment> {
  assertProjectFilesFit([], [file]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) throw new Error(`Could not read all bytes of ${file.name}.`);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  const checksum = await sha256(bytes);
  return {
    id: `attachment-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`,
    filename: file.name,
    mimeType: safeMimeType(file.type),
    sizeBytes: bytes.length,
    data: btoa(chunks.join("")),
    addedAt: new Date().toISOString(),
    ...(checksum ? { sha256: checksum } : {}),
  };
}

export function addProjectAttachments(
  existing: readonly ProjectAttachment[],
  additions: readonly ProjectAttachment[],
) {
  assertProjectFilesFit(existing, additions.map((file) => ({ size: file.sizeBytes, name: file.filename })));
  const ids = new Set(existing.map((file) => file.id));
  for (const file of additions) {
    if (ids.has(file.id)) throw new Error("Duplicate Project File ID.");
    ids.add(file.id);
  }
  return [...existing, ...additions];
}

export function replaceProjectAttachment(
  existing: readonly ProjectAttachment[], id: string, replacement: ProjectAttachment,
) {
  const original = existing.find((file) => file.id === id);
  if (!original) throw new Error("This project file no longer exists.");
  assertProjectFilesFit(existing, [{ size: replacement.sizeBytes, name: replacement.filename }], id);
  return existing.map((file) => file.id === id ? {
    ...replacement, id, description: original.description, addedAt: original.addedAt,
  } : file);
}

export function updateProjectAttachment(
  existing: readonly ProjectAttachment[], id: string,
  patch: { filename?: string; description?: string },
) {
  if (patch.filename !== undefined && !validFilename(patch.filename)) {
    throw new Error("Enter a filename without folder paths or control characters.");
  }
  return existing.map((file) => file.id === id ? { ...file, ...patch } : file);
}

export interface ProjectFilePreview {
  kind: "image" | "pdf" | "text" | "download";
  url?: string;
  text?: string;
  dispose: () => void;
}

/** Only raster signatures, sandboxed PDF and escaped plain text can preview. */
export function createProjectFilePreview(file: ProjectAttachment): ProjectFilePreview {
  const bytes = attachmentBytes(file);
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  let mime: string | undefined;
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) mime = "image/png";
  else if (starts(255, 216, 255)) mime = "image/jpeg";
  else if (starts(82, 73, 70, 70) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") mime = "image/webp";
  else if (starts(37, 80, 68, 70, 45)) mime = "application/pdf";
  if (mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    let disposed = false;
    return { kind: mime === "application/pdf" ? "pdf" : "image", url, dispose: () => {
      if (!disposed) URL.revokeObjectURL(url);
      disposed = true;
    } };
  }
  if (["text/plain", "text/csv"].includes(file.mimeType) || /\.(txt|csv)$/i.test(file.filename)) {
    try {
      const truncated = bytes.length > MAX_TEXT_PREVIEW_BYTES;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES), { stream: truncated },
      );
      if (text.includes("\0")) return { kind: "download", dispose: () => undefined };
      return { kind: "text", text: text + (truncated ? "\n[Preview truncated; download for the complete file.]" : ""), dispose: () => undefined };
    } catch { /* Non-UTF-8 binaries remain available for download. */ }
  }
  return { kind: "download", dispose: () => undefined };
}

export async function projectAttachmentDownloadBlob(file: ProjectAttachment) {
  const bytes = attachmentBytes(file);
  if (file.sha256) {
    const actual = await sha256(bytes);
    if (actual && actual !== file.sha256.toLowerCase()) throw new Error("Attachment checksum mismatch; download cancelled.");
  }
  // Downloads are never navigated to as active HTML/SVG/document content.
  return new Blob([bytes], { type: "application/octet-stream" });
}
