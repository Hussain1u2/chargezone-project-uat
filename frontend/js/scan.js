const Scan = {
  _active: null,

  openModal(onScanCallback, { title = 'Camera QR Scanner', continuous = true } = {}) {

    this.stop();
    const existing = document.getElementById('cameraScannerModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'cameraScannerModal';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '3000';
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:440px; text-align:center">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
          <h3 style="margin:0; font-size:16px">${title}</h3>
          <button id="closeCamModalTop" class="btn-ghost small" type="button" aria-label="Close scanner">&times;</button>
        </div>
        <p class="muted" style="margin-top:0; font-size:12.5px">Position the QR code inside the camera viewfinder box to scan.</p>

        <div id="camReaderBox" style="width:100%; max-width:360px; height:260px; margin:0 auto 14px auto; border-radius:var(--radius-lg); overflow:hidden; border:2px dashed var(--brand); background:#000; position:relative"></div>

        <div id="camScannedCount" class="muted" style="font-size:13px; font-weight:600; margin-bottom:12px; min-height:20px">Scanning active…</div>

        <div style="display:flex; justify-content:center; gap:8px">
          <button id="camDoneBtn" class="btn-primary" type="button">Done Scanning</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeCam = () => {
      this.stop();
      overlay.remove();
    };

    overlay.querySelector('#closeCamModalTop').addEventListener('click', closeCam);
    overlay.querySelector('#camDoneBtn').addEventListener('click', closeCam);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCam();
    });

    if (typeof Html5Qrcode === 'undefined') {
      const box = document.getElementById('camReaderBox');
      if (box) box.innerHTML = '<div style="color:#fff; padding:40px 16px; font-size:13px">Camera scanner library not available. Please enter the code manually.</div>';
      return;
    }

    try {
      const qr = new Html5Qrcode('camReaderBox');
      this._active = qr;
      let lastScannedText = '';
      let scanCount = 0;

      qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 160 } },
        (decodedText) => {
          if (decodedText === lastScannedText) return;
          lastScannedText = decodedText;
          scanCount += 1;

          const countEl = document.getElementById('camScannedCount');
          if (countEl) countEl.innerHTML = `<span style="color:var(--brand); font-weight:700">Scanned #${scanCount}: ${decodedText}</span>`;

          onScanCallback(decodedText);

          if (!continuous) {
            closeCam();
          } else {
            setTimeout(() => { lastScannedText = ''; }, 1500);
          }
        },
        () => {}
      ).catch((err) => {
        const box = document.getElementById('camReaderBox');
        if (box) box.innerHTML = `<div style="color:#ef4444; padding:40px 16px; font-size:13px">Camera access error: ${err.message || 'Permission denied or no camera found'}</div>`;
      });
    } catch (err) {
      console.error('Camera init error:', err);
    }
  },

  start(containerId, onResult) {
    this.openModal(onResult, { continuous: false });
  },

  stop() {
    if (this._active) {
      const qr = this._active;
      this._active = null;
      qr.stop().catch(() => {}).then(() => {
        try { qr.clear(); } catch (_) {}
      });
    }
  }
};
