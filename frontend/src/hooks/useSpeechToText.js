import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps the browser's SpeechRecognition API (P1.4 — voice input).
 *
 * Chrome/Edge only (webkitSpeechRecognition); no Firefox/Safari support as of
 * this writing. `supported` tells the caller whether to render the control at
 * all — a mic button with no browser support behind it is exactly the "dead
 * affordance" this feature exists to fix, so an unsupported browser should
 * hide the button, never show one that silently does nothing.
 *
 * `onResult` is called once per final transcript chunk (not interim results
 * — a composer text field re-writing itself mid-word on every interim
 * result is worse than waiting the half-second for the real one).
 */
export function useSpeechToText({ onResult } = {}) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const SpeechRecognitionCtor =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
  const supported = Boolean(SpeechRecognitionCtor);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onresult = (event) => {
      const chunk = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();
      if (chunk) onResultRef.current?.(chunk);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [SpeechRecognitionCtor, supported]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, toggle };
}
