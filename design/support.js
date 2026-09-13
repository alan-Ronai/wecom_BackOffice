/* LOCAL REVIEW SHIM ONLY — never pushed to the Claude Design project.
   The project already ships its own ./support.js runtime; this file only exists so the
   turn files can be opened from file:// and screenshotted with Playwright with the
   {{ }} bindings, <sc-for> and <sc-if> resolved the same way the canvas resolves them. */
(function () {
  var style = document.createElement('style');
  style.textContent = 'x-dc{display:block}helmet{display:none}script[type="text/x-dc"]{display:none}';
  document.documentElement.appendChild(style);

  function unwrapBinding(s) { return String(s == null ? '' : s).replace(/^\s*\{\{/, '').replace(/\}\}\s*$/, '').trim(); }

  var VALS = {};

  function resolve(expr, scope) {
    expr = String(expr == null ? '' : expr).trim();
    if (expr === '') return undefined;
    var neg = false;
    while (expr[0] === '!') { neg = !neg; expr = expr.slice(1).trim(); }
    var v;
    if (expr === 'true') v = true;
    else if (expr === 'false') v = false;
    else if (expr === 'null') v = null;
    else if (/^-?\d+(\.\d+)?$/.test(expr)) v = Number(expr);
    else if (/^(['"]).*\1$/.test(expr)) v = expr.slice(1, -1);
    else {
      var parts = expr.split('.');
      var root = (scope && Object.prototype.hasOwnProperty.call(scope, parts[0])) ? scope : VALS;
      v = root;
      for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    }
    return neg ? !v : v;
  }

  function interp(str, scope) {
    return String(str).replace(/\{\{([^}]*)\}\}/g, function (_, e) {
      var v = resolve(e, scope);
      return v == null || typeof v === 'function' ? '' : String(v);
    });
  }

  function process(node, scope) {
    Array.prototype.slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { if (n.nodeValue.indexOf('{{') >= 0) n.nodeValue = interp(n.nodeValue, scope); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase();
      if (tag === 'sc-for') {
        var list = resolve(unwrapBinding(n.getAttribute('list')), scope) || [];
        var as = n.getAttribute('as') || 'item';
        var frag = document.createDocumentFragment();
        list.forEach(function (item, idx) {
          var clone = n.cloneNode(true);
          var s = Object.assign({}, scope); s[as] = item; s[as + 'Index'] = idx;
          process(clone, s);
          while (clone.firstChild) frag.appendChild(clone.firstChild);
        });
        n.replaceWith(frag);
        return;
      }
      if (tag === 'sc-if') {
        if (resolve(unwrapBinding(n.getAttribute('value')), scope)) {
          var c = n.cloneNode(true); process(c, scope);
          var f = document.createDocumentFragment(); while (c.firstChild) f.appendChild(c.firstChild);
          n.replaceWith(f);
        } else n.remove();
        return;
      }
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (a.name === 'onClick' || a.name === 'onclick') {
          var fn = resolve(unwrapBinding(a.value), scope);
          n.removeAttribute(a.name);
          if (typeof fn === 'function') { n.addEventListener('click', fn); if (!n.style.cursor) n.style.cursor = 'pointer'; }
          return;
        }
        if (String(a.value).indexOf('{{') >= 0) n.setAttribute(a.name, interp(a.value, scope));
      });
      process(n, scope);
    });
  }

  function DCLogic() { this.state = {}; }
  DCLogic.prototype.setState = function (u) {
    this.state = Object.assign({}, this.state, typeof u === 'function' ? u(this.state) : u);
    render();
  };
  DCLogic.prototype.renderVals = function () { return {}; };
  window.DCLogic = DCLogic;

  var root = null, pristine = '', instance = null;

  function render() {
    if (!root) return;
    root.innerHTML = pristine;
    VALS = (instance && instance.renderVals && instance.renderVals()) || {};
    process(root, null);
  }

  function boot() {
    root = document.querySelector('x-dc');
    if (!root) return;
    pristine = root.innerHTML;
    var src = document.querySelector('script[type="text/x-dc"][data-dc-script]');
    if (src) {
      try {
        var Component = new Function('DCLogic', src.textContent + '\n;return Component;')(DCLogic);
        instance = new Component();
        if (!instance.state) instance.state = {};
      } catch (e) { console.error('[dc-shim] logic error', e); }
    }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
