"""
Core transcription engine:
- faster-whisper for multilingual speech-to-text
- Simple speaker diarization using spectral clustering on audio embeddings
"""

import logging
from typing import Any

import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


class TranscriptionService:
    """Transcribes audio with speaker diarization."""

    SUPPORTED_LANGUAGES = {"ar", "fr", "en"}

    def __init__(
        self,
        model_size: str = "large-v3",
        device: str = "cpu",
        compute_type: str = "int8",
    ):
        logger.info(f"Loading Whisper model: {model_size} on {device} ({compute_type})")
        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self._embedding_model = None
        self._init_diarization()

    def _init_diarization(self) -> None:
        """Initialize speaker diarization using speechbrain's speaker embedding model."""
        try:
            from speechbrain.inference.speaker import EncoderClassifier

            self._embedding_model = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir="models/spkrec-ecapa-voxceleb",
                run_opts={"device": "cpu"},
            )
            logger.info("Speaker embedding model loaded")
        except Exception as e:
            logger.warning(f"Speaker diarization unavailable: {e}")
            self._embedding_model = None

    def transcribe(self, audio_path: str) -> dict[str, Any]:
        """
        Transcribe audio file with speaker diarization.
        Returns dict matching TranscriptResponse schema.
        """
        # Step 1: Transcribe with Whisper
        # language=None enables auto-detection — crucial for Tunisian Arabic
        # which is a dialect not well served by hardcoding language="ar" (biases to MSA)
        segments_iter, info = self._model.transcribe(
            audio_path,
            language=None,
            task="transcribe",
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 200,
            },
            word_timestamps=True,
            beam_size=5,
        )

        # Collect all segments
        raw_segments = []
        for seg in segments_iter:
            raw_segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip(),
                "confidence": np.exp(seg.avg_logprob) if seg.avg_logprob else 0.0,
                "words": [
                    {"start": w.start, "end": w.end, "word": w.word}
                    for w in (seg.words or [])
                ],
            })

        detected_lang = info.language
        duration = info.duration

        logger.info(
            f"Whisper done: {len(raw_segments)} segments, "
            f"lang={detected_lang}, duration={duration:.1f}s"
        )

        # Step 2: Speaker diarization
        if self._embedding_model is not None and len(raw_segments) > 1:
            speaker_labels = self._diarize_segments(audio_path, raw_segments)
        else:
            speaker_labels = ["Speaker 1"] * len(raw_segments)

        # Step 3: Build response
        detected_languages = [detected_lang] if detected_lang else ["unknown"]

        result_segments = []
        for seg, speaker in zip(raw_segments, speaker_labels):
            result_segments.append({
                "speaker": speaker,
                "text": seg["text"],
                "start_time": round(seg["start"], 2),
                "end_time": round(seg["end"], 2),
                "language": detected_lang or "unknown",
                "confidence": round(seg["confidence"], 4),
            })

        # Merge consecutive segments from the same speaker
        merged = _merge_consecutive_speakers(result_segments)

        unique_speakers = list({s["speaker"] for s in merged})
        full_text = " ".join(s["text"] for s in merged)

        return {
            "duration_seconds": round(duration, 2),
            "detected_languages": detected_languages,
            "speaker_count": len(unique_speakers),
            "segments": merged,
            "full_text": full_text,
        }

    def _diarize_segments(
        self, audio_path: str, segments: list[dict[str, Any]]
    ) -> list[str]:
        """
        Simple speaker diarization using speaker embeddings + clustering.
        Extracts an embedding per segment, then clusters into speakers.
        """
        import torchaudio
        from sklearn.cluster import AgglomerativeClustering

        try:
            waveform, sample_rate = torchaudio.load(audio_path)

            # Convert to mono if stereo
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                resampler = torchaudio.transforms.Resample(sample_rate, 16000)
                waveform = resampler(waveform)
                sample_rate = 16000

            # Extract embedding for each segment
            embeddings = []
            valid_indices = []
            min_samples = int(sample_rate * 0.5)  # 0.5 second minimum

            for i, seg in enumerate(segments):
                start_sample = int(seg["start"] * sample_rate)
                end_sample = int(seg["end"] * sample_rate)
                chunk = waveform[:, start_sample:end_sample]

                # Skip very short segments (< 0.5s)
                if chunk.shape[1] < min_samples:
                    continue

                emb = self._embedding_model.encode_batch(chunk)
                embeddings.append(emb.squeeze().detach().numpy())
                valid_indices.append(i)

            if len(embeddings) < 2:
                return ["Speaker 1"] * len(segments)

            embeddings_array = np.stack(embeddings)

            # Determine optimal number of speakers (2–5) using silhouette score
            from sklearn.metrics import silhouette_score

            max_speakers = min(5, len(embeddings))
            best_k = 2
            best_score = -1.0

            for k in range(2, max_speakers + 1):
                clustering_trial = AgglomerativeClustering(
                    n_clusters=k,
                    metric="cosine",
                    linkage="average",
                )
                trial_labels = clustering_trial.fit_predict(embeddings_array)
                # silhouette_score requires at least 2 distinct labels
                if len(set(trial_labels)) < 2:
                    continue
                score = silhouette_score(embeddings_array, trial_labels, metric="cosine")
                if score > best_score:
                    best_score = score
                    best_k = k

            clustering = AgglomerativeClustering(
                n_clusters=best_k,
                metric="cosine",
                linkage="average",
            )
            labels = clustering.fit_predict(embeddings_array)

            # Map cluster labels to speaker names
            speaker_map = {label: f"Speaker {label + 1}" for label in set(labels)}

            # Build full label list (assign Unknown to skipped segments)
            result = ["Unknown"] * len(segments)
            for idx, label in zip(valid_indices, labels):
                result[idx] = speaker_map[label]

            # Fill Unknown gaps with nearest known speaker
            for i in range(len(result)):
                if result[i] == "Unknown" and i > 0:
                    result[i] = result[i - 1]

            logger.info(f"Diarization: {len(set(labels))} speakers detected")
            return result

        except Exception as e:
            logger.warning(f"Diarization failed, falling back to single speaker: {e}")
            return ["Speaker 1"] * len(segments)


def _merge_consecutive_speakers(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge consecutive segments from the same speaker."""
    if not segments:
        return []

    merged = [segments[0].copy()]
    for seg in segments[1:]:
        if seg["speaker"] == merged[-1]["speaker"]:
            merged[-1] = {
                **merged[-1],
                "text": merged[-1]["text"] + " " + seg["text"],
                "end_time": seg["end_time"],
                "confidence": max(merged[-1]["confidence"], seg["confidence"]),
            }
        else:
            merged.append(seg.copy())
    return merged
