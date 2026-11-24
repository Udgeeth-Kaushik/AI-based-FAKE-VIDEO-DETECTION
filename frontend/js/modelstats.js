/* Fills [data-stat] elements with the real numbers saved by the trained model (GET /api/model-info). */
(function () {
  function set(sel, text) { document.querySelectorAll(sel).forEach(function (el) { el.textContent = text; }); }
  fetch("/api/model-info", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.accuracy == null) return;
      set('[data-stat="acc"]', d.accuracy + "%");
      set('[data-stat="auc"]', d.auc == null ? "—" : Number(d.auc).toFixed(3));
      var per = d.per_dataset || {};
      Object.keys(per).forEach(function (k) {
        var v = per[k];
        set('[data-ds-auc="' + k + '"]', v.auc == null ? "—" : Number(v.auc).toFixed(3));
        set('[data-ds-acc="' + k + '"]', v.accuracy + "%");
        set('[data-ds-n="' + k + '"]', String(v.videos));
      });
    })
    .catch(function () {});
})();
