/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.18.2',
  promaBaseCommit: '92a635faa522d5d40544b06fdf74a28152012c71',
  formalMergeCommit: 'fc8e8f3d976e2a187b5c8fa610dbdbbd2bb42d79',
  catSchema: 16,
  promptVersion: '3.1.1',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
