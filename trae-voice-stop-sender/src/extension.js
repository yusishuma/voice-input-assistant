/**
 * 语音输入助手 — Trae 扩展（v2.0.0）
 *
 * 功能：语音唤醒 → 语音识别 → 停止词结束 → 文本优化 → 粘贴到 AI 对话输入框
 *
 * macOS 关键技巧：用 osascript 发送键盘事件，能打到 Webview 里的 textarea（VS Code API 的 type 命令做不到）
 */
const vscode = require('vscode');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const CMD_START = 'voiceStopSender.start';
const CMD_STOP = 'voiceStopSender.stop';
const CMD_CONFIGURE = 'voiceStopSender.configure';
const CMD_TOGGLE_WAKE = 'voiceStopSender.toggleWakeWord';
const CMD_SET_WAKE = 'voiceStopSender.setWakeWord';

let isRecording = false;
let currentProcess = undefined;
let isWakeListening = false;
let wakeWordProcess = undefined;
let shouldRestartWake = false;      // 录音前的唤醒状态（录音后是否要重启）
let wakeManuallyStopped = false;     // 用户手动关闭的唤醒标记（true 时不再自动重启）

let statusBarItem = undefined;
let wakeStatusBarItem = undefined;

// Webview 面板（显示已识别的文本，可编辑，可再次发送）
let chatPanel = undefined;

function activate(context) {
    // 状态栏：录音按钮
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = CMD_START;
    setStatusBarIdle(statusBarItem);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 状态栏：唤醒监听
    wakeStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        90
    );
    wakeStatusBarItem.command = CMD_TOGGLE_WAKE;
    setStatusBarWakeIdle(wakeStatusBarItem);
    wakeStatusBarItem.show();
    context.subscriptions.push(wakeStatusBarItem);

    // 命令注册
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_START, () => {
            if (isRecording) stopVoiceInput();
            else startVoiceInput();
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_STOP, () => {
            if (isRecording) {
                shouldRestartWake = !wakeManuallyStopped; // 录音停止后，若未手动关闭则重启唤醒
                stopVoiceInput();
            } else if (isWakeListening) {
                wakeManuallyStopped = true;               // Esc 停止唤醒也算手动关闭
                stopWakeWordListening();
                vscode.window.showInformationMessage('🔕 已关闭语音唤醒（按 Option+Shift+V 可重新开启）');
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_CONFIGURE, async () => {
            const word = await vscode.window.showInputBox({
                title: '设置语音停止词',
                prompt: '说出这个词时停止录音并发送',
                value: getStopWord()
            });
            if (word && word.trim().length > 0) {
                await vscode.workspace.getConfiguration('voiceStopSender').update(
                    'stopWord', word.trim(), vscode.ConfigurationTarget.Global
                );
                vscode.window.showInformationMessage(`停止词已设置为：「${word.trim()}」`);
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_TOGGLE_WAKE, async () => {
            if (isWakeListening) {
                // 用户手动关闭唤醒：设置标记，阻止守护进程自动重启
                wakeManuallyStopped = true;
                stopWakeWordListening();
                vscode.window.showInformationMessage('🔕 已关闭语音唤醒（按 Option+Shift+V 可重新开启）');
            } else {
                if (isRecording) {
                    vscode.window.showWarningMessage('正在录音中...');
                    return;
                }
                // 用户手动开启：清除标记，启动监听
                wakeManuallyStopped = false;
                const ok = await startWakeWordListening();
                if (ok) vscode.window.showInformationMessage(`👂 语音唤醒已开启（呼唤「${getWakeWord()}」开始录音）`);
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(CMD_SET_WAKE, async () => {
            const word = await vscode.window.showInputBox({
                title: '设置语音唤醒词',
                prompt: '呼唤这个词自动开始录音',
                value: getWakeWord()
            });
            if (word && word.trim().length > 0) {
                await vscode.workspace.getConfiguration('voiceStopSender').update(
                    'wakeWord', word.trim(), vscode.ConfigurationTarget.Global
                );
                vscode.window.showInformationMessage(`唤醒词已设为：「${word.trim()}」`);
                if (isWakeListening) {
                    stopWakeWordListening();
                    setTimeout(() => startWakeWordListening(), 500);
                }
            }
        })
    );

    vscode.commands.executeCommand('setContext', 'voiceStopSender.isRecording', false);
    vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', false);

    // ============ 唤醒守护进程 ============
    // 只要配置开启（shouldWakeWordEnabled=true），就要保持唤醒监听；仅用户手动关闭时停止
    // 延迟 2 秒启动（等 Trae 完全加载），然后每 10 秒检查一次是否应该运行
    setTimeout(() => { startWakeWordListening().catch(() => {}); }, 2000);

    const watchdog = setInterval(() => {
        if (!isRecording && !isWakeListening && !wakeManuallyStopped && shouldWakeWordEnabled()) {
            // 应该在监听但实际没在监听 → 重启
            startWakeWordListening().catch(() => {});
        }
    }, 10000);
    context.subscriptions.push({ dispose: () => clearInterval(watchdog) });
}

function deactivate() {
    if (currentProcess) { try { currentProcess.kill('SIGTERM'); } catch (_) {} currentProcess = undefined; }
    if (wakeWordProcess) { try { wakeWordProcess.kill('SIGTERM'); } catch (_) {} wakeWordProcess = undefined; }
    if (chatPanel) { try { chatPanel.dispose(); } catch (_) {} chatPanel = undefined; }
}

// ============ 状态栏辅助：用户可见文本统一
function setStatusBarIdle(item) { item.text = '🎙 语音'; item.tooltip = '点击开始语音输入（Option+V）'; item.backgroundColor = undefined; }
function setStatusBarRecording(item, heard) { item.text = '🔴 聆听中'; item.tooltip = '正在聆听，说"完毕"结束' + (heard ? '\n听到: ' + heard : ''); }
function setStatusBarSending(item, text) { item.text = '✈ 发送中'; item.tooltip = '正在发送到 AI 对话' + (text ? ': ' + text : ''); }
function setStatusBarWakeIdle(item) { item.text = '👂 唤醒'; item.tooltip = '点击开启语音唤醒（Option+Shift+V）'; }
function setStatusBarWakeActive(item, heard) { item.text = '👂 唤醒中'; item.tooltip = '听到"小助小助"自动开始录音' + (heard ? '\n听到: ' + heard : ''); }

// ============ 配置读取 ============
function getStopWord() { return vscode.workspace.getConfiguration('voiceStopSender').get('stopWord') || '完毕'; }
function getWakeWord() { return vscode.workspace.getConfiguration('voiceStopSender').get('wakeWord') || '小助小助'; }
function shouldOptimize() { const v = vscode.workspace.getConfiguration('voiceStopSender').get('optimizeText'); return v === undefined ? true : !!v; }
function shouldWakeWordEnabled() { const v = vscode.workspace.getConfiguration('voiceStopSender').get('wakeWordEnabled'); return v === undefined ? true : !!v; }
function getSilenceTimeout() { const v = vscode.workspace.getConfiguration('voiceStopSender').get('silenceTimeout'); return (typeof v === 'number' && v >= 0) ? v : 3.0; }
function getMaxSeconds() { const v = vscode.workspace.getConfiguration('voiceStopSender').get('maxSeconds'); return (typeof v === 'number' && v > 0) ? v : 90; }

// ============ 文本优化 & 同音词替换 ============
function applyReplacements(text) {
    if (!text) return text;
    try {
        const replacements = vscode.workspace.getConfiguration('voiceStopSender').get('replacements') || {};
        if (typeof replacements === 'object' && replacements !== null) {
            const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);
            for (const key of keys) {
                const val = replacements[key];
                if (typeof key === 'string' && typeof val === 'string' && key.length > 0) {
                    let idx = text.indexOf(key);
                    while (idx !== -1 && idx >= 0) {
                        text = text.slice(0, idx) + val + text.slice(idx + key.length);
                        idx = text.indexOf(key, idx + val.length);
                    }
                }
            }
        }
    } catch (e) {}
    return text;
}
function optimizeText(raw, stopWord) {
    let text = (raw || '').trim();
    const stopEsc = stopWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(stopEsc, 'g'), '').trim();
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/(.)(然后|所以|而且|但是|不过|因此|于是|另外|还有|同时|接着|随后)/g, '$1，$2');
    if (text && !/[。！？.!?;；,，]/.test(text.charAt(text.length - 1))) text += '。';
    return text;
}

// ============ 核心：开始语音录音 ============
function startVoiceInput() {
    if (isRecording) return;
    // 关键修复：用 OR 逻辑！唤醒触发时 shouldRestartWake 已被设为 true，不要被 isWakeListening(false) 覆盖掉
    shouldRestartWake = shouldRestartWake || isWakeListening;
    if (isWakeListening) stopWakeWordListening(true);

    const stopWord = getStopWord();
    isRecording = true;
    vscode.commands.executeCommand('setContext', 'voiceStopSender.isRecording', true);
    setStatusBarRecording(statusBarItem);

    const extensionDir = path.dirname(__dirname);
    const scriptPath = path.join(extensionDir, 'voice_listener.py');
    const args = [
        '-u', scriptPath,
        '--stop-word', stopWord,
        '--language', 'zh',
        '--max-seconds', String(getMaxSeconds()),
        '--silence-timeout', String(getSilenceTimeout()),
    ];

    let child;
    let foundPython = false;
    const pythonCandidates = findPythonCandidates();

    function tryPython(idx) {
        if (idx >= pythonCandidates.length) {
            if (!foundPython) {
                vscode.window.showErrorMessage(
                    '未找到 Python。请先安装 Python 3.7+，\n然后运行：pip3 install vosk sounddevice soundfile numpy'
                );
            }
            cleanupRecording();
            // 录音失败也重启唤醒
            if (shouldRestartWake) setTimeout(() => startWakeWordListening(), 500);
            return;
        }
        const pythonCmd = pythonCandidates[idx];
        let stdoutText = '';
        let stderrBuffer = '';

        try {
            child = spawn(pythonCmd, args, { windowsHide: true });
        } catch (e) {
            tryPython(idx + 1);
            return;
        }
        foundPython = true;
        currentProcess = child;

        child.stdout.on('data', (data) => { stdoutText += data.toString('utf-8'); });
        child.stderr.on('data', (data) => {
            const msg = data.toString('utf-8');
            stderrBuffer += msg;
            const match = msg.match(/\[HEAR\]\s*(.+)/) || msg.match(/\[PART\]\s*(.+)/);
            if (match) {
                const heard = applyReplacements(match[1].trim());
                setStatusBarRecording(statusBarItem, heard);
            }
        });

        child.on('close', (code) => {
            if (!isRecording) return;
            isRecording = false;
            vscode.commands.executeCommand('setContext', 'voiceStopSender.isRecording', false);
            currentProcess = undefined;

            let rawText = applyReplacements(stdoutText.trim());

            if (rawText && (code === 0 || rawText.length > 2)) {
                const finalText = shouldOptimize() ? optimizeText(rawText, stopWord) : rawText;
                if (finalText && finalText.replace(/[。！？.!?;；,，\s]/g, '').trim().length > 0) {
                    // === 关键修复：先粘贴（不开 webview），粘贴完成后再打开 webview ===
                    sendToChatAndOpenPanel(finalText, shouldRestartWake);
                    return;
                }
            }

            // 错误/无内容
            setStatusBarIdle(statusBarItem);
            if (stderrBuffer.includes('缺少依赖') || stderrBuffer.includes('ImportError')) {
                vscode.window.showErrorMessage('缺少 Python 依赖：请运行 pip3 install vosk sounddevice soundfile numpy');
            } else if (stderrBuffer.includes('[ERROR]')) {
                const lines = stderrBuffer.split('\n').filter(l => l.includes('[ERROR]'));
                vscode.window.showErrorMessage('识别失败：' + lines.slice(-1).map(l => l.replace(/\[ERROR\]\s*/, '')).join(' '));
            } else {
                vscode.window.showInformationMessage('没有识别到有效的语音内容');
            }
            // 错误/无内容时也重启唤醒
            if (shouldRestartWake) setTimeout(() => startWakeWordListening(), 500);
        });
    }

    tryPython(0);
}

function stopVoiceInput() {
    if (currentProcess) { try { currentProcess.kill('SIGTERM'); } catch (_) {} currentProcess = undefined; }
    isRecording = false;
    vscode.commands.executeCommand('setContext', 'voiceStopSender.isRecording', false);
    if (statusBarItem) setStatusBarIdle(statusBarItem);
}

function cleanupRecording() {
    isRecording = false;
    vscode.commands.executeCommand('setContext', 'voiceStopSender.isRecording', false);
    if (currentProcess) { try { currentProcess.kill('SIGKILL'); } catch (_) {} currentProcess = undefined; }
    if (statusBarItem) setStatusBarIdle(statusBarItem);
}

function findPythonCandidates() {
    const custom = vscode.workspace.getConfiguration('voiceStopSender').get('pythonPath');
    if (custom && custom.trim()) return [custom.trim()];
    return ['python3', 'python', 'py'];
}

// ============ 唤醒词监听 ============
async function startWakeWordListening() {
    if (isWakeListening || isRecording) return false;
    const wakeWord = getWakeWord();
    const extensionDir = path.dirname(__dirname);
    const scriptPath = path.join(extensionDir, 'voice_listener.py');
    const pythonCandidates = findPythonCandidates();
    const args = ['-u', scriptPath, '--mode', 'wake', '--wake-word', wakeWord, '--language', 'zh'];

    return await new Promise((resolve) => {
        let resolved = false;
        const tryStart = (candidates, idx) => {
            if (idx >= candidates.length) {
                if (!resolved) {
                    vscode.window.showWarningMessage('语音唤醒无法启动（未找到可用的 Python）');
                    resolved = true;
                    resolve(false);
                }
                return;
            }
            const pythonCmd = candidates[idx];
            let started = false;
            let child;
            try { child = spawn(pythonCmd, args, { windowsHide: true }); }
            catch (e) { tryStart(candidates, idx + 1); return; }

            child.stdout.on('data', (data) => {
                const lines = data.toString('utf-8').split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    if (trimmed.startsWith('WAKE_READY')) {
                        if (!started) {
                            started = true;
                            isWakeListening = true;
                            vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', true);
                            setStatusBarWakeActive(wakeStatusBarItem);
                            if (!resolved) { resolved = true; resolve(true); }
                        }
                    } else if (trimmed.startsWith('WAKE_DETECTED')) {
                        // 关键修复：录音前先记下"之前在监听唤醒"，录音结束后要重启
                        shouldRestartWake = true;
                        try { child.kill('SIGTERM'); } catch (_) {}
                        isWakeListening = false;
                        vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', false);
                        setStatusBarWakeIdle(wakeStatusBarItem);
                        setTimeout(() => startVoiceInput(), 200);
                    }
                }
            });
            child.stderr.on('data', (data) => {
                const lines = data.toString('utf-8').split('\n');
                for (const line of lines) {
                    const match = line.match(/\[HEAR\]\s*(.+)/) || line.match(/\[PART\]\s*(.+)/);
                    if (match) {
                        const heard = applyReplacements(match[1].trim());
                        if (heard.includes(wakeWord)) {
                            // 关键修复：录音前先记下"之前在监听唤醒"
                            shouldRestartWake = true;
                            try { child.kill('SIGTERM'); } catch (_) {}
                            isWakeListening = false;
                            vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', false);
                            setStatusBarWakeIdle(wakeStatusBarItem);
                            setTimeout(() => startVoiceInput(), 200);
                            return;
                        }
                        setStatusBarWakeActive(wakeStatusBarItem, heard);
                    }
                }
            });
            child.on('close', () => {
                if (isWakeListening) {
                    isWakeListening = false;
                    vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', false);
                    setStatusBarWakeIdle(wakeStatusBarItem);
                }
                if (!started && !resolved) tryStart(candidates, idx + 1);
                else if (!resolved) { resolved = true; resolve(started); }
            });
            child.on('error', () => { if (!started) tryStart(candidates, idx + 1); });
            wakeWordProcess = child;
        };
        tryStart(pythonCandidates, 0);
    });
}

function stopWakeWordListening(silent) {
    if (wakeWordProcess) { try { wakeWordProcess.kill('SIGTERM'); } catch (_) {} wakeWordProcess = undefined; }
    isWakeListening = false;
    vscode.commands.executeCommand('setContext', 'voiceStopSender.isWakeListening', false);
    if (wakeStatusBarItem) setStatusBarWakeIdle(wakeStatusBarItem);
}

// ============ 识别后的处理：先粘贴到 AI 对话，再开 Webview 预览 ============
// 关键修复：Webview 会抢焦点，必须在粘贴完成后再打开
function sendToChatAndOpenPanel(text, restartWake) {
    const finalText = text.trim();
    setStatusBarSending(statusBarItem, finalText);

    // === 步骤 1：写入剪贴板（始终有效） ===
    vscode.env.clipboard.writeText(finalText).then(() => {
        // === 步骤 2：尝试聚焦 AI 聊天面板 ===
        // 尝试多个可能的命令（Trae / Copilot Chat / VS Code Chat）
        const focusCommands = [
            'workbench.action.chat.focus',
            'workbench.action.chat.open',
            'workbench.action.chat.new',
            'workbench.action.chat.openInSidebar',
            'workbench.view.extension.trae-chat',
            'chat.action.focus',
            'trae.chat.focus',
        ];
        let cmdIdx = 0;
        function tryNextFocus() {
            if (cmdIdx < focusCommands.length) {
                try {
                    vscode.commands.executeCommand(focusCommands[cmdIdx]).then(
                        () => { /* 命令执行成功，继续下一步 */ },
                        () => { /* 命令不存在，忽略 */ }
                    );
                } catch (e) {}
                cmdIdx++;
                setTimeout(tryNextFocus, 120);  // 每个命令间隔 120ms，给焦点转移时间
            } else {
                // === 步骤 3：所有聚焦命令都尝试过了，执行 Cmd+V ===
                setTimeout(doPaste, 400);
            }
        }
        tryNextFocus();
    });

    // 执行粘贴（macOS：osascript；其他：PowerShell 或 VS Code paste）
    function doPaste() {
        const platform = process.platform;
        let pasted = false;

        if (platform === 'darwin') {
            // macOS：用 osascript 触发 Cmd+V — 这是唯一能把文本打到 Webview textarea 的方式
            exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 2000 }, (err) => {
                pasted = !err;
                finish();
            });
        } else if (platform === 'win32') {
            exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"`, { timeout: 2000 }, (err) => {
                pasted = !err;
                finish();
            });
        } else {
            // Linux：尝试 VS Code paste 命令
            try {
                vscode.commands.executeCommand('editor.action.clipboardPasteAction').then(
                    () => { pasted = true; finish(); },
                    () => { finish(); }
                );
            } catch (e) { finish(); }
        }

        function finish() {
            // === 步骤 4：粘贴后才打开 Webview 面板（显示内容，可手动编辑重发） ===
            setTimeout(() => {
                openChatPanel(finalText, restartWake, pasted);
                setStatusBarIdle(statusBarItem);
            }, 300);

            // === 步骤 5：无论 Webview 是否关闭，2 秒后都重启唤醒监听 ===
            if (restartWake) {
                setTimeout(() => startWakeWordListening(), 2000);
            }
        }
    }
}

// ============ Webview 面板 — 语音识别结果预览与手动重发 ============
function openChatPanel(initialText, restartWake, wasAutoPasted) {
    if (chatPanel) {
        // 更新已有面板的文本，无需重新创建
        chatPanel.webview.postMessage({ type: 'update', text: initialText });
        if (wasAutoPasted !== undefined) {
            chatPanel.webview.postMessage({
                type: 'status',
                text: wasAutoPasted ? '✅ 已复制到剪贴板并尝试粘贴到 AI 对话' : '📋 已复制到剪贴板，请在 AI 对话输入框按 Cmd+V 粘贴',
                level: wasAutoPasted ? 'ok' : 'warn'
            });
        }
        chatPanel.reveal(vscode.ViewColumn.Beside);
        return;
    }

    chatPanel = vscode.window.createWebviewPanel(
        'voiceStopSender.chat',
        '🗣 语音输入',
        vscode.ViewColumn.Beside,
        { enableScripts: true, enableForms: true, retainContextWhenHidden: true }
    );
    chatPanel.webview.html = buildWebviewHtml(initialText, wasAutoPasted);

    chatPanel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'send':
                // 用户手动点击"重新发送"（可能修改过文本）
                await vscode.env.clipboard.writeText((message.text || '').trim());
                // 再次尝试粘贴到 AI 对话
                if (process.platform === 'darwin') {
                    const cmds = ['workbench.action.chat.focus', 'workbench.action.chat.open', 'workbench.view.extension.trae-chat'];
                    for (const cmd of cmds) {
                        try { await vscode.commands.executeCommand(cmd); break; } catch (e) {}
                    }
                    setTimeout(() => {
                        exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { timeout: 2000 }, () => {});
                    }, 400);
                }
                vscode.window.showInformationMessage('↺ 已重新复制到剪贴板并尝试粘贴');
                if (chatPanel) chatPanel.webview.postMessage({ type: 'status', text: '↺ 已重新复制到剪贴板并尝试粘贴', level: 'ok' });
                break;
            case 'close':
                if (chatPanel) chatPanel.dispose();
                chatPanel = undefined;
                if (restartWake) setTimeout(() => startWakeWordListening(), 300);
                break;
        }
    });

    chatPanel.onDidDispose(() => {
        chatPanel = undefined;
        // Webview 关闭后也重启唤醒
        if (restartWake) setTimeout(() => startWakeWordListening(), 300);
    });
}

function buildWebviewHtml(initialText, wasAutoPasted) {
    const escapedText = (initialText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const statusText = wasAutoPasted
        ? '✅ 已复制到剪贴板并尝试粘贴到 AI 对话输入框。如内容未出现，请在 AI 对话输入框按 Cmd+V 粘贴。'
        : '📋 已复制到剪贴板。请点击 AI 对话输入框，按 Cmd+V 粘贴。';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' 'self'; script-src 'unsafe-inline' 'self';">
    <style>
        body { margin: 0; padding: 14px; font-family: -apple-system, BlinkMacSystemFont, "Ping Fang SC", "Microsoft YaHei", sans-serif; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        .header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; opacity: 0.85; }
        .hint { font-size: 11px; opacity: 0.6; margin-top: 6px; line-height: 1.5; }
        textarea { width: 100%; min-height: 100px; padding: 10px; box-sizing: border-box; font-size: 13px; line-height: 1.6; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.2)); border-radius: 4px; resize: vertical; outline: none; font-family: inherit; }
        textarea:focus { border-color: var(--vscode-focusBorder, #007fd4); }
        .btns { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
        button { padding: 6px 12px; font-size: 12px; cursor: pointer; border: none; border-radius: 4px; }
        .btn-primary { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, white); flex: 1; min-width: 100px; }
        .btn-close { background: transparent; color: var(--vscode-foreground, #cccccc); border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.2)); }
        .status { margin-top: 8px; font-size: 12px; padding: 8px 10px; border-radius: 4px; background: rgba(99, 102, 241, 0.12); color: #7c7ff3; line-height: 1.5; }
        .status.ok { background: rgba(72, 187, 120, 0.15); color: #48bb78; }
        .status.warn { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
    </style>
</head>
<body>
    <div class="header"><span>🗣</span><span>语音识别结果</span></div>
    <textarea id="text" placeholder="识别到的语音内容...">${escapedText}</textarea>
    <div class="hint">💡 这就是你刚才说的内容。可在这里修改。修改后按 <b>Ctrl+Enter</b> 或点击按钮重新复制到剪贴板。</div>
    <div class="btns">
        <button class="btn-primary" id="btn-send">↺ 重新复制到剪贴板</button>
        <button class="btn-close" id="btn-close">关闭</button>
    </div>
    <div class="status ${wasAutoPasted ? 'ok' : 'warn'}" id="status">${statusText}</div>
    <script>
        const vs = acquireVsCodeApi();
        const textArea = document.getElementById('text');
        const statusEl = document.getElementById('status');
        document.getElementById('btn-send').addEventListener('click', () => vs.postMessage({ command: 'send', text: textArea.value.trim() }));
        document.getElementById('btn-close').addEventListener('click', () => vs.postMessage({ command: 'close' }));
        textArea.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-send').click(); }
            else if (e.key === 'Escape') vs.postMessage({ command: 'close' });
        });
        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.type === 'update') textArea.value = msg.text || '';
            if (msg.type === 'status') {
                statusEl.textContent = msg.text || '';
                statusEl.className = 'status ' + (msg.level || '');
            }
        });
    </script>
</body>
</html>`;
}

// ============ 辅助：执行 shell 命令（osascript 等） ============
function execShell(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 3000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}

module.exports = { activate, deactivate };
