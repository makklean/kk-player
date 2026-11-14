const CACHE_NAME = 'kk-player-v15';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first для оболочки, network для остального
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Кэшируем только успешные same-origin ответы
        if (response.ok && new URL(e.request.url).origin === location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
  // ============ EXPORT / IMPORT LOGIC ============
  function showProgress(text, percent) {
    const overlay = document.getElementById("progressOverlay");
    if (!overlay) return;
    overlay.classList.add("visible");
    document.getElementById("progressText").innerText = text;
    document.getElementById("progressBarFill").style.width = percent + "%";
  }
  function hideProgress() {
    const overlay = document.getElementById("progressOverlay");
    if (overlay) overlay.classList.remove("visible");
  }

  async function exportBackup() {
    closeModal('settingsModal');
    if (typeof JSZip === 'undefined') return alert("Ошибка: библиотека JSZip не загружена.");
    
    showProgress("Сборка архива...", 0);
    
    try {
      const zip = new JSZip();
      const audioFolder = zip.folder("audio");
      
      const config = {
        version: 1,
        tracks: [],
        scenarios: scenarios.map(s => ({ 
          name: s.name, 
          duration: s.duration, 
          order: s.order,
          pads: (s.pads || []).map(p => ({
            title: p.title,
            icon: p.icon,
            color: p.color,
            trackFileName: tracks.find(t => t.id === p.trackId)?.fileName || null
          }))
        })),
        globalPads: pads.map(p => ({
          title: p.title,
          icon: p.icon,
          color: p.color,
          trackFileName: tracks.find(t => t.id === p.trackId)?.fileName || null
        }))
      };

      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const fileName = `track_${t.id}.mp3`; 
        
        const blob = new Blob([t.data], { type: t.mimeType || "audio/mpeg" });
        audioFolder.file(fileName, blob);
        
        config.tracks.push({
          fileName: fileName,
          name: t.name,
          purpose: t.purpose,
          tag: t.tag,
          loop: t.loop
        });

        if (i % 2 === 0) {
          showProgress(`Сборка треков... ${i}/${tracks.length}`, Math.round((i / tracks.length) * 100));
          await new Promise(r => setTimeout(r, 10));
        }
      }

      zip.file("config.json", JSON.stringify(config, null, 2));

      showProgress("Финализация...", 99);
      const content = await zip.generateAsync({ type: "blob" }, (metadata) => {
        showProgress(`Сжатие... ${Math.round(metadata.percent)}%`, Math.round(metadata.percent));
      });

      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kk_player_backup_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      
      hideProgress();
    } catch (err) {
      hideProgress();
      alert("Ошибка экспорта: " + err.message);
    }
  }

  function triggerImportBackup() {
    closeModal('settingsModal');
    document.getElementById("importFileInput").value = "";
    document.getElementById("importFileInput").click();
  }

  async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    showProgress("Чтение архива...", 0);

    try {
      const zip = await JSZip.loadAsync(file);
      const configFile = zip.file("config.json");
      if (!configFile) throw new Error("Не найден файл конфигурации.");
      
      const config = JSON.parse(await configFile.async("string"));
      
      const txClear = db.transaction(["tracks", "scenarios", "pads"], "readwrite");
      txClear.objectStore("tracks").clear();
      txClear.objectStore("scenarios").clear();
      txClear.objectStore("pads").clear();
      await new Promise((resolve, reject) => {
        txClear.oncomplete = resolve;
        txClear.onerror = reject;
      });

      const trackIdMap = {}; 
      const trackEntries = Object.values(zip.files).filter(f => f.name.startsWith("audio/") && !f.dir);
      
      for (let i = 0; i < trackEntries.length; i++) {
        const zipEntry = trackEntries[i];
        const fileName = zipEntry.name.replace("audio/", "");
        const arrayBuffer = await zipEntry.async("arraybuffer");
        
        const meta = config.tracks.find(t => t.fileName === fileName);
        
        const tx = db.transaction("tracks", "readwrite");
        const addReq = tx.objectStore("tracks").add({
          name: meta ? meta.name : fileName,
          purpose: meta ? meta.purpose : "",
          tag: meta ? meta.tag : "linear-gradient(135deg,#1565c0,#42a5f5)|🎵",
          loop: meta ? meta.loop : false,
          order: i,
          data: arrayBuffer,
          mimeType: "audio/mpeg"
        });
        
        await new Promise((resolve, reject) => {
          addReq.onsuccess = (e) => {
            trackIdMap[fileName] = e.target.result;
            resolve();
          };
          addReq.onerror = reject;
        });
        
        showProgress(`Загрузка треков... ${i+1}/${trackEntries.length}`, Math.round(((i+1) / trackEntries.length) * 80));
      }

      showProgress("Восстановление сценариев...", 85);
      for (const scConfig of config.scenarios) {
        const newPads = [];
        for (const pConfig of scConfig.pads) {
          if (pConfig.trackFileName && trackIdMap[pConfig.trackFileName]) {
            newPads.push({
              id: Date.now() + Math.random(),
              trackId: trackIdMap[pConfig.trackFileName],
              title: pConfig.title,
              icon: pConfig.icon,
              color: pConfig.color,
              order: newPads.length
            });
          }
        }
        
        const tx = db.transaction("scenarios", "readwrite");
        tx.objectStore("scenarios").add({
          name: scConfig.name,
          duration: scConfig.duration,
          order: scConfig.order,
          trackIds: [],
          pads: newPads
        });
        await new Promise(r => setTimeout(r, 10));
      }

      showProgress("Финальный штрих...", 95);
      const txPads = db.transaction("pads", "readwrite");
      for (const pConfig of config.globalPads) {
        if (pConfig.trackFileName && trackIdMap[pConfig.trackFileName]) {
          txPads.objectStore("pads").add({
            trackId: trackIdMap[pConfig.trackFileName],
            title: pConfig.title,
            icon: pConfig.icon,
            color: pConfig.color,
            order: 0
          });
        }
      }
      
      await new Promise((resolve, reject) => {
        txPads.oncomplete = resolve;
        txPads.onerror = reject;
      });
      
      hideProgress();
      alert("Импорт завершен! Все треки и сценарии загружены.");
      window.location.reload();

    } catch (err) {
      hideProgress();
      alert("Ошибка импорта: " + err.message);
    }
  }
