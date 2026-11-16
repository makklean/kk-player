
  // ============ STATE ============
  let db = null, tracks = [], scenarios = [];
  let activeSection = "all", openedScenarioId = null;
  let currentPadId = null, currentPadScenarioId = null, currentPlaybackMode = "music";
  let musicSearchQuery = "", scenarioSearchQuery = "";
  try { localStorage.removeItem("kk-player-folders"); localStorage.removeItem("kk-player-scenario-folders"); } catch(e) {}
  let currentAudio = null, currentBlobUrl = null, currentTrackId = null, currentQueueIds = [];
  const audioCache = new Map();
  let editingTrackId = null, editingScenarioId = null, editingPadId = null;
  let wakeLock = null, currentVolume = 1.0, playerHidden = false;
  let padEditMode = false, hasUnsavedChanges = false;
  let padTrackChangeMode = false;

  const PAD_COLORS = ["linear-gradient(135deg,#1565c0,#42a5f5)","linear-gradient(135deg,#2e7d32,#66bb6a)","linear-gradient(135deg,#ef6c00,#ffa726)","linear-gradient(135deg,#ad1457,#ec407a)","linear-gradient(135deg,#4527a0,#7e57c2)","linear-gradient(135deg,#b71c1c,#e53935)","linear-gradient(135deg,#00695c,#26a69a)","linear-gradient(135deg,#37474f,#607d8b)"];
  let selectedPadColor = PAD_COLORS[0];
  const PAD_ICONS = [];

  // ============ DB ============
  const dbReq = indexedDB.open("KKPlayerDB_v9", 1); 
  dbReq.onupgradeneeded = (e) => {
    const database = e.target.result;
    if (!database.objectStoreNames.contains("tracks")) database.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
    if (!database.objectStoreNames.contains("scenarios")) database.createObjectStore("scenarios", { keyPath: "id", autoIncrement: true });
  };
  dbReq.onsuccess = (e) => { db = e.target.result; loadAllData(); };
  dbReq.onerror = () => { hideAppSplash(); alert("Не удалось открыть базу данных."); };
  function hideAppSplash(){const splash=document.getElementById("appSplash");if(splash)splash.classList.add("is-hidden");}
  setTimeout(hideAppSplash,6500);

  function loadAllData(callback) {
    const tx = db.transaction(["tracks", "scenarios"], "readwrite");
    let loadedTracks = [], loadedScenarios = [];
    const trackStore=tx.objectStore("tracks"),scenarioStore=tx.objectStore("scenarios");
    trackStore.getAll().onsuccess = (e) => {
      loadedTracks=(e.target.result||[]);
      loadedTracks=loadedTracks.map(item=>{if(Object.prototype.hasOwnProperty.call(item,"folder")){const clean={...item};delete clean.folder;trackStore.put(clean);return clean}return item});
      loadedTracks.sort((a,b)=>(a.order??a.id)-(b.order??b.id));
    };
    scenarioStore.getAll().onsuccess = (e) => {
      loadedScenarios=(e.target.result||[]);
      loadedScenarios=loadedScenarios.map(item=>{if(Object.prototype.hasOwnProperty.call(item,"folder")){const clean={...item};delete clean.folder;scenarioStore.put(clean);return clean}return item});
      loadedScenarios.sort((a,b)=>(a.order??a.id)-(b.order??b.id));
    };
    tx.oncomplete = () => { tracks = loadedTracks; scenarios = loadedScenarios; renderCurrentView(); hideAppSplash(); if (callback) callback(); };
  }

  function formatTime(s) { if (!s || isNaN(s)) return "0:00"; const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return m + ":" + (sec < 10 ? "0" : "") + sec; }

  // ============ PROGRESS ============
  function showProgress(text, percent) { const overlay = document.getElementById("progressOverlay"); if (!overlay) return; overlay.classList.add("visible"); document.getElementById("progressText").innerText = text; document.getElementById("progressBarFill").style.width = percent + "%"; }
  function hideProgress() { const overlay = document.getElementById("progressOverlay"); if (overlay) overlay.classList.remove("visible"); }

  // ============ EXPORT / IMPORT ============
  async function exportBackup() {
    closeModal('settingsModal');
    if (typeof JSZip === 'undefined') return alert("Ошибка: JSZip не загружен.");
    showProgress("Сборка архива...", 0);
    try {
      const zip = new JSZip();
      const audioFolder = zip.folder("audio");
      const config = { version: 9, tracks: [], scenarios: [] };
      
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const fileName = `track_${t.id}.mp3`; 
        const blob = new Blob([t.data], { type: t.mimeType || "audio/mpeg" });
        audioFolder.file(fileName, blob);
        config.tracks.push({ id: t.id, fileName, name: t.name, tag: t.tag, order: t.order, mimeType: t.mimeType || "audio/mpeg" });
        if (i % 2 === 0) { showProgress(`Сборка... ${i}/${tracks.length}`, Math.round((i / tracks.length) * 100)); await new Promise(r => setTimeout(r, 10)); }
      }

      config.scenarios = scenarios.map(s => ({
        name: s.name, description: s.description || "", order: s.order,
        pads: (s.pads || []).map(p => ({
          title: p.title, icon: p.icon, color: p.color, order: p.order,
          trackFileName: tracks.find(t => t.id === p.trackId) ? `track_${p.trackId}.mp3` : null
        }))
      }));

      zip.file("config.json", JSON.stringify(config, null, 2));
      showProgress("Финализация...", 99);
      const content = await zip.generateAsync({ type: "blob" }, (metadata) => { showProgress(`Сжатие... ${Math.round(metadata.percent)}%`, Math.round(metadata.percent)); });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a"); a.href = url; a.download = `kk_player_backup_${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      hideProgress();
    } catch (err) { hideProgress(); alert("Ошибка экспорта: " + err.message); }
  }

  function triggerImportBackup() { closeModal('settingsModal'); document.getElementById("importFileInput").value = ""; document.getElementById("importFileInput").click(); }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!confirm("Импорт заменит текущую музыку и сценарии данными из архива. Перед продолжением убедитесь, что у вас есть резервная копия. Продолжить?")) {
      event.target.value = "";
      return;
    }
    showProgress("Проверка архива...", 0);
    try {
      if (typeof JSZip === "undefined") throw new Error("Библиотека ZIP не загружена.");
      if (!db) throw new Error("База данных ещё не готова.");
      const zip = await JSZip.loadAsync(file);
      const configFile = zip.file("config.json");
      if (!configFile) throw new Error("В архиве нет config.json.");
      const config = JSON.parse(await configFile.async("string"));
      if (!config || !Array.isArray(config.tracks) || !Array.isArray(config.scenarios)) {
        throw new Error("Неверный формат резервной копии.");
      }

      // Сначала полностью читаем и проверяем архив в памяти. База не меняется,
      // пока каждый аудиофайл и конфигурация не готовы к записи.
      const trackEntries = [];
      for (let i = 0; i < config.tracks.length; i++) {
        const meta = config.tracks[i];
        if (!meta || typeof meta.fileName !== "string" || !meta.fileName) {
          throw new Error("В конфигурации найден трек без имени файла.");
        }
        const entry = zip.file("audio/" + meta.fileName);
        if (!entry) throw new Error("Не найден аудиофайл: " + meta.fileName);
        const data = await entry.async("arraybuffer");
        if (!data || !data.byteLength) throw new Error("Пустой аудиофайл: " + meta.fileName);
        trackEntries.push({
          fileName: meta.fileName,
          record: {
            name: String(meta.name || meta.fileName),
            tag: meta.tag || "linear-gradient(135deg,#1565c0,#42a5f5)|🎵",
            order: Number.isFinite(meta.order) ? meta.order : i,
            data,
            mimeType: meta.mimeType || "audio/mpeg"
          }
        });
        showProgress("Проверка аудио... " + (i + 1) + "/" + config.tracks.length,
          Math.round(((i + 1) / Math.max(config.tracks.length, 1)) * 65));
      }

      const trackIdMap = new Map();
      const tx = db.transaction(["tracks", "scenarios"], "readwrite");
      const trackStore = tx.objectStore("tracks");
      const scenarioStore = tx.objectStore("scenarios");
      trackStore.clear();
      scenarioStore.clear();

      const addScenarios = () => {
        config.scenarios.forEach((scConfig, scenarioIndex) => {
          const pads = (Array.isArray(scConfig.pads) ? scConfig.pads : []).map((p, padIndex) => ({
            id: p.id || (Date.now() + scenarioIndex * 1000 + padIndex),
            trackId: p.trackFileName ? (trackIdMap.get(p.trackFileName) || null) : null,
            title: p.title || "",
            icon: p.icon || "🎵",
            color: p.color || "linear-gradient(135deg,#1565c0,#42a5f5)",
            order: Number.isFinite(p.order) ? p.order : padIndex
          })).sort((a, b) => a.order - b.order);
          scenarioStore.add({
            name: String(scConfig.name || "Новый сценарий"),
            description: String(scConfig.description || ""),
            order: Number.isFinite(scConfig.order) ? scConfig.order : scenarioIndex,
            pads
          });
        });
      };

      // Track IDs are assigned by IndexedDB asynchronously. Add scenarios only
      // after every track request has returned its new ID, in this same transaction.
      let addedTracks = 0;
      if (!trackEntries.length) addScenarios();
      trackEntries.forEach((item) => {
        const request = trackStore.add(item.record);
        request.onsuccess = () => {
          trackIdMap.set(item.fileName, request.result);
          addedTracks += 1;
          if (addedTracks === trackEntries.length) addScenarios();
        };
      });

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Не удалось записать данные."));
        tx.onabort = () => reject(tx.error || new Error("Импорт отменён: транзакция прервана."));
      });
      hideProgress();
      alert("Импорт завершён. Загружено треков: " + trackEntries.length + ", сценариев: " + config.scenarios.length + ".");
      window.location.reload();
    } catch (err) {
      hideProgress();
      alert("Импорт не выполнен: " + (err && err.message ? err.message : err));
    } finally {
      event.target.value = "";
    }
  }

  // ============ SETTINGS ============
  function forceAppUpdate() {
    closeModal('settingsModal');
    if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(registrations => { for (let registration of registrations) registration.update(); setTimeout(() => window.location.reload(true), 1000); }); }
    else window.location.reload(true);
  }

  // ============ ANDROID BACK NAVIGATION ============
  // Use an in-app confirmation: native dialogs can be suppressed in installed PWAs.
  function showExitConfirmation() {
    const modal = document.getElementById("exitConfirmModal");
    if (modal) modal.style.display = "flex";
  }
  function cancelExitConfirmation() {
    const modal = document.getElementById("exitConfirmModal");
    if (modal) modal.style.display = "none";
    history.pushState({ kkPlayerBackGuard: true }, "", location.href);
  }
  function confirmExitApplication() {
    const modal = document.getElementById("exitConfirmModal");
    if (modal) modal.style.display = "none";
    // Try closing the standalone window, then fall back to browser history navigation.
    window.close();
    history.back();
  }
  function installBackNavigation() {
    if (!history.state || !history.state.kkPlayerBackGuard) {
      history.pushState({ kkPlayerBackGuard: true }, "", location.href);
    }
    window.addEventListener("popstate", () => {
      const exitModal = document.getElementById("exitConfirmModal");
      if (exitModal && getComputedStyle(exitModal).display !== "none") {
        exitModal.style.display = "none";
        history.pushState({ kkPlayerBackGuard: true }, "", location.href);
        return;
      }
      const visibleModals = [...document.querySelectorAll(".modal-overlay")]
        .filter(el => el.id !== "exitConfirmModal" && getComputedStyle(el).display !== "none");
      if (visibleModals.length) {
        visibleModals[visibleModals.length - 1].style.display = "none";
        history.pushState({ kkPlayerBackGuard: true }, "", location.href);
        return;
      }
      if (activeSection === "scenarios" && openedScenarioId !== null) {
        closeOpenedScenario();
        history.pushState({ kkPlayerBackGuard: true }, "", location.href);
        return;
      }
      showExitConfirmation();
      // Keep the guard popped while the confirmation is visible.
    });
  }
  installBackNavigation();

  // ============ WAKE LOCK ============
  async function requestWakeLock() { if (!('wakeLock' in navigator)) return; try { if (wakeLock) return; wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) {} }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release(); wakeLock = null; } }
  document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && currentAudio && !currentAudio.paused) await requestWakeLock(); });

  // ============ LOCK MODE ============
   // ============ NAV ============
  function switchSection(section) {
     activeSection = section; if (section === "all") { openedScenarioId = null; undefined } else  hasUnsavedChanges = false;
    syncPlayerVisibility();
    document.getElementById("tabAllMusic").classList.toggle("active", section === "all");
    
    document.getElementById("tabScenarios").classList.toggle("active", section === "scenarios");
    renderCurrentView();
  }
  function openScenario(id) { openedScenarioId = id; hasUnsavedChanges = false; renderCurrentView(); }
  function closeOpenedScenario() { openedScenarioId = null; hasUnsavedChanges = false; renderCurrentView(); }
  function togglePadEditMode() { padEditMode = !padEditMode; renderCurrentView(); }

  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch])); }
  function filterMusicList(value) {
    musicSearchQuery = String(value || "").toLocaleLowerCase("ru").trim();
    document.querySelectorAll("#itemsList [data-search]").forEach(el => { el.style.display = el.dataset.search.includes(musicSearchQuery) ? "" : "none"; });
  }

  function appIcon(type){const p={note:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',pads:'<rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/><rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/><rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/><rect x="14" y="14" width="7" height="7" rx="1.5" fill="none" stroke="currentColor"/>',folder:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'};return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[type]||p.pads)+'</svg>'}
function renderScenarioLibrary(host){
 host.innerHTML='<div class="scenario-toolbar"><button class="primary-action-btn" onclick="openScenarioModal(null)">＋ Создать сценарий</button></div>'+'<input class="music-search scenario-search" type="search" placeholder="Поиск по названию и описанию сценария…" value="'+escapeHtml(scenarioSearchQuery)+'" oninput="filterScenarioList(this.value)">'+'<div class="scenario-library-scroll"><div class="items-list" id="itemsList"></div></div>';
 const list=host.querySelector("#itemsList");scenarios.slice().sort((a,b)=>(a.order??a.id)-(b.order??b.id)).forEach(sc=>{const e=document.createElement("div");e.className="list-row scenario-card";e.dataset.itemId=String(sc.id);e.dataset.search=(sc.name+" "+(sc.description||"")).toLocaleLowerCase("ru");e.innerHTML='<div class="row-cover">'+appIcon("pads")+'</div><div class="row-info"><div class="row-title"></div><div class="scenario-description"></div><div class="row-subtitle"></div></div><div class="scenario-actions"><button class="row-btn delete-btn" title="Удалить">✕</button><button class="row-btn" title="Дублировать">⧉</button><button class="row-btn" title="Редактировать">✎</button></div>';e.querySelector(".row-title").textContent=sc.name;e.querySelector(".scenario-description").textContent=sc.description||"";e.querySelector(".row-subtitle").textContent="Пэдов: "+(sc.pads||[]).length;e.onclick=ev=>{if(ev.target.closest(".scenario-actions")||ev.target.closest(".list-drag-dot"))return;if(e.dataset.suppressClick==="1"){delete e.dataset.suppressClick;return}openScenario(sc.id)};const bs=e.querySelectorAll(".scenario-actions button");bs[0].onclick=ev=>deleteScenarioAction(ev,sc.id);bs[1].onclick=ev=>{ev.stopPropagation();duplicateScenario(sc.id)};bs[2].onclick=ev=>editScenarioAction(ev,sc.id);attachLongPressDrag(e,"scenario",sc.id);list.appendChild(e)});if(!scenarios.length){const empty=document.createElement("div");empty.className="empty-state";empty.textContent="Сценариев пока нет. Создайте первый сценарий.";list.appendChild(empty)}filterScenarioList(scenarioSearchQuery);
}

function filterScenarioList(value){
 scenarioSearchQuery=String(value||"").toLocaleLowerCase("ru").trim();
 document.querySelectorAll("#itemsList [data-search]").forEach(el=>el.style.display=el.dataset.search.includes(scenarioSearchQuery)?"":"none");
}
function duplicateScenario(id){const s=scenarios.find(x=>x.id===id);if(!s)return;const tx=db.transaction("scenarios","readwrite"),st=tx.objectStore("scenarios");scenarios.filter(x=>(x.order??0)>(s.order??0)).forEach(x=>st.put({...x,order:x.order+1}));const c={...s,name:s.name+" (копия)",order:(s.order??0)+1,pads:(s.pads||[]).map((p,i)=>({...p,id:Date.now()+i}))};delete c.id;st.add(c);tx.oncomplete=loadAllData}
function attachLongPressDrag(row,type,id){let timer=null,x=0,y=0,pid=null;const add=()=>{row.classList.add("drag-ready");row.dataset.suppressClick="1";if(row.querySelector(".list-drag-dot"))return;const dot=document.createElement("button");dot.type="button";dot.className="list-drag-dot";dot.setAttribute("aria-label","Перетащить");dot.addEventListener("pointerdown",ev=>{ev.preventDefault();ev.stopPropagation();row.dataset.suppressClick="1";try{dot.setPointerCapture(ev.pointerId)}catch(_){}startListDrag(row,type,id)});row.appendChild(dot)};row.addEventListener("pointerdown",e=>{if(e.target.closest("button")||e.target.closest(".row-actions"))return;x=e.clientX;y=e.clientY;pid=e.pointerId;timer=setTimeout(()=>{timer=null;add();try{row.setPointerCapture(pid)}catch(_){}startListDrag(row,type,id)},480)});row.addEventListener("pointermove",e=>{if(timer&&Math.hypot(e.clientX-x,e.clientY-y)>9){clearTimeout(timer);timer=null}});const end=()=>{if(timer){clearTimeout(timer);timer=null}};row.addEventListener("pointerup",end);row.addEventListener("pointercancel",end)}
function startListDrag(row,type,id){row.classList.add("list-dragging");const selector=type==="track"?"[data-track-id]":".scenario-card[data-item-id]",clear=()=>document.querySelectorAll(".list-drop-target").forEach(x=>x.classList.remove("list-drop-target")),move=e=>{e.preventDefault();const t=document.elementFromPoint(e.clientX,e.clientY)?.closest(selector);clear();if(t&&t!==row)t.classList.add("list-drop-target")},end=e=>{document.removeEventListener("pointermove",move);document.removeEventListener("pointerup",end);document.removeEventListener("pointercancel",end);row.classList.remove("list-dragging");clear();const t=document.elementFromPoint(e.clientX,e.clientY)?.closest(selector);if(!t||t===row)return;const tid=Number(type==="track"?t.dataset.trackId:t.dataset.itemId);if(tid!==id)reorderVisibleItems(type,id,tid,e.clientY,t.getBoundingClientRect())};document.addEventListener("pointermove",move,{passive:false});document.addEventListener("pointerup",end);document.addEventListener("pointercancel",end)}
function reorderVisibleItems(type,movingId,targetId,dropY,rect){const track=type==="track",all=(track?tracks:scenarios).slice().sort((a,b)=>(a.order??a.id)-(b.order??b.id)),q=(track?musicSearchQuery:scenarioSearchQuery).toLocaleLowerCase("ru").trim(),visible=all.filter(x=>!q||(track?x.name:(x.name+" "+(x.description||""))).toLocaleLowerCase("ru").includes(q)),moving=visible.find(x=>x.id===movingId);if(!moving||!visible.some(x=>x.id===targetId))return;const rest=visible.filter(x=>x.id!==movingId);let at=rest.findIndex(x=>x.id===targetId);if(rect&&dropY>rect.top+rect.height/2)at++;rest.splice(at,0,moving);const ids=new Set(visible.map(x=>x.id));let n=0;const ordered=all.map(x=>ids.has(x.id)?rest[n++]:x),tx=db.transaction(track?"tracks":"scenarios","readwrite"),store=tx.objectStore(track?"tracks":"scenarios");ordered.forEach((x,i)=>{const item={...x,order:i};delete item.folder;store.put(item)});tx.oncomplete=loadAllData}

// ============ RENDER ============
  function renderCurrentView() {
    const container = document.getElementById("mainContainer");
     if (activeSection === "all") {
      container.innerHTML = '<div class="music-toolbar"><button class="primary-action-btn" onclick="openTrackModal(null)">＋ Добавить треки</button></div><input class="music-search" type="search" placeholder="Поиск по названию трека…" value="' + escapeHtml(musicSearchQuery) + '" oninput="filterMusicList(this.value)"><div class="music-list-scroll"><div class="items-list" id="itemsList"></div></div>';
       const listEl = document.getElementById("itemsList");
      if (!tracks.length) { listEl.innerHTML = '<div class="empty-state">Библиотека пуста. Добавьте аудиофайлы.</div>'; return; }
      tracks.slice().sort((a,b)=>(a.order??a.id)-(b.order??b.id)).forEach(track => {
        const row = document.createElement("div"); row.className = "list-row"; row.dataset.trackId = String(track.id);
        row.innerHTML = '<div class="row-cover music-row-icon">' + appIcon("note") + '</div><div class="row-info"><div class="row-title"></div></div><div class="row-actions"><button class="row-btn" onclick="editTrackAction(event,' + track.id + ')">✎</button><button class="row-btn delete-btn" onclick="deleteTrackAction(event,' + track.id + ')">✕</button></div>';
         row.querySelector(".row-title").textContent = track.name;
        row.classList.toggle("track-playing", currentTrackId === track.id && !!currentAudio && !currentAudio.paused);
         row.classList.toggle("track-paused", currentTrackId === track.id && !!currentAudio && currentAudio.paused);
         row.dataset.search = track.name.toLocaleLowerCase("ru");row.onclick=e=>{if(e.target.closest(".row-actions")||e.target.closest(".list-drag-dot"))return;if(row.dataset.suppressClick==="1"){delete row.dataset.suppressClick;return}if(padTrackChangeMode){selectTrackForPad(track.id);return}toggleTrackFromList(track.id)};attachLongPressDrag(row,"track",track.id);
         listEl.appendChild(row);
      });
      filterMusicList(musicSearchQuery);
      return;
    }
    if (activeSection === "scenarios" && openedScenarioId === null) { renderScenarioLibrary(container); return; }
    if (activeSection === "scenarios" && openedScenarioId !== null) {
      const scenario = scenarios.find(s => s.id === openedScenarioId);
      if (!scenario) { openedScenarioId = null; renderCurrentView(); return; }
      container.innerHTML = '<div class="playlist-sub-header"><button class="back-btn" onclick="closeOpenedScenario()">← Назад</button><div class="sub-header-heading"><div class="sub-header-title"></div><div class="scenario-description"></div></div></div><div class="pad-mode-toolbar">' + '<button class="edit-mode-btn ' + (padEditMode ? "active" : "") + '" aria-label="Редактировать пэды" title="Редактировать пэды" style="display:flex;width:40px;height:40px;border-radius:12px;padding:0;font-size:21px;margin:0" onclick="togglePadEditMode()">✎</button>' + (hasUnsavedChanges ? '<button class="save-scenario-btn visible" onclick="saveScenarioState()">💾 Сохранить порядок</button>' : '') + '</div><div class="pads-scroll" id="padsScroll"><div class="pads-grid ' + (padEditMode ? "edit-mode" : "") + '" id="padsGrid"></div></div>';
      container.querySelector(".sub-header-title").textContent = scenario.name;
      container.querySelector(".sub-header-heading .scenario-description").textContent = scenario.description || "";
      const grid = document.getElementById("padsGrid");
      const visiblePads = (scenario.pads || []).map((pad, idx) => ({ pad, idx }));
      visiblePads.forEach(({ pad, idx }) => {
        const track = tracks.find(t => t.id === pad.trackId);
        const current = currentPlaybackMode === "pad" && currentPadId === pad.id && !!currentAudio;
        const playing = current && !currentAudio.paused;
        const tile = document.createElement("div");
        tile.className = "pad drum-pad" + (playing ? " playing" : "") + (current && !playing ? " paused" : "") + (track ? "" : " empty");
        tile.dataset.index = idx;
        if (!track) {
          tile.innerHTML = '<div class="pad-handle">⠿</div><div class="pad-add">+</div>';
          if (!padEditMode) tile.onclick = () => { editingPadId = pad.id; openAddSourceModal(); };
        } else {
          const bg = pad.color ? pad.color.split("|")[0] : (track.tag || "#333").split("|")[0];
          tile.style.background = bg;
          tile.innerHTML = '<div class="pad-handle">⠿</div><div class="pad-title"></div><div class="pad-trackname"></div><button class="pad-edit-text" aria-label="Редактировать пэд" onclick="event.stopPropagation();editingPadId=' + pad.id + ';openPadEditor()">✎</button>';
          tile.onclick = e => { if (!padEditMode && !e.target.closest(".pad-edit-text") && !e.target.closest(".pad-handle")) togglePadPlayback(pad.id, scenario.id); };
          tile.querySelector(".pad-title").textContent = pad.title || track.name;
          tile.querySelector(".pad-trackname").textContent = track.name;
          if (padEditMode) tile.classList.add("move-ready");
        }
        grid.appendChild(tile);
      });
      const add = document.createElement("div"); add.className = "pad empty add-pad-tile"; add.innerHTML = '<div class="pad-add">+</div><div class="pad-trackname">Добавить пэд</div>';
      if (!padEditMode) add.onclick = () => { editingPadId = null; openAddSourceModal(); };
      grid.appendChild(add);
      if (padEditMode) grid.querySelectorAll(".pad[data-index]").forEach(attachPadDragEvents);
       preloadScenarioAudio(scenario);
    }
  }

  // ============ DRAG ============
  function attachPadDragEvents(padEl) {
    const handle = padEl.querySelector(".pad-handle"); if (!handle) return;
    const fromIndex = Number(padEl.dataset.index); let active = false;
    const clearTargets = () => document.querySelectorAll(".pad").forEach(el => el.classList.remove("drag-over"));
    handle.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); active = true; handle.setPointerCapture(e.pointerId); padEl.classList.add("dragging"); });
    handle.addEventListener("pointermove", e => {
      if (!active) return;
      const target = document.elementFromPoint(e.clientX,e.clientY)?.closest(".pad[data-index]");
      clearTargets(); if (target && Number(target.dataset.index) !== fromIndex) target.classList.add("drag-over");
    });
    const finish = e => {
      if (!active) return; active = false; padEl.classList.remove("dragging");
      const target = document.elementFromPoint(e.clientX,e.clientY)?.closest(".pad[data-index]"); clearTargets();
      if (!target) return;
      const toIndex = Number(target.dataset.index), sc = scenarios.find(s => s.id === openedScenarioId);
      if (sc && toIndex !== fromIndex) {
        const moved = sc.pads.splice(fromIndex,1)[0]; sc.pads.splice(toIndex,0,moved);
        sc.pads.forEach((p,i) => p.order = i); hasUnsavedChanges = true; renderCurrentView();
      }
    };
    handle.addEventListener("pointerup",finish); handle.addEventListener("pointercancel",finish);
  }

  // ============ CRUD ============
  function closeModal(id) { document.getElementById(id).style.display = "none"; }
  function openSettings() { document.getElementById("settingsModal").style.display = "flex"; }
  
  function openTrackModal(trackId = null) {
    editingTrackId = trackId;
    const t = trackId ? tracks.find(x => x.id === trackId) : null;
    document.getElementById("addTrackFields").style.display = t ? "none" : "block";
    document.getElementById("editTrackFields").style.display = t ? "block" : "none";
    document.getElementById("trackModalHeading").innerText = t ? "Редактировать трек" : "Добавить треки";
    if (t) { document.getElementById("inputTrackName").value = t.name; }
    document.getElementById("trackModal").style.display = "flex";
  }
  
  function saveTrack() {
    const btn = document.getElementById("saveTrackBtn");
    if (editingTrackId) {
      const t = tracks.find(x => x.id === editingTrackId);
      const name = document.getElementById("inputTrackName").value.trim() || t.name;
      const tx = db.transaction("tracks", "readwrite"); tx.objectStore("tracks").put({ ...t, name });
      tx.oncomplete = () => { closeModal("trackModal"); loadAllData(); };
    } else {
      const files = document.getElementById("inputTrackFiles").files;
      if (!files.length) return alert("Выберите файл!");
      btn.disabled = true; btn.innerText = "Загрузка...";
      let count = 0;
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const tx = db.transaction("tracks", "readwrite");
          tx.objectStore("tracks").add({ name: file.name.replace(/\.[^/.]+$/, ""), tag: "linear-gradient(135deg,#1565c0,#42a5f5)|🎵", order: tracks.length, data: e.target.result, mimeType: file.type });
          tx.oncomplete = () => { count++; if (count === files.length) { btn.disabled = false; btn.innerText = "Сохранить"; closeModal("trackModal"); loadAllData(); } };
        };
        reader.readAsArrayBuffer(file);
      });
    }
  }

  function editTrackAction(e, id) { e.stopPropagation(); openTrackModal(id); }
  function deleteTrackAction(e, id) { e.stopPropagation(); if(confirm("Удалить трек?")) { const tx = db.transaction("tracks", "readwrite"); tx.objectStore("tracks").delete(id); tx.oncomplete = loadAllData; } }
  
  function openScenarioModal(id = null) {
    editingScenarioId = id;
    const sc = id ? scenarios.find(x => x.id === id) : null;
    document.getElementById("scenarioModalHeading").innerText = sc ? "Редактировать сценарий" : "Создать сценарий";
    document.getElementById("inputScName").value = sc ? sc.name : "";
    document.getElementById("inputScDescription").value = sc ? (sc.description || "") : "";
    document.getElementById("scenarioModal").style.display = "flex";
  }
  
  function saveScenario(){const name=document.getElementById("inputScName").value.trim();if(!name)return alert("Введите название!");const description=document.getElementById("inputScDescription").value.trim(),tx=db.transaction("scenarios","readwrite"),store=tx.objectStore("scenarios");let newId=null;if(editingScenarioId){const old=scenarios.find(x=>x.id===editingScenarioId),{duration,...rest}=old;store.put({...rest,name,description})}else{const req=store.add({name,description,order:scenarios.length,pads:[]});req.onsuccess=()=>{newId=req.result}}tx.oncomplete=()=>{closeModal("scenarioModal");if(newId!==null){openedScenarioId=newId;activeSection="scenarios";padEditMode=false;hasUnsavedChanges=false;document.getElementById("tabAllMusic").classList.remove("active");document.getElementById("tabScenarios").classList.add("active")}loadAllData()}}

   function editScenarioAction(e, id) { e.stopPropagation(); openScenarioModal(id); }
  function deleteScenarioAction(e, id) { e.stopPropagation(); if(confirm("Удалить сценарий?")) { const tx = db.transaction("scenarios", "readwrite"); tx.objectStore("scenarios").delete(id); tx.oncomplete = loadAllData; } }
  
  function saveScenarioState() {
    const sc = scenarios.find(s => s.id === openedScenarioId); if (!sc) return;
    const tx = db.transaction("scenarios", "readwrite"); tx.objectStore("scenarios").put(sc);
    tx.oncomplete = () => { hasUnsavedChanges = false; renderCurrentView(); };
  }

  function openAddSourceModal() { document.getElementById("addSourceModal").style.display = "flex"; }
  function openLibraryPicker() { closeModal("addSourceModal"); padTrackChangeMode = true; activeSection = "all"; document.getElementById("tabAllMusic").classList.add("active"); document.getElementById("tabScenarios").classList.remove("active"); renderCurrentView(); }
   function renderPickerList(q) {
    const listEl = document.getElementById("libraryPickList"); listEl.innerHTML = "";
    tracks.filter(t => t.name.toLowerCase().includes(q.toLowerCase())).forEach(t => {
      const item = document.createElement("div"); item.className = "pick-item"; item.innerHTML = `<div style="font-weight:600;font-size:14px">${t.name}</div>`;
      item.onclick = () => selectTrackForPad(t.id);
      listEl.appendChild(item);
    });
  }
  function filterPickerList() { renderPickerList(document.getElementById("pickerSearch").value); }
  function selectTrackForPad(trackId) {const sc=scenarios.find(s=>s.id===openedScenarioId),pad=editingPadId&&sc&&(sc.pads||[]).find(p=>p.id===editingPadId);if(pad&&!pad.trackId){padTrackChangeMode=false;openPadEditor(trackId);return}if(pad){pad.trackId=trackId;const tx=db.transaction("scenarios","readwrite");tx.objectStore("scenarios").put(sc);tx.oncomplete=()=>{padTrackChangeMode=false;activeSection="scenarios";document.getElementById("tabAllMusic").classList.remove("active");document.getElementById("tabScenarios").classList.add("active");renderCurrentView()};return}padTrackChangeMode=false;openPadEditor(trackId)}

   function addFromDeviceToPad() {
    closeModal("addSourceModal");
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*';
    input.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const tx = db.transaction("tracks", "readwrite");
        const addReq = tx.objectStore("tracks").add({ name: file.name.replace(/\.[^/.]+$/, ""), tag: "linear-gradient(135deg,#1565c0,#42a5f5)|🎵", order: tracks.length, data: ev.target.result, mimeType: file.type });
        addReq.onsuccess = (res) => { const newTrackId = res.target.result; loadAllData(() => { editingPadId = null; openPadEditor(newTrackId); }); };
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  function openPadEditor(trackId = null) {
    const iconGrid = document.getElementById("padIconGrid"); if (iconGrid) iconGrid.innerHTML = "";
    const palette = document.getElementById("padColorPalette");
    if (palette) { palette.innerHTML = ""; PAD_COLORS.forEach(color => { const swatch = document.createElement("button"); swatch.type = "button"; swatch.className = "color-swatch"; swatch.style.background = color; swatch.setAttribute("aria-label", "Выбрать цвет пэда"); swatch.onclick = () => { selectedPadColor = color; palette.querySelectorAll(".color-swatch").forEach(el => el.classList.toggle("selected", el === swatch)); }; palette.appendChild(swatch); }); }
    const sc = scenarios.find(s => s.id === openedScenarioId);
    const existingPad = editingPadId ? sc.pads.find(p => p.id === editingPadId) : null;
    if (existingPad) {
      document.getElementById("inputPadTrackId").value = existingPad.trackId;
      document.getElementById("inputPadTitle").value = existingPad.title || "";
      document.getElementById("inputPadIcon").value = existingPad.icon;
      selectedPadColor = existingPad.color || PAD_COLORS[0];
    } else {
      document.getElementById("inputPadTrackId").value = trackId;
      document.getElementById("inputPadTitle").value = ""; document.getElementById("inputPadIcon").value = "🎵";
      selectedPadColor = PAD_COLORS[0];
    }
    if (palette) palette.querySelectorAll(".color-swatch").forEach((el, i) => el.classList.toggle("selected", PAD_COLORS[i] === selectedPadColor));
    const tr = tracks.find(t => t.id === Number(document.getElementById("inputPadTrackId").value));
    document.getElementById("padCurrentTrackName").innerText = tr ? tr.name : "—";
    document.getElementById("padModal").style.display = "flex";
  }

  function savePad(){const trackId=Number(document.getElementById("inputPadTrackId").value),title=document.getElementById("inputPadTitle").value.trim(),icon=document.getElementById("inputPadIcon").value,sc=scenarios.find(s=>s.id===openedScenarioId);if(!sc.pads)sc.pads=[];if(editingPadId){const pad=sc.pads.find(p=>p.id===editingPadId);if(!pad)return;pad.trackId=trackId;pad.title=title;pad.icon=icon;pad.color=selectedPadColor}else sc.pads.push({id:Date.now(),trackId,title,icon,color:selectedPadColor,order:sc.pads.length});const tx=db.transaction("scenarios","readwrite");tx.objectStore("scenarios").put(sc);tx.oncomplete=()=>{closeModal("padModal");padTrackChangeMode=false;activeSection="scenarios";document.getElementById("tabAllMusic").classList.remove("active");document.getElementById("tabScenarios").classList.add("active");hasUnsavedChanges=true;renderCurrentView()}}

   function deletePad(){if(!editingPadId)return;const sc=scenarios.find(s=>s.id===openedScenarioId),pad=(sc.pads||[]).find(p=>p.id===editingPadId);if(!pad)return;pad.trackId=null;pad.title="";pad.icon="";const tx=db.transaction("scenarios","readwrite");tx.objectStore("scenarios").put(sc);tx.oncomplete=()=>{closeModal("padModal");editingPadId=null;hasUnsavedChanges=true;renderCurrentView()}}

   function changePadTrack() {
    padTrackChangeMode = true;
    closeModal('padModal');
    openAddSourceModal();
  }

  // ============ ANDROID / SYSTEM MEDIA CONTROLS ============
  function updateMediaSessionPlaybackState() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.playbackState = currentAudio && !currentAudio.paused ? "playing" : "paused";
    } catch (error) {}
  }

  function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers = {
      play: () => { if (currentAudio && currentAudio.paused) togglePauseCurrent(); },
      pause: () => { if (currentAudio && !currentAudio.paused) togglePauseCurrent(); },
      previoustrack: () => playPrevTrack(),
      nexttrack: () => playNextTrack(),
      seekbackward: event => {
        if (currentAudio && Number.isFinite(currentAudio.duration)) {
          currentAudio.currentTime = Math.max(0, currentAudio.currentTime - (event.seekOffset || 10));
        }
      },
      seekforward: event => {
        if (currentAudio && Number.isFinite(currentAudio.duration)) {
          currentAudio.currentTime = Math.min(currentAudio.duration, currentAudio.currentTime + (event.seekOffset || 10));
        }
      },
      seekto: event => {
        if (currentAudio && Number.isFinite(currentAudio.duration) && Number.isFinite(event.seekTime)) {
          currentAudio.currentTime = Math.max(0, Math.min(currentAudio.duration, event.seekTime));
        }
      }
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { session.setActionHandler(action, handler); } catch (error) {}
    });
  }
  setupMediaSession();

  // ============ PLAYBACK ============
  function disposeCurrentAudio(){if(currentAudio)currentAudio.pause();currentAudio=null}
function getCachedTrackAudio(track){let item=audioCache.get(track.id);if(item){audioCache.delete(track.id);audioCache.set(track.id,item);return item.audio}const url=URL.createObjectURL(new Blob([track.data],{type:track.mimeType||"audio/mpeg"})),audio=new Audio();audio.preload="auto";audio.src=url;audio.volume=currentVolume;audio.addEventListener("loadedmetadata",()=>{if(currentAudio!==audio)return;const d=document.getElementById("timeDuration");if(d)d.textContent=formatTime(audio.duration)});audio.addEventListener("timeupdate",()=>{if(currentAudio!==audio)return;const c=document.getElementById("timeCurrent"),sl=document.getElementById("seekSlider");if(c)c.textContent=formatTime(audio.currentTime);if(sl&&Number.isFinite(audio.duration)&&audio.duration>0)sl.value=String(Math.round(audio.currentTime/audio.duration*1000))});audio.addEventListener("play",()=>{if(currentAudio!==audio)return;refreshMusicPlaybackUI();refreshPadPlaybackUI();updateMediaSessionPlaybackState();const btn=document.getElementById("playPauseBtn");if(btn)btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM15 5h4v14h-4z"/></svg>'});audio.addEventListener("pause",()=>{if(currentAudio!==audio)return;refreshMusicPlaybackUI();refreshPadPlaybackUI();updateMediaSessionPlaybackState();const btn=document.getElementById("playPauseBtn");if(btn)btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86z"/></svg>'});audio.addEventListener("ended",()=>{if(currentAudio!==audio)return;if(currentPlaybackMode==="pad"&&currentPadId!==null)playNextPadInScenario(currentPadId,currentPadScenarioId);else playNextTrack();updateMediaSessionPlaybackState()});audio.addEventListener("error",()=>{if(currentAudio!==audio)return;const btn=document.getElementById("playPauseBtn");if(btn)btn.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86z"/></svg>'});audio.load();audioCache.set(track.id,{audio,url});while(audioCache.size>4){const key=audioCache.keys().next().value,old=audioCache.get(key);if(old.audio===currentAudio){audioCache.delete(key);audioCache.set(key,old);continue}old.audio.pause();old.audio.removeAttribute("src");old.audio.load();URL.revokeObjectURL(old.url);audioCache.delete(key)}return audio}
function preloadScenarioAudio(sc){[...new Set((sc.pads||[]).map(p=>p.trackId).filter(Boolean))].slice(0,3).forEach(id=>{const t=tracks.find(x=>x.id===id);if(t)getCachedTrackAudio(t)})}

   async function startTrackAudioasync function startTrackAudio(track,pad=null,padScenarioId=null){if(!track||!track.data)return;disposeCurrentAudio();const audio=getCachedTrackAudio(track);currentAudio=audio;audio.pause();try{audio.currentTime=0}catch(_){}audio.volume=currentVolume;currentTrackId=track.id;updatePlayerUI(track,pad);const seek=document.getElementById("seekSlider"),time=document.getElementById("timeCurrent");if(seek)seek.value="0";if(time)time.textContent="0:00";try{await audio.play();requestWakeLock()}catch(err){if(err&&err.name!=="AbortError")alert("Не удалось запустить аудио. Попробуйте нажать воспроизведение ещё раз.")}}

   function toggleTrackFromList(id){if(currentTrackId===id&&currentAudio){if(currentAudio.paused)currentAudio.play().then(()=>requestWakeLock()).catch(()=>alert("Не удалось продолжить воспроизведение."));else{currentAudio.pause();releaseWakeLock()}refreshMusicPlaybackUI();refreshPadPlaybackUI();return}playTrack(id)}

   function playTrack(trackId, scenarioId = null) {function playPad(padId, scenarioId) {
    playerHidden = false;
    const sc = scenarios.find(s => s.id === scenarioId);
    if (!sc) return;
    const pad = (sc.pads || []).find(p => p.id === padId);
    if (!pad) return;
    const track = tracks.find(t => t.id === pad.trackId);
    if (!track) return;
    currentQueueIds = (sc.pads || []).map(p => p.trackId).filter(Boolean);
    currentPlaybackMode = "pad"; currentPadId = padId; currentPadScenarioId = scenarioId;
    syncPlayerVisibility();
    startTrackAudio(track, pad, scenarioId);
  }

  function playNextPadInScenario(padId, scenarioId) {
    const sc = scenarios.find(s => s.id === scenarioId);
    if (!sc) { currentPadId = null; refreshPadPlaybackUI(); return; }
    const pads = sc.pads || [], index = pads.findIndex(p => p.id === padId);
    const next = pads.slice(index + 1).find(p => tracks.some(t => t.id === p.trackId));
    if (next) playPad(next.id, scenarioId);
    else { currentPadId = null; currentPadScenarioId = null; currentPlaybackMode = "pad"; refreshPadPlaybackUI(); }
  }

  function togglePadPlayback(padId,scenarioId){if(currentPlaybackMode==="pad"&&currentPadId===padId&&currentAudio){if(currentAudio.paused)currentAudio.play().then(()=>requestWakeLock()).catch(()=>alert("Не удалось продолжить воспроизведение."));else{currentAudio.pause();releaseWakeLock()}refreshPadPlaybackUI();return}playPad(padId,scenarioId)}

   function refreshMusicPlaybackUI() {
    document.querySelectorAll(".list-row[data-track-id]").forEach(row => {
      const active = Number(row.dataset.trackId) === currentTrackId && !!currentAudio;
      row.classList.toggle("track-playing", active && !currentAudio.paused);
      row.classList.toggle("track-paused", active && currentAudio.paused);
    });
  }

  function refreshPadPlaybackUI() {
    const sc = scenarios.find(s => s.id === openedScenarioId); if (!sc) return;
    document.querySelectorAll(".drum-pad[data-index]").forEach(el => {
      const pad = sc.pads[Number(el.dataset.index)];
      const active = !!(pad && currentPlaybackMode === "pad" && currentPadId === pad.id && currentAudio);
      const playing = active && !currentAudio.paused;
      el.classList.toggle("playing",playing); el.classList.toggle("paused",active && currentAudio.paused);
      el.setAttribute("aria-label", (playing ? "Пауза: " : "Воспроизвести: ") + (pad ? (pad.title || "") : ""));
    });
  }

  function updatePlayerUI(track, pad) {
    if (!track) return;
    const bar = document.getElementById("playerBar");
    const cover = document.getElementById("playerCover");
    if (pad) {
      const [bg] = (track.tag || "linear-gradient(135deg,#1565c0,#42a5f5)|🎵").split("|");
      cover.style.background = bg;
      cover.innerText = "";
      document.getElementById("playerTitle").innerText = pad.title || track.name;
      document.getElementById("playerSub").innerText = track.name;
    } else {
      const [bg, ico] = (track.tag || "linear-gradient(135deg,#1565c0,#42a5f5)|🎵").split("|");
      cover.style.background = bg;
      cover.innerText = ico;
      document.getElementById("playerTitle").innerText = track.name;
      document.getElementById("playerSub").innerText = "Вся музыка";
    }
    if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: pad ? (pad.title || track.name) : track.name,
          artist: pad ? track.name : "ʞk Player",
          album: "KK Player"
        });
      } catch (error) {}
    }
    syncPlayerVisibility();
  }

  function syncPlayerVisibility() {
    const bar = document.getElementById("playerBar");
    const launcher = document.getElementById("playerLauncher");
    const hasTrack = !!(currentAudio && currentTrackId !== null);
    if (bar) {
      bar.classList.toggle("visible", hasTrack && !playerHidden);
      bar.classList.toggle("user-hidden", hasTrack && playerHidden);
    }
    if (launcher) launcher.classList.toggle("visible", hasTrack && playerHidden);
  }
  function hidePlayer() { playerHidden = true; syncPlayerVisibility(); }
  function showPlayer() { playerHidden = false; syncPlayerVisibility(); }

  function togglePauseCurrent() {
    if (!currentAudio) return;
    if (currentAudio.paused) currentAudio.play().catch(() => alert("Не удалось продолжить воспроизведение."));
    else currentAudio.pause();
  }
  function stopAndReset() {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    releaseWakeLock();
  }
  function restartCurrent() { if (currentAudio) currentAudio.currentTime = 0; }
  function playNextTrack() {
    if (currentPlaybackMode === "pad" && currentPadId !== null) { playAdjacentPad(1); return; }
    if (!currentQueueIds.length) return;
    const idx = currentQueueIds.indexOf(currentTrackId);
    const next = currentQueueIds[idx + 1];
    if (next) playTrack(next, openedScenarioId);
  }
  function playPrevTrack() {
    if (currentPlaybackMode === "pad" && currentPadId !== null) { playAdjacentPad(-1); return; }
    if (!currentQueueIds.length) return;
    const idx = currentQueueIds.indexOf(currentTrackId);
    const prev = currentQueueIds[idx - 1];
    if (prev) playTrack(prev, openedScenarioId);
  }

  function playAdjacentPad(direction) {
    const sc = scenarios.find(s => s.id === currentPadScenarioId);
    if (!sc) return;
    const pads = sc.pads || [];
    const currentIndex = pads.findIndex(p => p.id === currentPadId);
    if (currentIndex < 0) return;
    for (let i = currentIndex + direction; i >= 0 && i < pads.length; i += direction) {
      if (tracks.some(t => t.id === pads[i].trackId)) { playPad(pads[i].id, sc.id); return; }
    }
  }

  const seekControl = document.getElementById("seekSlider");
  if (seekControl) seekControl.addEventListener("input", () => {
    if (currentAudio && Number.isFinite(currentAudio.duration) && currentAudio.duration > 0) {
      currentAudio.currentTime = (Number(seekControl.value) / 1000) * currentAudio.duration;
    }
  });

  document.getElementById("playPauseBtn").innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>`;
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
