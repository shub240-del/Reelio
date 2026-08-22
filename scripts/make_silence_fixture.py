import math
import struct
import wave

sample_rate = 44100
segments = [(0.6, 0.0), (0.8, 0.35), (0.6, 0.0), (0.8, 0.35)]
frames = []
for duration, amplitude in segments:
    count = int(sample_rate * duration)
    for i in range(count):
        sample = amplitude * math.sin(2 * math.pi * 440 * (i / sample_rate))
        frames.append(struct.pack("<h", int(sample * 32767)))
with wave.open("/home/ubuntu/Reelio/silence-tone-fixture.wav", "wb") as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(sample_rate)
    out.writeframes(b"".join(frames))
