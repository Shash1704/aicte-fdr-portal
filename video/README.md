# Demo video

Builds the SIH26265 demo video from the team's voice recording: a browser drives the live prototype
in time with the speakers, and the result is merged with the audio and captions.

Needs: Homebrew `ffmpeg` and `whisper-cpp`, Node 22+, and the whisper model in `models/`:

```bash
brew install ffmpeg whisper-cpp
```

```bash
npm install && npx playwright install chromium
```

```bash
curl -L -o models/ggml-small.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

## Steps

1. Put the recording at `audio/voice.mp3`.
2. Transcribe it with word timings (used to place every click and the captions):

   ```bash
   ffmpeg -y -i audio/voice.mp3 -ar 16000 -ac 1 audio/voice16k.wav && whisper-cli -m models/ggml-small.en.bin -f audio/voice16k.wav -ml 1 -sow -oj -of out/words -np
   ```

3. Dry-run the browser script without waiting for the audio (finds broken steps in about a minute):

   ```bash
   FAST=1 node record.mjs
   ```

4. Record in real time (about 4½ minutes), then merge:

   ```bash
   node record.mjs && sh make.sh
   ```

Output: `out/Varangians_SIH26265_Demo.mp4` (1920×1080, captions as a switchable track) and `out/captions.srt`.

## How it works

- `record.mjs` opens the live demo at a 1920×1080 viewport (the same size as the video; the recorder never enlarges a smaller page, it leaves a grey border) and runs one timeline.
  Each step is pinned to the second its line is spoken (`at(seconds, label)`); the run reports any step
  that started late. It shows a cursor, click ripples, a lime highlight box, the part title, the title
  and closing cards, and the release letter, all drawn inside the page.
- A fresh browser profile means fresh demo data on every run, so the numbers match the script.
- `captions.py` groups the word timings into caption lines and fixes the few words whisper mishears.
- `make.sh` trims the warm-up from the recording and adds the audio and captions.

If the audio is re-recorded, the step times in `record.mjs` must be updated from the new `out/words.json`.
