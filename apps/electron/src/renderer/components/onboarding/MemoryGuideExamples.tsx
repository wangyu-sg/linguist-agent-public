/** 操作示例保留原有步骤；界面入口以章节中的当前截图为准。 */
export function MemoryGuideExamples() {
  return (
    <>
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#1b3f2d]">操作示例</div>
        <h2 className="mt-4 text-3xl font-light tracking-tight text-neutral-900 md:text-4xl">复用已验证的经验</h2>
      </div>

      <div className="mt-14 space-y-16 md:mt-16 md:space-y-20">
        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:items-center">

          <div className="min-w-0">
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">先建立项目地图，再沉淀协作记忆</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              在协作知识页先建立项目地图。Agent 会核验项目并维护两层 AGENTS.md，再通过真实对话逐步了解你的协作偏好；历史会话只在你之后明确授权时分批作为补充证据。
            </p>
          </div>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:items-center">
          <div className="min-w-0 lg:order-1">
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">
              Agent 整理好的<b className="font-medium text-neutral-900">偏好和记忆可以随时编辑</b>
            </h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              “记忆”只保存会影响未来协作判断的偏好、纠错和经验。你可以手动编辑这些 md 文件；项目地图则保留在对应的 AGENTS.md，避免每个 Agent 重复探索项目。
            </p>
          </div>

        </article>
      </div>
    </>
  )
}
