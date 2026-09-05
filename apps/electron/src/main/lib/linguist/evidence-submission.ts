import type { LinguistCatToolsDeps } from '@linguist/cat-tools'
import type { RecordStageEvidenceReceiptInput } from '@linguist/cat-store'

/** 仅观察最终 payload；不改请求，不保存正文，不把准备完成当作已提交。 */
export function createEvidenceSubmissionObserver(
  recordReceipt: (receipt: RecordStageEvidenceReceiptInput) => void,
  onUnverified: (error: unknown) => void,
) {
  type Prepared = Parameters<NonNullable<LinguistCatToolsDeps['onEvidencePrepared']>>
  const pending = new Map<string, Prepared>()
  const accepted = new Map<string, Prepared>()
  let submitted = new Map<string, Prepared>()
  return {
    prepare: (...prepared: Prepared): void => {
      pending.set(JSON.stringify(prepared[0]), prepared)
    },
    onPayload(payload: unknown): void {
      const strings: string[] = []
      const images: string[] = []
      const visit = (value: unknown): void => {
        if (typeof value === 'string') { strings.push(value); return }
        if (value === null || typeof value !== 'object') return
        if (Array.isArray(value)) { value.forEach(visit); return }
        const node = value as Record<string, unknown>
        // 锁定 Pi 的 Anthropic、OpenAI/Responses、Google 图像字段；未知协议保守少计。
        if (node.type === 'image' || node.type === 'image_url' || node.type === 'input_image' || node.inlineData !== undefined) {
          images.push(JSON.stringify(node))
        }
        Object.values(node).forEach(visit)
      }
      visit(payload)
      submitted = new Map([...pending].filter(([, [, content]]) => content.length > 0 && content.every(block =>
        block.type === 'text'
          ? strings.some(text => text.includes(block.text))
          : images.some(image => image.includes(block.data)),
      )))
    },
    onResponse(response: { status: number }): void {
      if (response.status >= 200 && response.status < 300) {
        for (const [key, prepared] of submitted) accepted.set(key, prepared)
      }
      submitted.clear()
      for (const [key, [receipt]] of accepted) {
        try {
          recordReceipt({ ...receipt, evidence: receipt.evidence.map(item => ({ ...item, submission: 'provider-response-v1' })) })
          accepted.delete(key)
          pending.delete(key)
        } catch (error) {
          // 已发生的模型调用不能回滚；保留待记账项，后续响应只重试记账。
          onUnverified(error)
        }
      }
    },
  }
}
