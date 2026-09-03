/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.19.23',
  promaBaseCommit: '1ab22a17effd344c3f376538318efbf1628150ea',
  formalMergeCommit: '8ff00976ea91b83242f4c46a66d70d4dae129bac',
  catSchema: 19,
  promptVersion: '3.1.2',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
