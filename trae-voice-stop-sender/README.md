# 语音断语发送（Voice Stop Sender）—— Trae/VSCode 扩展

一个能让你**用语音在聊天面板输入内容**的扩展（**无需浏览器、无需 Web Speech API**）：

1. 按 `Ctrl+1`（Mac：`Cmd+1`）或点击状态栏的麦克风图标，启动后台 Python 进程录音。
2. 说出你设定的**停止词**（默认"完毕"）时，自动停止录音。
3. 自动对识别的文字做**标点/断句优化**（去除空格、在"然后/不过/但是"等词前加逗号、句末补句号）。
4. 把优化后的文本**写入剪贴板并聚焦到聊天面板**（按 Cmd+V 粘贴，Enter 发送）。

**完全离线**，**完全免费**，**无需申请 API key**。

---

## 安装

### 第一步：安装 Python 依赖（所有平台）

```bash
pip3 install vosk sounddevice soundfile numpy
```

- **Vosk**：国产开源离线语音识别引擎（来自 Alpha Cephei，中文识别准确、体积小）。
- **sounddevice / soundfile**：跨平台录音库（支持 macOS / Windows / Linux）。
- **numpy**：Vosk 的依赖。

### 第二步：安装扩展

#### 方法 A：使用 `.vsix` 安装

在扩展目录下打包（已打包好的话可直接跳过）：

```bash
cd trae-voice-stop-sender
npx --yes @vscode/vsce package --no-yarn --allow-star-activation
```

然后在 Trae 中：
- 左侧「扩展市场」→ 右上角 `···` →「从 VSIX 安装」→ 选择生成的 `voice-stop-sender-x.y.z.vsix`。
- 或命令行：`/Applications/Trae\ CN.app/Contents/Resources/app/bin/code --install-extension voice-stop-sender-1.2.0.vsix`。

#### 方法 B：直接拷贝到扩展目录（开发模式）

```bash
cp -R trae-voice-stop-sender ~/.trae-cn/extensions/
```

Windows 平台：复制到 `%USERPROFILE%\.trae-cn\extensions\`

重启 Trae，在「已安装」扩展列表中即可看到「语音断语发送」。

### 第三步：首次使用

第一次启动录音时，脚本会自动下载 Vosk 中文小模型（约 40MB，只需一次）到：

- **macOS / Linux**：`~/.vosk/models/vosk-model-small-cn-0.22/`
- **Windows**：`%USERPROFILE%\.vosk\models\vosk-model-small-cn-0.22\`

状态栏会显示 `⬇ 下载模型…` 进度。模型就绪后即可开始录音。

> **系统麦克风权限**：首次录音时 macOS 会弹窗请求麦克风权限 → 点击「允许」。若被拒绝：系统设置 → 隐私与安全性 → 麦克风 → 打开 Trae / Terminal 的开关。

---

## 使用

- **启动 / 停止录音**：点击状态栏的 `🎙 语音输入`，或按 `Ctrl+1`（Mac：`Cmd+1`）。
  - 录音中状态栏显示 `🔴 聆听中（完毕）`。
  - 再次点击或按快捷键 → 手动停止。
- **修改停止词**：`Ctrl+Shift+1`（Mac：`Cmd+Shift+1`）。或在设置中搜索 `voiceStopSender.stopWord`。
- **可配置项**（设置 → Voice Stop Sender）：
  - `stopWord`（string，默认"完毕"）：停止词。
  - `optimizeText`（boolean，默认 true）：是否优化标点。
  - `autoSend`（boolean，默认 true）：是否聚焦聊天面板。
  - `language`（string，默认 zh-CN）：识别语言。
  - `pythonPath`（string，默认空）：自定义 Python 解释器路径（如 pyenv/conda 的路径）。留空自动检测。
  - `silenceTimeout`（number，默认 3.0）：静音多少秒自动停止（0 禁用）。
  - `maxSeconds`（number，默认 60）：最长录音时长（秒）。

---

## 技术要点

- **录音与识别**：启动 Python 子进程运行 `voice_listener.py`，使用 `sounddevice` 从默认麦克风捕获 16kHz PCM 音频流，送入 Vosk 的 `KaldiRecognizer` 做离线实时识别。
- **停止词检测**：在每次 `AcceptWaveform()` 返回结果时检查 `finalText + partialText` 是否包含停止词。命中则调用进程结束并把最终文本打印到 stdout。
- **静音超时**：超过 `silenceTimeout` 秒没有新识别内容自动停止（避免长时间空录音）。
- **文本优化**：纯本地 JS，不依赖大模型。做以下几件事：
  1. 截掉停止词及之后的内容；
  2. 去除所有空白；
  3. 在「然后/所以/不过/但是/而且/于是/接着/之后/后来/另外/还有」等连接词前插入逗号；
  4. 句末补一个句号。
- **跨平台**：Python 脚本 + Node.js 的 `child_process.spawn()`，在 macOS / Windows / Linux 均可运行。
- **发送到聊天面板**：由于 Trae/VSCode 没有公开把文本写入聊天输入框的正式 API，扩展采用稳健的兜底策略：
  1. 把优化结果写入剪贴板；
  2. 尝试 `workbench.action.chat.open / focus / sendMessage(text)` 等多种命令；
  3. 弹出通知提示用户在聊天输入框按 Cmd+V（或 Ctrl+V）→ Enter。

> 💡 希望更干净的自动注入？如果你的 Trae 版本暴露了自定义的「发送消息」命令，把它加到 `focusChatAndSend()` 的 `chatCommands` 列表中即可实现完全自动。

---

## 文件结构

```
trae-voice-stop-sender/
├── package.json        # 扩展元信息、命令、配置、快捷键
├── voice_listener.py   # Python 录音+Vosk 识别脚本（核心引擎）
├── icon.png            # 扩展图标（麦克风）
├── LICENSE.txt         # MIT 许可证
└── src/
    └── extension.js    # 主入口：状态栏、启动/停止 Python 进程、优化与发送
```

---

## 排错

- **提示缺少 Python 依赖**：请运行 `pip3 install vosk sounddevice soundfile numpy`，然后重启 Trae。
- **提示未找到 Python**：在扩展设置中设置 `voiceStopSender.pythonPath`，指向你的 Python 可执行文件（例如 `/usr/local/bin/python3` 或 `C:\Python311\python.exe`）。
- **模型下载失败**：确保网络能访问 `alphacephei.com`，或手动下载 `vosk-model-small-cn-0.22.zip` 解压到 `~/.vosk/models/` 目录。
- **麦克风景音被识别成停止词**：适当提高静音阈值（`silenceTimeout`）或换一个更长、更有辨识度的停止词（如「说完了」）。
- **识别准确率不满意**：
  - 中文小模型约 40MB，适合日常对话；
  - 如需更高准确率：下载标准模型 `vosk-model-cn-0.22`（~1.3GB），在设置中更改 `modelName` 参数（见 `voice_listener.py` 的 `--model-name` 选项）。
  - Vosk 官网：<https://alphacephei.com/vosk/>
- **Windows 特有的音频问题**：如果 `sounddevice` 无法识别麦克风，请确认系统默认录音设备已选中，或尝试通过 `python -m sounddevice` 列出可用设备。

---

## 为什么不用 Web Speech API？

Web Speech API（`SpeechRecognition`）对浏览器/宿主环境有麦克风权限要求，而 Trae 的 Webview 不支持该 API 或在安全上下文中会被拒绝。为了提供**稳定、可预测**的语音输入体验，本扩展采用：

1. **直接调系统 Python + Vosk**：权限由系统统一管理（macOS 权限弹窗、Windows 音频栈），不依赖 Electron 的 Webview 实现。
2. **国产离线引擎**：Vosk 由 Alpha Cephei 开发，完全离线运行，响应延迟低（流式识别），无需任何外部 API 调用，完全免费。
3. **零浏览器依赖**：无需打开任何浏览器窗口，没有弹出新应用的切换成本。
