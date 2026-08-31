window.OrderFlowWeb = {
  _scannerDecoderPromise: null,
  _scannerDecoderReady: false,

  prepareScannerDecoder: function () {
    if (this._scannerDecoderReady) return Promise.resolve(true);
    if (this._scannerDecoderPromise) return this._scannerDecoderPromise;

    const scriptId = 'mobile-scanner-zxing-wasm';
    const scriptUrl = new URL(
      'vendor/zxing-wasm-3.1.1/reader.js',
      document.baseURI,
    ).href;
    const wasmUrl = new URL(
      'vendor/zxing-wasm-3.1.1/zxing_reader.wasm',
      document.baseURI,
    ).href;

    this._scannerDecoderPromise = new Promise((resolve) => {
      const prepareModule = async () => {
        try {
          if (!window.ZXingWASM ||
              typeof window.ZXingWASM.prepareZXingModule !== 'function') {
            throw new Error('ZXingWASM is unavailable');
          }

          await window.ZXingWASM.prepareZXingModule({
            overrides: {
              locateFile: (path, prefix) =>
                path.endsWith('.wasm') ? wasmUrl : prefix + path,
            },
            fireImmediately: true,
          });
          this._scannerDecoderReady = true;
          resolve(true);
        } catch (_) {
          this._scannerDecoderPromise = null;
          this._scannerDecoderReady = false;
          const failedScript = document.getElementById(scriptId);
          if (failedScript) failedScript.remove();
          resolve(false);
        }
      };

      const existingScript = document.getElementById(scriptId);
      if (existingScript) {
        if (window.ZXingWASM) {
          void prepareModule();
        } else {
          existingScript.addEventListener('load', prepareModule, { once: true });
          existingScript.addEventListener('error', () => {
            existingScript.remove();
            this._scannerDecoderPromise = null;
            resolve(false);
          }, { once: true });
        }
        return;
      }

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = scriptUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.addEventListener('load', prepareModule, { once: true });
      script.addEventListener('error', () => {
        script.remove();
        this._scannerDecoderPromise = null;
        resolve(false);
      }, { once: true });
      document.head.appendChild(script);
    });

    return this._scannerDecoderPromise;
  },

  __isBarcodeDetectorSupported: function () {
    return typeof window.BarcodeDetector !== 'undefined'
        && typeof window.createImageBitmap === 'function';
  },

  _scannerTrack: null,
  _scannerVideo: null,
  _scannerCanvas: null,

  _findScannerVideo: function () {
    const roots = [document];
    while (roots.length) {
      const root = roots.shift();
      for (const video of root.querySelectorAll('video')) {
        const stream = video.srcObject;
        const track = stream && stream.getVideoTracks
            ? stream.getVideoTracks()[0]
            : null;
        if (track && track.readyState === 'live') return video;
      }
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return null;
  },

  configureScannerCamera: async function () {
    const video = this._findScannerVideo();
    const track = video && video.srcObject
        ? video.srcObject.getVideoTracks()[0]
        : null;
    if (!track) return -1;

    this._scannerVideo = video;
    this._scannerTrack = track;

    const capabilities = track.getCapabilities
        ? track.getCapabilities()
        : {};
    return capabilities.torch === true ? 1 : 0;
  },

  setScannerTorch: async function (enabled) {
    const track = this._scannerTrack;
    if (!track || track.readyState !== 'live') return false;

    const capabilities = track.getCapabilities
        ? track.getCapabilities()
        : {};
    if (capabilities.torch !== true) return false;

    try {
      await track.applyConstraints({ advanced: [{ torch: enabled }] });
      return true;
    } catch (_) {
      return false;
    }
  },

  sampleScannerLuminance: function () {
    const video = this._scannerVideo;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;

    const canvas = this._scannerCanvas || document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    this._scannerCanvas = canvas;

    const context = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    if (!context) return null;

    const sourceWidth = video.videoWidth * 0.7;
    const sourceHeight = video.videoHeight * 0.5;
    const sourceX = (video.videoWidth - sourceWidth) / 2;
    const sourceY = (video.videoHeight - sourceHeight) / 2;

    try {
      context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let total = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        total += pixels[index] * 0.2126
            + pixels[index + 1] * 0.7152
            + pixels[index + 2] * 0.0722;
      }
      return total / (pixels.length / 4);
    } catch (_) {
      return null;
    }
  },
};
