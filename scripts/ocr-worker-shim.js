// Wrapper around the Tesseract worker. If the page passes ?model=<file>, the model
// download (always requested as eng.traineddata.gz) is redirected to that file name,
// for hosts that only serve certain file extensions.
const model = new URL(self.location.href).searchParams.get('model');
if (model) {
  const realFetch = self.fetch.bind(self);
  self.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return realFetch(/\/eng\.traineddata\.gz$/.test(url) ? url.replace(/eng\.traineddata\.gz$/, model) : input, init);
  };
}
importScripts('worker.min.js');
