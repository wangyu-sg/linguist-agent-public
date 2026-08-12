/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.17.15',
  promaBaseCommit: '73e9d014b56dfda7554011bc02cf8ee5af2c5493',
  formalMergeCommit: '2ade7e7e045ce6beab817778b1b39f897045fdf3',
  catSchema: 15,
  promptVersion: '3.1.0',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
