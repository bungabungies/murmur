'use strict';

const DB_NAME = 'murmur-db';
const DB_VERSION = 1;
const STORE = 'entries';

const moodPalettes = {
  warm: ['#ff9d83', '#f1a2ce'],
  bright: ['#ffd36c', '#88c7ff'],
  soft: ['#f4b4cb', '#8ea8ff'],
  blue: ['#81a9ff', '#a4d1d9'],
  storm: ['#7082ae', '#d1a6c6'],
  ember: ['#f2876b', '#eeb26c'],
  neutral: ['#a8b9d9', '#e8afc2']
};

const lexicon = {
  bright: ['happy','good','great','fun','funny','love','loved','excited','amazing','cute','proud','laugh','laughed','lol','lmao','hehe','best','nice','relieved','peaceful','grateful','syukur','seneng','senang','seru','bahagia','lega','gemes'],
  warm: ['miss','missing','care','caring','comfort','comfortable','safe','soft','sweet','affection','home','friend','friends','family','nostalgic','nostalgia','kangen','sayang','nyaman','hangat'],
  blue: ['sad','cry','cried','lonely','alone','empty','hurt','down','tired','exhausted','miss','missing','melancholy','bad','sedih','nangis','capek','lelah','sepi','kosong','galau'],
  storm: ['angry','annoyed','mad','hate','frustrated','stressed','stress','overwhelmed','anxious','anxiety','worried','panic','upset','pissed','kesel','marah','stres','cemas','khawatir','panik','muak'],
  ember: ['busy','deadline','work','working','presentation','meeting','project','client','manager','office','kerja','kantor','lembur','deadline']
};

const themeGroups = {
  work: ['work','working','office','project','client','manager','meeting','presentation','deadline','kerja','kantor','atasan','proyek'],
  people: ['friend','friends','family','mom','dad','mother','father','sister','brother','manager','coworker','team','temen','teman','keluarga','mama','papa'],
  love: ['love','crush','miss him','miss her','date','kiss','relationship','boyfriend','girlfriend','kangen','sayang','gebetan'],
  body: ['sleep','tired','gym','run','food','eat','weight','skin','period','sick','sleepy','tidur','capek','makan','lapar','olahraga'],
  travel: ['trip','travel','flight','hotel','japan','tokyo','london','holiday','vacation','jalan-jalan','liburan'],
  memory: ['remember','used to','back then','miss those','nostalgia','nostalgic','dulu','ingat','kangen masa']
};

let db;
let selectedDate = localISODate(new Date());
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let pendingPhotos = [];
let pendingAudio = null;
let pendingTranscript = '';
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordStartedAt = 0;
let recordTimer = null;
let recognition = null;

const $ = (id) => document.getElementById(id);
const els = {
  displayDate: $('displayDate'), dayCaption: $('dayCaption'), dayTags: $('dayTags'), dayVibeCard: $('dayVibeCard'), moodOrb: $('moodOrb'),
  entryText: $('entryText'), photoInput: $('photoInput'), micBtn: $('micBtn'), saveEntryBtn: $('saveEntryBtn'), entriesList: $('entriesList'), entryCount: $('entryCount'),
  attachmentPreview: $('attachmentPreview'), recordingPanel: $('recordingPanel'), recordingTime: $('recordingTime'), saveHint: $('saveHint'),
  dateDialog: $('dateDialog'), datePicker: $('datePicker'), searchDialog: $('searchDialog'), searchInput: $('searchInput'), searchResults: $('searchResults'),
  settingsDialog: $('settingsDialog'), monthTitle: $('monthTitle'), calendarGrid: $('calendarGrid'), monthArchive: $('monthArchive'), insightsList: $('insightsList'), jumpTodayBtn: $('jumpTodayBtn')
};

function localISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function prettyDate(iso, opts = {}) {
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat('en', opts.long ? { weekday:'long', day:'numeric', month:'long', year:'numeric' } : { weekday:'long', day:'numeric', month:'long' }).format(date).toLowerCase();
}

function formatTime(ts) {
  return new Intl.DateTimeFormat('en', { hour:'numeric', minute:'2-digit' }).format(new Date(ts)).toLowerCase();
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
      store.createIndex('date', 'date', { unique:false });
      store.createIndex('createdAt', 'createdAt', { unique:false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode='readonly') { return db.transaction(STORE, mode).objectStore(STORE); }

function addEntry(entry) {
  return new Promise((resolve, reject) => {
    const request = tx('readwrite').add(entry);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteEntry(id) {
  return new Promise((resolve, reject) => {
    const request = tx('readwrite').delete(Number(id));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getEntriesByDate(date) {
  return new Promise((resolve, reject) => {
    const request = tx().index('date').getAll(date);
    request.onsuccess = () => resolve(request.result.sort((a,b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

function getAllEntries() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result.sort((a,b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

function putEntry(entry) {
  return new Promise((resolve, reject) => {
    const request = tx('readwrite').put(entry);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function textFor(entries) {
  return entries.map(e => `${e.text || ''} ${e.transcript || ''}`).join(' ').toLowerCase();
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, ' ').split(/\s+/).filter(Boolean);
}

function countHits(text, words) {
  return words.reduce((score, term) => {
    const matches = text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    return score + (matches ? matches.length : 0);
  }, 0);
}

function analyzeDay(entries) {
  const text = textFor(entries);
  if (!entries.length || !text.trim()) {
    return { mood:'neutral', tags:[], caption:'Nothing to explain yet.', palette:moodPalettes.neutral };
  }

  const scores = Object.fromEntries(Object.entries(lexicon).map(([k, words]) => [k, countHits(text, words)]));
  const weighted = { ...scores };
  weighted.warm += Math.min(scores.blue, scores.warm) * .5;
  const mood = Object.entries(weighted).sort((a,b) => b[1]-a[1])[0][1] === 0 ? 'soft' : Object.entries(weighted).sort((a,b)=>b[1]-a[1])[0][0];

  const themeScores = Object.entries(themeGroups).map(([name, words]) => [name, countHits(text, words)]).sort((a,b)=>b[1]-a[1]);
  const tags = themeScores.filter(x => x[1] > 0).slice(0,3).map(x=>x[0]);
  const hasMixed = scores.bright > 0 && (scores.blue > 0 || scores.storm > 0);

  let caption;
  if (hasMixed) caption = 'A good day with a little weather in it.';
  else if (mood === 'bright') caption = 'There was lightness here.';
  else if (mood === 'warm') caption = 'Something stayed close to your heart.';
  else if (mood === 'blue') caption = 'A quieter, heavier kind of day.';
  else if (mood === 'storm') caption = 'Your mind had a lot to carry.';
  else if (mood === 'ember') caption = 'A day with momentum — and maybe too much of it.';
  else caption = 'A soft, in-between kind of day.';

  if (tags[0] === 'work' && mood === 'warm') caption = 'Work took up space, but not all of it was heavy.';
  if (tags[0] === 'love' && (mood === 'warm' || mood === 'blue')) caption = 'Someone was on your mind more than once.';
  if (tags[0] === 'memory') caption = 'You spent a little time somewhere that already happened.';

  return { mood, tags, caption, palette:moodPalettes[mood] || moodPalettes.neutral };
}

function setPalette(el, palette) {
  el.style.setProperty('--vibe-a', palette[0]);
  el.style.setProperty('--vibe-b', palette[1]);
}

function updateDateHeader() {
  els.displayDate.textContent = prettyDate(selectedDate);
  els.datePicker.value = selectedDate;
  els.jumpTodayBtn.hidden = selectedDate === localISODate(new Date());
}

async function renderToday() {
  updateDateHeader();
  const entries = await getEntriesByDate(selectedDate);
  const analysis = analyzeDay(entries);
  els.dayCaption.textContent = analysis.caption;
  els.dayTags.textContent = analysis.tags.length ? analysis.tags.join(' · ') : 'leave a murmur whenever something sticks.';
  setPalette(els.dayVibeCard, analysis.palette);
  setPalette(els.moodOrb, analysis.palette);
  els.entryCount.textContent = entries.length ? `${entries.length} ${entries.length === 1 ? 'murmur' : 'murmurs'}` : '';
  els.entriesList.innerHTML = '';

  if (!entries.length) {
    els.entriesList.innerHTML = '<div class="empty-state">nothing here yet. that’s allowed.</div>';
    return;
  }

  entries.slice().reverse().forEach(entry => els.entriesList.appendChild(renderEntry(entry)));
}

function renderEntry(entry) {
  const fragment = $('entryTemplate').content.cloneNode(true);
  const card = fragment.querySelector('.entry-card');
  card.dataset.id = entry.id;
  fragment.querySelector('.entry-time').textContent = formatTime(entry.createdAt);
  fragment.querySelector('.entry-text').textContent = entry.text || '';

  const types = [];
  if (entry.text) types.push('text');
  if (entry.photos?.length) types.push(entry.photos.length > 1 ? `${entry.photos.length} photos` : 'photo');
  if (entry.audio) types.push('voice');
  fragment.querySelector('.entry-type').textContent = types.join(' · ') || 'murmur';

  const images = fragment.querySelector('.entry-images');
  (entry.photos || []).forEach(photo => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(photo);
    img.alt = 'photo from this murmur';
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once:true });
    images.appendChild(img);
  });

  if (entry.audio) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    const src = URL.createObjectURL(entry.audio);
    audio.src = src;
    audio.addEventListener('emptied', () => URL.revokeObjectURL(src), { once:true });
    fragment.querySelector('.entry-audio').appendChild(audio);
  }

  if (entry.transcript) {
    const details = fragment.querySelector('.transcript-wrap');
    details.hidden = false;
    fragment.querySelector('.entry-transcript').textContent = entry.transcript;
  }

  fragment.querySelector('.entry-delete').addEventListener('click', async () => {
    if (confirm('Delete this murmur?')) {
      await deleteEntry(entry.id);
      await renderAll();
    }
  });

  return fragment;
}

function renderPhotoPreview() {
  els.attachmentPreview.innerHTML = '';
  els.attachmentPreview.hidden = pendingPhotos.length === 0;
  pendingPhotos.forEach((file, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once:true });
    const remove = document.createElement('button');
    remove.className = 'preview-remove';
    remove.textContent = '×';
    remove.type = 'button';
    remove.addEventListener('click', () => { pendingPhotos.splice(index,1); renderPhotoPreview(); updateSaveHint(); });
    wrap.append(img, remove);
    els.attachmentPreview.appendChild(wrap);
  });
}

function updateSaveHint() {
  const bits = [];
  if (pendingPhotos.length) bits.push(`${pendingPhotos.length} photo${pendingPhotos.length > 1 ? 's' : ''}`);
  if (pendingAudio) bits.push('voice');
  if (selectedDate !== localISODate(new Date())) bits.push(prettyDate(selectedDate));
  els.saveHint.textContent = bits.join(' · ');
}

async function saveEntry() {
  const text = els.entryText.value.trim();
  if (!text && !pendingPhotos.length && !pendingAudio) {
    els.entryText.focus();
    return;
  }

  els.saveEntryBtn.disabled = true;
  const now = Date.now();
  const entry = {
    date: selectedDate,
    createdAt: now,
    text,
    photos: pendingPhotos.slice(),
    audio: pendingAudio,
    transcript: pendingTranscript.trim()
  };
  await addEntry(entry);
  els.entryText.value = '';
  pendingPhotos = [];
  pendingAudio = null;
  pendingTranscript = '';
  els.photoInput.value = '';
  renderPhotoPreview();
  updateSaveHint();
  els.saveEntryBtn.disabled = false;
  await renderAll();
  els.entryText.focus();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    stopRecognition();
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    const preferred = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    mediaRecorder = new MediaRecorder(mediaStream, preferred ? { mimeType:preferred } : undefined);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      pendingAudio = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      mediaStream?.getTracks().forEach(track => track.stop());
      mediaStream = null;
      clearInterval(recordTimer);
      els.recordingPanel.hidden = true;
      els.micBtn.classList.remove('recording');
      els.micBtn.textContent = '◉';
      updateSaveHint();
    };
    mediaRecorder.start();
    recordStartedAt = Date.now();
    els.recordingPanel.hidden = false;
    els.micBtn.classList.add('recording');
    els.micBtn.textContent = '■';
    els.recordingTime.textContent = '00:00';
    recordTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recordStartedAt) / 1000);
      els.recordingTime.textContent = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    }, 500);
    startRecognition();
  } catch (err) {
    alert('Murmur could not access your microphone. Check browser permissions and try again.');
  }
}

function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || 'en-US';
  let finalText = '';
  recognition.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
      else interim += e.results[i][0].transcript;
    }
    pendingTranscript = `${finalText}${interim}`.trim();
  };
  recognition.onerror = () => {};
  try { recognition.start(); } catch (_) {}
}

function stopRecognition() {
  try { recognition?.stop(); } catch (_) {}
  recognition = null;
}

async function renderCalendar() {
  const all = await getAllEntries();
  const byDate = groupByDate(all);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  els.monthTitle.textContent = new Intl.DateTimeFormat('en', {month:'long', year:'numeric'}).format(calendarMonth).toLowerCase();
  els.calendarGrid.innerHTML = '';

  let startDay = new Date(year, month, 1).getDay();
  startDay = (startDay + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month+1, 0).getDate();

  for (let i=0; i<startDay; i++) {
    const blank = document.createElement('button'); blank.className='calendar-day muted'; blank.innerHTML='<span>·</span>'; els.calendarGrid.appendChild(blank);
  }
  for (let day=1; day<=daysInMonth; day++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const button = document.createElement('button');
    button.className = 'calendar-day';
    button.innerHTML = `<span>${day}</span>`;
    if (byDate[iso]?.length) {
      button.classList.add('has-entry');
      const a = analyzeDay(byDate[iso]); setPalette(button, a.palette);
    }
    if (iso === selectedDate) button.classList.add('selected');
    button.addEventListener('click', async () => { selectedDate = iso; switchView('todayView'); await renderToday(); updateSaveHint(); window.scrollTo({top:0,behavior:'smooth'}); });
    els.calendarGrid.appendChild(button);
  }

  els.monthArchive.innerHTML = '';
  const monthDates = Object.keys(byDate).filter(date => {
    const d = new Date(`${date}T12:00:00`); return d.getFullYear()===year && d.getMonth()===month;
  }).sort().reverse();
  if (!monthDates.length) {
    els.monthArchive.innerHTML = '<div class="empty-state">this month is still mostly unwritten.</div>';
  } else {
    monthDates.forEach(date => {
      const entries = byDate[date];
      const a = analyzeDay(entries);
      const btn = document.createElement('button');
      btn.className='archive-day'; setPalette(btn,a.palette);
      const excerpt = entries.slice().reverse().map(e=>e.text || e.transcript || (e.photos?.length ? 'photo' : 'voice note')).find(Boolean) || 'a day you kept';
      btn.innerHTML = `<span class="archive-swatch"></span><span><h3>${prettyDate(date)}</h3><p>${escapeHTML(excerpt)}</p></span><span class="archive-count">${entries.length}</span>`;
      btn.addEventListener('click', async () => { selectedDate=date; switchView('todayView'); await renderToday(); updateSaveHint(); window.scrollTo({top:0,behavior:'smooth'}); });
      els.monthArchive.appendChild(btn);
    });
  }
}

function groupByDate(entries) {
  return entries.reduce((acc,e) => ((acc[e.date] ||= []).push(e), acc), {});
}

function escapeHTML(str='') {
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function renderInsights() {
  const all = await getAllEntries();
  els.insightsList.innerHTML='';
  if (!all.length) {
    els.insightsList.innerHTML = '<div class="empty-state">write a few murmurs first. patterns need something to echo.</div>';
    return;
  }

  const now = Date.now();
  const recent = all.filter(e => now - e.createdAt <= 30*24*60*60*1000);
  const pool = recent.length ? recent : all;
  const text = textFor(pool);
  const byDate = groupByDate(pool);
  const analyses = Object.entries(byDate).map(([date,entries]) => ({date, ...analyzeDay(entries)}));

  const moodCounts = analyses.reduce((acc,a)=>((acc[a.mood]=(acc[a.mood]||0)+1),acc),{});
  const topMood = Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'soft';
  const themes = Object.entries(themeGroups).map(([name,words])=>[name,countHits(text,words)]).sort((a,b)=>b[1]-a[1]).filter(x=>x[1]>0);
  const topTheme = themes[0]?.[0];
  const totalPhotos = pool.reduce((n,e)=>n+(e.photos?.length||0),0);
  const totalVoice = pool.filter(e=>e.audio).length;
  const late = pool.filter(e => new Date(e.createdAt).getHours() >= 22 || new Date(e.createdAt).getHours() < 4).length;

  const cards = [];
  if (topTheme) cards.push({ label:'you keep returning to', title:topTheme, body:`It shows up more than your other recurring themes in the ${recent.length ? 'last 30 days' : 'archive so far'}.`, palette:moodPalettes[topMood] });

  const moodCopy = {
    bright:'Your brighter days have been showing up often.', warm:'There has been a lot of tenderness in the archive lately.', blue:'The archive has leaned quieter lately.', storm:'A few days have carried more friction than usual.', ember:'Your recent days have had a lot of motion in them.', soft:'Your recent days have mostly lived in the in-between.'
  };
  cards.push({ label:'the recent texture', title:moodCopy[topMood], body:'This is a loose read of your own words, not a score or diagnosis.', palette:moodPalettes[topMood] });

  if (late >= Math.max(3, Math.ceil(pool.length*.25))) cards.push({ label:'tiny habit', title:'you tend to murmur late.', body:`${late} of your recent entries landed after 10 PM. Apparently your brain likes an encore.`, palette:moodPalettes.storm });
  if (totalPhotos >= 4) cards.push({ label:'what you kept', title:`you saved ${totalPhotos} little pieces of the world.`, body:'Photos are becoming part of how you remember, not just what you write.', palette:moodPalettes.bright });
  if (totalVoice >= 2) cards.push({ label:'in your own voice', title:`you left ${totalVoice} voice murmurs.`, body:'Future-you gets the words and the exact way you sounded saying them.', palette:moodPalettes.warm });

  cards.slice(0,5).forEach(card => {
    const el = document.createElement('article');
    el.className='insight-card'; setPalette(el, card.palette);
    el.innerHTML=`<span class="insight-label">${escapeHTML(card.label)}</span><h2>${escapeHTML(card.title)}</h2><p>${escapeHTML(card.body)}</p>`;
    els.insightsList.appendChild(el);
  });
}

async function searchEntries(query) {
  const q = query.trim().toLowerCase();
  els.searchResults.innerHTML='';
  if (!q) {
    els.searchResults.innerHTML='<div class="empty-state">try a person, place, feeling, or random word.</div>';
    return;
  }
  const all = await getAllEntries();
  const results = all.filter(e => `${e.text || ''} ${e.transcript || ''}`.toLowerCase().includes(q)).reverse();
  if (!results.length) {
    els.searchResults.innerHTML='<div class="empty-state">nothing echoed back.</div>';
    return;
  }
  results.slice(0,50).forEach(e => {
    const btn=document.createElement('button'); btn.className='search-result';
    const excerpt=(e.text || e.transcript || 'photo / voice murmur').replace(/\s+/g,' ');
    btn.innerHTML=`<strong>${prettyDate(e.date)} · ${formatTime(e.createdAt)}</strong><span>${escapeHTML(excerpt)}</span>`;
    btn.addEventListener('click', async()=>{ selectedDate=e.date; els.searchDialog.close(); switchView('todayView'); await renderToday(); updateSaveHint(); window.scrollTo({top:0,behavior:'smooth'}); });
    els.searchResults.appendChild(btn);
  });
}

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===viewId));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===viewId));
  if (viewId==='pastView') renderCalendar();
  if (viewId==='murmursView') renderInsights();
}

async function exportArchive() {
  const entries = await getAllEntries();
  const serial = [];
  for (const e of entries) {
    serial.push({
      ...e,
      photos: await Promise.all((e.photos||[]).map(blobToDataURL)),
      audio: e.audio ? await blobToDataURL(e.audio) : null
    });
  }
  const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), entries:serial}, null, 2)], {type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`murmur-backup-${localISODate(new Date())}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function blobToDataURL(blob) {
  return new Promise(resolve => { const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(blob); });
}

async function dataURLToBlob(url) {
  const res=await fetch(url); return await res.blob();
}

async function importArchive(file) {
  const data=JSON.parse(await file.text());
  if (!Array.isArray(data.entries)) throw new Error('Invalid archive');
  for (const raw of data.entries) {
    const entry={...raw}; delete entry.id;
    entry.photos=await Promise.all((raw.photos||[]).map(dataURLToBlob));
    entry.audio=raw.audio ? await dataURLToBlob(raw.audio) : null;
    await addEntry(entry);
  }
  await renderAll();
}

async function clearArchive() {
  return new Promise((resolve,reject)=>{
    const request=tx('readwrite').clear(); request.onsuccess=()=>resolve(); request.onerror=()=>reject(request.error);
  });
}

async function renderAll() {
  await renderToday();
  if ($('pastView').classList.contains('active')) await renderCalendar();
  if ($('murmursView').classList.contains('active')) await renderInsights();
}

function wireEvents() {
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.view)));
  $('homeBtn').addEventListener('click', async()=>{ selectedDate=localISODate(new Date()); switchView('todayView'); await renderToday(); updateSaveHint(); });
  $('jumpTodayBtn').addEventListener('click', async()=>{ selectedDate=localISODate(new Date()); await renderToday(); updateSaveHint(); });
  $('dateButton').addEventListener('click',()=>{ els.datePicker.value=selectedDate; els.dateDialog.showModal(); });
  $('entryDateBtn').addEventListener('click',()=>{ els.datePicker.value=selectedDate; els.dateDialog.showModal(); });
  $('confirmDateBtn').addEventListener('click',()=>{ selectedDate=els.datePicker.value || selectedDate; setTimeout(async()=>{ await renderToday(); updateSaveHint(); },0); });
  els.photoInput.addEventListener('change',()=>{ pendingPhotos.push(...Array.from(els.photoInput.files || [])); renderPhotoPreview(); updateSaveHint(); });
  els.micBtn.addEventListener('click',toggleRecording);
  els.saveEntryBtn.addEventListener('click',saveEntry);
  els.entryText.addEventListener('keydown',e=>{ if ((e.metaKey||e.ctrlKey) && e.key==='Enter') saveEntry(); });

  $('prevMonthBtn').addEventListener('click',()=>{ calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1); renderCalendar(); });
  $('nextMonthBtn').addEventListener('click',()=>{ calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1); renderCalendar(); });

  $('searchBtn').addEventListener('click',()=>{ els.searchDialog.showModal(); els.searchInput.value=''; searchEntries(''); setTimeout(()=>els.searchInput.focus(),100); });
  $('closeSearchBtn').addEventListener('click',()=>els.searchDialog.close());
  els.searchInput.addEventListener('input',()=>searchEntries(els.searchInput.value));

  $('settingsBtn').addEventListener('click',()=>els.settingsDialog.showModal());
  $('closeSettingsBtn').addEventListener('click',()=>els.settingsDialog.close());
  $('exportBtn').addEventListener('click',exportArchive);
  $('importInput').addEventListener('change',async e=>{ try { if(e.target.files[0]) await importArchive(e.target.files[0]); alert('Archive imported.'); } catch(err){ alert('That backup could not be imported.'); } e.target.value=''; });
  $('clearBtn').addEventListener('click',async()=>{ if(confirm('Clear every Murmur entry stored on this device? This cannot be undone unless you exported a backup.')) { await clearArchive(); await renderAll(); els.settingsDialog.close(); } });
}

async function init() {
  db = await openDB();
  wireEvents();
  updateSaveHint();
  await renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

init();
/* =========================
   MURMUR LAUNCH SPLASH
   ========================= */

(function initLaunchSplash() {
  const splash = document.getElementById("launchSplash");
  if (!splash) return;

  const SPLASH_DURATION = 3400;
  const SKIP_DELAY = 900;
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 menit
  const STORAGE_KEY = "murmur_last_splash_at";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lastShown = Number(localStorage.getItem(STORAGE_KEY) || 0);
  const now = Date.now();

  // kalau splash baru aja muncul within 10 mins, skip
  if (now - lastShown < COOLDOWN_MS) {
    splash.classList.add("is-hidden");
    return;
  }

  localStorage.setItem(STORAGE_KEY, String(now));

  let canSkip = false;
  let finished = false;

  const finishSplash = () => {
    if (finished) return;
    finished = true;
    splash.classList.add("is-hidden");

    setTimeout(() => {
      splash.remove();
    }, prefersReducedMotion ? 250 : 900);
  };

  setTimeout(() => {
    canSkip = true;
  }, SKIP_DELAY);

  setTimeout(() => {
    finishSplash();
  }, prefersReducedMotion ? 400 : SPLASH_DURATION);

  splash.addEventListener("click", () => {
    if (canSkip) finishSplash();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && canSkip) {
      finishSplash();
    }
  });
})();
