/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.19.37',
  promaBaseCommit: 'a987ec88fcfa05dd2448dc0ccdd9824a4b510dc6',
  formalMergeCommit: '4a7cbcecf3b0be635a6dd49f71bff70f6ac9edb1',
  catSchema: 19,
  promptVersion: '3.1.4',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
