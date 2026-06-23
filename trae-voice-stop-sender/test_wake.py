#!/usr/bin/env python3
import sys, os, time, queue, json

try:
    import sounddevice as sd
    from vosk import Model, KaldiRecognizer, SetLogLevel
    SetLogLevel(-1)
except ImportError as e:
    print(f'依赖缺失: {e}')
    sys.exit(1)

script_dir = os.path.dirname(os.path.abspath(__file__))
candidates = [
    os.path.join(script_dir, 'models', 'vosk-model-small-cn-0.22'),
    os.path.join(os.path.expanduser('~'), '.cache', 'vosk', 'vosk-model-small-cn-0.22'),
]
model_path = None
for p in candidates:
    if os.path.isdir(p) and os.path.exists(os.path.join(p, 'am')):
        model_path = p
        break

if not model_path:
    print('找不到模型目录')
    sys.exit(2)

print(f'模型: {model_path}')
print()

q = queue.Queue()
def _cb(indata, frames, time_info, status):
    q.put(bytes(indata))

model = Model(model_path)
recognizer = KaldiRecognizer(model, 16000)
recognizer.SetWords(False)

start_time = time.time()
last_partial = ''
all_parts = []
wake_word = sys.argv[1] if len(sys.argv) > 1 else '小助小助'
detected = False

print(f'开始录音测试（8秒），请对着麦克风说:「{wake_word}」')
print(f'{"时间(s)":<8} | 内容')
print('-' * 60)

with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype='int16', channels=1, callback=_cb):
    while time.time() - start_time < 8:
        try:
            data = q.get(timeout=0.3)
        except queue.Empty:
            continue
        if recognizer.AcceptWaveform(data):
            text = json.loads(recognizer.Result()).get('text', '').replace(' ', '')
            if text:
                all_parts.append(text)
                elapsed = time.time() - start_time
                combined = ''.join(all_parts)
                print(f'  FINAL [{elapsed:.1f}s]: {text}  |  累计={combined}')
                if wake_word in combined:
                    print(f'  ✅✅✅ 检测到唤醒词: {wake_word}')
                    detected = True
        else:
            partial = json.loads(recognizer.PartialResult()).get('partial', '').replace(' ', '')
            if partial and partial != last_partial:
                last_partial = partial
                elapsed = time.time() - start_time
                combined = ''.join(all_parts) + partial
                print(f'  PARTIAL [{elapsed:.1f}s]: {partial}  |  累计={combined}')
                if wake_word in combined:
                    print(f'  ✅✅✅ 检测到唤醒词(partial): {wake_word}')
                    detected = True

final_text = json.loads(recognizer.FinalResult()).get('text', '').replace(' ', '')
if final_text:
    all_parts.append(final_text)

print()
print('=' * 60)
combined = ''.join(all_parts)
print(f'最终累计识别: {combined}')
hit = '✅ 是' if wake_word in combined else '❌ 否'
print(f'唤醒词「{wake_word}」是否命中: {hit}')
print()
print('如果没识别到，可能的原因:')
print('  1. 发音方式问题 — Vosk 对某些词的组合更敏感')
print('  2. 可以尝试更长的词或带声调的词')
print('  3. 试试其他词：「小助手」「语音助手」「开始」')
