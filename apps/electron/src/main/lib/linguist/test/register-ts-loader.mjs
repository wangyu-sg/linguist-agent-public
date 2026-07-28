// Registers the extensionless-import resolver for the node test runner.
// Used only by the `test:linguist` script (node --test); bun never loads it.
// Pattern reused from packages/linguist-cat-store/test/register-ts-loader.mjs.
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 测试模块可能在 import 阶段读取 SDK 配置路径，禁止触碰真实用户数据根。
process.env.CLAUDE_CONFIG_DIR = join(tmpdir(), `linguist-nodetest-sdk-${process.pid}`)
register('./loader-hooks.mjs', import.meta.url)
