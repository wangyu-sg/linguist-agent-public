import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareDirectImageAttachments,
  visibleAttachmentMessage,
  withAttachmentContext,
} from "../packages/cat-server/src/direct_image_attachments.js";

const root = await mkdtemp(join(tmpdir(), "la-direct-images-"));
try {
  const image = join(root, "reference.png");
  const text = join(root, "brief.txt");
  await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(text, "A text attachment", "utf8");

  const prepared = await prepareDirectImageAttachments([
    { path: image, label: "reference.png" },
    { path: text, label: "brief.txt" },
  ]);
  assert.deepEqual(prepared.labels, ["reference.png", "brief.txt"]);
  assert.deepEqual(prepared.imageLabels, ["reference.png"]);
  assert.deepEqual(prepared.images, [{
    type: "image",
    mimeType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
  }]);
  assert.match(withAttachmentContext("Please review.", prepared.labels, prepared.imageLabels), /directly as image input/);
  assert.match(withAttachmentContext("Please review.", prepared.labels, prepared.imageLabels), /authorized file tools/);
  assert.equal(visibleAttachmentMessage("Please review.", prepared.labels), "Please review.\n\n附件：reference.png、brief.txt");

  const textOnly = await prepareDirectImageAttachments([{ path: text, label: "brief.txt" }]);
  assert.deepEqual(textOnly.images, []);
  assert.deepEqual(textOnly.imageLabels, []);
  console.log("direct image attachment tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
