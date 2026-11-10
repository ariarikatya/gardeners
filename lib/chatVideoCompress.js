const VIDEO_MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export async function compressChatVideo(file, { maxWidth = 1280, maxHeight = 720, videoBitsPerSecond = 900_000 } = {}) {
  if (!file?.type?.startsWith('video/') || typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return file;
  }

  const mimeType = VIDEO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
  const captureStream = HTMLVideoElement.prototype.captureStream
    || HTMLVideoElement.prototype.mozCaptureStream;
  if (!mimeType || !captureStream || !HTMLCanvasElement.prototype.captureStream) return file;

  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = sourceUrl;

  let animationFrame = 0;
  let sourceStream;
  let outputStream;

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error(`Не удалось прочитать видео «${file.name}»`));
    });

    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;

    outputStream = canvas.captureStream(24);
    sourceStream = captureStream.call(video);
    sourceStream.getAudioTracks().forEach((track) => outputStream.addTrack(track));

    const recorder = new MediaRecorder(outputStream, {
      mimeType,
      videoBitsPerSecond,
    });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error(`Не удалось сжать видео «${file.name}»`));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
      video.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    });

    const drawFrame = () => {
      if (video.paused || video.ended) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    recorder.start(500);
    await video.play();
    drawFrame();
    const compressedBlob = await result;
    if (!compressedBlob.size || compressedBlob.size >= file.size) return file;

    const outputExtension = compressedBlob.type.includes('mp4') ? '.mp4' : '.webm';
    const outputName = file.name.replace(/\.[^/.]+$/, '') + outputExtension;
    return new File([compressedBlob], outputName, {
      type: compressedBlob.type,
      lastModified: Date.now(),
    });
  } finally {
    window.cancelAnimationFrame(animationFrame);
    video.pause();
    video.removeAttribute('src');
    video.load();
    sourceStream?.getTracks().forEach((track) => track.stop());
    outputStream?.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(sourceUrl);
  }
}
