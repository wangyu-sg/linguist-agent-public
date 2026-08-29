/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.19.1',
  promaBaseCommit: '3f1725c5b2e46c6aa85d64c175870c1fcb3bb5ed',
  formalMergeCommit: '8819a4a0990dfedffb691bf1e5cc04cc78a0d6d5',
  catSchema: 18,
  promptVersion: '3.1.2',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
