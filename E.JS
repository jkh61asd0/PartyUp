const STORAGE_KEY = "partyup-state-v3";
const ADMIN_CODE = "1234";

function sharedApiUrls() {
  if (window.location.protocol === "file:") return [];
  const urls = ["/api/state"];
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (isLocalHost && window.location.port !== "3000") {
    urls.push(`${window.location.protocol}//${window.location.hostname}:3000/api/state`);
  }
  return [...new Set(urls)];
}

const SHARED_API_URLS = sharedApiUrls();

const games = ["리그 오브 레전드", "발로란트", "오버워치 2", "배틀그라운드", "로스트아크", "메이플스토리"];

const initialState = {
  isLoggedIn: false,
  isAdmin: false,
  settings: {
    theme: "system",
    density: "comfortable",
    autoScrollChat: true,
    boardSort: "newest",
    chatDisplay: "comfortable",
    soundCue: false
  },
  me: {
    nickname: "",
    status: "온라인 · 매칭 가능",
    gender: "비공개",
    age: "",
    mainGame: "리그 오브 레전드",
    mic: true,
    bio: ""
  },
  selectedFriendId: "",
  selectedBoardGame: "리그 오브 레전드",
  selectedThreadId: "",
  editingBoardPostId: "",
  currentRoomId: "",
  micOn: true,
  micAllowed: false,
  blocked: [],
  reports: [],
  bans: [],
  recruits: [],
  rooms: {},
  deletedRecruitIds: [],
  deletedRoomIds: [],
  deletedBoardPostIds: [],
  deletedCommentIds: [],
  deletedReportIds: [],
  deletedBanIds: [],
  friendRequests: [],
  friendships: [],
  directMessages: {},
  friends: [],
  dms: {},
  boardPosts: [],
  lobbyMessages: [],
  room: {
    recruitId: "",
    title: "내 파티 방",
    intro: "",
    owner: "",
    mode: "자유 입장",
    password: "",
    participants: [],
    messages: []
  }
};

let state = loadState();
let sharedApiUrl = SHARED_API_URLS[0] || "";
let sharedStateLoaded = !SHARED_API_URLS.length;
let sharedSaveTimer = 0;
let sharedSyncTimer = 0;
let sharedLoadInFlight = false;
let sharedSaveInFlight = false;
let sharedSaveQueued = false;
let sharedMutationVersion = 0;
let sharedSaveRetryDelay = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...clone(initialState), ...saved } : clone(initialState);
  } catch {
    return clone(initialState);
  }
}

function saveState(syncShared = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (syncShared) saveSharedState();
}

function sharedStatePayload() {
  return {
    recruits: state.recruits,
    rooms: state.rooms,
    deletedRecruitIds: state.deletedRecruitIds,
    deletedRoomIds: state.deletedRoomIds,
    deletedBoardPostIds: state.deletedBoardPostIds,
    deletedCommentIds: state.deletedCommentIds,
    deletedReportIds: state.deletedReportIds,
    deletedBanIds: state.deletedBanIds,
    friendRequests: state.friendRequests,
    friendships: state.friendships,
    directMessages: state.directMessages,
    boardPosts: state.boardPosts,
    lobbyMessages: state.lobbyMessages,
    reports: state.reports,
    bans: state.bans
  };
}

function applySharedState(data) {
  if (!data || typeof data !== "object") return;
  const previousLobbyId = state.lobbyMessages.at(-1)?.id || "";
  if (Array.isArray(data.recruits)) state.recruits = data.recruits;
  state.rooms = data.rooms && typeof data.rooms === "object" && !Array.isArray(data.rooms) ? data.rooms : {};
  if (Array.isArray(data.deletedRecruitIds)) state.deletedRecruitIds = data.deletedRecruitIds;
  if (Array.isArray(data.deletedRoomIds)) state.deletedRoomIds = data.deletedRoomIds;
  if (Array.isArray(data.deletedBoardPostIds)) state.deletedBoardPostIds = data.deletedBoardPostIds;
  if (Array.isArray(data.deletedCommentIds)) state.deletedCommentIds = data.deletedCommentIds;
  if (Array.isArray(data.deletedReportIds)) state.deletedReportIds = data.deletedReportIds;
  if (Array.isArray(data.deletedBanIds)) state.deletedBanIds = data.deletedBanIds;
  if (Array.isArray(data.friendRequests)) state.friendRequests = data.friendRequests;
  if (Array.isArray(data.friendships)) state.friendships = data.friendships;
  state.directMessages = data.directMessages && typeof data.directMessages === "object" && !Array.isArray(data.directMessages) ? data.directMessages : {};
  if (Array.isArray(data.boardPosts)) state.boardPosts = data.boardPosts;
  if (Array.isArray(data.lobbyMessages)) state.lobbyMessages = data.lobbyMessages;
  if (Array.isArray(data.reports)) state.reports = data.reports;
  if (Array.isArray(data.bans)) state.bans = data.bans;
  normalizeBoardPosts();
  normalizeLobbyMessages();
  normalizeFriendData();
  normalizeAdminData();
  syncCurrentRoomFromShared();
  const nextLobbyMessage = state.lobbyMessages.at(-1);
  if (sharedStateLoaded && currentSettings().soundCue && nextLobbyMessage?.id !== previousLobbyId && nextLobbyMessage?.from !== displayName()) {
    playSoundCue();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function blankRoom() {
  return { ...clone(initialState.room), participants: [displayName()] };
}

function normalizeRoom(room = {}) {
  return {
    ...clone(initialState.room),
    ...room,
    participantStatus: room.participantStatus && typeof room.participantStatus === "object" && !Array.isArray(room.participantStatus) ? room.participantStatus : {},
    participants: Array.isArray(room.participants) ? [...new Set(room.participants.filter(Boolean))] : [],
    removedParticipants: Array.isArray(room.removedParticipants) ? [...new Set(room.removedParticipants.filter(Boolean))] : [],
    kicked: Array.isArray(room.kicked) ? [...new Set(room.kicked.filter(Boolean))] : [],
    messages: Array.isArray(room.messages) ? room.messages.slice(-300) : []
  };
}

function syncCurrentRoomFromShared() {
  state.rooms = state.rooms && typeof state.rooms === "object" && !Array.isArray(state.rooms) ? state.rooms : {};
  state.deletedRecruitIds = Array.isArray(state.deletedRecruitIds) ? state.deletedRecruitIds : [];
  state.deletedRoomIds = Array.isArray(state.deletedRoomIds) ? state.deletedRoomIds : [];
  state.deletedBoardPostIds = Array.isArray(state.deletedBoardPostIds) ? state.deletedBoardPostIds : [];
  state.deletedCommentIds = Array.isArray(state.deletedCommentIds) ? state.deletedCommentIds : [];
  state.deletedReportIds = Array.isArray(state.deletedReportIds) ? state.deletedReportIds : [];
  state.deletedBanIds = Array.isArray(state.deletedBanIds) ? state.deletedBanIds : [];
  if (!state.currentRoomId) return;
  const sharedRoom = state.rooms[state.currentRoomId];
  const recruit = state.recruits.find((item) => item.id === state.currentRoomId);
  if (!sharedRoom && !recruit) {
    state.currentRoomId = "";
    state.room = blankRoom();
    return;
  }
  if (sharedRoom) {
    state.room = normalizeRoom(sharedRoom);
    if (state.room.kicked.includes(displayName())) {
      state.currentRoomId = "";
      state.room = blankRoom();
      showToast("방에서 강퇴되었습니다.");
    }
  }
}

function currentSharedRoom() {
  if (!state.currentRoomId) return null;
  state.rooms = state.rooms && typeof state.rooms === "object" && !Array.isArray(state.rooms) ? state.rooms : {};
  const room = normalizeRoom(state.rooms[state.currentRoomId] || state.room);
  room.recruitId = state.currentRoomId;
  state.rooms[state.currentRoomId] = room;
  state.room = room;
  return room;
}

function updateSharedRoom(mutator) {
  const room = currentSharedRoom();
  if (!room) return null;
  mutator(room);
  state.rooms[state.currentRoomId] = normalizeRoom(room);
  state.room = state.rooms[state.currentRoomId];
  return state.room;
}

async function waitForSharedLoad() {
  const startedAt = Date.now();
  while (sharedLoadInFlight && Date.now() - startedAt < 5000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function loadSharedState(silent = false) {
  if (!SHARED_API_URLS.length) return;
  if (sharedSaveTimer || sharedSaveInFlight || sharedSaveQueued) return;
  if (sharedLoadInFlight) return;
  const loadMutationVersion = sharedMutationVersion;
  sharedLoadInFlight = true;
  for (const url of SHARED_API_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Shared state request failed");
      sharedApiUrl = url;
      const nextSharedState = await response.json();
      sharedStateLoaded = true;
      if (loadMutationVersion !== sharedMutationVersion || sharedSaveTimer || sharedSaveInFlight || sharedSaveQueued) {
        sharedLoadInFlight = false;
        return;
      }
      applySharedState(nextSharedState);
      renderAll(false);
      sharedLoadInFlight = false;
      return;
    } catch {
      sharedStateLoaded = false;
    }
  }
  sharedLoadInFlight = false;
  if (!silent) showToast("공유 서버에 연결할 수 없어 이 브라우저에만 저장됩니다.");
}

function startSharedSync() {
  if (!SHARED_API_URLS.length || sharedSyncTimer) return;
  sharedSyncTimer = window.setInterval(() => loadSharedState(true), 2000);
}

function saveSharedState() {
  if (!sharedApiUrl || !sharedStateLoaded) return;
  sharedSaveQueued = true;
  sharedMutationVersion += 1;
  window.clearTimeout(sharedSaveTimer);
  sharedSaveTimer = window.setTimeout(async () => {
    sharedSaveTimer = 0;
    if (sharedSaveInFlight) {
      saveSharedState();
      return;
    }
    sharedSaveInFlight = true;
    sharedSaveQueued = false;
    const saveMutationVersion = sharedMutationVersion;
    try {
      const response = await fetch(sharedApiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sharedStatePayload())
      });
      const nextSharedState = response.ok ? await response.json() : null;
      if (nextSharedState && saveMutationVersion === sharedMutationVersion && !sharedSaveQueued) {
        applySharedState(nextSharedState);
      }
    } catch {
      sharedSaveQueued = true;
      sharedSaveRetryDelay = 1000;
      showToast("공유 서버 저장에 실패했습니다.");
    } finally {
      sharedSaveInFlight = false;
      if (sharedSaveQueued) {
        const retryDelay = sharedSaveRetryDelay;
        sharedSaveRetryDelay = 0;
        if (retryDelay) {
          window.setTimeout(() => saveSharedState(), retryDelay);
        } else {
          saveSharedState();
        }
      }
    }
  }, 250);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function ageLabel(age) {
  return age === "40" ? "40대 이상" : `${age}대`;
}

function micLabel(mic) {
  return mic ? "마이크 사용" : "마이크 미사용";
}

function fillGameSelect(select, includeAll = false) {
  select.innerHTML = `${includeAll ? '<option value="">전체</option>' : ""}${games
    .map((game) => `<option>${escapeHtml(game)}</option>`)
    .join("")}`;
}

function setView(view) {
  $$(".view").forEach((node) => node.classList.remove("active"));
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  $(`#${view}View`).classList.add("active");
  const titles = {
    recruit: "모집 화면",
    create: "모집 글 작성",
    friends: "친구",
    board: "게임별 게시판",
    lobby: "전체 채팅",
    room: "방",
    safety: "신고 및 차단",
    admin: "관리자",
    profile: "프로필 설정",
    settings: "설정",
    boardEditor: "게시글 작성",
    roomSettings: "방 설정"
  };
  $("#viewTitle").textContent = titles[view];
}

function displayName() {
  return state.me.nickname || "게스트";
}

function currentSettings() {
  state.settings = { ...clone(initialState.settings), ...(state.settings || {}) };
  return state.settings;
}

function friendPairKey(a, b) {
  return [a, b].map((name) => String(name || "").trim()).sort((left, right) => left.localeCompare(right, "ko-KR")).join("::");
}

function normalizeFriendData() {
  state.friendRequests = Array.isArray(state.friendRequests) ? state.friendRequests : [];
  state.friendships = Array.isArray(state.friendships) ? state.friendships : [];
  state.directMessages = state.directMessages && typeof state.directMessages === "object" && !Array.isArray(state.directMessages) ? state.directMessages : {};

  state.friendRequests.forEach((request) => {
    if (!request.id) request.id = `fr${Date.now()}${Math.random().toString(16).slice(2)}`;
    if (!request.status) request.status = "대기";
    if (!request.createdAt) request.createdAt = new Date().toISOString();
  });
  state.friendships.forEach((friendship) => {
    if (!friendship.id) friendship.id = `fs${Date.now()}${Math.random().toString(16).slice(2)}`;
    friendship.users = Array.isArray(friendship.users) ? [...new Set(friendship.users.filter(Boolean))] : [];
    if (!friendship.createdAt) friendship.createdAt = new Date().toISOString();
  });
  Object.keys(state.directMessages).forEach((key) => {
    state.directMessages[key] = Array.isArray(state.directMessages[key]) ? state.directMessages[key].slice(-300) : [];
    state.directMessages[key].forEach((message) => {
      if (!message.id) message.id = `dm${Date.now()}${Math.random().toString(16).slice(2)}`;
      if (!message.createdAt) message.createdAt = new Date().toISOString();
    });
  });
}

function friendshipWith(nickname) {
  const me = displayName();
  return state.friendships.find((friendship) => !friendship.deletedAt && friendship.users.includes(me) && friendship.users.includes(nickname));
}

function friendNicknames() {
  const me = displayName();
  return state.friendships
    .filter((friendship) => !friendship.deletedAt && friendship.users.includes(me))
    .map((friendship) => friendship.users.find((nickname) => nickname !== me))
    .filter(Boolean);
}

function applySettings() {
  const settings = currentSettings();
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  document.documentElement.dataset.theme = theme;
  document.body.dataset.density = settings.density;
  document.body.dataset.chatDisplay = settings.chatDisplay;
}

function playSoundCue() {
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 740;
    gain.gain.value = 0.03;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.08);
  } catch {
    // Browsers can block audio before the first user gesture.
  }
}

function avatarText(name = displayName()) {
  return name.trim().slice(0, 1) || "나";
}

function syncMyIdentity() {
  const name = displayName();
  state.rooms = state.rooms && typeof state.rooms === "object" && !Array.isArray(state.rooms) ? state.rooms : {};
  state.room = {
    recruitId: "",
    title: "내 파티 방",
    intro: "",
    owner: "",
    mode: "자유 입장",
    password: "",
    participants: [],
    messages: [],
    ...state.room
  };
  if (!state.room.participants.length) state.room.participants = [name];
  state.room.participants = state.room.participants.map((participant) => (participant === "치킨플레이어" || participant === "게스트" ? name : participant));
  if (state.currentRoomId && state.rooms[state.currentRoomId]) {
    state.rooms[state.currentRoomId] = normalizeRoom({
      ...state.rooms[state.currentRoomId],
      participants: state.rooms[state.currentRoomId].participants.map((participant) => (participant === "치킨플레이어" || participant === "게스트" ? name : participant))
    });
    state.room = state.rooms[state.currentRoomId];
  }
}

function activeBans() {
  const now = Date.now();
  return state.bans.filter((ban) => !ban.expiresAt || new Date(ban.expiresAt).getTime() > now);
}

function activeBanFor(nickname) {
  return activeBans().find((ban) => ban.nickname === nickname);
}

function banMessage(ban) {
  if (!ban) return "";
  const until = ban.expiresAt ? new Date(ban.expiresAt).toLocaleString("ko-KR") : "영구";
  return `정지된 닉네임입니다. 해제: ${until}`;
}

function guardNotBanned() {
  const ban = activeBanFor(displayName());
  if (!ban) return true;
  showToast(banMessage(ban));
  return false;
}

function banDurationLabel(value) {
  const labels = {
    "10m": "10분",
    "30m": "30분",
    "1h": "1시간",
    "1d": "1일",
    "7d": "7일",
    forever: "영구정지"
  };
  return labels[value] || value;
}

function banExpiresAt(value) {
  const minutes = {
    "10m": 10,
    "30m": 30,
    "1h": 60,
    "1d": 60 * 24,
    "7d": 60 * 24 * 7
  }[value];
  return minutes ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : "";
}

function canInteractWithRecruit(recruit) {
  const ban = activeBanFor(displayName());
  if (ban) return { ok: false, reason: banMessage(ban) };
  if (recruit.owner === displayName()) return { ok: false, reason: "내 방에는 신청할 수 없습니다." };
  if (state.currentRoomId && state.currentRoomId !== recruit.id) return { ok: false, reason: "이미 다른 방에 있어서 신청할 수 없습니다." };
  if (recruit.requests.some((request) => request.nickname === displayName() && ["대기", "허락"].includes(request.status))) return { ok: false, reason: "이미 신청한 방입니다." };
  return { ok: true };
}

function renderLoginState() {
  if (state.isLoggedIn && activeBanFor(displayName())) {
    state.isLoggedIn = false;
  }
  $("#loginScreen").classList.toggle("active", !state.isLoggedIn);
}

function renderSettingsForm() {
  const settings = currentSettings();
  $("#settingTheme").value = settings.theme;
  $("#settingDensity").value = settings.density;
  $("#settingBoardSort").value = settings.boardSort;
  $("#settingChatDisplay").value = settings.chatDisplay;
  $("#settingAutoScroll").checked = settings.autoScrollChat;
  $("#settingSoundCue").checked = settings.soundCue;
}

function renderProfileForm() {
  $("#profileNickname").value = state.me.nickname;
  $("#profileGender").value = state.me.gender;
  $("#profileAge").value = state.me.age;
  $("#profileGame").value = state.me.mainGame;
  $("#profileStatus").value = state.me.status;
  $("#profileMic").value = String(state.me.mic);
  $("#profileBio").value = state.me.bio;
  $("#profileAvatar").textContent = avatarText();
}

function renderRecruitList() {
  const filters = Object.fromEntries(new FormData($("#filterForm")).entries());
  const list = state.recruits.filter((item) => {
    if (filters.gender && item.gender !== filters.gender) return false;
    if (filters.age && item.age !== filters.age) return false;
    if (filters.game && item.game !== filters.game) return false;
    if (filters.partySize && item.partySize < Number(filters.partySize)) return false;
    if (filters.mic && String(item.mic) !== filters.mic) return false;
    return !state.blocked.includes(item.owner);
  });

  $("#recruitCount").textContent = `${list.length}개 모집`;
  $("#recruitList").innerHTML = list.length
    ? list.map(renderRecruitCard).join("")
    : '<div class="empty">조건에 맞는 모집 글이 없습니다.</div>';
}

function renderRecruitCard(item) {
  const mine = item.owner === displayName();
  const alreadyRequested = item.requests.some((request) => request.nickname === displayName());
  const accepted = item.requests.some((request) => request.nickname === displayName() && request.status === "허락");
  const inAnotherRoom = Boolean(state.currentRoomId && state.currentRoomId !== item.id);
  const disabled = inAnotherRoom ? "disabled" : "";
  const guestAction = (() => {
    if (item.mode === "자유 입장") {
      return `<button class="primary-button" data-request="${item.id}" ${alreadyRequested || disabled ? "disabled" : ""}>바로 입장</button>`;
    }
    if (item.mode === "신청 입장") {
      return accepted
        ? `<button class="primary-button" data-join-room="${item.id}" ${disabled}>방 입장</button>`
        : `<button class="primary-button" data-request="${item.id}" ${alreadyRequested || disabled ? "disabled" : ""}>입장 신청</button>`;
    }
    return `<button class="primary-button" data-join-room="${item.id}" ${disabled}>비번 입장</button>`;
  })();
  const visibleRequests = item.requests.filter((request) => !["나감", "강퇴", "삭제"].includes(request.status));
  const requestRows = visibleRequests.length
    ? visibleRequests
        .map((request) => {
          const canManage = item.owner === displayName();
          const controls =
            request.status === "대기" && canManage
              ? `<div class="mini-actions">
                  <button class="ghost-button" data-approve="${item.id}:${request.id}">허락</button>
                  <button class="danger-button" data-reject="${item.id}:${request.id}">거절</button>
                </div>`
              : "";
          return `<div class="request-row">
            <span>${escapeHtml(request.nickname)} · ${escapeHtml(request.status)}</span>
            ${controls}
          </div>`;
        })
        .join("")
    : '<span class="subtle">아직 신청이 없습니다.</span>';

  return `
    <article class="recruit-card">
      <div>
        <h2>${escapeHtml(item.title)}</h2>
        <span class="card-meta">${escapeHtml(item.owner)} · ${escapeHtml(item.game)} · ${escapeHtml(item.shortIntro || "소개 없음")}</span>
        <div class="tag-row">
          <span class="tag">${escapeHtml(item.gender)}</span>
          <span class="tag">${ageLabel(item.age)}</span>
          <span class="tag">${item.partySize}명</span>
          <span class="tag green">${micLabel(item.mic)}</span>
          <span class="tag yellow">${escapeHtml(item.mode)}</span>
        </div>
        <p>${escapeHtml(item.intro)}</p>
        <div class="card-actions">
          ${
            mine
              ? `<button class="primary-button" data-join-room="${item.id}">내 방으로 이동</button>
                 <button class="danger-button" data-delete-room="${item.id}">방 삭제</button>`
              : guestAction
          }
          <button class="danger-button" data-report="${escapeHtml(item.owner)}">신고</button>
          <button class="danger-button" data-block="${escapeHtml(item.owner)}">차단</button>
        </div>
      </div>
      <aside class="request-box">
        <strong>신청 관리</strong>
        ${requestRows}
      </aside>
    </article>`;
}

function renderFriends() {
  normalizeFriendData();
  const me = displayName();
  const friends = friendNicknames().filter((nickname) => !state.blocked.includes(nickname));
  const incoming = state.friendRequests.filter((request) => request.to === me && request.status === "대기" && !state.blocked.includes(request.from));
  const outgoing = state.friendRequests.filter((request) => request.from === me && request.status === "대기" && !state.blocked.includes(request.to));
  const friendRows = friends.length
    ? friends
        .map(
          (nickname) => `
        <article class="friend">
          <div class="friend-main">
            <strong><span class="status-dot"></span>${escapeHtml(nickname)}</strong>
            <span>친구 · 메시지 가능</span>
          </div>
          <div class="mini-actions">
            <button class="ghost-button" data-dm="${escapeHtml(nickname)}">메시지</button>
            <button class="danger-button" data-remove-friend="${escapeHtml(nickname)}">삭제</button>
            <button class="danger-button" data-report="${escapeHtml(nickname)}">신고</button>
            <button class="danger-button" data-block="${escapeHtml(nickname)}">차단</button>
          </div>
        </article>`
        )
        .join("")
    : '<div class="empty">아직 친구가 없습니다.</div>';
  const incomingRows = incoming.length
    ? incoming
        .map(
          (request) => `
        <article class="friend">
          <div class="friend-main">
            <strong>${escapeHtml(request.from)}</strong>
            <span>친구 요청을 받았습니다.</span>
          </div>
          <div class="mini-actions">
            <button class="ghost-button" data-accept-friend="${escapeHtml(request.id)}">수락</button>
            <button class="danger-button" data-decline-friend="${escapeHtml(request.id)}">거절</button>
          </div>
        </article>`
        )
        .join("")
    : '<div class="empty">받은 친구 요청이 없습니다.</div>';
  const outgoingRows = outgoing.length
    ? outgoing.map((request) => `<div class="simple-item"><strong>${escapeHtml(request.to)}</strong><span class="subtle">수락 대기중</span></div>`).join("")
    : '<div class="empty">보낸 친구 요청이 없습니다.</div>';

  $("#friendList").innerHTML = friendRows;
  $("#friendRequestList").innerHTML = `
    <h3 class="inline-title">받은 요청</h3>
    ${incomingRows}
    <h3 class="inline-title">보낸 신청</h3>
    ${outgoingRows}`;
  renderDm();
}

function renderDm() {
  const nickname = state.selectedFriendId;
  const isFriend = nickname && friendshipWith(nickname) && !state.blocked.includes(nickname);
  const messageKey = isFriend ? friendPairKey(displayName(), nickname) : "";
  $("#messageTarget").textContent = isFriend ? nickname : "개인 메시지";
  $("#messageStatus").textContent = isFriend ? "친구" : "대상을 선택하세요";
  const messages = isFriend ? state.directMessages[messageKey] || [] : [];
  $("#dmLog").innerHTML = messages.length
    ? messages.map((message) => renderBubble(message)).join("")
    : '<div class="empty">메시지가 없습니다.</div>';
  if (currentSettings().autoScrollChat) $("#dmLog").scrollTop = $("#dmLog").scrollHeight;
}

function renderBoard() {
  normalizeBoardPosts();
  $("#boardTabs").innerHTML = games
    .map((game) => `<button class="${state.selectedBoardGame === game ? "active" : ""}" data-board-game="${escapeHtml(game)}">${escapeHtml(game)}</button>`)
    .join("");
  $("#boardTitle").textContent = state.selectedBoardGame;
  const posts = state.boardPosts
    .filter((post) => post.game === state.selectedBoardGame && !state.blocked.includes(post.author))
    .sort((a, b) => {
      const diff = new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      return currentSettings().boardSort === "oldest" ? -diff : diff;
    });
  if (!posts.some((post) => post.id === state.selectedThreadId)) state.selectedThreadId = posts[0]?.id || "";
  $("#boardList").innerHTML = posts.length
    ? posts
        .map((post) => {
          const mine = post.author === displayName();
          return `
            <article class="board-card">
              <strong>${escapeHtml(post.title)}</strong>
              <span class="card-meta">${escapeHtml(post.author)} · 댓글 ${post.messages.length}개</span>
              <p>${escapeHtml(post.body)}</p>
              <div class="card-actions">
                <button class="primary-button" data-thread="${post.id}">글 보기</button>
                ${mine ? `<button class="ghost-button" data-edit-post="${post.id}">수정</button><button class="danger-button" data-delete-post="${post.id}">삭제</button>` : ""}
                ${mine ? "" : `<button class="danger-button" data-report="${escapeHtml(post.author)}">신고</button><button class="danger-button" data-block="${escapeHtml(post.author)}">차단</button>`}
              </div>
            </article>`;
        })
        .join("")
    : '<div class="empty">게시글이 없습니다.</div>';
  renderThread();
}

function renderLobby() {
  normalizeLobbyMessages();
  const messages = state.lobbyMessages.filter((message) => !state.blocked.includes(message.from));
  $("#lobbyLog").innerHTML = messages.length
    ? messages.map((message) => renderBubble(message)).join("")
    : '<div class="empty">아직 전체 채팅이 없습니다.</div>';
  if (currentSettings().autoScrollChat) $("#lobbyLog").scrollTop = $("#lobbyLog").scrollHeight;
}

function renderThread() {
  const post = state.boardPosts.find((item) => item.id === state.selectedThreadId);
  $("#threadTitle").textContent = post ? post.title : "글 상세";
  $("#threadBody").innerHTML = post
    ? `<strong>${escapeHtml(post.author)}</strong><span class="subtle">${escapeHtml(post.game)}</span><p>${escapeHtml(post.body)}</p>`
    : '<div class="empty">게시글을 선택하세요.</div>';
  $("#threadLog").innerHTML = post?.messages.length
    ? post.messages.map((message) => renderComment(post.id, message)).join("")
    : '<div class="empty">댓글이 없습니다.</div>';
  if (currentSettings().autoScrollChat) $("#threadLog").scrollTop = $("#threadLog").scrollHeight;
}

function renderComment(postId, message) {
  const isMine = message.from === "me" || message.from === displayName();
  return `<div class="bubble ${isMine ? "me" : ""}">
    <strong>${isMine ? displayName() : escapeHtml(message.from)}</strong><br>
    ${escapeHtml(message.text)}
    ${
      isMine
        ? `<div class="comment-actions">
            <button class="ghost-button" data-edit-comment="${postId}:${message.id}">수정</button>
            <button class="danger-button" data-delete-comment="${postId}:${message.id}">삭제</button>
          </div>`
        : ""
    }
  </div>`;
}

function normalizeBoardPosts() {
  state.boardPosts.forEach((post) => {
    if (!Array.isArray(post.messages)) post.messages = [];
    post.messages.forEach((message) => {
      if (!message.id) message.id = `c${Date.now()}${Math.random().toString(16).slice(2)}`;
      if (!message.createdAt) message.createdAt = new Date().toISOString();
    });
  });
}

function normalizeLobbyMessages() {
  if (!Array.isArray(state.lobbyMessages)) state.lobbyMessages = [];
  state.lobbyMessages.forEach((message) => {
    if (!message.id) message.id = `l${Date.now()}${Math.random().toString(16).slice(2)}`;
    if (!message.createdAt) message.createdAt = new Date().toISOString();
  });
  state.lobbyMessages = state.lobbyMessages.slice(-300);
}

function normalizeAdminData() {
  if (!Array.isArray(state.reports)) state.reports = [];
  if (!Array.isArray(state.bans)) state.bans = [];
  state.reports.forEach((report) => {
    if (!report.id) report.id = `rep${Date.now()}${Math.random().toString(16).slice(2)}`;
    if (!report.reporter) report.reporter = "알 수 없음";
    if (!report.status) report.status = "대기";
    if (!report.createdAt) report.createdAt = new Date().toISOString();
  });
  state.bans.forEach((ban) => {
    if (!ban.id) ban.id = `ban${Date.now()}${Math.random().toString(16).slice(2)}`;
    if (!ban.durationLabel) ban.durationLabel = banDurationLabel(ban.duration || "forever");
    if (!ban.createdAt) ban.createdAt = new Date().toISOString();
  });
}

function openBoardEditor(postId = "") {
  state.editingBoardPostId = postId;
  const post = state.boardPosts.find((item) => item.id === postId);
  $("#boardEditorTitle").textContent = post ? "게시글 수정" : "게시글 작성";
  $("#boardEditorGame").textContent = state.selectedBoardGame;
  $("#boardPostTitle").value = post?.title || "";
  $("#boardPostBody").value = post?.body || "";
  setView("boardEditor");
  saveState();
}

function renderRoom() {
  const isOwner = state.currentRoomId && state.room.owner === displayName();
  $("#roomTitle").textContent = state.room.title;
  $("#roomMeta").textContent = `${state.room.participants.length}명 · ${state.room.mode}${state.room.intro ? ` · ${state.room.intro}` : ""}`;
  $("#roomSettings").disabled = !isOwner;
  $("#deleteRoom").disabled = !isOwner;
  $("#leaveRoom").disabled = !state.currentRoomId;
  $("#participantList").innerHTML = state.room.participants
    .filter((nickname) => !state.blocked.includes(nickname))
    .map(
      (nickname) => `
        <article class="participant">
          <div>
            <strong>${escapeHtml(nickname)}</strong>
            <span class="subtle">${nickname === displayName() ? "나" : "참가자"}</span>
          </div>
          ${
            nickname === displayName()
              ? ""
              : `<div class="mini-actions">
                  <button class="ghost-button" data-friend="${escapeHtml(nickname)}">친구</button>
                  ${isOwner ? `<button class="danger-button" data-kick="${escapeHtml(nickname)}">강퇴</button>` : ""}
                  <button class="danger-button" data-report="${escapeHtml(nickname)}">신고</button>
                  <button class="danger-button" data-block="${escapeHtml(nickname)}">차단</button>
                </div>`
          }
        </article>`
    )
    .join("");
  $("#micToggle").textContent = state.micOn ? "마이크 ON" : "마이크 OFF";
  $("#micToggle").classList.toggle("active", state.micOn);
  $("#micPermission").textContent = state.micAllowed ? "마이크 허용됨" : "마이크 허용";
  $("#roomLog").innerHTML = state.room.messages.map((message) => renderBubble(message)).join("");
  if (currentSettings().autoScrollChat) $("#roomLog").scrollTop = $("#roomLog").scrollHeight;
}

function renderRoomSettingsForm() {
  $("#roomSettingTitle").value = state.room.title;
  $("#roomSettingMode").value = state.room.mode;
  $("#roomSettingPassword").value = state.room.password || "";
  $("#roomSettingIntro").value = state.room.intro || "";
}

function renderSafety() {
  const visibleReports = state.reports.filter((report) => !report.deletedAt);
  $("#blockedList").innerHTML = state.blocked.length
    ? state.blocked.map((name) => `<div class="simple-item">${escapeHtml(name)}</div>`).join("")
    : '<div class="empty">차단한 사용자가 없습니다.</div>';
  $("#reportList").innerHTML = visibleReports.length
    ? visibleReports
        .map((report) => `<div class="simple-item"><strong>${escapeHtml(report.target)}</strong><span class="subtle">${escapeHtml(report.reason)}</span></div>`)
        .join("")
    : '<div class="empty">신고 기록이 없습니다.</div>';
}

function renderAdmin() {
  normalizeAdminData();
  const reports = state.reports.filter((report) => !report.deletedAt && !["처리됨", "취소"].includes(report.status));
  const bans = activeBans();
  $("#adminReportCount").textContent = `${reports.length}건`;
  $("#adminReports").innerHTML = reports.length
    ? reports
        .map((report) => {
          const status = report.status || "대기";
          return `<article class="admin-card">
            <div>
              <strong>${escapeHtml(report.target)}</strong>
              <span class="card-meta">신고자 ${escapeHtml(report.reporter || "알 수 없음")} · ${new Date(report.createdAt).toLocaleString("ko-KR")} · ${escapeHtml(status)}</span>
              <p>${escapeHtml(report.reason)}</p>
            </div>
            <div class="admin-actions">
              <select data-ban-duration="${escapeHtml(report.id)}">
                <option value="10m">10분</option>
                <option value="30m">30분</option>
                <option value="1h">1시간</option>
                <option value="1d">1일</option>
                <option value="7d">7일</option>
                <option value="forever">영구정지</option>
              </select>
              <button class="danger-button" data-ban-target="${escapeHtml(report.target)}" data-report-id="${escapeHtml(report.id)}">정지</button>
              <button class="ghost-button" data-dismiss-report="${escapeHtml(report.id)}">취소</button>
            </div>
          </article>`;
        })
        .join("")
    : '<div class="empty">접수된 신고가 없습니다.</div>';

  $("#adminBans").innerHTML = bans.length
    ? bans
        .map((ban) => {
          const until = ban.expiresAt ? new Date(ban.expiresAt).toLocaleString("ko-KR") : "영구";
          return `<article class="admin-card">
            <div>
              <strong>${escapeHtml(ban.nickname)}</strong>
              <span class="card-meta">${escapeHtml(ban.durationLabel)} · 해제 ${escapeHtml(until)}</span>
              <p>${escapeHtml(ban.reason || "관리자 정지")}</p>
            </div>
            <button class="ghost-button" data-unban="${escapeHtml(ban.id)}">해제</button>
          </article>`;
        })
        .join("")
    : '<div class="empty">현재 정지된 닉네임이 없습니다.</div>';
}

function renderBubble(message) {
  const isMe = message.from === "me" || message.from === displayName();
  const time = message.createdAt ? new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="bubble ${isMe ? "me" : ""}">
    <strong>${isMe ? displayName() : escapeHtml(message.from)}</strong>
    ${time ? `<span>${escapeHtml(time)}</span>` : ""}
    <br>${escapeHtml(message.text)}
  </div>`;
}

function renderAll(syncShared = true) {
  applySettings();
  syncMyIdentity();
  $("#myNickname").textContent = displayName();
  $("#myStatus").textContent = state.me.status;
  $("#myAvatar").textContent = avatarText();
  renderRecruitList();
  renderFriends();
  renderBoard();
  renderLobby();
  renderRoom();
  renderSafety();
  renderAdmin();
  renderProfileForm();
  renderRoomSettingsForm();
  renderSettingsForm();
  renderLoginState();
  saveState(syncShared);
}

function sendFriendRequest(nickname) {
  nickname = String(nickname || "").trim();
  const me = displayName();
  if (!nickname || nickname === me) return;
  if (state.blocked.includes(nickname)) {
    showToast("차단한 사용자에게는 친구 요청을 보낼 수 없습니다.");
    return;
  }
  normalizeFriendData();
  if (friendshipWith(nickname)) {
    showToast("이미 친구입니다.");
    return;
  }
  const existing = state.friendRequests.find((request) => request.status === "대기" && ((request.from === me && request.to === nickname) || (request.from === nickname && request.to === me)));
  if (existing?.from === me) {
    showToast("이미 친구 요청을 보냈습니다.");
    return;
  }
  if (existing?.to === me) {
    acceptFriendRequest(existing.id);
    return;
  }
  state.friendRequests.unshift({ id: `fr${Date.now()}`, from: me, to: nickname, status: "대기", createdAt: new Date().toISOString() });
  renderAll();
  showToast("친구 요청을 보냈습니다.");
}

function acceptFriendRequest(requestId) {
  normalizeFriendData();
  const request = state.friendRequests.find((item) => item.id === requestId && item.to === displayName() && item.status === "대기");
  if (!request) return;
  request.status = "수락";
  const key = friendPairKey(request.from, request.to);
  if (!state.friendships.some((friendship) => !friendship.deletedAt && friendPairKey(...friendship.users) === key)) {
    state.friendships.unshift({ id: `fs${Date.now()}`, users: [request.from, request.to], createdAt: new Date().toISOString() });
  }
  if (!state.directMessages[key]) state.directMessages[key] = [];
  state.selectedFriendId = request.from;
  renderAll();
  showToast("친구 요청을 수락했습니다.");
}

function declineFriendRequest(requestId) {
  const request = state.friendRequests.find((item) => item.id === requestId && item.to === displayName() && item.status === "대기");
  if (!request) return;
  request.status = "거절";
  renderAll();
  showToast("친구 요청을 거절했습니다.");
}

function removeFriend(nickname) {
  normalizeFriendData();
  if (!confirm(`${nickname}님을 친구에서 삭제할까요?`)) return;
  const key = friendPairKey(displayName(), nickname);
  state.friendships.forEach((friendship) => {
    if (friendPairKey(...friendship.users) === key) friendship.deletedAt = new Date().toISOString();
  });
  state.friendRequests.forEach((request) => {
    if (friendPairKey(request.from, request.to) === key && request.status === "대기") request.status = "삭제";
  });
  if (state.selectedFriendId === nickname) state.selectedFriendId = "";
  renderAll();
  showToast("친구를 삭제했습니다.");
}

function reportUser(target) {
  const reason = prompt(`${target} 신고 사유를 입력하세요.`);
  if (!reason) return;
  state.reports.unshift({
    id: `rep${Date.now()}${Math.random().toString(16).slice(2)}`,
    target,
    reporter: displayName(),
    reason,
    status: "대기",
    createdAt: new Date().toISOString()
  });
  renderSafety();
  renderAdmin();
  saveState();
  showToast("신고가 접수되었습니다.");
}

function blockUser(target) {
  if (!confirm(`${target} 사용자를 차단할까요?`)) return;
  if (!state.blocked.includes(target)) state.blocked.push(target);
  renderAll();
  showToast("차단했습니다.");
}

function banUser(target, duration, reportId = "") {
  if (!target) return;
  const reason = prompt(`${target} 정지 사유를 입력하세요.`, "신고 처리");
  if (!reason?.trim()) return;
  const previousBan = activeBanFor(target);
  if (previousBan && !confirm("이미 정지된 닉네임입니다. 새 정지로 갱신할까요?")) return;

  const replacedBanIds = state.bans.filter((ban) => ban.nickname === target).map((ban) => ban.id).filter(Boolean);
  state.deletedBanIds = [...new Set([...(state.deletedBanIds || []), ...replacedBanIds])];
  state.bans = state.bans.filter((ban) => ban.nickname !== target);
  state.bans.unshift({
    id: `ban${Date.now()}${Math.random().toString(16).slice(2)}`,
    nickname: target,
    reason: reason.trim(),
    duration,
    durationLabel: banDurationLabel(duration),
    expiresAt: banExpiresAt(duration),
    moderator: displayName(),
    createdAt: new Date().toISOString()
  });

  const report = state.reports.find((item) => item.id === reportId);
  if (report) {
    report.status = "처리됨";
    report.deletedAt = new Date().toISOString();
    state.deletedReportIds = [...new Set([...(state.deletedReportIds || []), report.id])];
    state.reports = state.reports.filter((item) => item.id !== report.id);
  }
  renderAll();
  showToast(`${target} 닉네임을 ${banDurationLabel(duration)} 정지했습니다.`);
}

function dismissReport(reportId) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  if (!confirm(`${report.target} 신고를 취소할까요? 정지 없이 목록에서 사라집니다.`)) return;
  report.status = "취소";
  report.deletedAt = new Date().toISOString();
  state.deletedReportIds = [...new Set([...(state.deletedReportIds || []), report.id])];
  state.reports = state.reports.filter((item) => item.id !== report.id);
  renderAll();
  showToast("신고를 취소했습니다.");
}

function unbanUser(banId) {
  state.bans = state.bans.filter((ban) => ban.id !== banId);
  state.deletedBanIds = [...new Set([...(state.deletedBanIds || []), banId])];
  renderAll();
  showToast("정지를 해제했습니다.");
}

function deleteRecruitRoom(recruitId) {
  const recruit = state.recruits.find((item) => item.id === recruitId);
  if (!recruit || recruit.owner !== displayName()) {
    showToast("내가 만든 방만 삭제할 수 있습니다.");
    return;
  }
  if (!confirm("이 방을 삭제할까요? 모집글과 현재 방 정보가 함께 삭제됩니다.")) return;
  state.recruits = state.recruits.filter((item) => item.id !== recruitId);
  if (state.rooms) delete state.rooms[recruitId];
  state.deletedRecruitIds = [...new Set([...(state.deletedRecruitIds || []), recruitId])];
  state.deletedRoomIds = [...new Set([...(state.deletedRoomIds || []), recruitId])];
  if (state.currentRoomId === recruitId) {
    state.currentRoomId = "";
    state.room = blankRoom();
  }
  renderAll();
  setView("recruit");
  showToast("방을 삭제했습니다.");
}

function kickRoomParticipant(nickname) {
  if (!state.currentRoomId || state.room.owner !== displayName() || nickname === displayName()) return;
  if (!confirm(`${nickname}님을 이 방에서 강퇴할까요?`)) return;
  const recruit = state.recruits.find((item) => item.id === state.currentRoomId);
  if (recruit) {
    recruit.requests.forEach((request) => {
      if (request.nickname === nickname) request.status = "강퇴";
    });
  }
  updateSharedRoom((room) => {
    room.participants = room.participants.filter((participant) => participant !== nickname);
    room.participantStatus = { ...(room.participantStatus || {}), [nickname]: { state: "kicked", at: new Date().toISOString() } };
    room.removedParticipants = [...new Set([...(room.removedParticipants || []), nickname])];
    room.kicked = [...new Set([...(room.kicked || []), nickname])];
    room.messages.push({ id: `m${Date.now()}`, from: "시스템", text: `${nickname}님이 강퇴되었습니다.`, createdAt: new Date().toISOString() });
  });
  renderAll();
  showToast("강퇴했습니다.");
}

function joinRecruitRoom(recruit) {
  const isOwner = recruit.owner === displayName();
  const accepted = recruit.requests.some((request) => request.nickname === displayName() && request.status === "허락");
  const existingRoom = state.rooms?.[recruit.id];
  if (existingRoom?.kicked?.includes(displayName())) {
    showToast("이 방에서 강퇴되어 다시 입장할 수 없습니다.");
    return;
  }
  if (state.currentRoomId && state.currentRoomId !== recruit.id) {
    showToast("이미 다른 방에 있어서 입장할 수 없습니다.");
    return;
  }
  if (recruit.mode === "신청 입장" && !isOwner && !accepted) {
    showToast("방 주인의 허락을 받은 뒤 입장할 수 있습니다.");
    return;
  }
  if (recruit.mode === "비번 입장" && !isOwner && !accepted) {
    const password = prompt("방 비밀번호를 입력하세요.");
    if (password !== (recruit.password || "")) {
      showToast("비밀번호가 맞지 않습니다.");
      return;
    }
  }
  state.currentRoomId = recruit.id;
  state.room.title = recruit.title;
  state.room.recruitId = recruit.id;
  state.room.owner = recruit.owner;
  state.room.mode = recruit.mode;
  state.room.password = recruit.password || "";
  state.room.intro = recruit.intro || "";
  const participants = [displayName(), recruit.owner, ...recruit.requests.filter((request) => request.status === "허락").map((request) => request.nickname)];
  state.room = normalizeRoom({
    ...state.room,
    ...(existingRoom || {}),
    recruitId: recruit.id,
    title: recruit.title,
    owner: recruit.owner,
    mode: recruit.mode,
    password: recruit.password || "",
    intro: recruit.intro || "",
    participants: [...new Set([...(existingRoom?.participants || []), ...participants])],
    participantStatus: {
      ...(existingRoom?.participantStatus || {}),
      ...Object.fromEntries(participants.map((nickname) => [nickname, { state: "active", at: new Date().toISOString() }]))
    },
    removedParticipants: (existingRoom?.removedParticipants || []).filter((nickname) => !participants.includes(nickname)),
    messages: existingRoom?.messages?.length ? existingRoom.messages : [{ id: `m${Date.now()}`, from: recruit.owner, text: `${recruit.game} 파티에 오신 걸 환영합니다.`, createdAt: new Date().toISOString() }]
  });
  state.rooms[recruit.id] = state.room;
  renderAll();
  setView("room");
  showToast("방에 입장했습니다.");
}

async function requestMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("현재 브라우저에서 마이크 권한 요청을 지원하지 않습니다.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    state.micAllowed = true;
    state.micOn = true;
    renderRoom();
    saveState();
    showToast("마이크 권한이 허용되었습니다.");
  } catch {
    state.micAllowed = false;
    renderRoom();
    saveState();
    showToast("마이크 권한이 거부되었거나 사용할 수 없습니다.");
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) =>
    button.addEventListener("click", () => {
      if (button.dataset.view === "admin" && !state.isAdmin) {
        const code = prompt("관리자 코드를 입력하세요.");
        if (code !== ADMIN_CODE) {
          showToast("관리자 코드가 맞지 않습니다.");
          return;
        }
        state.isAdmin = true;
        saveState();
      }
      setView(button.dataset.view);
    })
  );
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
  $("#filterForm").addEventListener("input", renderRecruitList);
  $("#clearFilters").addEventListener("click", () => {
    $("#filterForm").reset();
    renderRecruitList();
  });
  $("#seedButton").addEventListener("click", () => {
    if (!confirm("현재 브라우저에 저장된 모든 데이터를 초기화할까요?")) return;
    state = clone(initialState);
    renderAll();
    showToast("데이터를 초기화했습니다.");
  });

  $("#refreshButton").addEventListener("click", async () => {
    await loadSharedState(false);
    syncCurrentRoomFromShared();
    renderAll(false);
    showToast("새로고침 완료");
  });

  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const nickname = data.nickname.trim();
    if (!nickname) return;
    await waitForSharedLoad();
    await loadSharedState(true);
    await waitForSharedLoad();
    const ban = activeBanFor(nickname);
    if (ban) {
      showToast(banMessage(ban));
      return;
    }
    state.isLoggedIn = true;
    state.me.nickname = nickname;
    state.me.mainGame = data.mainGame;
    state.room.participants = [nickname];
    renderAll();
    showToast(`${nickname}님, 환영합니다.`);
  });

  $("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const beforeName = displayName();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const nextName = data.nickname.trim();
    if (!nextName) return;
    await waitForSharedLoad();
    await loadSharedState(true);
    await waitForSharedLoad();
    const ban = activeBanFor(nextName);
    if (ban) {
      showToast(banMessage(ban));
      return;
    }
    state.me = {
      ...state.me,
      nickname: nextName,
      gender: data.gender,
      age: data.age,
      mainGame: data.mainGame,
      status: data.status,
      mic: data.mic === "true",
      bio: data.bio.trim()
    };
    state.room.participants = state.room.participants.map((participant) => (participant === beforeName ? nextName : participant));
    if (state.room.owner === beforeName) state.room.owner = nextName;
    state.recruits.forEach((recruit) => {
      if (recruit.owner === beforeName) recruit.owner = nextName;
      recruit.requests.forEach((request) => {
        if (request.nickname === beforeName) request.nickname = nextName;
      });
    });
    Object.keys(state.rooms || {}).forEach((roomId) => {
      const room = state.rooms[roomId];
      if (room.owner === beforeName) room.owner = nextName;
      room.participants = Array.isArray(room.participants) ? room.participants.map((participant) => (participant === beforeName ? nextName : participant)) : [];
      if (Array.isArray(room.messages)) {
        room.messages.forEach((message) => {
          if (message.from === beforeName) message.from = nextName;
        });
      }
    });
    state.friendRequests.forEach((request) => {
      if (request.from === beforeName) request.from = nextName;
      if (request.to === beforeName) request.to = nextName;
    });
    state.friendships.forEach((friendship) => {
      friendship.users = friendship.users.map((nickname) => (nickname === beforeName ? nextName : nickname));
    });
    const renamedMessages = {};
    Object.entries(state.directMessages || {}).forEach(([key, messages]) => {
      const names = key.split("::").map((nickname) => (nickname === beforeName ? nextName : nickname));
      const nextKey = friendPairKey(names[0], names[1]);
      renamedMessages[nextKey] = Array.isArray(messages) ? messages : [];
      renamedMessages[nextKey].forEach((message) => {
        if (message.from === beforeName) message.from = nextName;
      });
    });
    state.directMessages = renamedMessages;
    if (state.selectedFriendId === beforeName) state.selectedFriendId = nextName;
    state.boardPosts.forEach((post) => {
      if (post.author === beforeName) post.author = nextName;
      post.messages.forEach((message) => {
        if (message.from === beforeName) message.from = nextName;
      });
    });
    renderAll();
    showToast("프로필을 저장했습니다.");
  });

  $("#settingsForm").addEventListener("input", (event) => {
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    state.settings = {
      theme: data.theme,
      density: data.density,
      autoScrollChat: Boolean(data.autoScrollChat),
      boardSort: data.boardSort,
      chatDisplay: data.chatDisplay,
      soundCue: Boolean(data.soundCue)
    };
    applySettings();
    renderBoard();
    saveState();
  });

  $("#logoutButton").addEventListener("click", () => {
    if (!confirm("로그아웃할까요? 브라우저에 저장된 글과 기록은 유지됩니다.")) return;
    state.isLoggedIn = false;
    state.isAdmin = false;
    renderAll();
    showToast("로그아웃했습니다.");
  });

  $("#createForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    if (state.currentRoomId) {
      showToast("이미 들어가 있거나 만든 방이 있으면 새 방을 만들 수 없습니다.");
      return;
    }
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (data.mode === "비번 입장" && !data.password.trim()) {
      showToast("비번 입장 방은 비밀번호가 필요합니다.");
      return;
    }
    const id = `r${Date.now()}`;
    const recruit = {
      id,
      title: data.title.trim(),
      owner: displayName(),
      gender: data.gender,
      age: data.age,
      game: data.game,
      partySize: Number(data.partySize),
      mic: data.mic === "true",
      mode: data.mode,
      password: data.mode === "비번 입장" ? data.password.trim() : "",
      shortIntro: data.shortIntro.trim() || "함께 해요",
      intro: data.intro.trim(),
      requests: []
    };
    state.recruits.unshift(recruit);
    state.currentRoomId = id;
    state.room = {
      recruitId: id,
      title: recruit.title,
      intro: recruit.intro,
      owner: displayName(),
      mode: recruit.mode,
      password: recruit.password,
      participants: [displayName()],
      participantStatus: { [displayName()]: { state: "active", at: new Date().toISOString() } },
      messages: []
    };
    state.rooms[id] = normalizeRoom(state.room);
    event.currentTarget.reset();
    renderAll();
    setView("room");
    showToast("방을 만들고 입장했습니다.");
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.dataset.request) {
      if (!guardNotBanned()) return;
      const recruit = state.recruits.find((item) => item.id === target.dataset.request);
      if (recruit) {
        const check = canInteractWithRecruit(recruit);
        if (!check.ok) {
          showToast(check.reason);
          return;
        }
        recruit.requests.push({ id: `q${Date.now()}`, nickname: displayName(), status: recruit.mode === "자유 입장" ? "허락" : "대기" });
        if (recruit.mode === "자유 입장") joinRecruitRoom(recruit);
        renderRecruitList();
        saveState();
        showToast(recruit.mode === "자유 입장" ? "바로 참여했습니다." : "매칭 요청을 보냈습니다.");
      }
    }

    if (target.dataset.approve || target.dataset.reject) {
      const [recruitId, requestId] = (target.dataset.approve || target.dataset.reject).split(":");
      const recruit = state.recruits.find((item) => item.id === recruitId);
      const request = recruit?.requests.find((item) => item.id === requestId);
      if (request) {
        request.status = target.dataset.approve ? "허락" : "거절";
        if (request.status === "허락" && state.currentRoomId === recruitId && !state.room.participants.includes(request.nickname)) {
          updateSharedRoom((room) => {
            room.participantStatus = { ...(room.participantStatus || {}), [request.nickname]: { state: "active", at: new Date().toISOString() } };
            room.removedParticipants = (room.removedParticipants || []).filter((nickname) => nickname !== request.nickname);
            room.participants.push(request.nickname);
          });
        }
        if (request.status === "거절") {
          updateSharedRoom((room) => {
            room.participants = room.participants.filter((nickname) => nickname !== request.nickname);
            room.participantStatus = { ...(room.participantStatus || {}), [request.nickname]: { state: "removed", at: new Date().toISOString() } };
            room.removedParticipants = [...new Set([...(room.removedParticipants || []), request.nickname])];
          });
        }
      }
      renderRecruitList();
      saveState();
    }

    if (target.dataset.joinRoom) {
      if (!guardNotBanned()) return;
      const recruit = state.recruits.find((item) => item.id === target.dataset.joinRoom);
      if (recruit) joinRecruitRoom(recruit);
    }

    if (target.dataset.deleteRoom) deleteRecruitRoom(target.dataset.deleteRoom);
    if (target.dataset.friend) sendFriendRequest(target.dataset.friend);
    if (target.dataset.acceptFriend) acceptFriendRequest(target.dataset.acceptFriend);
    if (target.dataset.declineFriend) declineFriendRequest(target.dataset.declineFriend);
    if (target.dataset.removeFriend) removeFriend(target.dataset.removeFriend);
    if (target.dataset.kick) kickRoomParticipant(target.dataset.kick);
    if (target.dataset.report) reportUser(target.dataset.report);
    if (target.dataset.block) blockUser(target.dataset.block);
    if (target.dataset.banTarget) {
      const reportId = target.dataset.reportId || "";
      const duration = target.closest(".admin-card")?.querySelector("[data-ban-duration]")?.value || "10m";
      banUser(target.dataset.banTarget, duration, reportId);
    }
    if (target.dataset.dismissReport) dismissReport(target.dataset.dismissReport);
    if (target.dataset.unban) unbanUser(target.dataset.unban);
    if (target.dataset.dm) {
      state.selectedFriendId = target.dataset.dm;
      renderDm();
      saveState();
    }
    if (target.dataset.boardGame) {
      state.selectedBoardGame = target.dataset.boardGame;
      renderBoard();
      saveState();
    }
    if (target.dataset.thread) {
      state.selectedThreadId = target.dataset.thread;
      renderThread();
      saveState();
    }

    if (target.dataset.editPost) {
      const post = state.boardPosts.find((item) => item.id === target.dataset.editPost);
      if (!post || post.author !== displayName()) {
        showToast("직접 쓴 글만 수정할 수 있습니다.");
        return;
      }
      openBoardEditor(post.id);
    }

    if (target.dataset.deletePost) {
      const post = state.boardPosts.find((item) => item.id === target.dataset.deletePost);
      if (!post || post.author !== displayName()) {
        showToast("직접 쓴 글만 삭제할 수 있습니다.");
        return;
      }
      if (!confirm("이 게시글을 삭제할까요?")) return;
      state.boardPosts = state.boardPosts.filter((item) => item.id !== post.id);
      state.deletedBoardPostIds = [...new Set([...(state.deletedBoardPostIds || []), post.id])];
      if (state.selectedThreadId === post.id) state.selectedThreadId = "";
      renderBoard();
      saveState();
      showToast("게시글을 삭제했습니다.");
    }

    if (target.dataset.editComment) {
      const [postId, commentId] = target.dataset.editComment.split(":");
      const post = state.boardPosts.find((item) => item.id === postId);
      const comment = post?.messages.find((item) => item.id === commentId);
      if (!comment || comment.from !== displayName()) {
        showToast("직접 쓴 댓글만 수정할 수 있습니다.");
        return;
      }
      const text = prompt("댓글을 수정하세요.", comment.text);
      if (!text?.trim()) return;
      comment.text = text.trim();
      renderThread();
      saveState();
      showToast("댓글을 수정했습니다.");
    }

    if (target.dataset.deleteComment) {
      const [postId, commentId] = target.dataset.deleteComment.split(":");
      const post = state.boardPosts.find((item) => item.id === postId);
      const comment = post?.messages.find((item) => item.id === commentId);
      if (!comment || comment.from !== displayName()) {
        showToast("직접 쓴 댓글만 삭제할 수 있습니다.");
        return;
      }
      if (!confirm("이 댓글을 삭제할까요?")) return;
      post.messages = post.messages.filter((item) => item.id !== commentId);
      state.deletedCommentIds = [...new Set([...(state.deletedCommentIds || []), commentId])];
      renderBoard();
      saveState();
      showToast("댓글을 삭제했습니다.");
    }
  });

  $("#friendSearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const nickname = $("#friendSearchInput").value.trim();
    if (!nickname) return;
    sendFriendRequest(nickname);
    $("#friendSearchInput").value = "";
  });

  $("#dmForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    const text = $("#dmInput").value.trim();
    if (!text || !state.selectedFriendId) return;
    if (!friendshipWith(state.selectedFriendId)) {
      showToast("친구 수락 후 메시지를 보낼 수 있습니다.");
      return;
    }
    const messageKey = friendPairKey(displayName(), state.selectedFriendId);
    if (!state.directMessages[messageKey]) state.directMessages[messageKey] = [];
    state.directMessages[messageKey].push({ id: `dm${Date.now()}`, from: displayName(), text, createdAt: new Date().toISOString() });
    $("#dmInput").value = "";
    renderDm();
    saveState();
  });

  $("#lobbyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    const text = $("#lobbyInput").value.trim();
    if (!text) return;
    state.lobbyMessages.push({ id: `l${Date.now()}`, from: displayName(), text, createdAt: new Date().toISOString() });
    $("#lobbyInput").value = "";
    renderLobby();
    saveState();
  });

  $("#newBoardPost").addEventListener("click", () => {
    openBoardEditor();
  });

  $("#cancelBoardEdit").addEventListener("click", () => {
    state.editingBoardPostId = "";
    setView("board");
    saveState();
  });

  $("#boardPostForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const title = data.title.trim();
    const body = data.body.trim();
    if (!title || !body) return;
    const editingPost = state.boardPosts.find((item) => item.id === state.editingBoardPostId);
    if (editingPost) {
      if (editingPost.author !== displayName()) {
        showToast("직접 쓴 글만 수정할 수 있습니다.");
        return;
      }
      editingPost.title = title;
      editingPost.body = body;
      showToast("게시글을 수정했습니다.");
    } else {
      const id = `b${Date.now()}`;
      state.boardPosts.unshift({
        id,
        game: state.selectedBoardGame,
        title,
        author: displayName(),
        body,
        messages: [],
        createdAt: new Date().toISOString()
      });
      state.selectedThreadId = id;
      showToast("게시글을 등록했습니다.");
    }
    state.editingBoardPostId = "";
    event.currentTarget.reset();
    renderBoard();
    setView("board");
    saveState();
  });

  $("#threadForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    const post = state.boardPosts.find((item) => item.id === state.selectedThreadId);
    const text = $("#threadInput").value.trim();
    if (!post || !text) return;
    post.messages.push({ id: `c${Date.now()}`, from: displayName(), text, createdAt: new Date().toISOString() });
    $("#threadInput").value = "";
    renderBoard();
    saveState();
  });

  $("#micToggle").addEventListener("click", () => {
    if (!state.micAllowed && !state.micOn) {
      showToast("마이크를 켜려면 먼저 권한을 허용하세요.");
      return;
    }
    state.micOn = !state.micOn;
    renderRoom();
    saveState();
  });

  $("#micPermission").addEventListener("click", requestMicPermission);

  $("#roomSettings").addEventListener("click", () => {
    setView("roomSettings");
  });

  $("#cancelRoomSettings").addEventListener("click", () => setView("room"));

  $("#roomSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (data.mode === "비번 입장" && !data.password.trim()) {
      showToast("비번 입장 방은 비밀번호가 필요합니다.");
      return;
    }
    const nextTitle = data.title.trim();
    const nextMode = data.mode;
    const nextPassword = data.mode === "비번 입장" ? data.password.trim() : "";
    const nextIntro = data.intro.trim();
    state.room.title = nextTitle;
    state.room.mode = nextMode;
    state.room.password = nextPassword;
    state.room.intro = nextIntro;
    const recruit = state.recruits.find((item) => item.id === state.room.recruitId);
    if (recruit && recruit.owner === displayName()) {
      recruit.title = nextTitle;
      recruit.mode = nextMode;
      recruit.password = nextPassword;
      recruit.intro = nextIntro;
    }
    updateSharedRoom((room) => {
      room.title = nextTitle;
      room.mode = nextMode;
      room.password = nextPassword;
      room.intro = nextIntro;
    });
    renderAll();
    setView("room");
    saveState();
    showToast("방 설정을 저장했습니다.");
  });

  $("#deleteRoom").addEventListener("click", () => {
    if (!state.currentRoomId) {
      showToast("삭제할 방이 없습니다.");
      return;
    }
    deleteRecruitRoom(state.currentRoomId);
  });

  $("#leaveRoom").addEventListener("click", () => {
    if (!confirm("현재 방에서 나갈까요?")) return;
    const recruit = state.recruits.find((item) => item.id === state.currentRoomId);
    if (recruit && recruit.owner === displayName()) {
      showToast("방장은 나가기 대신 방 삭제를 사용하세요.");
      return;
    }
    if (recruit) {
      recruit.requests.forEach((request) => {
        if (request.nickname === displayName()) request.status = "나감";
      });
    }
    updateSharedRoom((room) => {
      room.participants = room.participants.filter((nickname) => nickname !== displayName());
      room.participantStatus = { ...(room.participantStatus || {}), [displayName()]: { state: "removed", at: new Date().toISOString() } };
      room.removedParticipants = [...new Set([...(room.removedParticipants || []), displayName()])];
    });
    state.currentRoomId = "";
    state.room = blankRoom();
    renderAll();
    showToast("방에서 나갔습니다.");
    setView("recruit");
  });

  $("#roomForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!guardNotBanned()) return;
    const text = $("#roomInput").value.trim();
    if (!text) return;
    updateSharedRoom((room) => {
      room.messages.push({ id: `m${Date.now()}`, from: displayName(), text, createdAt: new Date().toISOString() });
    });
    $("#roomInput").value = "";
    renderRoom();
    saveState();
  });

  $("#clearSafety").addEventListener("click", () => {
    if (!confirm("신고 및 차단 기록을 모두 정리할까요?")) return;
    state.blocked = [];
    state.deletedReportIds = [...new Set([...(state.deletedReportIds || []), ...state.reports.map((report) => report.id).filter(Boolean)])];
    state.reports = [];
    renderAll();
  });
}

fillGameSelect($("#filterGame"), true);
fillGameSelect($("#createGame"));
fillGameSelect($("#loginGame"));
fillGameSelect($("#profileGame"));
bindEvents();
renderAll();
loadSharedState();
startSharedSync();

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (currentSettings().theme === "system") applySettings();
});
