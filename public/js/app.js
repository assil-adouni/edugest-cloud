// Confirmation avant les actions sensibles (suppression, validation)
document.querySelectorAll('form[data-confirm]').forEach(function (f) {
  f.addEventListener('submit', function (e) { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); });
});
// Menu latéral sur mobile
var t = document.getElementById('menuToggle');
if (t) t.addEventListener('click', function () { document.getElementById('sidebar').classList.toggle('open'); });
