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
  pitchStats: { shakuri: 0, kobushi: 0, fall: 0, vibrato: 0 },
  currentSegment: -1,
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
  historyThumbSection: document.getElementById('history-thumb-section'),
  historyThumbGrid: document.getElementById('history-thumb-grid'),
  resultsHeading: document.getElementById('results-heading'),
  resultsList: document.getElementById('results-list'),
  statusMsg: document.getElementById('status-msg'),
  loadMore: document.getElementById('load-more'),

  karaokeView: document.getElementById('karaoke-view'),
  karaokeTitle: document.getElementById('karaoke-title'),
  karaokeArtist: document.getElementById('karaoke-artist'),
  karaokeStatus: document.getElementById('karaoke-status'),
  lyricCandidates: document.getElementById('lyric-candidates'),
  karaokeLines: document.getElementById('karaoke-lines'),
  pitchTrackBase: document.getElementById('pitch-track-base'),
  pitchTrackColor: document.getElementById('pitch-track-color'),
  pitchCursor: document.getElementById('pitch-cursor'),
  statShakuri: document.getElementById('stat-shakuri'),
  statKobushi: document.getElementById('stat-kobushi'),
  statFall: document.getElementById('stat-fall'),
  statVibrato: document.getElementById('stat-vibrato'),
  pitchSegments: document.getElementById('pitch-segments'),
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
  if(state.apiKey && el.historyThumbGrid && !el.historyThumbGrid.children.length){
    renderHistoryThumbnailGrid();
  }
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
  el.historyThumbSection.classList.add('hidden');
  el.resultsHeading.classList.remove('hidden');
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

// サムネイルのみを敷き詰めるタイルを作る（初期画面の「過去の検索から」用）
function buildThumbTile(v){
  const tile = document.createElement('div');
  tile.className = 'thumb-tile';
  tile.tabIndex = 0;
  tile.innerHTML = `
    <img src="${v.thumb}" alt="" loading="lazy">
    <div class="thumb-tile-title">${decodeHTML(v.title)}</div>
  `;
  const play = () => startKaraoke(v);
  tile.addEventListener('click', play);
  tile.addEventListener('keydown', e => { if(e.key === 'Enter') play(); });
  return tile;
}

// 初期画面に、過去の検索履歴からランダムに選んだ曲のサムネイルを敷き詰めて表示する
async function renderHistoryThumbnailGrid(){
  const history = getSearchHistory();
  if(!history.length || !state.apiKey) return;

  el.historyThumbSection.classList.remove('hidden');
  el.resultsHeading.classList.add('hidden');
  el.historyThumbGrid.innerHTML = '';
  showStatus('過去の検索から曲を読み込み中…');

  const picks = shuffleArray(history).slice(0, Math.min(6, history.length));
  const seen = new Set();
  const allTracks = [];

  for(const q of picks){
    const data = await ytFetch('search', {
      part: 'snippet', q, type: 'video', videoCategoryId: '10', maxResults: 6,
    });
    if(!data) continue;
    normalizeSearchResponse(data).forEach(v => {
      if(!seen.has(v.id)){
        seen.add(v.id);
        allTracks.push(v);
      }
    });
  }

  showStatus('');
  if(!allTracks.length) return;
  shuffleArray(allTracks).forEach(v => el.historyThumbGrid.appendChild(buildThumbTile(v)));
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
// 次に検索するキーワードを決める：現在の曲のアーティスト名か、過去の検索履歴からランダムに1つ（半々の確率）
function pickNextSearchQuery(currentArtist){
  const history = getSearchHistory();
  if(history.length && Math.random() < 0.5){
    const query = history[Math.floor(Math.random() * history.length)];
    return { query, fromHistory: true };
  }
  return { query: currentArtist, fromHistory: false };
}

async function playNextByArtist(){
  const current = state.currentList[state.currentIndex];
  if(!current) return;

  const { artist } = guessTrackInfo(current);
  if(!artist) return;

  const { query, fromHistory } = pickNextSearchQuery(artist);

  el.karaokeStatus.textContent = fromHistory
    ? `検索履歴「${query}」から次の曲を探しています…`
    : '次の曲を探しています…';

  const data = await ytFetch('search', {
    part: 'snippet',
    q: query,
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

// タイトルから、歌詞検索に使えそうな「曲名／アーティスト名」の組み合わせ候補をいくつか作る
function buildTitleCandidates(v){
  const rawTitle = decodeHTML(v.title);
  const channelArtist = decodeHTML(v.channel).replace(/\s*-\s*Topic$/i, '').trim();
  const channelArtistSimplified = channelArtist
    .replace(/(Official|オフィシャル|Music|チャンネル|Channel|TV|VEVO|Records?)\s*$/gi, '').trim();
  const variants = cleanTitleVariants(rawTitle);
  const separators = [' - ', ' – ', ' — ', '「', '『', '｜', '/', ' : ', '：', '~', '〜', '×', '・', '|'];

  const candidates = [];
  const pushCandidate = (track, artist) => {
    track = (track || '').trim();
    artist = (artist || '').trim();
    if(!track || track.length < 1) return;
    const key = `${artist}::${track}`.toLowerCase();
    if(candidates.some(c => c.key === key)) return;
    candidates.push({ key, track, artist, label: artist ? `${track} / ${artist}` : track });
  };

  // ① 区切り文字ごとに分割し、通常パターン・逆パターン・末尾のみを候補にする
  variants.forEach(t => {
    let matchedSep = false;
    for(const sep of separators){
      if(t.includes(sep)){
        const parts = t.split(sep).map(p => p.trim()).filter(Boolean);
        if(parts.length >= 2){
          const left = parts[0];
          const rest = parts.slice(1).join(' ').replace(/[」』]/g, '').trim();
          pushCandidate(rest, left);              // 想定どおり：アーティスト名 - 曲名
          pushCandidate(left, rest);              // 逆パターン：曲名 - アーティスト名
          pushCandidate(parts[parts.length - 1], left); // 区切りが複数ある場合、末尾だけを曲名として試す
          matchedSep = true;
        }
      }
    }
    if(!matchedSep){
      pushCandidate(t, channelArtist);
      pushCandidate(t, channelArtistSimplified);
      pushCandidate(t, '');
    }
  });

  // ② 括弧の中身も、副題やアーティスト名の可能性があるため候補に加える
  const bracketMatches = [...rawTitle.matchAll(/[\(（\[［]([^\)）\]］]+)[\)）\]］]/g)];
  bracketMatches.forEach(m => {
    const inner = m[1].trim();
    if(inner.length >= 2 && inner.length <= 30 && !/official|video|mv|lyric|audio/i.test(inner)){
      pushCandidate(inner, channelArtist);
      pushCandidate(inner, '');
    }
  });

  // ③ 区切りが無い場合、単語（スペース区切り）ごとに「前半をアーティスト・後半を曲名」と仮定して分解する
  const baseWords = variants[variants.length - 1].split(/\s+/).filter(Boolean);
  if(baseWords.length >= 2 && baseWords.length <= 8){
    for(let i = 1; i < baseWords.length; i++){
      pushCandidate(baseWords.slice(i).join(' '), baseWords.slice(0, i).join(' '));
    }
  }

  // ④ 最後の保険：タイトルそのまま
  pushCandidate(rawTitle, channelArtist);
  pushCandidate(rawTitle, '');

  return candidates.slice(0, 14);
}

// 候補チップを表示する
function renderLyricCandidates(v){
  if(!el.lyricCandidates) return;
  el.lyricCandidates.innerHTML = '';
  const candidates = buildTitleCandidates(v);
  if(!candidates.length) return;

  const label = document.createElement('div');
  label.className = 'lyric-candidates-label';
  label.textContent = '近そうなものをタップして再検索できます:';
  el.lyricCandidates.appendChild(label);

  const row = document.createElement('div');
  row.className = 'lyric-candidates-chips';
  candidates.forEach(c => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lyric-candidate-chip';
    chip.textContent = c.label;
    chip.title = c.label;
    chip.addEventListener('click', () => tryLyricCandidate(c, chip));
    row.appendChild(chip);
  });
  el.lyricCandidates.appendChild(row);
}

// 候補チップがタップされたら、その組み合わせで歌詞を再検索し、見つかれば適用する
async function tryLyricCandidate(candidate, chipEl){
  chipEl.disabled = true;
  const originalLabel = chipEl.textContent;
  chipEl.textContent = `${candidate.label}（検索中…）`;

  let lrc = candidate.artist ? await fetchLyricsFromLrclib(candidate.track, candidate.artist) : null;
  if(!lrc){
    const q = candidate.artist ? `${candidate.artist} ${candidate.track}` : candidate.track;
    lrc = await fetchLyricsFromLrclibFreeText(q);
  }

  if(lrc){
    el.lyricCandidates.innerHTML = '';
    applyLyrics(parseLrc(lrc));
    el.karaokeStatus.textContent = `「${candidate.label}」の歌詞を適用しました。`;
  } else {
    chipEl.disabled = false;
    chipEl.textContent = `${originalLabel}（見つかりませんでした）`;
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
  state.calibrationTaps = [];
  state.currentVideoForLyrics = v;
  el.syncHint.textContent = '同じアーティストの曲を自動的に流し続けます';
  el.karaokeLines.innerHTML = '';
  el.karaokeStatus.textContent = '歌詞を検索中…';
  if(el.lyricCandidates) el.lyricCandidates.innerHTML = '';

  state.pitchStats = { shakuri: 0, kobushi: 0, fall: 0, vibrato: 0 };
  state.currentSegment = -1;
  el.statShakuri.textContent = '0';
  el.statKobushi.textContent = '0';
  el.statFall.textContent = '0';
  el.statVibrato.textContent = '0';
  if(el.pitchSegments) el.pitchSegments.querySelectorAll('.seg').forEach(s => s.classList.remove('is-current'));
  if(el.pitchTrackBase) el.pitchTrackBase.innerHTML = '';
  if(el.pitchTrackColor) el.pitchTrackColor.innerHTML = '';
  if(el.pitchCursor){ el.pitchCursor.style.transition = 'none'; el.pitchCursor.style.left = '0%'; }
  if(el.pitchTrackColor){ el.pitchTrackColor.style.transition = 'none'; el.pitchTrackColor.style.clipPath = 'inset(0 100% 0 0)'; }

  const result = await findLyricsWithFallback(v);
  if(!result.lrc){
    el.karaokeStatus.textContent = `歌詞が見つかりませんでした（検索語: ${result.usedArtist} / ${result.usedTrack}）。下の候補をタップするか、「✎ 歌詞を編集」から手動で貼り付けることもできます。`;
    renderLyricCandidates(v);
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
  updatePitchSegment();
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

    if(p.cls === 'k-current'){
      const wrap = document.createElement('div');
      wrap.className = 'k-current-wrap';
      const div = document.createElement('div');
      div.className = `k-line ${p.cls}`;
      div.textContent = line ? line.text : '\u00A0';
      if(line) div.addEventListener('click', () => resyncToLine(i));
      wrap.appendChild(div);

      if(line){
        const sparkles = document.createElement('div');
        sparkles.className = 'k-sparkles';
        sparkles.innerHTML = '<span>✦</span>'.repeat(8);
        wrap.appendChild(sparkles);
      }
      el.karaokeLines.appendChild(wrap);
      return;
    }

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

  // 音程バー（演出用）：行が変わるたびに左端からやり直し、その行が終わるタイミングで右端まで進む
  const bumpedKey = bumpPitchStats();
  regeneratePitchTrack(bumpedKey);
  movePitchCursor(duration);
}

const TECHNIQUE_ICONS = {
  shakuri:  { symbol: '⟋',  color: '#ffb347' }, // しゃくり
  kobushi:  { symbol: '◐',  color: '#5ecbff' }, // こぶし
  fall:     { symbol: '⌒',  color: '#d68cff' }, // フォール
  vibrato:  { symbol: '〰', color: '#7be07b' }, // ビブラート
};

// 派手なレインボーのキラキラ（星）のクラスターを1つ作る
const SPARKLE_COLORS = ['#ff5e6c', '#ff9f4d', '#ffe066', '#8cff8c', '#5ecbff', '#8c9dff', '#d68cff', '#ffffff'];
const SPARKLE_GLYPHS = ['✦', '✧', '⋆', '✶'];
function buildSparkleCluster(){
  const cluster = document.createElement('span');
  cluster.className = 'pitch-sparkle-cluster';
  const starCount = 5 + Math.floor(Math.random() * 4); // 5〜8個
  for(let s = 0; s < starCount; s++){
    const star = document.createElement('i');
    star.textContent = SPARKLE_GLYPHS[Math.floor(Math.random() * SPARKLE_GLYPHS.length)];
    star.style.color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
    star.style.left = `${Math.round(Math.random() * 40 - 4)}px`;
    star.style.top = `${Math.round(Math.random() * 30 - 14)}px`;
    star.style.fontSize = `${10 + Math.round(Math.random() * 8)}px`;
    star.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`;
    star.style.animationDuration = `${(1.1 + Math.random() * 1.1).toFixed(2)}s`;
    cluster.appendChild(star);
  }
  return cluster;
}

// 演出用の「音程バー」の見た目をランダムに生成する（実際の音程データではない）
function regeneratePitchTrack(bumpedKey){
  if(!el.pitchTrackBase || !el.pitchTrackColor) return;
  el.pitchTrackBase.innerHTML = '';
  el.pitchTrackColor.innerHTML = '';
  const colors = ['', 'c-green', 'c-pink', 'c-blue'];
  const pillCount = 34 + Math.floor(Math.random() * 16);

  // ところどころに空白（フレーズの切れ目）を入れる位置を決める
  const gapPositions = new Set();
  const gapCount = 2 + Math.floor(Math.random() * 2);
  for(let i = 0; i < gapCount; i++) gapPositions.add(2 + Math.floor(Math.random() * (pillCount - 4)));

  // アイコン（しゃくり・こぶし・フォール・ビブラート）を、ところどころに複数配置する位置を決める
  const techniqueKeys = Object.keys(TECHNIQUE_ICONS);
  const iconPositions = new Map();
  const iconCount = 2 + Math.floor(Math.random() * 3); // 2〜4個
  for(let n = 0; n < iconCount; n++){
    const idx = 2 + Math.floor(Math.random() * (pillCount - 4));
    if(gapPositions.has(idx)) continue;
    const key = (n === 0 && bumpedKey) ? bumpedKey : techniqueKeys[Math.floor(Math.random() * techniqueKeys.length)];
    iconPositions.set(idx, key);
  }

  // レインボーのキラキラを付与する箇所を、ところどころに複数決める（かなり多め・派手に）
  const sparklePositions = new Set();
  const sparkleRatio = 0.5 + Math.random() * 0.25; // ブロックの50〜75%程度に付与
  for(let i = 0; i < pillCount; i++){
    if(!gapPositions.has(i) && Math.random() < sparkleRatio) sparklePositions.add(i);
  }

  // 階段状の高さレベルを作る：同じ高さがしばらく続き（直線区間）、時々上下にジャンプする
  const levelCount = 6;
  const maxOffsetPx = 62;
  let level = Math.floor(levelCount / 2);
  let runLength = 3 + Math.floor(Math.random() * 3);

  for(let i = 0; i < pillCount; i++){
    if(runLength <= 0){
      const stay = Math.random() < 0.3;
      if(!stay){
        const jump = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
        level = Math.min(levelCount - 1, Math.max(0, level + jump));
      }
      runLength = 2 + Math.floor(Math.random() * 4);
    }
    runLength--;

    const isGap = gapPositions.has(i);
    const flex = isGap ? '0.6 1 auto' : `${(1 + Math.random() * 0.7).toFixed(2)} 1 auto`;
    const marginTop = isGap ? '0' : `${Math.round((level / (levelCount - 1)) * maxOffsetPx)}px`;
    const colorClass = (!isGap && Math.random() >= 0.8) ? colors[Math.floor(Math.random() * colors.length)] : '';

    // 同じ形状・同じ高さのブロックを、グレー版とカラー版の両方に同一データで生成する
    const basePill = document.createElement('div');
    basePill.className = `pitch-pill ${isGap ? 'is-gap' : ''}`;
    basePill.style.flex = flex;
    basePill.style.marginTop = marginTop;

    const colorPill = document.createElement('div');
    colorPill.className = `pitch-pill ${isGap ? 'is-gap' : colorClass}`;
    colorPill.style.flex = flex;
    colorPill.style.marginTop = marginTop;

    // アイコンは「通過済み」を示すカラー側のブロックに付与し、縦線が通り過ぎたときだけ見えるようにする
    if(iconPositions.has(i)){
      const icon = document.createElement('span');
      const meta = TECHNIQUE_ICONS[iconPositions.get(i)];
      icon.className = 'pitch-icon';
      icon.textContent = meta.symbol;
      icon.style.color = meta.color;
      icon.style.left = '50%';
      colorPill.appendChild(icon);
    }

    // レインボーのキラキラも同様に、通過済みブロックにのみ付与する（多め・派手に）
    if(!isGap && sparklePositions.has(i)){
      colorPill.appendChild(buildSparkleCluster());
    }

    el.pitchTrackBase.appendChild(basePill);
    el.pitchTrackColor.appendChild(colorPill);
  }
}

// 音程バーのカーソルと、通過後に残る虹色のキラキラの軌跡を、行の長さに合わせて左端から右端まで動かす
function movePitchCursor(duration){
  if(!el.pitchCursor || !el.pitchTrackColor) return;
  el.pitchCursor.style.transition = 'none';
  el.pitchTrackColor.style.transition = 'none';
  el.pitchCursor.style.left = '0%';
  el.pitchTrackColor.style.clipPath = 'inset(0 100% 0 0)';
  void el.pitchCursor.offsetWidth; // 強制リフロー
  el.pitchCursor.style.transition = `left ${duration}s linear`;
  el.pitchTrackColor.style.transition = `clip-path ${duration}s linear`;
  el.pitchCursor.style.left = '100%';
  el.pitchTrackColor.style.clipPath = 'inset(0 0% 0 0)';
}

// しゃくり・こぶし・フォール・ビブラートのカウンターを、行が変わるたびに演出としてランダムに増やす。
// 増えた項目のキー（無い場合はnull）を返す（アイコン表示に使う）
function bumpPitchStats(){
  const keys = ['shakuri', 'kobushi', 'fall', 'vibrato'];
  if(Math.random() >= 0.6) return null;
  const key = keys[Math.floor(Math.random() * keys.length)];
  state.pitchStats[key]++;
  const elMap = { shakuri: el.statShakuri, kobushi: el.statKobushi, fall: el.statFall, vibrato: el.statVibrato };
  elMap[key].textContent = state.pitchStats[key];
  return key;
}

// 曲全体の再生位置から「演奏区間」（1〜6）をハイライトする（演出用）
function updatePitchSegment(){
  if(!el.pitchSegments || !state.player || !state.player.getDuration) return;
  const total = state.player.getDuration();
  if(!total) return;
  const t = state.player.getCurrentTime();
  const seg = Math.min(5, Math.floor((t / total) * 6));
  if(seg === state.currentSegment) return;
  state.currentSegment = seg;
  el.pitchSegments.querySelectorAll('.seg').forEach(s => {
    s.classList.toggle('is-current', parseInt(s.dataset.n, 10) === seg + 1);
  });
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
  if(el.lyricCandidates) el.lyricCandidates.innerHTML = '';
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
} else {
  renderHistoryThumbnailGrid();
}
