// Profile loading placeholder. Keep existing data fetches and privacy checks.
(function () {
  if (typeof _buildProfileScreen !== 'function') return;
  var build = _buildProfileScreen;
  _buildProfileScreen = function (userId) {
    var result = build(userId);
    var body = document.getElementById('profile-screen-body');
    if (body && body.querySelector('.spinner')) {
      body.innerHTML = '<div class="yp-skeleton" role="status" aria-label="Loading profile"><div class="yp-sk yp-sk-cover"></div><div class="yp-sk-row"><div class="yp-sk yp-sk-avatar"></div><div class="yp-sk-lines"><div class="yp-sk yp-sk-line"></div><div class="yp-sk yp-sk-line short"></div></div></div></div>';
    }
    return result;
  };
})();
// Resize only new still profile photos/banners and Music cover uploads locally.
// Animated/unsupported formats and originals on decode failure are untouched.
(function () {
  window.YP_prepareImage = async function (file, maxEdge) {
    if (!(file instanceof File) || !/^image\/(jpeg|png)$/.test(file.type) || file.size > 12 * 1024 * 1024) return file;
    var image;
    try {
      if (!window.createImageBitmap) return file;
      if (file.type === 'image/png') {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var view = new DataView(bytes.buffer);
        for (var pos = 8; pos + 12 <= bytes.length;) {
          var len = view.getUint32(pos);
          var type = String.fromCharCode.apply(null, bytes.subarray(pos + 4, pos + 8));
          if (type === 'acTL') return file;
          if (type === 'IEND') break;
          pos += len + 12;
        }
      }
      image = await createImageBitmap(file);
      if (!image.width || !image.height || image.width * image.height > 40000000) return file;
      var scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      if (scale === 1) return file;
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/webp', .88); });
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified });
    } catch (e) { return file; }
    finally { if (image && image.close) image.close(); }
  };
  if (window.api) {
    ['put', 'post'].forEach(function (method) {
      var original = api[method];
      api[method] = function (path, body, isForm) {
        var fields = method === 'put' && path === '/profile' ? { photo: 512, banner: 1600 } : method === 'post' && path === '/music' ? { cover: 800 } : null;
        if (!fields || !isForm || !(body instanceof FormData)) return original.apply(this, arguments);
        var self = this;
        return Promise.all(Object.keys(fields).map(async function (key) {
          var file = body.get(key);
          if (file instanceof File) body.set(key, await YP_prepareImage(file, fields[key]));
        })).then(function () { return original.call(self, path, body, isForm); });
      };
    });
  }
  // Only change decode scheduling, never image URL, cache, access, or visibility.
  function enhance(root) {
    if (root.nodeType !== 1) return;
    var imgs = root.matches('img') ? [root] : root.querySelectorAll('img');
    imgs.forEach(function (img) {
      if (!img.hasAttribute('decoding')) img.decoding = 'async';
      if (!img.hasAttribute('loading') && img.closest('.ig-post-media,.album-cover,.track-thumb,.mv-thumb,#profile-content-area')) img.loading = 'lazy';
    });
  }
  function init() {
    enhance(document.documentElement);
    new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(enhance); }); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
