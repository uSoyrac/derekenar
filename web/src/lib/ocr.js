// OCR motoru (tesseract.js). İlk gerektiğinde yüklenir; dil verileri uygulamayla birlikte sunulur.
let enginePromise = null;

export function getOcrEngine() {
  enginePromise ||= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const base = new URL('./ocr/', document.baseURI).href;
    const worker = await createWorker(['tur', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core',
      langPath: base + 'lang',
      gzip: true,
      workerBlobURL: false,
    });
    let mode = null;
    return {
      async recognize(canvas, { block = false } = {}) {
        const want = block ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE;
        if (mode !== want) { await worker.setParameters({ tessedit_pageseg_mode: want }); mode = want; }
        const { data } = await worker.recognize(canvas);
        return (data.text || '').trim();
      },
      terminate: () => worker.terminate(),
    };
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}
