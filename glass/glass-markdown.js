/*! glass-markdown.js - zero-dependency, XSS-safe markdown -> HTML for Glass cards.
 *  Browser:  el.innerHTML = GlassMarkdown.render(text);  GlassMarkdown.bindCopy(el);
 *  Node:     const GM = require('./glass-markdown.js');
 *  SAFETY: all input is HTML-escaped BEFORE any tag is produced. The only tags in the output are generated here.
 *  Link hrefs are limited to http(s)/mailto. A code-fence label is escaped and shown as text only.
 *  Supported: ### headings, **bold**, *italic* / _italic_, `inline code`, ~~del~~, ++ins++ (proposal diffs),
 *  fenced code blocks (+Copy button, light syntax tint), nested bullet / numbered lists, > callouts, --- rules,
 *  [text](https://link), paragraphs with soft line breaks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GlassMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return ESC[c]; }); }

  /* ---------- inline ---------- */
  function inline(src) {
    var stash = [];
    // 1) code spans first (their content is literal)
    var s = String(src).replace(/`([^`\n]+)`/g, function (_, c) {
      stash.push('<code class="gm-ic">' + esc(c) + '</code>');
      return '\u0000' + (stash.length - 1) + '\u0000';
    });
    // 2) escape everything else
    s = esc(s);
    // 3) links (text already escaped; only safe schemes)
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      var raw = u.replace(/&amp;/g, '&');
      if (!/^(https?:\/\/|mailto:)/i.test(raw)) return t;
      stash.push(u); // held aside so emphasis can't rewrite the address
      return '<a class="gm-a" href="\u0000' + (stash.length - 1) + '\u0000" target="_blank" rel="noopener noreferrer">' + t + '</a>';
    });
    // 4) emphasis
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
         .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
         .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
         .replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g, '$1<em>$2</em>')
         .replace(/~~([^~\n]+?)~~/g, '<s class="gm-strike">$1</s>')
         .replace(/\+\+([^+\n]+?)\+\+/g, '<ins>$1</ins>');
    // 5) restore code spans
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return stash[+i]; });
  }

  /* ---------- tiny syntax tint (works on RAW code, escapes each piece) ---------- */
  var KW = /^(?:const|let|var|function|return|if|else|for|while|await|async|new|import|from|export|class|try|catch|throw|true|false|null|undefined|def|in|of|this|typeof)$/;
  function highlight(code) {
    var re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    var out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      last = re.lastIndex;
      if (m[1]) out += '<span class="tk-c">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tk-s">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tk-n">' + esc(m[3]) + '</span>';
      else if (m[4]) out += KW.test(m[4]) ? '<span class="tk-k">' + esc(m[4]) + '</span>' : '<span class="tk-f">' + esc(m[4]) + '</span>';
      else out += KW.test(m[5]) ? '<span class="tk-k">' + esc(m[5]) + '</span>' : esc(m[5]);
    }
    return out + esc(code.slice(last));
  }

  /* ---------- blocks ---------- */
  var LI = /^(\s*)([-*\u2022]|\d+[.)])\s+(.*)$/;

  function renderList(lines, i) {
    var stack = [], out = '';
    while (i < lines.length) {
      var m = LI.exec(lines[i]);
      if (!m) break;
      var ind = m[1].replace(/\t/g, '    ').length, tag = /\d/.test(m[2]) ? 'ol' : 'ul';
      while (stack.length && ind < stack[stack.length - 1].ind) out += '</li></' + stack.pop().tag + '>';
      var top = stack[stack.length - 1];
      if (!top || ind > top.ind) { out += '<' + tag + ' class="gm-' + tag + '"><li>'; stack.push({ ind: ind, tag: tag }); }
      else out += '</li><li>';
      out += inline(m[3]);
      i++;
    }
    while (stack.length) out += '</li></' + stack.pop().tag + '>';
    return [out, i];
  }

  function render(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var out = '', i = 0;
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*$/.test(ln)) { i++; continue; }
      var f = /^\s*```\s*([A-Za-z0-9+#-]*)\s*$/.exec(ln);
      if (f) { // fenced code
        var buf = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        var code = buf.join('\n'), lang = f[1].toLowerCase();
        out += '<div class="gm-code"><div class="gm-codehead"><span class="gm-lang">' + esc(lang || 'code') +
               '</span><button type="button" class="gm-copy" data-gm-copy>Copy</button></div><pre><code>' + highlight(code) + '</code></pre></div>';
        continue;
      }
      var h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(ln);
      if (h) { var lv = h[1].length; out += '<h' + (lv + 2) + ' class="gm-h gm-h' + lv + '">' + inline(h[2]) + '</h' + (lv + 2) + '>'; i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { out += '<hr class="gm-hr">'; i++; continue; }
      if (/^\s*>/.test(ln)) { // callout
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out += '<div class="gm-callout">' + q.map(inline).join('<br>') + '</div>';
        continue;
      }
      if (LI.test(ln)) { var r = renderList(lines, i); out += r[0]; i = r[1]; continue; }
      var p = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) && !LI.test(lines[i])) p.push(lines[i++]);
      out += '<p class="gm-p">' + p.map(inline).join('<br>') + '</p>';
    }
    return out;
  }

  /* ---------- adaptive width: short notes stay compact, structured / long answers widen ---------- */
  function measure(text) {
    var t = String(text == null ? '' : text), lines = t.split('\n').filter(function (l) { return l.trim(); });
    var fence = /```/.test(t), list = lines.some(function (l) { return LI.test(l); }), head = /^#{1,4}\s/m.test(t);
    var len = t.length, structured = fence || list || head || /^\s*>/m.test(t);
    var tier = 'compact';
    if (fence || len > 420 || lines.length > 9 || (structured && len > 140)) tier = 'wide';
    else if (structured || len > 150 || lines.length > 3) tier = 'regular';
    return { tier: tier, width: { compact: 300, regular: 380, wide: 480 }[tier], chars: len, lines: lines.length, structured: structured };
  }

  /* ---------- Copy buttons (event delegation; call once per card root) ---------- */
  function copyText(s) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s);
    return new Promise(function (ok, no) {
      try {
        var ta = document.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;left:-999px;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok();
      } catch (e) { no(e); }
    });
  }
  function bindCopy(el) {
    if (!el || el._gmCopy) return; el._gmCopy = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-gm-copy]'); if (!b) return;
      e.stopPropagation();
      var code = b.closest('.gm-code').querySelector('code').textContent;
      var done = function (msg) { b.textContent = msg; b.classList.add('ok'); setTimeout(function () { b.textContent = 'Copy'; b.classList.remove('ok'); }, 1300); };
      var pr; try { pr = Promise.resolve(copyText(code)); } catch (err) { pr = Promise.reject(err); }
      pr.then(function () { done('Copied \u2713'); }, function () { done('Press Ctrl+C'); });
    });
  }

  return { render: render, inline: inline, measure: measure, highlight: highlight, escapeHtml: esc, bindCopy: bindCopy };
});
