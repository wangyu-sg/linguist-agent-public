/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.16.10',
  promaBaseCommit: '72fd1b1a474ab0375b9c126d11d3c7c4c8ed538a',
  formalMergeCommit: 'ea26177f36d59bd2781d7ff9264451a8430e2249',
  catSchema: 15,
  promptVersion: '3.0.0',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
