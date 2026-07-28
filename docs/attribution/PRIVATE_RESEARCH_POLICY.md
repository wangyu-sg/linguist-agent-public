# PRIVATE_RESEARCH_POLICY — 私人研究资料政策

> 工单：PB-002（许可证与来源治理）
> 依据：执行计划 §0.5、§1.2。用户已明确不做闭源商业产品，本仓以 AGPL-3.0
> 发布且必须随时可公开。私人逆向规格只可用于内部设计施工，**原始逆向资料
> 本身不得进入本仓及任何公开镜像**。

## 被定义为私人研究资料的内容

- `THREE_APPS_PIXEL_SPEC.md`
- `codex-ui-spec-full.md`
- 任何 codex-teardown / asar-src / DMG 解包产物
- 闭源客户端的反编译文件名、chunk/class 名、原始文案库
- 第三方原始 Logo、字体、SVG、视频、粒子资源
- 旧仓 `docs/ui/*_DESIGN_SPEC.md` 等未跟踪的私人规格

## 存放位置

私人研究资料只允许放在**仓库外**或被 `.gitignore` 排除的目录：

```text
/Users/<local>/Desktop/linguist-agent-research-private/   （推荐，仓库外）
```

本仓 `.gitignore` 已排除上述文件名与目录名，防止误提交。

## 允许进入本仓的衍生成果

公开实现规格由施工者基于研究资料**重新整理**为 LA 自己的文档：

```text
docs/product/LA_PRODUCT_UI_SPEC.md
```

只允许保留：行为、尺寸、信息层级、LA 自己的 Token、LA 自己的文案、
LA 自己绘制的组件图。

**不得**保留：反编译文件名、chunk/class 名、原始闭源文案库、原始
Logo/字体/SVG/视频、"原样复刻"要求。

## 开源仓 ≠ 闭源客户端

`openai/codex` 开源仓（Apache-2.0）与 OpenAI 闭源桌面客户端是两个不同
对象。只有开源仓的代码可按 Apache-2.0 复制并登记（见
`docs/attribution/SOURCE_PROVENANCE.md`）；闭源客户端的任何内容一律
不得引入。

## 公开镜像前检查（Batch 11 必跑）

```bash
# 以下命令必须全部无输出（除 .gitignore 本身）：
git grep -n "THREE_APPS_PIXEL_SPEC\|codex-ui-spec-full\|asar-src\|codex-teardown" -- . ':!.gitignore'
git log --diff-filter=A --name-only --pretty=format: | grep -iE "teardown|asar|pixel.spec|ui-spec-full"
```
