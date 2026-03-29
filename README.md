# cc-meme

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-Hook-blue?style=flat-square&logo=anthropic&logoColor=white" alt="Claude Code Hook">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/npm-package-CB3837?style=flat-square&logo=npm&logoColor=white" alt="npm">
  <img src="https://img.shields.io/github/license/wuyouMaster/cc-meme?style=flat-square" alt="License">
</p>

<p align="center">
  为 <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a> 添加趣味浮动动画覆盖层
</p>

<p align="center">
  中文 | <a href="./README_EN.md">English</a>
</p>

---

## ✨ 简介

cc-meme 是 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的 Hook 插件，通过在 Claude Code 执行过程中显示浮动动画覆盖层，让编码过程更有趣。

它监听 Claude Code 的各类事件（会话开始、工具调用、错误等），并通过命名管道 (FIFO) 与 [meme-overlay](https://github.com/wuyouMaster/opencode-overlay) 桌面应用通信，实时显示当前任务进度。

> ⚠️ **前置依赖**: 本插件需要 [meme-overlay](https://github.com/wuyouMaster/opencode-overlay) 桌面应用配合使用。

---

## ✨ 功能特性

- **事件驱动** — 监听 Claude Code 8 种 Hook 事件
- **FIFO 通信** — 通过 POSIX 命名管道与 overlay 进程通信，Hook 调用轻量无阻塞
- **自动管理** — 自动启动/重启 overlay 进程，会话结束自动清理
- **自定义动画** — 通过配置文件为不同事件分配不同动画和文本
- **零延迟** — Hook 以异步命令运行，不影响 Claude Code 响应速度

### 支持的 Hook 事件

| Hook 事件 | 触发时机 | 默认文本 |
|----------|---------|---------|
| `SessionStart` | 会话启动/恢复 | "Starting..." |
| `UserPromptSubmit` | 用户提交 prompt | prompt 前 60 字符 |
| `PreToolUse` | 工具调用前 | 工具名称 |
| `PostToolUse` | 工具调用后 | 工具名称 |
| `PostToolUseFailure` | 工具调用失败 | 工具名称 |
| `Stop` | Claude 完成回复 | "Done" |
| `StopFailure` | 回复异常终止 | "Error" |
| `Notification` | 通知（等待输入/权限） | "Waiting for input..." / "Permission needed" |

---

## 📦 安装

### 前置条件

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org/) | 18+ | 运行 Hook 脚本 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | latest | AI 编码助手 |
| [meme-overlay](https://github.com/wuyouMaster/opencode-overlay) | 0.1+ | 浮动动画桌面应用 |

### 方式一：从 npm 安装

```bash
npm install -g cc-meme
```

### 方式二：从源码安装

```bash
git clone https://github.com/wuyouMaster/cc-meme.git
cd cc-meme
npm install
npm run build
```

---

## 🚀 使用

### 1. 安装 meme-overlay

请参考 [meme-overlay](https://github.com/wuyouMaster/opencode-overlay) 仓库完成桌面应用的安装。

### 2. 配置 Claude Code Hooks

编辑 `~/.claude/settings.json`，添加 Hook 配置：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/cc-meme/dist/cc-meme.js",
            "async": true
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/cc-meme/dist/cc-meme.js",
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/cc-meme/dist/cc-meme.js",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/cc-meme/dist/cc-meme.js",
            "async": true
          }
        ]
      }
    ]
  }
}
```

也可以直接复制项目中的 `hooks.json` 作为参考模板。

### 3. 启动 Claude Code

配置完成后，正常启动 Claude Code 即可。动画覆盖层会在任务执行时自动出现。

---

## ⚙️ 配置

### 配置文件

配置文件位于 `~/.config/meme-overlay/config.json`：

```json
{
  "cc": {
    "hook_assignments": {
      "cc.session.start": {
        "animation": "thinking",
        "custom_text": "Starting..."
      },
      "cc.tool.before": {
        "animation": "coding",
        "custom_text": null
      },
      "cc.tool.after": {
        "animation": "coding",
        "custom_text": "Done"
      },
      "cc.stop": {
        "animation": "success",
        "custom_text": "Done"
      }
    }
  }
}
```

### 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `OVERLAY_BIN` | 自定义 overlay 可执行文件路径 | `/usr/local/bin/meme-overlay` |

---

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 直接运行（调试）
node dist/cc-meme.js
```

### 项目结构

```
cc-plugin/
├── cc-meme.ts          # Hook 入口脚本
├── hooks.json          # Claude Code Hook 配置模板
├── package.json
└── tsconfig.json
```

### 工作原理

```
Claude Code 事件
      │
      ▼
  cc-meme.ts (每次事件启动新进程)
      │
      │  FIFO 命名管道 (O_RDWR | O_NONBLOCK)
      ▼
  meme-overlay 持久进程
      │
      ▼
  透明浮动动画窗口
```

由于 Claude Code 的 Hook 是每次事件触发时启动一个**短生命周期进程**（与 OpenCode 的长驻插件不同），所以使用 POSIX FIFO 命名管道进行 IPC：overlay 进程持有管道的读端，每次 Hook 调用以非阻塞模式打开管道写入命令。

---

## 🔧 故障排除

| 问题 | 排查步骤 |
|------|---------|
| overlay 未显示 | 确认 `~/.config/meme-overlay/bin/meme-overlay` 存在且可执行 |
| Hook 未触发 | 检查 `~/.claude/settings.json` 中 hooks 配置是否正确 |
| 管道错误 | 删除 `~/.config/meme-overlay/overlay.pipe` 后重启 |
| 动画不显示 | 检查 `~/.config/meme-overlay/animations/` 中是否有动画文件 |

---

## 📄 许可证

[MIT](LICENSE)
