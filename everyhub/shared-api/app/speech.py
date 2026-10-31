# Copyright 2026 Gwang-Jin Kim
# SPDX-License-Identifier: AGPL-3.0-only

from pathlib import Path


class WhisperEngine:
    def __init__(self, cache: Path, threads: int, max_duration: int):
        self.cache, self.threads, self.max_duration = cache, threads, max_duration
        self.model = None

    def load_model(self):
        if self.model is None:
            import onnxruntime
            from faster_whisper import WhisperModel
            onnxruntime.disable_telemetry_events()
            self.model = WhisperModel("small", device="cpu", compute_type="int8",
                                      cpu_threads=self.threads, num_workers=1, download_root=str(self.cache))
        return self.model

    def transcribe(self, path: Path, language: str):
        import av
        import numpy as np
        # Decode incrementally: a small compressed recording may contain hours
        # of audio. Never decode an untrusted file into an unbounded array.
        chunks, count = [], 0
        with av.open(str(path), options={"protocol_whitelist": "file,pipe"}) as audio:
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            for frame in audio.decode(audio=0):
                for converted in resampler.resample(frame):
                    count += converted.samples
                    if count > self.max_duration * 16000:
                        raise ValueError(f"Recording is longer than {self.max_duration // 60} minutes.")
                    chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32) / 32768.0)
            for converted in resampler.resample(None):
                count += converted.samples
                if count > self.max_duration * 16000:
                    raise ValueError(f"Recording is longer than {self.max_duration // 60} minutes.")
                chunks.append(converted.to_ndarray().reshape(-1).astype(np.float32) / 32768.0)
        if not chunks:
            raise ValueError("The recording contains no audio.")
        self.load_model()
        segments, info = self.model.transcribe(
            np.concatenate(chunks), task="transcribe", language=None if language == "auto" else language,
            vad_filter=True, condition_on_previous_text=False, beam_size=5,
        )
        if info.duration > self.max_duration:
            raise ValueError(f"Recording is longer than {self.max_duration // 60} minutes.")
        text = " ".join(segment.text.strip() for segment in segments).strip()
        if not text:
            raise ValueError("No speech detected in this recording.")
        return {"text": text, "language": info.language, "duration": count / 16000}
