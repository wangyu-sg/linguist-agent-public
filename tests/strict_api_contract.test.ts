import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { API_REQUEST_BODY_FIELDS, describeStrictApiSchema, externalApiRequestSchema, readStrictApiJsonBody, strictApiArray, strictApiBoolean, strictApiObject, strictApiOptional, strictApiString, StrictApiInputError } from "../packages/cat-server/src/strict_api_contract.js";

async function* body(value: string): AsyncGenerator<string> {
  yield value;
}

const patchSchema = strictApiObject({
  enabled: strictApiBoolean(),
  label: strictApiOptional(strictApiString({ minLength: 1, maxLength: 20 })),
  tags: strictApiArray(strictApiString({ minLength: 1, maxLength: 12 }), { maxItems: 3 }),
}, { name: "settings patch" });

assert.deepEqual(describeStrictApiSchema(patchSchema), {
  kind: "object",
  name: "settings patch",
  keys: ["enabled", "label", "tags"],
});

assert.deepEqual(await readStrictApiJsonBody(body('{"enabled":false,"label":"CAT","tags":["qa","tm"]}'), {
  contentType: "application/json; charset=utf-8",
  schema: patchSchema,
}), { enabled: false, label: "CAT", tags: ["qa", "tm"] });

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":"false","tags":[]}'), { contentType: "application/json", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError
    && error.status === 400
    && error.code === "invalid_request"
    && /enabled must be a boolean/.test(error.message),
  "a string must never be coerced with Boolean(value)",
);

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":true,"tags":["ok",7]}'), { contentType: "application/json", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError
    && error.status === 400
    && error.code === "invalid_request"
    && /tags\[1\] must be a string/.test(error.message),
  "an invalid array member must never be silently filtered",
);

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":true,"tags":[],"surprise":true}'), { contentType: "application/json", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError
    && error.status === 400
    && error.code === "invalid_request"
    && /unknown field surprise/.test(error.message),
  "unknown request fields are rejected by default",
);

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":true,"tags":[],"__proto__":{"polluted":true}}'), { contentType: "application/json", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError && /unknown field __proto__/.test(error.message),
  "prototype-named fields are unknown too",
);

assert.deepEqual(await readStrictApiJsonBody(body('{"message":"compatibility", "segmentSource":"forged but ignored"}'), {
  contentType: "application/json",
  schema: externalApiRequestSchema,
}), { message: "compatibility", segmentSource: "forged but ignored" });

await assert.rejects(
  () => readStrictApiJsonBody(body('{"message":"nope", "surprise":true}'), { contentType: "application/json", schema: externalApiRequestSchema }),
  (error: unknown) => error instanceof StrictApiInputError && /unknown field surprise/.test(error.message),
  "the shared transport schema rejects invented API fields before any route handler runs",
);

await assert.rejects(
  () => readStrictApiJsonBody(body('[true]'), { contentType: "application/json", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError && /must be a JSON object/.test(error.message),
);

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":true,"tags":[]}'), { contentType: "text/plain", schema: patchSchema }),
  (error: unknown) => error instanceof StrictApiInputError
    && error.status === 415
    && error.code === "unsupported_media_type",
);

await assert.rejects(
  () => readStrictApiJsonBody(body('{"enabled":true,"tags":["one","two","three","four"]}'), {
    contentType: "application/json",
    maxBytes: 8,
    schema: patchSchema,
  }),
  (error: unknown) => error instanceof StrictApiInputError
    && error.status === 413
    && error.code === "body_too_large",
);

const routeDirectory = new URL("../packages/cat-server/src/routes/", import.meta.url);
const routeFiles = (await readdir(routeDirectory)).filter((file) => file.endsWith(".ts"));
const bodySourceFiles = [
  new URL("../packages/cat-server/src/server.ts", import.meta.url),
  new URL("../packages/cat-server/src/task_decision_interactions.ts", import.meta.url),
  new URL("../packages/cat-server/src/task_extension_interactions.ts", import.meta.url),
  ...routeFiles.map((file) => new URL(`../packages/cat-server/src/routes/${file}`, import.meta.url)),
];
const serverSource = await readFile(new URL("../packages/cat-server/src/server.ts", import.meta.url), "utf8");
assert.match(serverSource, /readStrictApiJsonBody\(req, \{[\s\S]*schema: externalApiRequestSchema,/);
const declaredFields = new Set<string>(API_REQUEST_BODY_FIELDS);
const usedBodyFields = new Set<string>();
for (const sourceFile of bodySourceFiles) {
  const source = await readFile(sourceFile, "utf8");
  for (const match of source.matchAll(/\bbody\.([A-Za-z_][A-Za-z0-9_]*)/g)) usedBodyFields.add(match[1]!);
}
assert.deepEqual([...usedBodyFields].filter((field) => !declaredFields.has(field)).sort(), [], "every body field used by an HTTP route must be declared in the shared external vocabulary");

console.log("strict API contract tests passed");
