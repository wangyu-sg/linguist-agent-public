/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.19.26',
  promaBaseCommit: '20a5aa8f7c19b8e91949b5fd74b9eee40d767078',
  formalMergeCommit: 'ed8aedd60577ab88d1cca1f092ac5645c1da2d8f',
  catSchema: 19,
  promptVersion: '3.1.3',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
