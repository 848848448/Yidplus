// ============================================================
// js/theme.js  —  User-customizable color theme
// Lets each visitor pick their own accent / background colors.
// Persisted in localStorage (per-browser), applied via CSS vars.
// ============================================================

var THEME_KEY = 'yp_theme';

var THEME_PRESETS = [
  { name: 'Gold (Default)', gold: '#B8860B', goldL: '#DAA520', bg: '#FFFFFF', bg2: '#F5F5F5', text: '#000000' },
  { name: 'Royal Blue',     gold: '#1565C0', goldL: '#42A5F5', bg: '#FFFFFF', bg2: '#F0F4FA', text: '#000000' },
  { name: 'Emerald',        gold: '#2E7D32', goldL: '#66BB6A', bg: '#FFFFFF', bg2: '#F0F8F0', text: '#000000' },
  { name: 'Crimson',        gold: '#C62828', goldL: '#EF5350', bg: '#FFFFFF', bg2: '#FAF0F0', text: '#000000' },
  { name: 'Violet',         gold: '#6A1B9A', goldL: '#AB47BC', bg: '#FFFFFF', bg2: '#F6F0FA', text: '#000000' },
  { name: 'Midnight',       gold: '#C9A84C', goldL: '#F0D080', bg: '#0A0A0F', bg2: '#13131A', text: '#F0EDE6' },
];

// ── APPLY a theme object to the document ──────────────────
window.applyTheme = function (theme) {
  var root = document.documentElement.style;
  root.setProperty('--gold',   theme.gold);
  root.setProperty('--gold-l', theme.goldL);
  root.setProperty('--gold-d', theme.gold);
  root.setProperty('--bg',     theme.bg);
  root.setProperty('--bg2',    theme.bg2);
  root.setProperty('--text',   theme.text);

  // Derive a couple of dependent shades so things stay readable
  root.setProperty('--bg3', THEME_shade(theme.bg2, theme.text, 0.06));
  root.setProperty('--bg4', THEME_shade(theme.bg2, theme.text, 0.12));
};

// Mix two hex colors by ratio (0..1) — quick helper for derived shades
function THEME_shade(hex1, hex2, ratio) {
  var c1 = THEME_hexToRgb(hex1);
  var c2 = THEME_hexToRgb(hex2);
  if (!c1 || !c2) return hex1;
  var r = Math.round(c1.r + (c2.r - c1.r) * ratio);
  var g = Math.round(c1.g + (c2.g - c1.g) * ratio);
  var b = Math.round(c1.b + (c2.b - c1.b) * ratio);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}
function THEME_hexToRgb(hex) {
  if (!hex) return null;
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
  var num = parseInt(hex, 16);
  if (isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

// ── SAVE / LOAD ─────────────────────────────────────────
window.saveTheme = function (theme) {
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  applyTheme(theme);
};

window.loadTheme = function () {
  try {
    var raw = localStorage.getItem(THEME_KEY);
    if (raw) {
      var theme = JSON.parse(raw);
      applyTheme(theme);
      return theme;
    }
  } catch (e) { /* ignore bad data */ }
  return THEME_PRESETS[0];
};

window.resetTheme = function () {
  localStorage.removeItem(THEME_KEY);
  applyTheme(THEME_PRESETS[0]);
  if (typeof renderThemePicker === 'function') renderThemePicker();
  toast('🎨 Theme reset to default');
};

// ── BUILD THE PICKER UI (called from settings screen) ─────
window.renderThemePicker = function () {
  var host = document.getElementById('theme-picker-host');
  if (!host) return;

  var current = (function () {
    try { return JSON.parse(localStorage.getItem(THEME_KEY) || 'null'); }
    catch (e) { return null; }
  })();

  var swatches = THEME_PRESETS.map(function (t, i) {
    var isActive = current
      ? (current.gold === t.gold && current.bg === t.bg)
      : (i === 0);
    return '<div class="theme-swatch' + (isActive ? ' active' : '') +
      '" style="background:' + t.gold + '" title="' + escHtml(t.name) +
      '" onclick="THEME_pick(' + i + ')"></div>';
  }).join('');

  var customGold = (current && current.gold) || THEME_PRESETS[0].gold;
  var customBg   = (current && current.bg)   || THEME_PRESETS[0].bg;

  host.innerHTML =
    '<div class="theme-picker-card">' +
      '<div class="theme-picker-title">🎨 App Color Theme</div>' +
      '<div class="theme-swatch-row">' + swatches + '</div>' +
      '<div class="theme-custom-row">' +
        '<label>Accent color</label>' +
        '<input type="color" id="theme-custom-gold" value="' + customGold + '" oninput="THEME_custom()">' +
      '</div>' +
      '<div class="theme-custom-row">' +
        '<label>Background color</label>' +
        '<input type="color" id="theme-custom-bg" value="' + customBg + '" oninput="THEME_custom()">' +
      '</div>' +
      '<button class="theme-reset-btn" onclick="resetTheme()">Reset to Default</button>' +
    '</div>';
};

// ── PICK A PRESET ─────────────────────────────────────────
window.THEME_pick = function (i) {
  var preset = THEME_PRESETS[i];
  saveTheme(preset);
  renderThemePicker();
  toast('🎨 Theme set to ' + preset.name);
};

// ── CUSTOM COLOR PICKERS ────────────────────────────────────
window.THEME_custom = function () {
  var gold = document.getElementById('theme-custom-gold').value;
  var bg   = document.getElementById('theme-custom-bg').value;

  // Decide text/bg2 based on whether bg is light or dark
  var rgb = THEME_hexToRgb(bg) || { r: 255, g: 255, b: 255 };
  var luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  var isDark = luminance < 0.5;

  var theme = {
    name:  'Custom',
    gold:  gold,
    goldL: gold,
    bg:    bg,
    bg2:   isDark ? THEME_shade(bg, '#ffffff', 0.06) : THEME_shade(bg, '#000000', 0.04),
    text:  isDark ? '#F0EDE6' : '#000000',
  };

  saveTheme(theme);
};

// ── ROUTER HOOK: render picker whenever Settings screen opens ──
window.init_settings = function () {
  renderThemePicker();
};

// ── APPLY SAVED THEME ON PAGE LOAD ──────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  loadTheme();
});

console.log('[YID PLUS] theme.js loaded ✓ — user color picker ready');
