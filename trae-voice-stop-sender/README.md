# 语音输入助手（Voice Input Assistant）— Trae/VSCode 扩展

**说话即输入**，内容自动粘贴到 AI 对话输入框。无需浏览器、无需 API key、**完全免费、完全离线**。

- **语音唤醒**：默认「小助小助」，扩展启动后自动开启后台监听
- **停止词结束**：默认「完毕」，说完即停止录音
- **Vosk 离线识别**：内置中文模型，流式识别、响应即时
- **文本优化**：自动标点、断句、同音词替换
- **自动粘贴**：识别内容自动粘贴到 AI 对话输入框（macOS 通过 `osascript` 触发 Cmd+V）
- **唤醒守护**：录音结束后自动恢复唤醒监听，进程异常退出会自动重启

---

## 快速开始

### 1. 安装依赖

```bash
pip3 install vosk sounddevice soundfile numpy
```

### 2. 安装扩展

在扩展市场搜索「语音输入助手」或 `yusishuma.voice-input-assistant` 安装。

### 3. 开始使用

```
打开 Trae → 状态栏显示 "👂 唤醒"

方式 A（语音唤醒）: 说 "小助小助" → 🔴 开始聆听
                   → 说你想输入的内容
                   → 说 "完毕" 结束
                   → 自动复制到剪贴板
                   → 自动聚焦 AI 对话输入框
                   → 自动粘贴（Cmd+V / Ctrl+V）
                   → Webview 面板显示内容
                   → 约 2 秒后自动恢复唤醒监听

方式 B（手动录音）: 点击状态栏 "🎙 语音" 或按 Option+V
                   → 后续流程同上

方式 C（关闭唤醒）: 点击状态栏 "👂 唤醒" 或按 Option+Shift+V
                   → 唤醒监听停止（不再后台占用麦克风）

方式 D（停止录音）: 录音/唤醒监听中按 Esc
```

---

## 快捷键一览

| 快捷键（macOS）| 功能 |
|---|---|
| `Option+V` | 开始/停止语音输入 |
| `Option+Shift+V` | 开启/关闭语音唤醒 |
| `Option+,` | 设置停止词 |
| `Esc` | 停止当前录音 / 唤醒监听 |

---

## 核心功能

### 🎯 语音唤醒（Wake Word）

- 扩展启动后约 2 秒**自动开启**（`wakeWordEnabled: true`）
- 默认唤醒词：**「小助小助」**（3–4 字，有辨识度）
- 唤醒后立即切换到录音模式，录音结束后约 2 秒**自动恢复**唤醒
- **守护进程**：每 10 秒检查一次，唤醒进程意外退出会自动重启
- **仅手动关闭**才真正停止：`Option+Shift+V` 或唤醒状态下按 `Esc`
- 可在设置中自定义唤醒词：`voiceStopSender.wakeWord`

### 🎙 语音输入 & 停止词

- 点击状态栏「🎙 语音」或按 `Option+V` 开始录音
- **停止词「完毕」**：说出即停止录音并进入处理流程
- 静音超时（默认 3 秒）：长时间不说话自动停止
- 最长录音（默认 60 秒）：防止意外持续录音

### 🔤 文本优化

识别后的原始文本会经过以下处理：

1. **截掉停止词**：移除「完毕」及后续内容
2. **去除空白**：压缩多余空格
3. **连接词加逗号**：在「然后/所以/但是/不过/因此/于是/另外/还有/同时/接着/随后」前插入逗号
4. **句末补句号**：如果结尾没有标点符号，自动添加句号
5. **同音词替换**：按配置表修复常见识别错误（如「小猪小猪」→「小助小助」）

可通过 `voiceStopSender.optimizeText` 关闭优化。

### 📋 自动发送到 AI 对话

识别并优化后的文本会：

1. **写入剪贴板**（保证内容可随时手动粘贴）
2. **尝试聚焦 AI 聊天面板**（通过多个 VS Code 命令兜底）
3. **执行系统级粘贴**
   - macOS：`osascript` → 触发 `Cmd+V`
   - Windows：PowerShell → `SendKeys('^v')`
   - Linux：`editor.action.clipboardPasteAction`
4. **打开 Webview 预览面板**：展示最终识别内容，可编辑、可重新复制

> 💡 如果自动粘贴未成功，文本已在剪贴板中，只需点击 AI 对话输入框后按 `Cmd+V` / `Ctrl+V` 即可。

---

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `voiceStopSender.stopWord` | string | `"完毕"` | 停止词。说出该词后立即停止录音，内容将被优化并发送。 |
| `voiceStopSender.wakeWord` | string | `"小助小助"` | 语音唤醒词。默认启动后自动在后台监听，听到此词即开始录音。 |
| `voiceStopSender.wakeWordEnabled` | boolean | `true` | 是否启用语音唤醒。启用后启动即自动监听；仅手动关闭才真正停止。 |
| `voiceStopSender.optimizeText` | boolean | `true` | 是否对识别文本进行标点/断句优化。 |
| `voiceStopSender.replacements` | object | 详见下方 | 同音词替换表。键为要替换的词，值为正确词。 |
| `voiceStopSender.silenceTimeout` | number | `3.0` | 静音超时（秒）。停止说话超过该时长自动停止。设为 0 禁用。 |
| `voiceStopSender.maxSeconds` | number | `60` | 单次最长录音时长（秒）。防止忘记说停止词。 |
| `voiceStopSender.pythonPath` | string | `""` | 自定义 Python 解释器路径。留空自动检测 `python3` / `python` / `py`。 |

**默认同音词替换表**：

```json
{
  "小猪": "小助",
  "小猪小猪": "小助小助",
  "小猪小猪小": "小助小助",
  "小竹": "小助",
  "小竹小竹": "小助小助",
  "小雨": "小助",
  "小朱": "小助",
  "小主人": "小助"
}
```

---

## 状态栏图标说明

| 图标 | 含义 | 点击操作 |
|---|---|---|
| `🎙 语音` | 空闲中，可开始录音 | 开始语音输入 |
| `🔴 聆听中` | 正在录音中 | 停止录音 |
| `✈ 发送中` | 正在发送到 AI 对话 | — |
| `👂 唤醒` | 唤醒监听已关闭 | 开启语音唤醒 |
| `👂 唤醒中` | 唤醒监听运行中 | 关闭语音唤醒 |

---

## 技术要点

### 架构概览

```
扩展主进程 (Node.js / extension.js)
    ├── 状态栏 UI (2 个按钮：录音 + 唤醒)
    ├── 命令注册（开始 / 停止 / 设置）
    ├── 快捷键绑定（Option+V / Option+Shift+V / Esc / Option+,）
    ├── Python 子进程管理（录音进程 + 唤醒进程）
    ├── 文本优化 + 替换逻辑
    └── Webview 面板（结果预览）

子进程 (Python)
    ├── sounddevice：跨平台麦克风输入（16kHz PCM）
    └── vosk：离线语音识别（流式，无需联网）
        └── 内置中文模型：vosk-model-small-cn-0.22（约 40MB）

系统集成
    ├── macOS：osascript 模拟键盘事件 Cmd+V
    ├── Windows：PowerShell SendKeys ^v
    └── Linux：VS Code paste 命令
```

### 唤醒守护机制

```
扩展激活
  └─ 延迟 2 秒 → startWakeWordListening()
       └─ Python 进程监听麦克风，等待唤醒词
            └─ 检测到 "小助小助" → kill 唤醒进程 → startVoiceInput()
                 └─ Python 进程录音，等待 "完毕"
                      └─ 文本优化 → 复制到剪贴板 → 聚焦 → 粘贴
                           └─ 2 秒后 → startWakeWordListening() [自动恢复]

守护进程（每 10 秒检查）：
  if (不在录音 && 不在唤醒监听 && 未手动关闭 && 配置开启) → 重启唤醒
```

### 为什么不用 Web Speech API？

- **权限限制**：Trae 的 Webview 环境不支持 `SpeechRecognition`
- **依赖浏览器**：需要打开浏览器窗口，体验割裂
- **方案优势**：直接调系统 Python + Vosk，权限由系统统一管理，**完全离线、零延迟、零成本**

---

## 文件结构

```
voice-input-assistant/
├── package.json          # 扩展元信息、命令、配置、快捷键
├── voice_listener.py     # Python 录音 + Vosk 识别脚本（支持录音/唤醒两种模式）
├── icon.png              # 扩展图标（麦克风）
├── README.md             # 本文档
├── models/               # 内置 Vosk 中文模型（约 40MB，无需下载）
│   └── vosk-model-small-cn-0.22/
└── src/
    └── extension.js      # 主入口：状态栏、进程管理、文本优化、自动粘贴、Webview
```

---

## 常见问题

| 问题 | 解决方法 |
|---|---|
| **麦克风权限被拒绝** | macOS：系统设置 → 隐私与安全性 → 麦克风 → 打开 Terminal / Trae 的开关 |
| **找不到 Python** | 运行 `python3 --version` 确认；或在设置中填写 `pythonPath` |
| **缺少 Python 依赖** | 运行 `pip3 install vosk sounddevice soundfile numpy`，然后重启 Trae |
| **唤醒词总是识别成其他词** | 在 `replacements` 配置中添加同音词替换；或更换为更长/更独特的唤醒词 |
| **识别准确率不满意** | 小模型（40MB）适合日常对话。如需更高准确率，可下载标准模型 `vosk-model-cn-0.22`（~1.3GB）放到 `models/` 目录 |
| **自动粘贴未成功** | 文本已写入剪贴板，点击 AI 对话输入框后按 `Cmd+V` / `Ctrl+V` 即可 |
| **唤醒监听没有自动开启** | 确认 `wakeWordEnabled` 为 `true`；扩展启动后约 2 秒自动开启；守护进程每 10 秒检查重启 |

---

## 版本历史

- **v2.0.0**：扩展改名为「语音输入助手」；全面重写 README；package.json 命令标题、配置描述更清晰易懂；状态栏提示文字优化
- **v1.9.x**：新增唤醒守护进程，修复 `shouldRestartWake` 时序 bug
- **v1.8.x**：先粘贴后开 Webview，避免焦点竞争
- **v1.7.x**：加入语音唤醒与同音词替换表
- **v1.6.x**：内置 Vosk 模型，无需用户下载
- **v1.5.x**：从 Web Speech API 切换为 Vosk + Python 方案
- **v1.4.x**：快捷键改为 `Option+V`
