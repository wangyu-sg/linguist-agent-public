/**
 * 当前集成基线显示信息。
 *
 * 仅供 About 与 Linguist Diagnostics 展示；运行时合同的权威定义仍在各自模块中。
 */
declare const __APP_VERSION__: string

export const LINGUIST_BUILD_METADATA = {
  linguistAgentVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  promaBaseVersion: '0.17.26',
  promaBaseCommit: 'db94285a6c6eaeea6a75a3fcf9d67a22e8bc45ba',
  formalMergeCommit: '0a09ee5e53e8ed647a4b130bce1d73c4631bd67e',
  catSchema: 16,
  promptVersion: '3.1.0',
  hostContract: '未单独版本化',
  hostContractDetail: '代码未定义独立 runtime version constant',
} as const
