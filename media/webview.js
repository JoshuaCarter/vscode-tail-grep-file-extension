(function () {
  const vscode = acquireVsCodeApi();

  const filterInput = document.getElementById('filterInput');
  const regexToggle = document.getElementById('regexToggle');
  const caseToggle = document.getElementById('caseToggle');
  const lineLimitInput = document.getElementById('lineLimitInput');
  const clearBtn = document.getElementById('clearBtn');
  const statusText = document.getElementById('statusText');
  const jumpBtn = document.getElementById('jumpBtn');
  const scrollArea = document.getElementById('scrollArea');
  const content = document.getElementById('content');

  let rawLines = [];
  let following = true;
  const SCROLL_EPS = 24;

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Builds a global RegExp from the filter bar: plain text is treated as a literal
  // substring search (like grep -F), /pattern/flags is treated as a real regex, and
  // the ".*" toggle forces regex mode for the plain text as well.
  function buildMatcher() {
    const raw = filterInput.value;
    if (!raw) {
      return null;
    }

    let pattern = raw;
    let flags = caseToggle.checked ? '' : 'i';
    let useRegex = regexToggle.checked;

    const slashMatch = raw.match(/^\/(.*)\/([a-z]*)$/i);
    if (slashMatch) {
      useRegex = true;
      pattern = slashMatch[1];
      flags = slashMatch[2] || (caseToggle.checked ? '' : 'i');
    }

    try {
      const source = useRegex ? pattern : escapeRegExp(pattern);
      const finalFlags = flags.includes('g') ? flags : flags + 'g';
      return new RegExp(source, finalFlags);
    } catch (e) {
      return null;
    }
  }

  // Matches against the raw line first, then escapes each segment as it is emitted,
  // so HTML-escaping never shifts match offsets computed from the unescaped text.
  function highlightLine(line, matcher) {
    if (!matcher) {
      return { html: escapeHtml(line), matched: true };
    }
    matcher.lastIndex = 0;
    let html = '';
    let lastIndex = 0;
    let matched = false;
    let m;
    while ((m = matcher.exec(line)) !== null) {
      matched = true;
      html += escapeHtml(line.slice(lastIndex, m.index));
      html += '<mark>' + escapeHtml(m[0]) + '</mark>';
      lastIndex = m.index + m[0].length;
      if (m[0].length === 0) {
        matcher.lastIndex++;
        if (matcher.lastIndex > line.length) {
          break;
        }
      }
    }
    html += escapeHtml(line.slice(lastIndex));
    return { html, matched };
  }

  function render() {
    const matcher = buildMatcher();
    let matchCount = 0;
    const htmlParts = [];

    for (const line of rawLines) {
      const { html, matched } = highlightLine(line, matcher);
      if (matcher && !matched) {
        continue;
      }
      if (matcher) {
        matchCount++;
      }
      htmlParts.push('<span class="line">' + html + '</span>');
    }

    content.innerHTML = htmlParts.join('\n');

    const total = rawLines.length;
    statusText.textContent = matcher
      ? `${matchCount} / ${total} lines matching \u00b7 buffer limit ${lineLimitInput.value}`
      : `${total} lines \u00b7 buffer limit ${lineLimitInput.value}`;

    if (following) {
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    scrollArea.scrollTop = scrollArea.scrollHeight;
    jumpBtn.classList.add('hidden');
  }

  scrollArea.addEventListener('scroll', () => {
    const atBottom = scrollArea.scrollTop + scrollArea.clientHeight >= scrollArea.scrollHeight - SCROLL_EPS;
    following = atBottom;
    jumpBtn.classList.toggle('hidden', atBottom);
  });

  jumpBtn.addEventListener('click', () => {
    following = true;
    scrollToBottom();
  });

  filterInput.addEventListener('input', render);
  regexToggle.addEventListener('change', render);
  caseToggle.addEventListener('change', render);

  lineLimitInput.addEventListener('change', () => {
    vscode.postMessage({ type: 'setLineLimit', value: Number(lineLimitInput.value) });
  });

  clearBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        rawLines = msg.lines;
        lineLimitInput.value = msg.lineLimit;
        following = true;
        render();
        break;
      case 'update':
        rawLines = msg.lines;
        render();
        break;
      case 'error':
        statusText.textContent = 'Error: ' + msg.message;
        break;
      case 'info':
        statusText.textContent = msg.message;
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
