export type QualityScorecardJudge = "human" | `human:${string}` | `llm:${string}`;

export interface QualityScorecardRow {
  schemaVersion: 1;
  promptVersion: string;
  modelVersion: string;
  evalSet: string;
  segNo?: number;
  segId: string;
  dimension: string;
  score: number;
  judge: QualityScorecardJudge;
  timestamp: string;
  issueTier?: "A" | "B" | "OK" | string;
  issueCategories?: string[];
}

export interface QualityScorecardBucket {
  promptVersion: string;
  dimension: string;
  count: number;
  averageScore: number;
}

export interface QualityScorecardSummary {
  rows: number;
  promptVersions: string[];
  evalSets: string[];
  buckets: QualityScorecardBucket[];
}

const RAW_TEXT_KEYS = new Set([
  "source",
  "target",
  "text",
  "sourceText",
  "targetText",
  "currentTarget",
  "proposedTarget",
  "laInitialTarget",
  "humanGoldCorrected",
  "submittedTargetObserved",
]);

function assertNoRawTextKeys(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawTextKeys(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_TEXT_KEYS.has(key)) {
      throw new Error(`Quality scorecard must not contain raw text field ${path}.${key}`);
    }
    assertNoRawTextKeys(nested, `${path}.${key}`);
  }
}

function assertScorecardRow(value: unknown, sourceName: string, lineNo: number): QualityScorecardRow {
  assertNoRawTextKeys(value, `$line${lineNo}`);
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid quality scorecard row at ${sourceName}:${lineNo}: expected object`);
  }
  const row = value as Partial<QualityScorecardRow>;
  if (row.schemaVersion !== 1) throw new Error(`Invalid quality scorecard row at ${sourceName}:${lineNo}: schemaVersion must be 1`);
  for (const key of ["promptVersion", "modelVersion", "evalSet", "segId", "dimension", "judge", "timestamp"] as const) {
    if (typeof row[key] !== "string" || !row[key]?.trim()) {
      throw new Error(`Invalid quality scorecard row at ${sourceName}:${lineNo}: ${key} is required`);
    }
  }
  if (typeof row.score !== "number" || !Number.isFinite(row.score) || row.score < 1 || row.score > 5) {
    throw new Error(`Invalid quality scorecard row at ${sourceName}:${lineNo}: score must be 1..5`);
  }
  if (row.issueCategories !== undefined && !Array.isArray(row.issueCategories)) {
    throw new Error(`Invalid quality scorecard row at ${sourceName}:${lineNo}: issueCategories must be an array`);
  }
  return row as QualityScorecardRow;
}

export function parseQualityScorecardJsonl(raw: string, sourceName = "scorecard.jsonl"): QualityScorecardRow[] {
  const rows: QualityScorecardRow[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid quality scorecard JSON at ${sourceName}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    rows.push(assertScorecardRow(parsed, sourceName, index + 1));
  });
  return rows;
}

export function summarizeQualityScorecards(rows: QualityScorecardRow[]): QualityScorecardSummary {
  const promptVersions = Array.from(new Set(rows.map((row) => row.promptVersion))).sort();
  const evalSets = Array.from(new Set(rows.map((row) => row.evalSet))).sort();
  const grouped = new Map<string, QualityScorecardRow[]>();
  for (const row of rows) {
    const key = `${row.promptVersion}\u0000${row.dimension}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const buckets = Array.from(grouped.entries())
    .map(([key, bucketRows]) => {
      const [promptVersion, dimension] = key.split("\u0000");
      const total = bucketRows.reduce((sum, row) => sum + row.score, 0);
      return {
        promptVersion,
        dimension,
        count: bucketRows.length,
        averageScore: Number((total / bucketRows.length).toFixed(2)),
      };
    })
    .sort((left, right) => left.promptVersion.localeCompare(right.promptVersion) || left.dimension.localeCompare(right.dimension));
  return {
    rows: rows.length,
    promptVersions,
    evalSets,
    buckets,
  };
}

export function renderQualityScorecardReport(rows: QualityScorecardRow[]): string {
  const summary = summarizeQualityScorecards(rows);
  const lines = [
    "# LA Quality Scorecard",
    "",
    "This report is a non-blocking Phase B product-quality signal. It is never wired into `rc:status`.",
    "",
    `Rows: ${summary.rows}`,
    `Prompt versions: ${summary.promptVersions.join(", ") || "(none)"}`,
    `Eval sets: ${summary.evalSets.join(", ") || "(none)"}`,
    "",
    "## Dimension Summary",
    "",
    "| Prompt | Dimension | Rows | Average |",
    "|---|---:|---:|---:|",
  ];
  for (const bucket of summary.buckets) {
    lines.push(`| ${bucket.promptVersion} | ${bucket.dimension} | ${bucket.count} | ${bucket.averageScore.toFixed(2)} |`);
  }
  lines.push("", "## Version Delta", "");
  if (summary.promptVersions.length < 2) {
    lines.push("Only one prompt version has scorecard rows. Capture v1 rows after the next model/judge run to produce a numeric delta.");
  } else {
    const baseline = summary.promptVersions[0];
    const baselineByDimension = new Map(
      summary.buckets.filter((bucket) => bucket.promptVersion === baseline).map((bucket) => [bucket.dimension, bucket.averageScore]),
    );
    lines.push("| Prompt | Dimension | Delta vs " + baseline + " |", "|---|---:|---:|");
    for (const bucket of summary.buckets.filter((item) => item.promptVersion !== baseline)) {
      const base = baselineByDimension.get(bucket.dimension);
      const delta = base === undefined ? "n/a" : (bucket.averageScore - base).toFixed(2);
      lines.push(`| ${bucket.promptVersion} | ${bucket.dimension} | ${delta} |`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
