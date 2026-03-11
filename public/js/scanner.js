(function() {
  const resultEl = document.getElementById('scan-result');
  const messageEl = resultEl && resultEl.querySelector('.result-message');
  const nameEl = resultEl && resultEl.querySelector('.result-name');
  const scanAgainBtn = document.getElementById('scan-again');
  let html5QrCode = null;
  let isProcessing = false;

  // -------------------------------------------------------
  // FIX: Calcule une taille qrbox adaptée à l'écran
  // Jamais inférieure à 50px (minimum imposé par html5-qrcode)
  // -------------------------------------------------------
  function getQrboxSize() {
    const readerEl = document.getElementById('reader');
    const containerWidth = readerEl
      ? readerEl.offsetWidth
      : Math.min(window.innerWidth, window.innerHeight);
    const size = Math.floor(containerWidth * 0.75);
    return Math.max(50, Math.min(size, 300));
  }

  function getScanConfig() {
    const size = getQrboxSize();
    return {
      fps: 10,
      qrbox: { width: size, height: size },
      rememberLastUsedCamera: true,
      aspectRatio: 1.0
    };
  }

  function showResult(ok, data) {
    if (!resultEl) return;
    const reader = document.getElementById('reader');
    if (reader) reader.classList.add('hidden');
    resultEl.classList.remove('hidden');
    
    const infoEl = resultEl.querySelector('.result-employee-info');
    if (!infoEl) return;
    
    if (ok && data && data.ok) {
      const emp = data.employee;
      const type = data.type === 'entrer' ? '✅ Entrée enregistrée' : '🚪 Sortie enregistrée';
      const photo = emp.photo ? `<img src="/uploads/${emp.photo}" alt="Photo" class="result-photo">` : '';
      infoEl.innerHTML = `
        <div class="result-success">
          ${photo}
          <div class="result-type">${type}</div>
          <div class="result-name">${emp.prenom} ${emp.nom}</div>
          <div class="result-details">
            <div>Badge: <strong>${emp.badge_id || emp.id_affichage || 'Non assigné'}</strong></div>
            ${emp.poste ? `<div>Poste: <strong>${emp.poste}</strong></div>` : ''}
          </div>
        </div>
      `;
    } else {
      infoEl.innerHTML = `
        <div class="result-error">
          <div class="result-message">❌ ${data.error || 'Badge non reconnu'}</div>
        </div>
      `;
      setTimeout(function() { showReader(); }, 3000);
    }
  }

  function showReader() {
    const reader = document.getElementById('reader');
    if (reader) reader.classList.remove('hidden');
    if (resultEl) resultEl.classList.add('hidden');
    isProcessing = false;

    if (!html5QrCode) return;

    if (html5QrCode.isScanning()) return;

    html5QrCode.start(
      { facingMode: 'environment' },
      getScanConfig(),
      onScanSuccess,
      onScanError
    ).catch(function(err) {
      showCameraError(err);
    });
  }

  function showCameraError(err) {
    if (messageEl) {
      messageEl.textContent = 'Impossible d\'accéder à la caméra: ' + (err && err.message ? err.message : err);
      messageEl.className = 'result-message err';
    }
    if (nameEl) nameEl.textContent = 'Vérifiez les permissions caméra et rechargez la page.';
    if (resultEl) resultEl.classList.remove('hidden');
    const reader = document.getElementById('reader');
    if (reader) reader.classList.add('hidden');
  }

  function onScanSuccess(decodedText) {
    // FIX: Empêcher les doubles scans
    if (isProcessing) return;
    if (!decodedText || !decodedText.trim()) return;

    isProcessing = true;
    if (html5QrCode && html5QrCode.isScanning()) {
      html5QrCode.pause();
    }

    fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badge_id: decodedText.trim() })
    })
      .then(function(r) {
        return r.json().then(function(data) { return { ok: r.ok, data: data }; });
      })
      .then(function(result) {
        if (result.ok && result.data.ok) {
          showResult(true, result.data);
        } else {
          showResult(false, result.data);
        }
      })
      .catch(function() {
        showResult(false, '❌ Erreur réseau — Vérifiez la connexion', '');
        setTimeout(function() { showReader(); }, 3000);
      });
  }

  // FIX: onScanError silencieux (appelé en continu, ne rien afficher)
  function onScanError() {}

  if (scanAgainBtn) {
    scanAgainBtn.addEventListener('click', function() {
      showReader();
    });
  }

  // FIX: Vérifier que Html5Qrcode est bien chargé avant d'utiliser
  if (typeof Html5Qrcode === 'undefined') {
    if (messageEl) {
      messageEl.textContent = 'Erreur: la librairie QR code n\'est pas chargée. Vérifiez votre connexion internet ou hébergez html5-qrcode.min.js en local.';
      messageEl.className = 'result-message err';
    }
    if (resultEl) resultEl.classList.remove('hidden');
    const reader = document.getElementById('reader');
    if (reader) reader.classList.add('hidden');
    return;
  }

  // FIX: Attendre que le DOM soit bien rendu avant de calculer la taille
  window.addEventListener('load', function() {
    html5QrCode = new Html5Qrcode('reader');
    html5QrCode.start(
      { facingMode: 'environment' },
      getScanConfig(),
      onScanSuccess,
      onScanError
    ).catch(function(err) {
      showCameraError(err);
    });
  });

})();