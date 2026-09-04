/** 操作示例保留原有步骤；界面入口以章节中的当前截图为准。 */
export function AutomationGuideExamples() {
  return (
    <>
      <div className="max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#1b3f2d]">操作示例</div>
        <h2 className="mt-4 text-3xl font-light tracking-tight text-neutral-900 md:text-4xl">让每天的代码质量检查自动运行</h2>
        <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
          安排好时间后，只要 Linguist Agent 是打开状态，就会在设定时间自动执行。
        </p>
      </div>

      <div className="mt-14 space-y-16 md:mt-16 md:space-y-20">
        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:items-center">

          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#1b3f2d]">示例 01 · 安排</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">每天 09:00 检查昨天的代码</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              把任务设为每天定点 09:00，设定好频率/模型/绑定的项目/是否开启飞书通知等，并保持 Linguist Agent 处于打开状态。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“每天帮我用 deepseek v4flash 扫描这个代码库，看看前一天新提交的代码的质量。”</p>
            </div>
          </div>
        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:items-center">
          <div className="min-w-0 lg:order-1">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#1b3f2d]">示例 02 · 执行</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">Agent 会在你设定的时间自动打开新会话工作</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              到点后，Agent 会自动扫描代码库，完成代码质量审查；过程和结果都会留在新会话里。
            </p>
            <div className="mt-5 border-l-2 border-[#1b3f2d]/35 pl-4">
              <div className="text-base font-medium text-[#1b3f2d]">这样告诉 Agent</div>
              <p className="mt-1 text-base leading-7 text-neutral-500">“每天帮我扫描这个代码库，然后看看昨天一天新提交的代码的质量。”</p>
            </div>
          </div>

        </article>

        <article className="grid gap-10 border-t border-[#1b3f2d]/15 pt-10 lg:items-center">

          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#1b3f2d]">示例 03 · 查看</div>
            <h3 className="mt-3 text-2xl font-medium text-neutral-900 md:text-3xl">在日程表里查看自动任务</h3>
            <p className="mt-4 text-base leading-[1.7] text-neutral-600 md:text-lg">
              创建后，你的自动任务会显示在日程表里供你查看。
            </p>
          </div>
        </article>
      </div>
    </>
  )
}
