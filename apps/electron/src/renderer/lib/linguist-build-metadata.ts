/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.17.59',
  promaBaseCommit: '4546c5f7d0fbfa4ed1d58aec63705fc75a9020c2',
  formalMergeCommit: 'f53612ca6566b58857173aa522fa73e229e5f08c',
  catSchema: 16,
  promptVersion: '3.1.0',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
