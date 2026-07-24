# LA-112 Document Router Benchmark Policy Report

Scope: synthetic contract evidence only, created 2026-07-24.

The checked-in fixture [`profile-v1.json`](../../tests/fixtures/document-router-benchmark/profile-v1.json) has SHA-256 `e62a161f0a2b6d81ee2d221b5e5d6ff5174077d99036d4090a7be0cf84471e01`. It binds the native-text coverage threshold `0.80` to [`synthetic-report-v1.json`](../../tests/fixtures/document-router-benchmark/synthetic-report-v1.json), whose canonical JSON SHA-256 is `75c0c0c186640f2d6f30761c00bc4ec2cba7ea950f274385fcd539b54d805664`.

The profile schema is exact version 1: `schemaVersion`, `id`, `issuedAt`, `expiresAt`, `benchmarkReportSha256`, and `nativeTextCoverage`. Unknown or malformed fields and unsupported versions are refused. A missing or expired profile retains the server-owned 0.75 native/light/blocked baseline. Each Router result records the policy source, profile/report digests when present, and the threshold used for its native-versus-light reason.

This fixture proves neither OCR quality nor hardware performance. It does not qualify structured, long-horizon, remote, MinerU, or Unlimited-OCR backends; their qualification remains LA-031 and release-gate work. No real `data/**`, customer document, installed backend, credential, public mirror, or release material was read.
