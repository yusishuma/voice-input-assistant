#!/usr/bin/env python3
"""
语音断语识别 - 使用 Vosk 离线中文语音识别
跨平台（macOS / Windows / Linux）

模型路径：扩展目录下的 models/vosk-model-small-cn-0.22/
（模型已随扩展打包，无需下载！）

用法:
    # 模式 1：录音识别（默认）——说停止词停止，输出识别文本
    python3 voice_listener.py --stop-word 完毕 --language zh --silence-timeout 3.0

    # 模式 2：唤醒词监听——持续监听，听到唤醒词时输出 [WAKE_DETECTED]
    python3 voice_listener.py --mode wake --wake-word 维纳斯 --language zh
"""

import argparse
import json
import os
import sys
import time
import queue
import signal

try:
    import sounddevice as sd
except ImportError:
    print("[ERROR] 缺少依赖：请先运行  pip3 install vosk sounddevice soundfile numpy", file=sys.stderr)
    sys.exit(1)

try:
    from vosk import Model, KaldiRecognizer, SetLogLevel
except ImportError:
    print("[ERROR] 缺少依赖：请先运行  pip3 install vosk sounddevice soundfile numpy", file=sys.stderr)
    sys.exit(1)

SetLogLevel(-1)

# 关键修复：强制 stdout 行缓冲（子进程默认是块缓冲，
# 这会导致 WAKE_READY/WAKE_DETECTED 信号延迟几秒钟才能被 Node.js 读到）
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

SAMPLE_RATE = 16000
CHANNELS = 1
CHUNK_SIZE = 4000  # 每块 ~0.25s

MODEL_DIR_NAME = "vosk-model-small-cn-0.22"


def find_model_path():
    candidates = []
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(script_dir, "models", MODEL_DIR_NAME))
    candidates.append(os.path.join(os.path.expanduser("~"), ".cache", "vosk", MODEL_DIR_NAME))
    candidates.append(os.path.join(os.path.expanduser("~"), ".vosk", "models", MODEL_DIR_NAME))
    candidates.append(os.path.join(os.path.expanduser("~"), MODEL_DIR_NAME))
    for p in candidates:
        if os.path.isdir(p) and os.path.exists(os.path.join(p, "am")):
            return p
    return None


def listen_and_recognize(stop_word, model_path, max_seconds, silence_timeout):
    q = queue.Queue()

    def _audio_callback(indata, frames, time_info, status):
        if status:
            pass
        q.put(bytes(indata))

    try:
        model = Model(model_path)
    except Exception as e:
        print(f"[ERROR] 模型加载失败：{e}", file=sys.stderr)
        print(f"[ERROR] 模型路径：{model_path}", file=sys.stderr)
        sys.exit(3)

    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(False)

    all_text_parts = []
    last_partial = ""
    last_voice_time = time.time()
    start_time = time.time()

    print(f"[READY] 正在聆听…说出停止词「{stop_word}」", file=sys.stderr)
    sys.stderr.flush()

    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=CHUNK_SIZE,
            dtype="int16",
            channels=CHANNELS,
            callback=_audio_callback,
        ):
            while True:
                elapsed = time.time() - start_time
                if elapsed > max_seconds:
                    print(f"[STOP] 达到最长时长 {max_seconds}s", file=sys.stderr)
                    break

                try:
                    data = q.get(timeout=0.5)
                except queue.Empty:
                    continue

                if recognizer.AcceptWaveform(data):
                    result = json.loads(recognizer.Result())
                    text = result.get("text", "").strip().replace(" ", "")
                    if text:
                        all_text_parts.append(text)
                        print(f"[PART] {text}", file=sys.stderr)
                        sys.stderr.flush()
                        last_voice_time = time.time()
                        combined = "".join(all_text_parts)
                        if stop_word and stop_word in combined:
                            print(f"[STOP] 检测到停止词「{stop_word}」", file=sys.stderr)
                            break
                else:
                    partial = json.loads(recognizer.PartialResult()).get("partial", "").strip().replace(" ", "")
                    if partial and partial != last_partial:
                        last_partial = partial
                        print(f"[HEAR] {partial}", file=sys.stderr)
                        sys.stderr.flush()
                        last_voice_time = time.time()
                        combined = "".join(all_text_parts) + partial
                        if stop_word and stop_word in combined:
                            print(f"[STOP] 检测到停止词「{stop_word}」", file=sys.stderr)
                            break

                if silence_timeout > 0:
                    silence = time.time() - last_voice_time
                    if silence > silence_timeout and all_text_parts:
                        print(f"[STOP] 静音超时（{silence:.1f}s 无语音）", file=sys.stderr)
                        break

    except KeyboardInterrupt:
        print("[STOP] 用户中断", file=sys.stderr)

    final_result = json.loads(recognizer.FinalResult())
    final_text = final_result.get("text", "").strip().replace(" ", "")
    if final_text and final_text not in all_text_parts:
        all_text_parts.append(final_text)

    combined_text = "".join(all_text_parts)
    if stop_word and stop_word in combined_text:
        idx = combined_text.index(stop_word)
        combined_text = combined_text[:idx]

    return combined_text.strip()


def wake_word_listen(wake_word, model_path):
    """持续监听唤醒词。检测到后输出 WAKE_DETECTED 并退出。
    为降低 CPU 占用，采用滑动窗口检测。每 3 秒清空历史，防止旧文字误匹配。
    """
    q = queue.Queue()

    def _audio_callback(indata, frames, time_info, status):
        if status:
            pass
        q.put(bytes(indata))

    try:
        model = Model(model_path)
    except Exception as e:
        print(f"[ERROR] 模型加载失败：{e}", file=sys.stderr)
        print(f"[ERROR] 模型路径：{model_path}", file=sys.stderr)
        sys.exit(3)

    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(False)

    # 输出 ready 信号，告诉 Node.js 层启动成功
    print(f"[WAKE_READY] 正在监听唤醒词「{wake_word}」…", file=sys.stderr)
    sys.stderr.flush()
    print("WAKE_READY")  # stdout 信号，给 Node.js 层用
    sys.stdout.flush()

    last_partial = ""
    # 保存最近几轮的文本，避免唤醒词被 partial 分段识别
    recent_texts = []
    # 每 3 秒重置一次缓存，防止旧文字累积误匹配
    last_clear_time = time.time()

    try:
        with sd.RawInputStream(
            samplerate=SAMPLE_RATE,
            blocksize=CHUNK_SIZE,
            dtype="int16",
            channels=CHANNELS,
            callback=_audio_callback,
        ):
            while True:
                # 定期清空历史（3 秒一次），防止累积的旧文字造成误匹配
                if time.time() - last_clear_time > 3.0:
                    recent_texts = []
                    last_clear_time = time.time()

                try:
                    data = q.get(timeout=0.5)
                except queue.Empty:
                    continue

                if recognizer.AcceptWaveform(data):
                    result = json.loads(recognizer.Result())
                    text = result.get("text", "").strip().replace(" ", "")
                    if text:
                        recent_texts.append(text)
                        # 只保留最近 3 段（唤醒词一般 2-4 个字，一段就够）
                        if len(recent_texts) > 3:
                            recent_texts = recent_texts[-3:]
                        combined = "".join(recent_texts)
                        print(f"[HEAR] final={text} 累计={combined}", file=sys.stderr)
                        sys.stderr.flush()
                        if wake_word in combined:
                            print(f"[WAKE_DETECTED] {wake_word}", file=sys.stderr)
                            sys.stderr.flush()
                            print("WAKE_DETECTED")
                            sys.stdout.flush()
                            return True
                else:
                    partial = json.loads(recognizer.PartialResult()).get("partial", "").strip().replace(" ", "")
                    if partial and partial != last_partial:
                        last_partial = partial
                        # 也在 partial 中检测唤醒词（更灵敏）
                        combined = "".join(recent_texts) + partial
                        print(f"[HEAR] partial={partial} 累计={combined}", file=sys.stderr)
                        sys.stderr.flush()
                        if wake_word in combined:
                            print(f"[WAKE_DETECTED] {wake_word} (from partial)", file=sys.stderr)
                            sys.stderr.flush()
                            print("WAKE_DETECTED")
                            sys.stdout.flush()
                            return True

    except KeyboardInterrupt:
        return False

    return False


def main():
    parser = argparse.ArgumentParser(description="语音断语识别（Vosk 离线）")
    parser.add_argument("--mode", default="record", choices=["record", "wake"],
                        help="运行模式：record=录音识别直到停止词；wake=持续监听唤醒词")
    parser.add_argument("--stop-word", default="完毕")
    parser.add_argument("--wake-word", default="维纳斯")
    parser.add_argument("--language", default="zh")
    parser.add_argument("--max-seconds", type=float, default=60)
    parser.add_argument("--silence-timeout", type=float, default=3.0)
    args = parser.parse_args()

    # SIGTERM: 让 Node.js 可以正常杀掉唤醒进程
    signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
    # SIGINT: 录音模式下忽略，由上层逻辑控制停止
    signal.signal(signal.SIGINT, lambda s, f: None)

    model_path = find_model_path()
    if not model_path:
        print(f"[ERROR] 未找到 Vosk 模型目录。", file=sys.stderr)
        print(f"[ERROR] 请确保扩展目录下存在 models/{MODEL_DIR_NAME}/（包含 am, conf, graph 子目录）", file=sys.stderr)
        sys.exit(2)

    print(f"[INFO] 使用模型：{model_path}", file=sys.stderr)
    sys.stderr.flush()

    if args.mode == "wake":
        detected = wake_word_listen(
            wake_word=args.wake_word,
            model_path=model_path,
        )
        sys.exit(0 if detected else 1)
    else:
        text = listen_and_recognize(
            stop_word=args.stop_word,
            model_path=model_path,
            max_seconds=args.max_seconds,
            silence_timeout=args.silence_timeout,
        )
        print(text)


if __name__ == "__main__":
    main()
