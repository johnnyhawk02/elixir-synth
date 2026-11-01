// ---- installable: a service worker keeps the app for offline use (sw.js: the page comes from the network first, so a
// new version arrives as soon as there's a connection), and the presets page offers to install it where the browser
// allows (Chrome on Android also has Install app in its menu) ----
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
let mInstallEv = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); mInstallEv = e; $('m-install').hidden = false; });
addEventListener('appinstalled', () => { mInstallEv = null; $('m-install').hidden = true; });
$('m-install').addEventListener('click', async () => {
  if (!mInstallEv) return;
  mInstallEv.prompt(); await mInstallEv.userChoice.catch(() => {});
  mInstallEv = null; $('m-install').hidden = true;
});
// start: everything drawn, the first page shown
mUndoDraw(); drawAll(); mGo(0); requestAnimationFrame(mDepth);
