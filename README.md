# 语音输入助手（Voice Input Assistant）—— Trae/VSCode 扩展

一个能让你**用语音在 Trae 聊天面板输入内容**的扩展：

1. **语音唤醒**：打开 Trae 后约 2 秒自动开启唤醒监听，说出「小助小助」即可开始录音；或点击状态栏 `🎙 语音` / 按 `Option+V`（Mac）/ `Ctrl+Alt+V`（Win/Linux）手动开始。
2. **语音识别**：后台 Python 进程使用 **Vosk 国产离线语音识别引擎**（中文模型约 40MB，内置在扩展中，**无需用户下载**）。完全离线，完全免费，无需 API key。
3. **停止词结束**：说出停止词（默认「完毕」）立即停止录音；也可在静音超时或达到最长录音时长后自动停止。
4. **文本优化**：自动去除停止词、去掉空格、在「然后/所以/但是…」等连接词前加逗号、句末补句号；可配置同音词替换表（如「小猪」→「小助」）修复常见识别错误。
5. **自动发送到 AI 对话**：优化后的文本自动写入剪贴板 → 自动尝试聚焦 AI 对话输入框 → 通过系统级模拟按键（macOS `osascript`、Windows PowerShell SendKeys）自动 `Cmd+V` / `Ctrl+V` 粘贴 → 随后弹出 Webview 面板展示识别结果（可编辑、可重新复制发送）。
6. **唤醒自动恢复**：录音结束后约 2 秒**自动恢复唤醒监听**；唤醒进程意外退出也会被守护进程每 10 秒检查并重启；**只有手动关闭（`Option+Shift+V` 或处于唤醒监听状态下按 `Esc`）才真正停止**。

---

## 安装

### 第一步：安装 Python 依赖（所有平台）

```bash
pip3 install vosk sounddevice soundfile numpy
```

- **Vosk**：国产开源离线语音识别引擎（中文识别准确、体积约 40MB）。
- **sounddevice / soundfile**：跨平台录音库（支持 macOS / Windows / Linux）。
- **numpy**：Vosk 的依赖。

> 模型已内置在扩展的 `models/` 目录中，**无需用户下载**。

### 第二步：安装扩展

#### 方法 A：从扩展市场安装（推荐）

在 Trae/VSCode 扩展市场搜索「语音断语发送」或 `yusishuma.voice-stop-sender`，点击安装。

#### 方法 B：使用 `.vsix` 安装

```bash
cd trae-voice-stop-sender
npx --yes @vscode/vsce package --no-yarn --allow-star-activation
```

生成 `voice-stop-sender-1.9.1.vsix` 后，在 Trae 中：
- 左侧「扩展市场」→ 右上角 `···` →「从 VSIX 安装」→ 选择生成的 vsix 文件。

### 第三步：麦克风权限

首次录音时，macOS 会弹窗请求麦克风权限 → 点击「允许」。若被拒绝：
- **macOS**：系统设置 → 隐私与安全性 → 麦克风 → 打开 Trae / Terminal 的开关。
- **Windows**：设置 → 隐私 → 麦克风 → 允许桌面应用访问。

---

## 使用

### 核心操作

| 操作 | 方式 |
|---|---|
| **开始/停止录音** | 点击状态栏 `🎙 语音`，或按 `Option+V`（Mac）/ `Ctrl+Alt+V`（Win/Linux） |
| **语音唤醒录音** | 唤醒监听开启时，说「小助小助」即可自动开始录音（状态栏显示 `👂 唤醒监听中`） |
| **开启/关闭唤醒** | 点击状态栏 `👂 唤醒`，或按 `Option+Shift+V`（Mac）/ `Ctrl+Alt+Shift+V`（Win/Linux） |
| **停止当前录音/唤醒** | 录音中或唤醒监听中按 `Esc` |
| **设置停止词** | 命令面板 `> VoiceStopSender: 设置停止词`，或按 `Option+,`（Mac）/ `Ctrl+Alt+,`（Win/Linux） |
| **设置唤醒词** | 命令面板 `> VoiceStopSender: 设置语音唤醒词` |

### 录音流程

1. 说「小助小助」→ 状态栏变为 `🔴 聆听中`，开始录音；
2. 说出要发送的内容；
3. 说「完毕」→ 录音停止；
4. 文本自动复制到剪贴板 → 自动粘贴到 AI 对话输入框 → 面板显示识别结果。

录音结束后约 **2 秒**，唤醒监听**自动恢复**（除非你手动关闭了唤醒）。

---

## 配置项（设置 → Voice Stop Sender）

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `stopWord` | string | `"完毕"` | 停止词。说出该词后立即停止录音。 |
| `wakeWord` | string | `"小助小助"` | 语音唤醒词。建议选不易与其他词混淆的 3–4 字词。 |
| `wakeWordEnabled` | boolean | `true` | 是否启用语音唤醒（启动后自动开启，持续后台监听）。 |
| `optimizeText` | boolean | `true` | 是否对识别后的文本进行标点/断句优化。 |
| `replacements` | object | `{"小猪":"小助", "小猪小猪":"小助小助", ...}` | 文本替换表。用于修复 Vosk 常见同音混淆。键是要替换的词，值是替换后的正确词。支持多对。 |
| `silenceTimeout` | number | `3.0` | 静音超时（秒）。停止说话超过该时长后自动停止。设为 `0` 禁用。 |
| `maxSeconds` | number | `60` | 单次最长录音时长（秒）。 |
| `pythonPath` | string | `""` | 自定义 Python 解释器路径（如 pyenv/conda 的路径）。留空自动检测 `python3` / `python` / `py`。 |

---

## 技术要点

### 录音与识别流程

扩展启动后（`*` 激活，启动即激活），Python 子进程 `voice_listener.py` 以 `--mode wake` 模式启动唤醒监听。唤醒后切换为录音模式（不带 `--mode wake`）：

1. **录音**：`sounddevice` 从默认麦克风捕获 16kHz PCM 音频流。
2. **识别**：送入 Vosk 的 `KaldiRecognizer` 做离线实时识别（流式，无需等待整段结束）。
3. **停止词检测**：每次 `AcceptWaveform()` 返回结果时检查识别文本是否包含停止词，命中即结束进程。
4. **静音超时**：超过 `silenceTimeout` 秒没有新识别内容自动停止（避免长时间空录音）。
5. **文本优化**：纯本地 JS，不依赖大模型。做以下几件事：
   - 截掉停止词及之后的内容；
   - 去除所有空白；
   - 在「然后/所以/不过/但是/而且/于是/接着/之后/后来/另外/还有/因此/同时/随后」等连接词前插入逗号；
   - 句末补句号。
6. **同音词替换**：根据 `replacements` 配置表对识别文本做关键词替换，修复 Vosk 常见的同音混淆（如「小猪小猪」→「小助小助」）。

### 发送到 AI 对话面板

由于 Trae/VSCode 没有公开把文本写入聊天输入框的正式 API，扩展采用多层兜底策略（**先粘贴后开 Webview，避免 Webview 抢焦点**）：

```
录音结束 → 文本优化 → 写入剪贴板
    → 尝试多个聚焦命令（workbench.action.chat.focus / open / new / openInSidebar 等）
    → 等待焦点转移 → 执行系统级模拟粘贴
        macOS:   osascript → Cmd+V
        Windows: PowerShell → SendWait('^v')
        Linux:   editor.action.clipboardPasteAction
    → 300ms 后打开 Webview 面板展示识别结果（可编辑、可重新复制）
```

> **macOS 的关键技巧**：用 `osascript` 触发键盘事件，文本可以粘贴到 Webview 内部的 `textarea`（VS Code API 的 `type` 命令做不到这一点）。

### 唤醒守护进程

为了让唤醒监听**始终保持可用**（除非用户手动关闭），扩展在 `activate()` 中注册了一个每 10 秒检查一次的守护进程：

```
每 10 秒检查：
    不在录音 且 不在唤醒监听 且 未被手动关闭 且 配置开启 → 重启唤醒
```

录音开始时会临时停止唤醒监听（避免麦克风冲突），录音结束后约 2 秒自动恢复。手动关闭唤醒（`Option+Shift+V` 或唤醒监听中按 `Esc`）会设置 `wakeManuallyStopped = true` 标记，守护进程不再自动重启。

### 文件结构

```
trae-voice-stop-sender/
├── package.json         # 扩展元信息、命令、配置、快捷键
├── voice_listener.py    # Python 录音 + Vosk 识别脚本（核心引擎）
├── icon.png             # 扩展图标（麦克风）
├── README.md            # 本文件
├── LICENSE.txt          # MIT 许可证
├── models/              # 内置 Vosk 中文模型（约 40MB，无需下载）
│   └── vosk-model-small-cn-0.22/
└── src/
    └── extension.js     # 主入口：状态栏、录音、唤醒、文本优化、发送到聊天、Webview 预览
```

---

## 排错

| 问题 | 解决方法 |
|---|---|
| **提示缺少 Python 依赖** | 运行 `pip3 install vosk sounddevice soundfile numpy`，然后重启 Trae。 |
| **提示未找到 Python** | 在扩展设置中设置 `voiceStopSender.pythonPath`，指向你的 Python 可执行文件（如 `/usr/local/bin/python3` 或 `C:\Python311\python.exe`）。 |
| **麦克风权限被拒绝** | macOS：系统设置 → 隐私与安全性 → 麦克风 → 打开 Trae / Terminal 的开关。 |
| **唤醒词经常被误识别为其他词** | 在 `replacements` 配置中添加同音词替换，或更换唤醒词为更长/更有辨识度的词。 |
| **识别准确率不满意** | 中文小模型约 40MB，适合日常对话。如需更高准确率，可下载标准模型 `vosk-model-cn-0.22`（~1.3GB）放到扩展 `models/` 目录。 |
| **自动粘贴未成功** | 文本已写入剪贴板，点击 AI 对话输入框后按 `Cmd+V`（Mac）/ `Ctrl+V`（Win/Linux）手动粘贴即可。也可在 Webview 面板点击「↺ 重新复制到剪贴板」再次尝试。 |
| **唤醒监听没有自动开启** | 确认 `wakeWordEnabled` 为 `true`（默认开启）。扩展启动后约 2 秒自动开启，若麦克风被其他程序占用会延迟启动，守护进程每 10 秒会重试。 |

---

## 为什么不用 Web Speech API？

Web Speech API（`SpeechRecognition`）对浏览器/宿主环境有麦克风权限要求，而 Trae 的 Webview 不支持该 API 或在安全上下文中会被拒绝。为了提供**稳定、可预测**的语音输入体验，本扩展采用：

1. **直接调系统 Python + Vosk**：权限由系统统一管理（macOS 权限弹窗、Windows 音频栈），不依赖 Electron 的 Webview 实现。
2. **国产离线引擎**：Vosk 由 Alpha Cephei 开发，完全离线运行，响应延迟低（流式识别），无需任何外部 API 调用，完全免费。
3. **零浏览器依赖**：无需打开任何浏览器窗口，没有弹出新应用的切换成本。

---

## 版本历史

- **v1.9.0**：新增唤醒守护进程（每 10 秒检查自动恢复）；修复 `shouldRestartWake` 时序 bug（OR 逻辑避免被覆盖）；录音停止后的唤醒重启行为与手动关闭标记分离。
- **v1.8.0**：先粘贴后开 Webview，避免焦点竞争导致粘贴失败；自动粘贴改为系统级 `osascript` / PowerShell 按键模拟。
- **v1.7.x**：加入语音唤醒（`小助小助`）与同音词替换表。
- **v1.6.x**：加入 Vosk 内置模型，解决模型下载慢问题。
- **v1.5.x**：从 Web Speech API 切换为 Vosk + Python 方案，解决麦克风权限被拒问题。
- **v1.4.x**：快捷键从 `Cmd+1` 改为 `Option+V`。
- **v1.0–v1.3.x**：初始版本，基于 Web Speech API，支持停止词识别与文本优化。

