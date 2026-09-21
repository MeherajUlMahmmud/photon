import base64
import binascii

from rest_framework import serializers

# Base64 of a two-minute Opus clip is well under 1 MB; the cap keeps the JSON
# body inside Django's default upload limit.
MAX_AUDIO_BASE64_CHARS = 2_000_000

ACCEPTED_MIME_PREFIXES = ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav')


class TranscriptionRequestSerializer(serializers.Serializer):
    audio = serializers.CharField(max_length=MAX_AUDIO_BASE64_CHARS, trim_whitespace=False)
    mime = serializers.CharField(max_length=80)
    language = serializers.RegexField(r'^[a-z]{2}(-[A-Za-z]{2})?$', required=False, allow_blank=True)

    class Meta:
        ref_name = 'TranscriptionRequest'

    def validate_mime(self, value):
        if not value.lower().startswith(ACCEPTED_MIME_PREFIXES):
            raise serializers.ValidationError('Unsupported audio type.')
        return value

    def validate_audio(self, value):
        try:
            raw = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError):
            raise serializers.ValidationError('audio must be base64.')
        if not raw:
            raise serializers.ValidationError('audio is empty.')
        return raw


class TranscriptionResponseSerializer(serializers.Serializer):
    text = serializers.CharField()
    provider = serializers.CharField()
    model = serializers.CharField()
    call_id = serializers.CharField()

    class Meta:
        ref_name = 'TranscriptionResponse'
