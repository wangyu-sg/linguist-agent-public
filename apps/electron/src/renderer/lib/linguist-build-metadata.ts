/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.17.46',
  promaBaseCommit: '2a73cd6b7674935b0af1bd59d84b8db1195e77fe',
  formalMergeCommit: '19584b802d31f37095714a4db48c6fa545cd2c32',
  catSchema: 16,
  promptVersion: '3.1.0',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
