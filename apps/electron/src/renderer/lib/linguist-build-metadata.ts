/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.19.5',
  promaBaseCommit: 'c261cbc5344a6d4a22d30de57e489efd0e56062d',
  formalMergeCommit: 'cf2832f3ebb07a65a7af30d5834858b6a8dfec5b',
  catSchema: 18,
  promptVersion: '3.1.2',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
