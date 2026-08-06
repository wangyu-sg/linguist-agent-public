/**
 * LA-PROMPT-001：Linguist Prompt 多模型 renderer。
 *
 * 输入唯一真源 prompt-contract.ts 的 Canonical Prompt Contract，输出各
 * runtime 的 wire 表达：
 *
 * - `'xml'`：与 LA-PROMPT-001 之前 project-assets-prompt.ts 的输出
 *   byte 级一致（既有 nodetest golden 零改动通过即证据），Claude 路径使用。
 * - `'markdown'`：generic markdown 序列化，Pi 等 generic runtime 使用。
 *   相同层、相同 version/hash 元数据、相同正文；层元数据统一用 HTML
 *   注释头表达（markdown 正文本身不含机械可辨的层边界），输出确定性。
 *
 * 层正文在 contract 构建侧已完成 project-data 消毒（R-005），renderer
 * 不再各自转义正文——因此不存在某 Provider 独有的安全/质量降级。
 * 各层 hash 对正文计算、与 envelope 无关；markdown 头注释额外携带
 * promptContractHash（canonical contract 序列化的 sha256），可直接用于
 * 跨 renderer 等价核对。
 *
 * LA-PROMPT-002：序列化 fragment（层/属性/envelope）统一由
 * prompt-contract.ts 导出，全局预算 estimator 与本 renderer 共用同一真源，
 * 保证预算核算恒等于真实 wire 长度。
 */

import {
  PROMPT_MARKDOWN_ENVELOPE_CLOSE,
  PROMPT_XML_ENVELOPE_CLOSE,
  serializePromptMarkdownEnvelopeOpen,
  serializePromptMarkdownLayer,
  serializePromptXmlEnvelopeOpen,
  serializePromptXmlLayer,
  type LinguistPromptContract,
} from './prompt-contract'

export type LinguistPromptRenderer = 'xml' | 'markdown'

export const LINGUIST_PROMPT_RENDERERS: readonly LinguistPromptRenderer[] = ['xml', 'markdown']

function renderXml(contract: LinguistPromptContract): string {
  return serializePromptXmlEnvelopeOpen(contract)
    + contract.layers.map(serializePromptXmlLayer).join('\n\n')
    + PROMPT_XML_ENVELOPE_CLOSE
}

function renderMarkdown(contract: LinguistPromptContract): string {
  return serializePromptMarkdownEnvelopeOpen(contract)
    + contract.layers.map(serializePromptMarkdownLayer).join('\n\n')
    + PROMPT_MARKDOWN_ENVELOPE_CLOSE
}

/** 把 canonical contract 序列化为指定 runtime 的 wire 表达（确定性输出）。 */
export function renderLinguistPrompt(
  contract: LinguistPromptContract,
  renderer: LinguistPromptRenderer,
): string {
  switch (renderer) {
    case 'xml':
      return renderXml(contract)
    case 'markdown':
      return renderMarkdown(contract)
  }
}
