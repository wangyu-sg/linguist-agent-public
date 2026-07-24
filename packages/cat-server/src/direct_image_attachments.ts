import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";

const DIRECT_IMAGE_MIME_TYPES: Record<string, string | undefined> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const MAX_DIRECT_IMAGES = 8;
const MAX_DIRECT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DIRECT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

export interface SelectedDirectAttachment {
  path: string;
  label: string;
}

export interface PreparedDirectImageAttachments {
  images: ImageContent[];
  labels: string[];
  imageLabels: string[];
}

/**
 * Read only standard provider-safe image formats into Pi's documented prompt
 * content shape. Other selected files remain explicit, granted attachments
 * for Agent tools/OCR; they are deliberately not mislabeled as direct vision
 * input. Limits are checked before base64 allocation so a Chat attachment
 * cannot turn into unbounded renderer/server memory pressure.
 */
export async function prepareDirectImageAttachments(
  selected: SelectedDirectAttachment[],
): Promise<PreparedDirectImageAttachments> {
  const labels = selected.map((attachment) => attachment.label);
  const vision = selected.map((attachment) => ({
    ...attachment,
    mimeType: DIRECT_IMAGE_MIME_TYPES[extname(attachment.path).toLocaleLowerCase()],
  })).filter((attachment): attachment is SelectedDirectAttachment & { mimeType: string } => Boolean(attachment.mimeType));
  if (vision.length > MAX_DIRECT_IMAGES) {
    throw new Error(`At most ${MAX_DIRECT_IMAGES} PNG, JPEG, or WebP images can be sent directly to a model in one Run.`);
  }

  let totalBytes = 0;
  const images: ImageContent[] = [];
  for (const attachment of vision) {
    const bytes = await readFile(attachment.path);
    if (bytes.byteLength > MAX_DIRECT_IMAGE_BYTES) {
      throw new Error(`${attachment.label} is larger than the ${MAX_DIRECT_IMAGE_BYTES / 1024 / 1024} MiB direct-image limit.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_DIRECT_IMAGE_TOTAL_BYTES) {
      throw new Error(`Direct image attachments exceed the ${MAX_DIRECT_IMAGE_TOTAL_BYTES / 1024 / 1024} MiB total limit.`);
    }
    images.push({ type: "image", data: bytes.toString("base64"), mimeType: attachment.mimeType });
  }
  return { images, labels, imageLabels: vision.map((attachment) => attachment.label) };
}

export function withAttachmentContext(message: string, labels: string[], imageLabels: string[]): string {
  if (labels.length === 0) return message;
  const lines = [
    message,
    "",
    `Attached files for this request: ${labels.join(", ")}.`,
  ];
  if (imageLabels.length) lines.push(`The following are supplied directly as image input when the selected model supports vision: ${imageLabels.join(", ")}.`);
  if (labels.length > imageLabels.length) lines.push("Other attached files remain available through this Chat or Task's authorized file tools.");
  return lines.join("\n");
}

export function visibleAttachmentMessage(message: string, labels: string[]): string {
  return labels.length ? `${message}\n\n附件：${labels.join("、")}` : message;
}
