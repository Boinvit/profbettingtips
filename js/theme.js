// Theme: 'system' (default, follows the device), 'light' or 'dark'. Applied before first paint; a small floating button cycles it.
(function () {
  var KEY = 'pbt.theme', root = document.documentElement;
  var get = function () { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } };
  var set = function (v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage unavailable */ } };
  var apply = function (m) {
    if (m === 'light' || m === 'dark') root.setAttribute('data-theme', m); else root.removeAttribute('data-theme');
    var light = m === 'light' || (m === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
    var meta = document.querySelector('meta[name=theme-color]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.content = light ? '#F6F7FB' : '#07090F';
  };
  var mode = get(); apply(mode);
  var LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' }, ORDER = ['system', 'light', 'dark'];
  function mount() {
    if (document.getElementById('theme-toggle')) return;
    var b = document.createElement('button'); b.id = 'theme-toggle'; b.type = 'button';
    var paint = function () { b.textContent = 'Theme: ' + LABEL[mode]; b.setAttribute('aria-label', 'Colour theme: ' + LABEL[mode] + '. Tap to change.'); };
    b.addEventListener('click', function () { mode = ORDER[(ORDER.indexOf(mode) + 1) % 3]; set(mode); apply(mode); paint(); });
    paint(); document.body.appendChild(b);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: light)');
    var onChange = function () { if (mode === 'system') apply('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
  }
})();
