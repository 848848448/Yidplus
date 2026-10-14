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
