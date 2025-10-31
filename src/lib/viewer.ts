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
    /* Tuned palette for better layering */
    [data-theme="dark"] { --bg:#0b1220; --fg:#e5e7eb; --border:#223045; --surface:#0f172a; --accent:#6c8cff; --button:#111827; }
    [data-theme="light"] { --bg:#f6f9ff; --fg:#0b1220; --border:#d6e0f2; --surface:#ffffff; --accent:#3b82f6; --button:#ffffff; }
    html,body { height:100%; }
    body { margin:0; background:var(--bg); color:var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial; }
    header { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--border); background:var(--surface); position:sticky; top:0; z-index:10; }
    a.btn { display:inline-block; padding:6px 10px; text-decoration:none; border-radius:8px; }
    a.btn.ghost { background:var(--button); color:var(--fg); border:1px solid var(--border); }
    main { height: calc(100vh - 48px); }
    #viewport { position:relative; height:100%; overflow:hidden; background:var(--bg); }
    /* Keep the <img> at its natural pixel size; we handle fitting via transforms for crispness */
    #img { width:auto; height:auto; max-width:none; max-height:none; border-radius: 8px; border:1px solid var(--border); will-change: transform; transform-origin: 0 0; user-select: none; cursor: grab; }
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
      let baseScale = 1; // fit-to-screen scale relative to natural pixels
      let scale = 1;     // current absolute scale relative to natural pixels
      let tx = 0, ty = 0; // translation in CSS pixels (pre-scale space)
      let minScale = 0.1, maxScale = 16;

      function apply(){
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      }

      function computeFit(){
        const vw = vp.clientWidth, vh = vp.clientHeight;
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        if (!iw || !ih || !vw || !vh) return;
        baseScale = Math.min(vw / iw, vh / ih);
        // Keep current zoom centered around viewport center when recomputing
        const cx = vw / 2; const cy = vh / 2;
        const prev = scale || baseScale;
        scale = baseScale;
        tx = cx - (iw * scale) / 2;
        ty = cy - (ih * scale) / 2;
        minScale = Math.max(0.05, baseScale * 0.25);
        maxScale = Math.max(8, baseScale * 16);
        apply();
      }

      function clientToLocal(x, y){
        const rect = vp.getBoundingClientRect();
        const px = x - rect.left; // point inside viewport
        const py = y - rect.top;
        // Convert to image local space (pre-scale) using inverse transform
        const localX = (px - tx) / scale;
        const localY = (py - ty) / scale;
        return { x: localX, y: localY };
      }

      // Zoom with Ctrl+Wheel (also allow Meta for some platforms)
      vp.addEventListener('wheel', function(e){
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const k = Math.exp(-e.deltaY * 0.002);
        const prev = scale;
        let next = prev * k;
        if (next < minScale) next = minScale;
        if (next > maxScale) next = maxScale;
        const pt = clientToLocal(e.clientX, e.clientY); // in image local space
        // Maintain cursor position: new translation so that local pt maps back to same client point
        tx = e.clientX - vp.getBoundingClientRect().left - pt.x * next;
        ty = e.clientY - vp.getBoundingClientRect().top - pt.y * next;
        scale = next;
        apply();
      }, { passive: false });

      // Drag to pan
      let dragging = false; let sx = 0, sy = 0, stx = 0, sty = 0;
      function onDown(e){ if (e.button !== 0) return; dragging = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; img.classList.add('grabbing'); }
      function onMove(e){ if (!dragging) return; tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); apply(); }
      function onUp(){ dragging = false; img.classList.remove('grabbing'); }
      vp.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);

      // Double-click to reset fit-to-screen
      vp.addEventListener('dblclick', function(){ computeFit(); });

      // Back button
      document.getElementById('backBtn').addEventListener('click', function(e){ e.preventDefault(); if (history.length > 1) { history.back(); } else { window.close(); } });

      // Prevent image native drag ghost
      img.addEventListener('dragstart', function(e){ e.preventDefault(); });

      // Recompute fit after image load and on resize
      if (img.complete) computeFit(); else img.addEventListener('load', computeFit);
      window.addEventListener('resize', computeFit);
    })();
  </script>
  </body></html>`);
  w.document.close();
}
