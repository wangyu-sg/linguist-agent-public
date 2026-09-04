# Third-Party Notices

本文件汇总 Linguist Agent 发行物中包含的第三方组件的许可与归属声明。
每个第三方一段：名称 / 版本 / 许可 / 来源 / 用途。

- 完整依赖许可清单（机器可读）：`docs/release/sbom-full.json`；
  直接依赖表与许可分布：`docs/release/SBOM.md`。
- 生成与复核命令：`bun run license:scan`（许可门禁同步执行）。
- 本文件随发行物打包；每个 release 的 notices 与构建同版本归档。

---

## 专有组件（重点复核项）

### Anthropic 专有 Skills：docx / pdf / pptx / xlsx

- 版本：docx 1.0.1、pdf 1.0.4、pptx 1.0.1、xlsx 1.0.1
- 许可：**专有**（© 2025 Anthropic, PBC. All rights reserved.）
- 来源：上游 Proma 自带的默认 skills，位于
  `apps/electron/default-skills/{docx,pdf,pptx,xlsx}/`，各目录内附
  `LICENSE.txt`（Anthropic 专有许可全文：使用受其服务协议约束，限制
  提取、复制、再分发与衍生）。
- 用途：通用 Agent 文档处理能力（Word / PDF / PPT / Excel 读写），
  上游 Proma 自带的默认技能。
- 声明：该四个 skill 为 Anthropic 专有素材，保留不删；**公开发行前需
  产品负责人最终确认再分发依据**。

## 开源 Skills

### skill-creator

- 版本：1.1.1
- 许可：Apache-2.0（全文见
  `apps/electron/default-skills/skill-creator/LICENSE.txt`）
- 来源：Anthropic 开源 skills（上游 Proma 自带），位于
  `apps/electron/default-skills/skill-creator/`
- 用途：创建/修改/评测 Agent skills 的元技能。

### guizang-ppt-skill

- 版本：1.0.0
- 许可：MIT（Copyright (c) 2026 op7418 (歸藏)；全文见
  `apps/electron/default-skills/guizang-ppt-skill/LICENSE`）
- 来源：https://github.com/op7418 （歸藏），位于
  `apps/electron/default-skills/guizang-ppt-skill/`
- 用途：生成横向翻页网页 PPT（单 HTML 文件）的技能。

### brainstorming / executing-plans / writing-plans / find-skills

- 版本：各 1.0.1
- 许可：**无许可信息**——这四个目录（
  `apps/electron/default-skills/{brainstorming,executing-plans,writing-plans,find-skills}/`
  ）未附带 LICENSE 文件或许可声明，为上游 Proma 自带内容，事实登记于此；
  如后续确认其上游许可，按 CONTRIBUTING 的来源登记规则补录。
- 用途：规划/头脑风暴/技能发现的默认工作流技能。

## 开源依赖中的重点声明

### @fontsource-variable/inter

- 版本：5.2.8
- 许可：SIL Open Font License 1.1（OFL-1.1；Inter 字体，原作者
  Rasmus Andersson，包作者标注 Google Inc.）
- 来源：npm `@fontsource-variable/inter`，https://fontsource.org/fonts/inter
- 用途：渲染器 UI 字体（随应用打包）。
- OFL-1.1 要点：字体可自由使用/嵌入/再分发；再分发须保留版权与许可
  声明；字体本身不得单独出售；修改再分发须改名（Reserved Font Name）。
  许可全文：https://openfontlicense.org/open-font-license-official-text/
  （包内另见 `node_modules/@fontsource-variable/inter/LICENSE`）。

### dompurify（双许可选择记录）

- 版本：3.4.5（生产依赖闭包内版本）
- 许可：双许可 (MPL-2.0 OR Apache-2.0)
- 来源：npm `dompurify`，https://github.com/cure53/DOMPurify
- 用途：HTML 消毒（XSS 防护）。
- **选择记录：本项目按 Apache-2.0 采用。**

### jszip（双许可选择记录）

- 版本：3.10.1
- 许可：双许可 (MIT OR GPL-3.0-or-later)
- 来源：npm `jszip`，https://github.com/Stuk/jszip
- 用途：zip 文件读写（文档处理链路）。
- **选择记录：本项目按 MIT 采用。**

### sharp 预编译 libvips 平台包

- 当前 macOS arm64 包：`@img/sharp-libvips-darwin-arm64` 1.3.3。
- 许可：LGPL-3.0-or-later；包内还列明其捆绑库各自的 MPL、MIT、BSD、
  LGPL、Zlib 等许可。
- 来源：npm `@img/sharp-libvips-*`，随 `sharp` 0.35.3 按目标平台安装；
  发行物使用未修改的动态 `libvips` 库。
- 用途：Vision Relay 的图片处理。
- 义务：保留包内许可与归属信息，并允许用户按 LGPL 条款替换或修改该动态库。
  当前个人 Alpha 不公开发行；公开发行前必须复核目标平台产物、签名机制和 LGPL
  合规材料，不能把 license gate 通过等同于法律审查完成。

### 其余开源依赖

除上述已单列组件外，其余第三方依赖（当前生产闭包共 489 个，含传递依赖）
均为宽松许可
（MIT / Apache-2.0 / BSD / ISC / BlueOak-1.0.0 / 0BSD / Unlicense /
CC-BY-4.0 / EPL-2.0 / Zlib 等），逐包清单与许可见
`docs/release/sbom-full.json`；各包许可全文见其在发行物/仓库
`node_modules` 中附带的 LICENSE 文件。其中 elkjs（EPL-2.0，mermaid
传递依赖）为弱 copyleft，按源码不修改方式使用，无额外义务。

## 参考来源（当前未复制代码）

OpenWorker（MIT，https://github.com/andrewyng/openworker）与
openai/codex（Apache-2.0，https://github.com/openai/codex）目前**未向
本仓复制任何代码**（PB-115 时点复核结论见
`docs/release/PB115_COMPLIANCE_DRAFTS.md`），故不附对应许可文本；
未来一旦复制，按其许可保留版权头与许可全文，并在此追加对应条目。
