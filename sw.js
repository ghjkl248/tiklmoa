// 오프라인 지원: 앱 화면 파일은 캐시, 시세·뉴스 등 외부 요청은 항상 네트워크
// 같은 출처 파일은 네트워크 우선이라 수정 사항이 바로 반영됨. 파일 목록을 바꾸면 VERSION을 올릴 것
const VERSION = 'tiklmoa-v1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/universe.js', 'js/engine.js', 'js/store.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // 외부 API는 관여하지 않음
  // 같은 출처: 네트워크 우선, 실패하면 캐시 (새 버전이 바로 보이도록)
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
