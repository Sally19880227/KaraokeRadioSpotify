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
  calibrationTaps: [],
  bgTimer: null,
  bgActiveLayer: 'a',
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
  stopBackgroundSlideshow();
}
function showKaraokeView(){
  el.resultsView.classList.add('hidden');
  el.karaokeView.classList.remove('hidden');
  startBackgroundSlideshow();
}
el.backToSearchBtn.addEventListener('click', showResultsView);

// ---------- 背景の風景写真スライドショー（Picsum Photos / APIキー不要） ----------
const SCENIC_PHOTO_IDS = [1015, 1018, 1019, 1021, 1024, 1035, 1036, 1039, 1043, 1044, 1047, 1049, 1053, 1056, 1057, 1060, 1063, 1067, 1080];
let bgOrder = shuffleArray(SCENIC_PHOTO_IDS);
let bgPos = 0;

function shuffleArray(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextBackgroundPhoto(){
  if(bgPos >= bgOrder.length){
    bgOrder = shuffleArray(SCENIC_PHOTO_IDS);
    bgPos = 0;
  }
  const id = bgOrder[bgPos++];
  const url = `https://picsum.photos/id/${id}/1600/900`;

  // 先読みしてから切り替えることで、読み込み中の空白を防ぐ
  const img = new Image();
  img.onload = () => {
    const activeIsA = state.bgActiveLayer !== 'b';
    const nextEl = document.getElementById(activeIsA ? 'bg-layer-b' : 'bg-layer-a');
    const prevEl = document.getElementById(activeIsA ? 'bg-layer-a' : 'bg-layer-b');
    nextEl.style.backgroundImage = `url('${url}')`;
    nextEl.classList.add('is-active');
    prevEl.classList.remove('is-active');
    state.bgActiveLayer = activeIsA ? 'b' : 'a';
  };
  img.src = url;
}

function startBackgroundSlideshow(){
  nextBackgroundPhoto();
  stopBackgroundSlideshow();
  state.bgTimer = setInterval(nextBackgroundPhoto, 20000);
}
function stopBackgroundSlideshow(){
  if(state.bgTimer) clearInterval(state.bgTimer);
  state.bgTimer = null;
}

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
// 動画タイトルから、歌詞検索に使う「素の曲名」を作る。
// ライブ・カバー・リミックスなどの付記を段階的に取り除けるよう、複数バージョンを返す。
function cleanTitleVariants(rawTitle){
  let base = rawTitle
    .replace(/\(Official.*?\)|\[Official.*?\]|\(MV\)|\[MV\]|Official Music Video|Official Video|Lyric Video|Music Video|\bMV\b/gi, '')
    .trim();

  // 括弧内の補足（Live, Remix, Cover等）を除いたバージョン
  const noBrackets = base.replace(/[（(].*?[）)]|[［\[].*?[］\]]/g, '').trim();

  // ライブ・カバー・リミックス等を示す語自体を取り除いたバージョン（括弧の外にある場合にも対応）
  const versionWords = /(live|acoustic|remix|cover|instrumental|karaoke|session|ver\.?|version|tour|concert|弾き語り|ライブ|生歌|アコースティック|カバー|リミックス)/gi;
  const noVersionWords = noBrackets.replace(versionWords, '').replace(/[-–—]\s*$/, '').trim();

  return [...new Set([base, noBrackets, noVersionWords].filter(Boolean))];
}

function guessTrackInfo(v){
  const rawTitle = decodeHTML(v.title);
  const variants = cleanTitleVariants(rawTitle);
  const primaryTitle = variants[0];

  const separators = [' - ', ' – ', ' — ', '「', '『', '｜', '/'];
  for(const sep of separators){
    if(primaryTitle.includes(sep)){
      const parts = primaryTitle.split(sep);
      if(parts.length >= 2){
        const artist = parts[0].trim();
        const track = parts.slice(1).join(sep).replace(/[」』]/g, '').trim();
        return {
          artist,
          track,
          trackVariants: variants.map(t => {
            const p = t.split(sep);
            return p.length >= 2 ? p.slice(1).join(sep).replace(/[」』]/g, '').trim() : t;
          }),
        };
      }
    }
  }
  const artist = decodeHTML(v.channel).replace(/\s*-\s*Topic$/i, '').trim();
  return { artist, track: primaryTitle, trackVariants: variants };
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

// LRCLIBの自由入力検索（q）で、曲名だけの緩い条件で探す最終手段
async function fetchLyricsFromLrclibFreeText(query){
  const url = new URL('https://lrclib.net/api/search');
  url.searchParams.set('q', query);
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

// ライブ版・カバー版などで見つからない場合に備え、条件を段階的に緩めながら歌詞を探す
async function findLyricsWithFallback(v){
  const { artist, track, trackVariants } = guessTrackInfo(v);
  const triedTracks = trackVariants && trackVariants.length ? trackVariants : [track];

  // ① 曲名の各バージョン（そのまま → 括弧除去 → Live/Cover等の語も除去）× アーティスト名で順に試す
  for(const t of triedTracks){
    const lrc = await fetchLyricsFromLrclib(t, artist);
    if(lrc) return { lrc, usedTrack: t, usedArtist: artist };
  }

  // ② 一番シンプルにした曲名で、アーティスト名の自由入力検索を試す
  const simplestTrack = triedTracks[triedTracks.length - 1];
  const freeLrc = await fetchLyricsFromLrclibFreeText(`${artist} ${simplestTrack}`);
  if(freeLrc) return { lrc: freeLrc, usedTrack: simplestTrack, usedArtist: artist };

  return { lrc: null, usedTrack: simplestTrack, usedArtist: artist };
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
  state.calibrationTaps = [];
  state.currentVideoForLyrics = v;
  el.syncHint.textContent = '同じアーティストの曲を自動的に流し続けます';
  el.karaokeLines.innerHTML = '';
  el.karaokeStatus.textContent = '歌詞を検索中…';

  const result = await findLyricsWithFallback(v);
  if(!result.lrc){
    el.karaokeStatus.textContent = `歌詞が見つかりませんでした（検索語: ${result.usedArtist} / ${result.usedTrack}）。「✎ 歌詞を編集」から手動で貼り付けることもできます。`;
    return;
  }
  applyLyrics(parseLrc(result.lrc));
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

// タップされた行が「今まさに歌われている」ことにして同期し直す。
// タップ履歴が2点以上たまり、かつ十分に離れていれば、速度(rate)とズレ(offset)を
// 最小二乗法でまとめて自動計算する。1点しかない場合はズレだけをその場で合わせる。
function resyncToLine(i){
  if(!state.player || !state.player.getCurrentTime) return;
  const line = state.lyrics[i];
  if(!line) return;
  const videoTime = state.player.getCurrentTime();

  state.calibrationTaps.push({ videoTime, lyricTime: line.time });
  if(state.calibrationTaps.length > 10) state.calibrationTaps.shift();

  const times = state.calibrationTaps.map(p => p.videoTime);
  const spread = Math.max(...times) - Math.min(...times);

  if(state.calibrationTaps.length >= 2 && spread >= 5){
    const fit = computeLinearFit(state.calibrationTaps);
    applyRateAndOffset(fit.rate, fit.offset);
    el.syncHint.textContent = `タップ履歴（${state.calibrationTaps.length}点）から速度とズレを自動調整しました（速度: ${Math.round(state.karaokeRate*100)}% / ズレ: ${state.karaokeOffset.toFixed(1)}秒）`;
  } else {
    const offset = (videoTime * state.karaokeRate) - line.time;
    applyRateAndOffset(state.karaokeRate, offset);
    el.syncHint.textContent = `「${line.text}」に合わせました。曲が進んでからもう一度タップすると、速度も自動調整されます。`;
  }

  state.karaokeActiveIndex = i;
  renderKaraokeWindow(i);
}

// 記録したタップ（動画時間 × 歌詞時間）の点群から、最小二乗法で速度(rate)とズレ(offset)を求める
function computeLinearFit(points){
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  points.forEach(p => {
    sumX += p.videoTime; sumY += p.lyricTime;
    sumXY += p.videoTime * p.lyricTime; sumXX += p.videoTime * p.videoTime;
  });
  const denom = n * sumXX - sumX * sumX;
  if(Math.abs(denom) < 1e-6){
    return { rate: state.karaokeRate, offset: state.karaokeOffset };
  }
  const rate = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - rate * sumX) / n;
  return { rate, offset: -intercept };
}

// 速度・ズレをスライダーの範囲内に収めつつ反映する
function applyRateAndOffset(rate, offset){
  const rateMin = parseFloat(el.karaokeRateSlider.min);
  const rateMax = parseFloat(el.karaokeRateSlider.max);
  const offsetMin = parseFloat(el.karaokeOffsetSlider.min);
  const offsetMax = parseFloat(el.karaokeOffsetSlider.max);

  state.karaokeRate = Math.round(Math.min(rateMax, Math.max(rateMin, rate)) * 1000) / 1000;
  state.karaokeOffset = Math.round(Math.min(offsetMax, Math.max(offsetMin, offset)) * 10) / 10;

  el.karaokeRateSlider.value = state.karaokeRate;
  el.karaokeOffsetSlider.value = state.karaokeOffset;
  updateKaraokeRateDisplay();
  updateKaraokeOffsetDisplay();
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
