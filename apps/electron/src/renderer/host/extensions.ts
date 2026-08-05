import { registerExtensions } from './extension-registry'
import { linguistExtension } from './linguist-extension'

/** 应用 composition root：只组合本地编译产物，不在运行时装载插件。 */
export const extensionRegistry = registerExtensions([linguistExtension])
