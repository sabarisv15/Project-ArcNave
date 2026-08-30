#!/usr/bin/env python3
"""Fixed, sandbox-shipped ffmpeg wrapper — invoked directly by server.js
(same "trusted operation" treatment as recalc.py), never by
LLM-supplied `code`. The whole point of keeping this a separate,
argv-driven script rather than something the generic execute_code path
could construct is that the codec/target-format choice must stay a
closed, developer-reviewed set (ai-chat-file-intelligence-router-
approved-spec.md's Audio/Video features) — an LLM never gets to pick
arbitrary ffmpeg flags.
"""
import sys
import os
import subprocess
import json

# Two targets only, matching the router's own closed supported-format
# set: audio always normalizes to mono 16kHz PCM WAV (native-multimodal
# audio input), video to H.264/AAC MP4 (native-multimodal video input).
TARGET_FORMAT_ARGS = {
    'audio_wav': ['-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1'],
    'video_mp4': ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'],
}

FFMPEG_TIMEOUT_SECONDS = 100


def fail(reason, detail=None):
    print(json.dumps({'status': 'failed', 'reason': reason, 'detail': detail}))
    sys.exit(1)


def main():
    if len(sys.argv) != 4:
        fail('invalid_arguments', 'usage: transcode.py <inputPath> <targetFormat> <outputPath>')
    input_path, target_format, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    codec_args = TARGET_FORMAT_ARGS.get(target_format)
    if codec_args is None:
        fail('invalid_arguments', 'unknown targetFormat %r' % target_format)
    if not os.path.isfile(input_path):
        fail('invalid_arguments', 'input file does not exist')

    # A fixed argv list, never a shell string — input_path/output_path
    # are server-generated temp paths, not untrusted content, but this
    # avoids any shell-interpolation risk regardless.
    cmd = ['ffmpeg', '-y', '-i', input_path] + codec_args + [output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT_SECONDS, text=True)
    except subprocess.TimeoutExpired:
        fail('transcode_timeout')
        return

    if result.returncode != 0 or not os.path.isfile(output_path):
        fail('transcode_failed', (result.stderr or '')[-500:])
        return

    print(json.dumps({'status': 'ok', 'outputPath': os.path.basename(output_path)}))


if __name__ == '__main__':
    main()
