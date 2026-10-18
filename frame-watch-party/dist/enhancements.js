// Progressive playback improvements layered over the original app.
// Keeps the core room/sync implementation unchanged.
const form = document.getElementById('addForm');
const urlInput = document.getElementById('customUrl');
const titleInput = document.getElementById('customTitle');
const playlist = document.getElementById('playlist');

function titleFromUrl(value) {
  try {
    const u = new URL(value);
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'Shared video');
    return file.replace(/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i, '').replace(/[-_]+/g, ' ').trim() || 'Shared video';
  } catch { return 'Shared video'; }
}

function isDirectMediaUrl(value) {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && /\.(mp4|webm|ogg|m4v)(?:$|[?#])/i.test(u.href);
  } catch { return false; }
}

function notify(text) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.style.display = 'block';
  setTimeout(() => { if (t.textContent === text) t.style.display = 'none'; }, 5000);
}

// Make the title optional. A readable title is generated from the URL.
titleInput?.removeAttribute('required');
if (titleInput) titleInput.placeholder = 'Video title (optional)';
if (urlInput) urlInput.placeholder = 'Paste a direct .mp4 / .webm video URL';

// When a URL is pasted, fill the title automatically. The user can press Enter
// or the button; after it is queued, the host automatically loads it.
urlInput?.addEventListener('paste', () => setTimeout(() => {
  const value = urlInput.value.trim();
  if (!titleInput.value.trim()) titleInput.value = titleFromUrl(value);
  if (value && !isDirectMediaUrl(value)) {
    notify('That looks like a webpage, not a direct video file. Use a direct MP4/WebM URL.');
  }
}, 0));

form?.addEventListener('submit', () => {
  const value = urlInput.value.trim();
  if (!titleInput.value.trim()) titleInput.value = titleFromUrl(value);
  // app.js queues the item. Once the server broadcasts it back, click the
  // newest host-only Watch button so the pasted video loads immediately.
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    const watchButtons = playlist?.querySelectorAll('button[data-load]');
    const newest = watchButtons?.[watchButtons.length - 1];
    if (newest) {
      clearInterval(timer);
      newest.click();
      notify('Video queued and loaded. Press Play to start it for the room.');
    } else if (attempts >= 20) clearInterval(timer);
  }, 150);
}, true);

// The original Google sample bucket can occasionally fail in browsers/networks.
// Override Big Buck Bunny with the direct MP4 used in MDN's HTML video example.
const reliableSamples = {
  BigBuckBunny: {
    title: 'Big Buck Bunny',
    url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4'
  },
  ElephantsDream: {
    title: 'Elephants Dream',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4'
  }
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-film]');
  const sample = button && reliableSamples[button.dataset.film];
  if (!sample) return;
  // Stop app.js from adding its old Google URL, then use the existing queue form.
  event.preventDefault();
  event.stopImmediatePropagation();
  titleInput.value = sample.title;
  urlInput.value = sample.url;
  form.requestSubmit();
}, true);
