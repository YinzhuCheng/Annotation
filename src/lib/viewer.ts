// Lightweight image viewer in a new window with ctrl+wheel zoom and panning
// Consumers can pass localized strings via opts.

export function openViewerWindow(
  src: string,
  opts?: {
    title?: string;
    back?: string;
    zoomHint?: string;
  }
) {
  const w = window.open('', '_blank');
  if (!w) return;

  const title = opts?.title || 'Image';
  const backText = opts?.back || 'Back';
  const zoomHint = opts?.zoomHint || 'Ctrl + Wheel to zoom • Drag to pan • Double-click to reset';

  // Read saved theme from same-origin localStorage
  let savedTheme: 'light' | 'dark' = 'dark';
  try {
    const t = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (t === 'light' || t === 'dark') savedTheme = t;
  } catch {}

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    [data-theme="dark"] { --bg:#0b0c10; --fg:#eaecee; --border:#2b2f36; --surface:#0f1218; --accent:#3b82f6; --button:#12151b; }
    [data-theme="light"] { --bg:#ffffff; --fg:#0b0c10; --border:#e5e7eb; --surface:#f8fafc; --accent:#3b82f6; --button:#ffffff; }
    html,body { height:100%; }
    body { margin:0; background:var(--bg); color:var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial; }
    header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border); background:var(--surface); position:sticky; top:0; z-index:10; }
    a.btn { display:inline-block; padding:6px 10px; text-decoration:none; border-radius:8px; }
    a.btn.ghost { background:var(--button); color:var(--fg); border:1px solid var(--border); }
    main { height: calc(100vh - 48px); }
    #viewport { position:relative; height:100%; overflow:hidden; display:flex; align-items:center; justify-content:center; background:var(--bg); }
    #img { max-width: min(96vw, 1600px); max-height: 90vh; object-fit: contain; border-radius: 8px; border:1px solid var(--border); will-change: transform; transform-origin: 0 0; user-select: none; cursor: grab; }
    #img.grabbing { cursor: grabbing; }
  </style></head><body>
  <header>
    <a class="btn ghost" href="#" id="backBtn">← ${backText}</a>
    <div style="font-size:12px;opacity:0.8">${zoomHint}</div>
  </header>
  <main>
    <div id="viewport">
      <img id="img" src="${src}" alt="image" />
    </div>
  </main>
  <script>
    try { document.documentElement.setAttribute('data-theme', ${JSON.stringify(savedTheme)}); } catch {}
    (function(){
      const img = document.getElementById('img');
      const vp = document.getElementById('viewport');
      let scale = 1;
      let tx = 0, ty = 0;
      const minScale = 0.5, maxScale = 12;

      function apply(){
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      }

      function clientPointToImageLocal(x, y){
        const rect = img.getBoundingClientRect();
        const px = x - rect.left;
        const py = y - rect.top;
        return { x: px, y: py };
      }

      vp.addEventListener('wheel', function(e){
        if (!e.ctrlKey) return; // only intercept ctrl+wheel
        e.preventDefault();
        const k = Math.exp(-e.deltaY * 0.002); // zoom factor
        const prev = scale;
        let next = prev * k;
        if (next < minScale) next = minScale;
        if (next > maxScale) next = maxScale;
        const pt = clientPointToImageLocal(e.clientX, e.clientY);
        // keep cursor point stable after zoom: t' = p - (p - t) * (s'/s)
        tx = pt.x - (pt.x - tx) * (next / prev);
        ty = pt.y - (pt.y - ty) * (next / prev);
        scale = next;
        apply();
      }, { passive: false });

      // Drag to pan
      let dragging = false; let sx = 0, sy = 0, stx = 0, sty = 0;
      function onDown(e){
        if (e.button !== 0) return;
        dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; img.classList.add('grabbing');
      }
      function onMove(e){ if (!dragging) return; tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); apply(); }
      function onUp(){ dragging = false; img.classList.remove('grabbing'); }
      vp.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      // Double click to reset
      vp.addEventListener('dblclick', function(){ scale = 1; tx = 0; ty = 0; apply(); });

      // Back button
      document.getElementById('backBtn').addEventListener('click', function(e){ e.preventDefault(); if (history.length > 1) { history.back(); } else { window.close(); } });

      // Prevent image native drag ghost
      img.addEventListener('dragstart', function(e){ e.preventDefault(); });

      apply();
    })();
  </script>
  </body></html>`);
  w.document.close();
}
