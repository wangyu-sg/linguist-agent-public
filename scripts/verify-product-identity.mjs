import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const identity = JSON.parse(read('config/product-identity.json'))
const splash = read('apps/electron/resources/startup-splash/index.html')
for (const value of [identity.productName, identity.taglineZh, identity.taglineEn]) assert.ok(splash.includes(value), `Splash 缺少 ${value}`)
assert.equal(read('apps/electron/resources/startup-splash/linguist-mark-white.svg'), read('apps/electron/src/renderer/assets/onboarding/linguist-mark-white.svg'))
const builder = read('apps/electron/electron-builder.yml')
for (const value of [`appId: ${identity.appId}`, `productName: ${identity.productName}`, `artifactName: ${identity.artifactPrefix}-`]) assert.ok(builder.includes(value), `打包身份漂移：${value}`)
for (const file of ['apps/electron/src/renderer/App.tsx', 'apps/electron/src/renderer/components/onboarding/OnboardingView.tsx']) {
  const source = read(file)
  for (const field of ['productName', 'taglineZh', 'taglineEn']) assert.ok(source.includes(`identity.${field}`), `${file} 未消费 ${field}`)
  assert.ok(!source.includes('proma-mark-white'))
}
const guide = read('apps/electron/src/renderer/components/onboarding/OnboardingView.tsx')
assert.ok(guide.includes('Agent、Chat 与 Linguist'))
const faq = read('apps/electron/src/renderer/components/onboarding/faq-content.ts')
for (const word of ['商业版', '积分', '群友']) assert.ok(!faq.includes(word), `FAQ 存在旧产品承诺：${word}`)
assert.ok(faq.includes("topic: 'Linguist'"))
assert.ok(faq.includes('持久化用户消息'))
for (const [file, text] of [
  ['apps/electron/src/main/index.ts', '<title>Linguist Agent 无法加载</title>'],
  ['apps/electron/src/main/tray.ts', "label: '打开 Linguist Agent'"],
  ['apps/electron/src/renderer/components/settings/OnboardingSettings.tsx', 'Agent、Chat 与 Linguist'],
]) assert.ok(read(file).includes(text), `${file} 产品文案漂移`)
assert.ok(!read('apps/electron/src/renderer/components/settings/FeishuSettings.tsx').includes('Proma 工作区'))
console.log('产品身份合同通过')
