# Qiaomu Agent for DeepSeek Harness

乔木 Agent 的 DeepSeek Harness 完整迁移工程，复用原版界面、样式和交互。

**开发中，尚无可安装的 Harness 发布包。** 当前仓库用于逐项迁移和代码审查，不要将源码目录添加到日常 Harness profile。

## 当前范围

- 保留 Qiaomu Agent 0.6.7 的源代码、六份 CSS、原有测试与许可证，逐文件 SHA-256 校验。
- 原版 ChatPanel、AI SDK transport 和 Markdown 组件可以独立构建，DOM 测试覆盖原版发送与内部链接。
- 通过注入的 `sessions` / `uiSession` 标准聊天视图订阅消息；不读取完整事件历史、不轮询、不另存会话内容，不代替用户批准工具操作。
- 宿主接口、数据迁移和完整功能接线仍在进行。详见 [迁移清单](docs/ORIGINAL-ADAPTATION.md)。

## 开发检查

使用 Node.js 24：

```sh
npm ci
npm run check
```

`build:components` 只构建原版组件及宿主适配边界，不产生可安装插件。运行验收、安装与 Release 将在完整接线后单独记录。

## English

Work in progress: a full DeepSeek Harness adaptation of Qiaomu Agent that preserves the original UI and behavior. The current component build is **not an installable Harness plugin**. No release or runtime compatibility is claimed. See the migration checklist for verified scope and remaining work.

## 来源与许可

原版：[joeseesun/Qiaomu-agent](https://github.com/joeseesun/Qiaomu-agent)，0.6.7，MIT。冻结提交及文件摘要见 `vendor/qiaomu-agent/source.json`。复用的 Home 宿主边界来自 GPL-3.0 项目，因此此适配工程整体采用 GPL-3.0-or-later；各上游文件保留原许可。详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
