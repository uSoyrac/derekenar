// Sesli not: tarayıcının konuşma tanıma özelliğiyle dikte (Chrome, Edge, Android Chrome, Safari).
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export const speechSupported = Boolean(Recognition);

export const speechLang = () => localStorage.getItem('derkenar.speechLang') || 'tr-TR';
export const setSpeechLang = (lang) => localStorage.setItem('derkenar.speechLang', lang);

/**
 * Dikteyi başlatır. onText(kesinMetin, geçiciMetin) her güncellemede çağrılır.
 * Dönen fonksiyon dikteyi durdurur.
 */
export function startDictation({ onText, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = speechLang();
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalText += res[0].transcript.trim() + ' ';
      else interim += res[0].transcript;
    }
    onText(finalText.trim(), interim.trim());
  };
  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    onError?.(event.error === 'not-allowed' ? 'Mikrofon izni verilmedi' : 'Ses tanıma başlatılamadı');
  };
  rec.onend = () => onEnd?.(finalText.trim());
  rec.start();
  return () => rec.stop();
}
