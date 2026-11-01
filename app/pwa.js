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
// ---- landscape on a phone: a page can only lock the screen's turn while it's fullscreen or installed (Android's
// browsers; iPhones never allow it, so there it stays a prompt to turn the phone). The installed app asks for
// landscape in its manifest, and tries the lock too; in a browser tab, held upright, the prompt offers go fullscreen,
// which locks it landscape where the browser allows. Leaving fullscreen lets the phone turn freely again ----
const canLock = !!(screen.orientation && screen.orientation.lock && document.documentElement.requestFullscreen);
const lockLandscape = () => screen.orientation.lock('landscape').catch(() => {});
if (canLock && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches) lockLandscape();
$('m-turn-go').hidden = !canLock;
$('m-turn-go').addEventListener('click', async () => {
  try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); await screen.orientation.lock('landscape'); }
  catch { $('m-turn-go').hidden = true; } // it wouldn't: turning the phone is the only way left
});
// start: everything drawn, the first page shown
mUndoDraw(); drawAll(); mGo(0); requestAnimationFrame(mDepth);
