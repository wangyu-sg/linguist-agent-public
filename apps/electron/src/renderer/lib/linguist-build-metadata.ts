/**
 * 已冻结的 v0.16.8 基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.16.8',
  promaBaseCommit: 'bde00f00323d6735a939d14dbce3b2f1a5b672bc',
  formalMergeCommit: 'f3d2b431996523a4aa75ec2b027dcf0e932ef08f',
  catSchema: 13,
  promptContract: 'Profile 2.1.0 · Quality Contract 1.0.0 · Project Digest 1.0.0 · Turn Context 1',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
