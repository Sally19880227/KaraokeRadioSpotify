/* Karaoke Radio — 動画は表示せず、音声+カラオケ歌詞のみのプレイヤー */

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const REGION = 'JP';
const SEARCH_HISTORY_KEY = 'kr_search_history';
const SEARCH_HISTORY_MAX = 12;

const state = {
  apiKey: localStorage.getItem('kr_api_key') || '',
  query: '',
  nextPageToken: null,
  currentList: [],
  currentIndex: -1,
  recentlyPlayedIds: [],

  player: null,
  playerReady: false,

  lyrics: [],
  karaokeActiveIndex: -1,
  karaokeSyncTimer: null,
  karaokeOffset: 0,
  karaokeRate: 1.0,
};

const el = {
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  apiKeyInput: document.getElementById('api-key-input'),
  apiKeySave: document.getElementById('api-key-save'),
  apiKeyCancel: document.getElementById('api-key-cancel'),

  searchHistory: document.getElementById('search-history'),
  searchHistoryChips: document.getElementById('search-history-chips'),
  searchHistoryClear: document.getElementById('search-history-clear'),

  resultsView: document.getElementById('results-view'),
  resultsHeading: document.getElementById('results-heading'),
  resultsList: document.getElementById('results-list'),
  statusMsg: document.getElementById('status-msg'),
  loadMore: document.getElementById('load-more'),

  karaokeView: document.getElementById('karaoke-view'),
  karaokeTitle: document.getElementById('karaoke-title'),
  karaokeArtist: document.getElementById('karaoke-artist'),
  karaokeStatus: document.getElementById('karaoke-status'),
  karaokeLines: document.getElementById('karaoke-lines'),
  karaokeOffsetSlider: document.getElementById('karaoke-offset-slider'),
  karaokeRateSlider: document.getElementById('karaoke-rate-slider'),
  karaokeRateValue: document.getElementById('karaoke-rate-value'),
  karaokeOffsetValue: document.getElementById('karaoke-offset-value'),
  karaokeOffsetMinus: document.getElementById('karaoke-offset-minus'),
  karaokeOffsetPlus: document.getElementById('karaoke-offset-plus'),
  backToSearchBtn: document.getElementById('back-to-search-btn'),

  playPauseBtn: document.getElementById('play-pause-btn'),
  skipBtn: document.getElementById('skip-btn'),
  syncHint: document.getElementById('sync-hint'),
  editLyricsBtn: document.getElementById('edit-lyrics-btn'),
  lyricsEditModal: document.getElementById('lyrics-edit-modal'),
  lyricsEditClose: document.getElementById('lyrics-edit-close'),
  manualLrcInput: document.getElementById('manual-lrc-input'),
  manualLrcApply: document.getElementById('manual-lrc-apply'),
};

// ---------- API key modal ----------
function openSettings(){
  el.apiKeyInput.value = state.apiKey;
  el.settingsModal.classList.remove('hidden');
}
function closeSettings(){ el.settingsModal.classList.add('hidden'); }
el.settingsBtn.addEventListener('click', openSettings);
el.apiKeyCancel.addEventListener('click', closeSettings);
el.apiKeySave.addEventListener('click', () => {
  const key = el.apiKeyInput.value.trim();
  if(key){
    state.apiKey = key;
    localStorage.setItem('kr_api_key', key);
  }
  closeSettings();
});

// ---------- 検索履歴 ----------
function getSearchHistory(){
  try{ return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
  catch(e){ return []; }
}
function saveSearchHistory(query){
  let history = getSearchHistory().filter(q => q !== query);
  history.unshift(query);
  history = history.slice(0, SEARCH_HISTORY_MAX);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  renderSearchHistory();
}
function renderSearchHistory(){
  const history = getSearchHistory();
  el.searchHistoryChips.innerHTML = '';
  if(!history.length){
    el.searchHistory.classList.add('hidden');
    return;
  }
  el.searchHistory.classList.remove('hidden');
  history.forEach(q => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'search-history-chip';
    chip.textContent = q;
    chip.addEventListener('click', () => {
      el.searchInput.value = q;
      el.searchForm.dispatchEvent(new Event('submit', { cancelable: true }));
    });
    el.searchHistoryChips.appendChild(chip);
  });
}
el.searchHistoryClear.addEventListener('click', () => {
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  renderSearchHistory();
});

// ---------- Search ----------
el.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = el.searchInput.value.trim();
  if(!q) return;
  showResultsView();
  state.query = q;
  state.nextPageToken = null;
  saveSearchHistory(q);
  loadSearchResults(true);
});

async function ytFetch(path, params){
  if(!state.apiKey){
    showStatus('APIキーが未設定です。右上の ⚙ から設定してください。');
    openSettings();
    return null;
  }
  const url = new URL(`${API_BASE}/${path}`);
  Object.entries({ key: state.apiKey, ...params }).forEach(([k,v]) => {
    if(v === undefined || v === null) return;
    url.searchParams.set(k, v);
  });
  try{
    const res = await fetch(url);
    const data = await res.json();
    if(data.error){
      showStatus(`APIエラー: ${data.error.message}`);
      return null;
    }
    return data;
  } catch(e){
    showStatus('通信に失敗しました。ネットワーク接続を確認してください。');
    return null;
  }
}
function showStatus(msg){ el.statusMsg.textContent = msg; }

function normalizeSearchResponse(data){
  return (data.items || [])
    .filter(it => it.id && it.id.videoId)
    .map(it => ({
      id: it.id.videoId,
      title: it.snippet.title,
      channel: it.snippet.channelTitle,
      thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
    }));
}
function decodeHTML(str){
  const t = document.createElement('textarea');
  t.innerHTML = str;
  return t.value;
}

async function loadSearchResults(reset){
  if(reset){
    el.resultsList.innerHTML = '';
    state.currentList = [];
  }
  el.resultsHeading.textContent = `「${state.query}」の検索結果`;
  showStatus('読み込み中…');
  el.loadMore.classList.add('hidden');

  const data = await ytFetch('search', {
    part: 'snippet',
    q: state.query,
    type: 'video',
    videoCategoryId: '10',
    maxResults: 20,
    pageToken: state.nextPageToken || undefined,
  });
  if(!data) return;

  const items = normalizeSearchResponse(data);
  state.currentList = state.currentList.concat(items);
  items.forEach(v => el.resultsList.appendChild(buildResultCard(v)));

  state.nextPageToken = data.nextPageToken || null;
  el.loadMore.classList.toggle('hidden', !state.nextPageToken);
  showStatus(state.currentList.length ? '' : '該当する曲が見つかりませんでした。');
}
el.loadMore.addEventListener('click', () => loadSearchResults(false));

function buildResultCard(v){
  const card = document.createElement('div');
  card.className = 'result-card';
  card.tabIndex = 0;
  card.innerHTML = `
    <div class="result-thumb"><img src="${v.thumb}" alt="" loading="lazy"></div>
    <div class="result-meta">
      <div class="result-title">${decodeHTML(v.title)}</div>
      <div class="result-channel">${decodeHTML(v.channel)}</div>
    </div>
  `;
  const play = () => startKaraoke(v);
  card.addEventListener('click', play);
  card.addEventListener('keydown', e => { if(e.key === 'Enter') play(); });
  return card;
}

// ---------- 画面切り替え ----------
function showResultsView(){
  el.karaokeView.classList.add('hidden');
  el.resultsView.classList.remove('hidden');
  if(state.player && state.player.stopVideo) state.player.stopVideo();
  stopKaraokeSyncLoop();
}
function showKaraokeView(){
  el.resultsView.classList.add('hidden');
  el.karaokeView.classList.remove('hidden');
}
el.backToSearchBtn.addEventListener('click', showResultsView);

// ---------- YouTube Player（非表示・音声のみ） ----------
function onYouTubeIframeAPIReady(){
  const playerVars = { autoplay: 1, rel: 0, playsinline: 1 };
  if(location.protocol === 'http:' || location.protocol === 'https:'){
    playerVars.origin = location.origin;
  }
  state.player = new YT.Player('yt-player', {
    height: '100%', width: '100%',
    playerVars,
    events: {
      onReady: () => { state.playerReady = true; },
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    }
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

// 再生できなかった場合の処理（多くは著作権者が埋め込み再生を許可していないケース）
function onPlayerError(e){
  stopKaraokeSyncLoop();
  let msg = 'この曲は再生できませんでした。';
  if(e.data === 101 || e.data === 150){
    msg = 'この動画は権利者の設定により、外部サイトでの再生が許可されていません。';
  } else if(e.data === 100){
    msg = 'この動画は削除されているか非公開のため再生できません。';
  } else if(e.data === 2){
    msg = '動画IDが正しく認識できませんでした。';
  }
  el.karaokeStatus.textContent = `${msg} 自動的に別の曲を探します…`;

  // 自動再生の流れの中であれば、同じアーティストの別の曲を自動で探して再生を続ける
  if(state.currentIndex >= 0){
    playNextByArtist();
  } else {
    setTimeout(showResultsView, 2000);
  }
}

function onPlayerStateChange(e){
  if(e.data === YT.PlayerState.PLAYING){
    el.playPauseBtn.textContent = '⏸';
    startKaraokeSyncLoop();
  } else if(e.data === YT.PlayerState.PAUSED){
    el.playPauseBtn.textContent = '▶';
    stopKaraokeSyncLoop();
  } else if(e.data === YT.PlayerState.ENDED){
    el.playPauseBtn.textContent = '▶';
    stopKaraokeSyncLoop();
    playNextByArtist();
  }
}

el.playPauseBtn.addEventListener('click', () => {
  if(!state.player) return;
  const s = state.player.getPlayerState();
  if(s === YT.PlayerState.PLAYING) state.player.pauseVideo();
  else state.player.playVideo();
});
el.skipBtn.addEventListener('click', () => playNextByArtist());

// ---------- 曲を選んで再生開始 ----------
function startKaraoke(v){
  let idx = state.currentList.findIndex(x => x.id === v.id);
  if(idx === -1){
    state.currentList.push(v);
    idx = state.currentList.length - 1;
  }
  showKaraokeView();
  playTrack(v, idx);
}

function playTrack(v, indexHint){
  el.karaokeTitle.textContent = decodeHTML(v.title);
  el.karaokeArtist.textContent = decodeHTML(v.channel);
  state.currentIndex = (typeof indexHint === 'number') ? indexHint : state.currentList.findIndex(x => x.id === v.id);
  state.recentlyPlayedIds = [v.id, ...state.recentlyPlayedIds.filter(id => id !== v.id)].slice(0, 8);

  if(state.playerReady && state.player && state.player.loadVideoById){
    state.player.loadVideoById(v.id);
  } else {
    const wait = setInterval(() => {
      if(state.playerReady && state.player){
        clearInterval(wait);
        state.player.loadVideoById(v.id);
      }
    }, 200);
  }
  loadKaraokeLyrics(v);
}

// ---------- 自動選曲（同じアーティストで検索） ----------
async function playNextByArtist(){
  const current = state.currentList[state.currentIndex];
  if(!current) return;

  const { artist } = guessTrackInfo(current);
  if(!artist) return;

  el.karaokeStatus.textContent = '次の曲を探しています…';
  const data = await ytFetch('search', {
    part: 'snippet',
    q: artist,
    type: 'video',
    videoCategoryId: '10',
    maxResults: 15,
  });
  if(!data) return;

  const candidates = normalizeSearchResponse(data)
    .filter(item => item.id !== current.id && !state.recentlyPlayedIds.includes(item.id));
  if(!candidates.length){
    el.karaokeStatus.textContent = '次に流せる曲が見つかりませんでした。';
    return;
  }
  const next = candidates[Math.floor(Math.random() * candidates.length)];
  state.currentList.push(next);
  playTrack(next, state.currentList.length - 1);
}

// ---------- 曲名からアーティスト名を推測 ----------
function guessTrackInfo(v){
  let title = decodeHTML(v.title);
  title = title.replace(/\(Official.*?\)|\[Official.*?\]|\(MV\)|\[MV\]|Official Music Video|Official Video|Lyric Video|Music Video|MV|フル|Full ver\.?/gi, '').trim();

  const separators = [' - ', ' – ', ' — ', '「', '『', '｜', '/'];
  for(const sep of separators){
    if(title.includes(sep)){
      const parts = title.split(sep);
      if(parts.length >= 2){
        return { artist: parts[0].trim(), track: parts.slice(1).join(sep).replace(/[」』]/g, '').trim() };
      }
    }
  }
  return { artist: decodeHTML(v.channel).replace(/\s*-\s*Topic$/i, '').trim(), track: title };
}

// ---------- LRCLIB歌詞取得・解析 ----------
async function fetchLyricsFromLrclib(track, artist){
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('track_name', track);
  url.searchParams.set('artist_name', artist);
  try{
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    const withSync = data.find(item => item.syncedLyrics);
    return withSync ? withSync.syncedLyrics : null;
  } catch(e){
    return null;
  }
}
function parseLrc(lrcText){
  const lines = [];
  lrcText.split('\n').forEach(rawLine => {
    const timeMatches = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if(!timeMatches.length) return;
    const text = rawLine.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    timeMatches.forEach(m => {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3,'0'), 10) : 0;
      lines.push({ time: min * 60 + sec + ms / 1000, text: text || '♪' });
    });
  });
  lines.sort((a,b) => a.time - b.time);
  return lines;
}

async function loadKaraokeLyrics(v){
  stopKaraokeSyncLoop();
  state.lyrics = [];
  state.karaokeActiveIndex = -1;
  state.currentVideoForLyrics = v;
  el.syncHint.textContent = '同じアーティストの曲を自動的に流し続けます';
  el.karaokeLines.innerHTML = '';
  el.karaokeStatus.textContent = '歌詞を検索中…';

  const { artist, track } = guessTrackInfo(v);
  const lrc = await fetchLyricsFromLrclib(track, artist);
  if(!lrc){
    el.karaokeStatus.textContent = `歌詞が見つかりませんでした（検索語: ${artist} / ${track}）。「✎ 歌詞を編集」から手動で貼り付けることもできます。`;
    return;
  }
  applyLyrics(parseLrc(lrc));
}

// 解析済みの歌詞データを反映し、必要なら同期ループを開始する
function applyLyrics(lines){
  state.lyrics = lines;
  state.karaokeActiveIndex = -1;
  if(!state.lyrics.length){
    el.karaokeStatus.textContent = '歌詞データを解析できませんでした。';
    return;
  }
  el.karaokeStatus.textContent = '';
  renderKaraokeWindow(-1);
  if(state.player && state.player.getPlayerState && state.player.getPlayerState() === YT.PlayerState.PLAYING){
    startKaraokeSyncLoop();
  }
}

function startKaraokeSyncLoop(){
  if(!state.lyrics.length) return;
  stopKaraokeSyncLoop();
  state.karaokeSyncTimer = setInterval(karaokeTick, 150);
}
function stopKaraokeSyncLoop(){
  if(state.karaokeSyncTimer) clearInterval(state.karaokeSyncTimer);
  state.karaokeSyncTimer = null;
}
function karaokeTick(){
  if(!state.player || !state.player.getCurrentTime || !state.lyrics.length) return;
  const t = (state.player.getCurrentTime() * state.karaokeRate) - state.karaokeOffset;
  let idx = -1;
  for(let i = 0; i < state.lyrics.length; i++){
    if(state.lyrics[i].time <= t) idx = i;
    else break;
  }
  if(idx === state.karaokeActiveIndex) return;
  state.karaokeActiveIndex = idx;
  renderKaraokeWindow(idx);
}

// 前後数行をまとめて表示する（前1行・現在1行・次2行）。各行はタップで即座に同期し直せる
function renderKaraokeWindow(idx){
  el.karaokeLines.innerHTML = '';
  const positions = [
    { offset: -1, cls: 'k-prev' },
    { offset: 0,  cls: 'k-current' },
    { offset: 1,  cls: 'k-next' },
    { offset: 2,  cls: 'k-next2' },
  ];
  positions.forEach(p => {
    const i = idx + p.offset;
    const line = state.lyrics[i];
    const div = document.createElement('div');
    div.className = `k-line ${p.cls}`;
    div.textContent = line ? line.text : '\u00A0';
    if(line){
      div.addEventListener('click', () => resyncToLine(i));
    }
    el.karaokeLines.appendChild(div);
  });
  applyKaraokeFillAnimation(idx);
}

// タップされた行が「今まさに歌われている」ことにして、ズレ調整(offset)をその場で計算し直す
function resyncToLine(i){
  if(!state.player || !state.player.getCurrentTime) return;
  const line = state.lyrics[i];
  if(!line) return;
  const videoTime = state.player.getCurrentTime();
  let offset = (videoTime * state.karaokeRate) - line.time;

  const offsetMin = parseFloat(el.karaokeOffsetSlider.min);
  const offsetMax = parseFloat(el.karaokeOffsetSlider.max);
  offset = Math.min(offsetMax, Math.max(offsetMin, offset));

  state.karaokeOffset = Math.round(offset * 10) / 10;
  el.karaokeOffsetSlider.value = state.karaokeOffset;
  updateKaraokeOffsetDisplay();

  state.karaokeActiveIndex = i;
  renderKaraokeWindow(i);
  el.syncHint.textContent = `「${line.text}」に合わせました。`;
}

// 現在の行から次の行までの時間に合わせて、文字が色付いていくアニメーションの速さを設定する
function applyKaraokeFillAnimation(idx){
  const currentEl = el.karaokeLines.querySelector('.k-current');
  if(!currentEl || idx < 0){
    if(currentEl) currentEl.style.animation = 'none';
    return;
  }
  const current = state.lyrics[idx];
  const next = state.lyrics[idx + 1];
  let duration = next ? (next.time - current.time) / state.karaokeRate : 4;
  duration = Math.min(8, Math.max(1.2, duration));

  currentEl.style.animation = 'none';
  // 強制的にリフローさせてアニメーションを最初から再生させる
  void currentEl.offsetWidth;
  currentEl.style.animation = `karaokeFill ${duration}s linear forwards`;
}

// ---------- 歌詞の手動編集 ----------
el.editLyricsBtn.addEventListener('click', () => {
  el.manualLrcInput.value = '';
  el.lyricsEditModal.classList.remove('hidden');
});
el.lyricsEditClose.addEventListener('click', () => el.lyricsEditModal.classList.add('hidden'));
el.manualLrcApply.addEventListener('click', () => {
  const lines = parseLrc(el.manualLrcInput.value);
  if(!lines.length){
    alert('LRC形式を認識できませんでした。例: [00:12.50]歌詞の一行目');
    return;
  }
  stopKaraokeSyncLoop();
  applyLyrics(lines);
  el.lyricsEditModal.classList.add('hidden');
});

// ---------- ズレ調整 ----------
function updateKaraokeOffsetDisplay(){
  state.karaokeOffset = parseFloat(el.karaokeOffsetSlider.value);
  el.karaokeOffsetValue.textContent = `${state.karaokeOffset.toFixed(1)}秒`;
}
el.karaokeOffsetSlider.addEventListener('input', updateKaraokeOffsetDisplay);
el.karaokeOffsetSlider.addEventListener('change', updateKaraokeOffsetDisplay);

function updateKaraokeRateDisplay(){
  state.karaokeRate = parseFloat(el.karaokeRateSlider.value);
  el.karaokeRateValue.textContent = `${Math.round(state.karaokeRate * 100)}%`;
}
el.karaokeRateSlider.addEventListener('input', updateKaraokeRateDisplay);
el.karaokeRateSlider.addEventListener('change', updateKaraokeRateDisplay);

// ---------- タップで同期（2点計測して自動計算） ----------

function stepKaraokeOffset(delta){
  const min = parseFloat(el.karaokeOffsetSlider.min);
  const max = parseFloat(el.karaokeOffsetSlider.max);
  let next = Math.round((state.karaokeOffset + delta) * 10) / 10;
  next = Math.min(max, Math.max(min, next));
  el.karaokeOffsetSlider.value = next;
  updateKaraokeOffsetDisplay();
}
el.karaokeOffsetMinus.addEventListener('click', () => stepKaraokeOffset(-0.2));
el.karaokeOffsetPlus.addEventListener('click', () => stepKaraokeOffset(0.2));

// ---------- Init ----------
renderSearchHistory();
if(!state.apiKey){
  showStatus('はじめに右上の ⚙ からYouTube Data APIキーを設定してください。');
  openSettings();
}
