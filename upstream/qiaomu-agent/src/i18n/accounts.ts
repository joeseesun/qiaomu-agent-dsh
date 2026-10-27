import { getLanguage } from "obsidian";
const zh = {
  accounts: "登录账号", login: "登录并连接", waiting: "等待浏览器授权…", cancel: "取消登录", again: "重新登录", signout: "退出账号",
  desktop: "账号登录需要桌面版 Obsidian。也可以使用 API Key。", failed: "授权未完成，请重新登录。", expired: "登录已过期，请重新登录。",
  invalid: "登录结果校验失败，请重新登录。", complete: "授权已收到，可以关闭此页面并返回 Obsidian。", unsupported: "这个账号尚未授权使用 ChatGPT 套餐。",
  browser: "在浏览器中完成登录后，返回这里管理模型。", accountReady: "账号已连接", needsLogin: "需要登录", revokeFailed: "已退出本机账号，远端撤销未确认。请在 ChatGPT 设置中断开此应用。",
  services: "登录账号、填写 API Key，或连接 Magpie。开关决定是否出现在对话的模型菜单里。", empty: "选择登录账号、模型服务或本机网关，即可添加模型。",
  magpie: "请先启动 Magpie；Claude、Codex 和其他订阅在 Magpie 中登录并启用后，会出现在模型列表里。", detect: "检测 Magpie", detected: "已检测到 Magpie", notMagpie: "没有检测到 Magpie，请启动它并核对网关地址。",
  gatewayKeyRequired: "远程 Magpie 需要网关密钥。", endpoint: "接口地址", gatewayKey: "网关密钥（本机可留空）", plans: "Coding 套餐", keyInstead: "也可以粘贴 API Key", gatewayLink: "Magpie 安装与登录指南", localService: "请先启动本机服务。",
  chatgptHint: "使用账号已授权的 ChatGPT 套餐。可用模型和额度以账号为准。", streamFailed: "模型流未完整结束，请重试。", restricted: "ChatGPT 套餐通道暂不支持图片生成或编辑，请切换其他来源。",
} as const;
const en: Record<keyof typeof zh, string> = {
  accounts: "Sign in", login: "Sign in and connect", waiting: "Waiting for browser authorization…", cancel: "Cancel sign-in", again: "Sign in again", signout: "Sign out",
  desktop: "Account sign-in requires Obsidian desktop. You can also use an API key.", failed: "Authorization did not complete. Sign in again.", expired: "Your session expired. Sign in again.",
  invalid: "Sign-in validation failed. Sign in again.", complete: "Authorization received. You can close this page and return to Obsidian.", unsupported: "This account has not authorized ChatGPT plan usage.",
  browser: "Complete sign-in in your browser, then return here to manage models.", accountReady: "Account connected", needsLogin: "Sign-in required", revokeFailed: "Signed out locally; remote revocation could not be confirmed. Disconnect this app in ChatGPT settings.",
  services: "Sign in, enter an API key, or connect Magpie. Switches control which sources appear in chat.", empty: "Choose an account, model service or local gateway to add models.",
  magpie: "Start Magpie first. Sign in to Claude, Codex or other subscriptions in Magpie and enable their models to list them here.", detect: "Detect Magpie", detected: "Magpie detected", notMagpie: "Magpie was not detected. Start it and check the gateway URL.",
  gatewayKeyRequired: "A remote Magpie gateway requires a key.", endpoint: "API URL", gatewayKey: "Gateway key (optional on this computer)", plans: "Coding plans", keyInstead: "Or paste an API key", gatewayLink: "Magpie setup and sign-in guide", localService: "Start your local service first.",
  chatgptHint: "Use your authorized ChatGPT plan. Models and allowance depend on your account.", streamFailed: "The model stream ended before completion. Retry.", restricted: "ChatGPT plan access does not support image generation or editing. Choose another source.",
};
export function accountText(key: keyof typeof zh): string { return (getLanguage().startsWith("en") ? en : zh)[key]; }
