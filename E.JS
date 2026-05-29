const STORAGE_KEY = "partyup-state-v3";
const SHARED_API_URL = window.location.protocol === "file:" ? "" : "/api/state";

const games = ["리그 오브 레전드", "발로란트", "오버워치 2", "배틀그라운드", "로스트아크", "메이플스토리"];

const initialState = {
  isLoggedIn: false,
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
  recruits: [],
  friends: [],
  dms: {},
  boardPosts: [],
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
let sharedStateLoaded = !SHARED_API_URL;
let sharedSaveTimer = 0;

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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveSharedState();
}

function sharedStatePayload() {
  return {
    recruits: state.recruits,
    boardPosts: state.boardPosts
  };
}

function applySharedState(data) {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.recruits)) state.recruits = data.recruits;
  if (Array.isArray(data.boardPosts)) state.boardPosts = data.boardPosts;
  normalizeBoardPosts();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadSharedState() {
  if (!SHARED_API_URL) return;
  try {
    const response = await fetch(SHARED_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Shared state request failed");
    applySharedState(await response.json());
    sharedStateLoaded = true;
    renderAll();
  } catch {
    sharedStateLoaded = false;
    showToast("공유 서버에 연결할 수 없어 이 브라우저에만 저장됩니다.");
  }
}

function saveSharedState() {
  if (!SHARED_API_URL || !sharedStateLoaded) return;
  window.clearTimeout(sharedSaveTimer);
  sharedSaveTimer = window.setTimeout(async () => {
    try {
      await fetch(SHARED_API_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sharedStatePayload())
      });
    } catch {
      showToast("공유 서버 저장에 실패했습니다.");
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
    room: "방",
    safety: "신고 및 차단",
    profile: "프로필 설정",
    boardEditor: "게시글 작성",
    roomSettings: "방 설정"
  };
  $("#viewTitle").textContent = titles[view];
}

function displayName() {
  return state.me.nickname || "게스트";
}

function avatarText(name = displayName()) {
  return name.trim().slice(0, 1) || "나";
}

function syncMyIdentity() {
  const name = displayName();
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
}

function canInteractWithRecruit(recruit) {
  if (recruit.owner === displayName()) return { ok: false, reason: "내 방에는 신청할 수 없습니다." };
  if (state.currentRoomId && state.currentRoomId !== recruit.id) return { ok: false, reason: "이미 다른 방에 있어서 신청할 수 없습니다." };
  if (recruit.requests.some((request) => request.nickname === displayName())) return { ok: false, reason: "이미 신청한 방입니다." };
  return { ok: true };
}

function renderLoginState() {
  $("#loginScreen").classList.toggle("active", !state.isLoggedIn);
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
  const requestRows = item.requests.length
    ? item.requests
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
  const friends = state.friends.filter((friend) => !state.blocked.includes(friend.nickname));
  $("#friendList").innerHTML = friends.length
    ? friends
        .map(
          (friend) => `
        <article class="friend">
          <div class="friend-main">
            <strong><span class="status-dot ${friend.presence}"></span>${escapeHtml(friend.nickname)}</strong>
            <span>${escapeHtml(friend.status)} · ${escapeHtml(friend.activity)}</span>
          </div>
          <div class="mini-actions">
            <button class="ghost-button" data-dm="${friend.id}">메시지</button>
            <button class="danger-button" data-report="${escapeHtml(friend.nickname)}">신고</button>
            <button class="danger-button" data-block="${escapeHtml(friend.nickname)}">차단</button>
          </div>
        </article>`
        )
        .join("")
    : '<div class="empty">표시할 친구가 없습니다.</div>';
  renderDm();
}

function renderDm() {
  const friend = state.friends.find((item) => item.id === state.selectedFriendId && !state.blocked.includes(item.nickname));
  $("#messageTarget").textContent = friend ? friend.nickname : "개인 메시지";
  $("#messageStatus").textContent = friend ? friend.activity : "대상을 선택하세요";
  const messages = friend ? state.dms[friend.id] || [] : [];
  $("#dmLog").innerHTML = messages.length
    ? messages.map((message) => renderBubble(message)).join("")
    : '<div class="empty">메시지가 없습니다.</div>';
}

function renderBoard() {
  normalizeBoardPosts();
  $("#boardTabs").innerHTML = games
    .map((game) => `<button class="${state.selectedBoardGame === game ? "active" : ""}" data-board-game="${escapeHtml(game)}">${escapeHtml(game)}</button>`)
    .join("");
  $("#boardTitle").textContent = state.selectedBoardGame;
  const posts = state.boardPosts.filter((post) => post.game === state.selectedBoardGame && !state.blocked.includes(post.author));
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

function renderThread() {
  const post = state.boardPosts.find((item) => item.id === state.selectedThreadId);
  $("#threadTitle").textContent = post ? post.title : "글 상세";
  $("#threadBody").innerHTML = post
    ? `<strong>${escapeHtml(post.author)}</strong><span class="subtle">${escapeHtml(post.game)}</span><p>${escapeHtml(post.body)}</p>`
    : '<div class="empty">게시글을 선택하세요.</div>';
  $("#threadLog").innerHTML = post?.messages.length
    ? post.messages.map((message) => renderComment(post.id, message)).join("")
    : '<div class="empty">댓글이 없습니다.</div>';
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
}

function renderRoomSettingsForm() {
  $("#roomSettingTitle").value = state.room.title;
  $("#roomSettingMode").value = state.room.mode;
  $("#roomSettingPassword").value = state.room.password || "";
  $("#roomSettingIntro").value = state.room.intro || "";
}

function renderSafety() {
  $("#blockedList").innerHTML = state.blocked.length
    ? state.blocked.map((name) => `<div class="simple-item">${escapeHtml(name)}</div>`).join("")
    : '<div class="empty">차단한 사용자가 없습니다.</div>';
  $("#reportList").innerHTML = state.reports.length
    ? state.reports
        .map((report) => `<div class="simple-item"><strong>${escapeHtml(report.target)}</strong><span class="subtle">${escapeHtml(report.reason)}</span></div>`)
        .join("")
    : '<div class="empty">신고 기록이 없습니다.</div>';
}

function renderBubble(message) {
  const isMe = message.from === "me" || message.from === displayName();
  return `<div class="bubble ${isMe ? "me" : ""}"><strong>${isMe ? displayName() : escapeHtml(message.from)}</strong><br>${escapeHtml(message.text)}</div>`;
}

function renderAll() {
  syncMyIdentity();
  $("#myNickname").textContent = displayName();
  $("#myStatus").textContent = state.me.status;
  $("#myAvatar").textContent = avatarText();
  renderRecruitList();
  renderFriends();
  renderBoard();
  renderRoom();
  renderSafety();
  renderProfileForm();
  renderRoomSettingsForm();
  renderLoginState();
  saveState();
}

function addFriend(nickname) {
  if (!nickname || nickname === displayName()) return;
  if (state.blocked.includes(nickname)) {
    showToast("차단한 사용자는 친구로 추가할 수 없습니다.");
    return;
  }
  if (state.friends.some((friend) => friend.nickname === nickname)) {
    showToast("이미 친구 목록에 있습니다.");
    return;
  }
  const id = `f${Date.now()}`;
  state.friends.push({ id, nickname, status: "온라인", activity: "새 친구", presence: "online" });
  state.dms[id] = [];
  state.selectedFriendId = id;
  renderAll();
  showToast("친구를 추가했습니다.");
}

function reportUser(target) {
  const reason = prompt(`${target} 신고 사유를 입력하세요.`);
  if (!reason) return;
  state.reports.unshift({ target, reason, createdAt: new Date().toISOString() });
  renderSafety();
  saveState();
  showToast("신고가 접수되었습니다.");
}

function blockUser(target) {
  if (!confirm(`${target} 사용자를 차단할까요?`)) return;
  if (!state.blocked.includes(target)) state.blocked.push(target);
  renderAll();
  showToast("차단했습니다.");
}

function deleteRecruitRoom(recruitId) {
  const recruit = state.recruits.find((item) => item.id === recruitId);
  if (!recruit || recruit.owner !== displayName()) {
    showToast("내가 만든 방만 삭제할 수 있습니다.");
    return;
  }
  if (!confirm("이 방을 삭제할까요? 모집글과 현재 방 정보가 함께 삭제됩니다.")) return;
  state.recruits = state.recruits.filter((item) => item.id !== recruitId);
  if (state.currentRoomId === recruitId) {
    state.currentRoomId = "";
    state.room = { ...clone(initialState.room), participants: [displayName()] };
  }
  renderAll();
  setView("recruit");
  showToast("방을 삭제했습니다.");
}

function joinRecruitRoom(recruit) {
  const isOwner = recruit.owner === displayName();
  const accepted = recruit.requests.some((request) => request.nickname === displayName() && request.status === "허락");
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
  state.room.participants = [...new Set([displayName(), recruit.owner, ...recruit.requests.filter((request) => request.status === "허락").map((request) => request.nickname)])];
  state.room.messages.unshift({ from: recruit.owner, text: `${recruit.game} 파티에 오신 걸 환영합니다.` });
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
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
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

  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const nickname = data.nickname.trim();
    if (!nickname) return;
    state.isLoggedIn = true;
    state.me.nickname = nickname;
    state.me.mainGame = data.mainGame;
    state.room.participants = [nickname];
    renderAll();
    showToast(`${nickname}님, 환영합니다.`);
  });

  $("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const beforeName = displayName();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const nextName = data.nickname.trim();
    if (!nextName) return;
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
    state.boardPosts.forEach((post) => {
      if (post.author === beforeName) post.author = nextName;
      post.messages.forEach((message) => {
        if (message.from === beforeName) message.from = nextName;
      });
    });
    renderAll();
    showToast("프로필을 저장했습니다.");
  });

  $("#logoutButton").addEventListener("click", () => {
    if (!confirm("로그아웃할까요? 브라우저에 저장된 글과 기록은 유지됩니다.")) return;
    state.isLoggedIn = false;
    renderAll();
    showToast("로그아웃했습니다.");
  });

  $("#createForm").addEventListener("submit", (event) => {
    event.preventDefault();
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
      messages: []
    };
    event.currentTarget.reset();
    renderAll();
    setView("room");
    showToast("방을 만들고 입장했습니다.");
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.dataset.request) {
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
          state.room.participants.push(request.nickname);
        }
        if (request.status === "거절") {
          state.room.participants = state.room.participants.filter((nickname) => nickname !== request.nickname);
        }
      }
      renderRecruitList();
      saveState();
    }

    if (target.dataset.joinRoom) {
      const recruit = state.recruits.find((item) => item.id === target.dataset.joinRoom);
      if (recruit) joinRecruitRoom(recruit);
    }

    if (target.dataset.deleteRoom) deleteRecruitRoom(target.dataset.deleteRoom);
    if (target.dataset.friend) addFriend(target.dataset.friend);
    if (target.dataset.report) reportUser(target.dataset.report);
    if (target.dataset.block) blockUser(target.dataset.block);
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
      renderBoard();
      saveState();
      showToast("댓글을 삭제했습니다.");
    }
  });

  $("#friendSearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const nickname = $("#friendSearchInput").value.trim();
    if (!nickname) return;
    addFriend(nickname);
    $("#friendSearchInput").value = "";
  });

  $("#dmForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#dmInput").value.trim();
    if (!text || !state.selectedFriendId) return;
    state.dms[state.selectedFriendId].push({ from: "me", text });
    $("#dmInput").value = "";
    renderDm();
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
    state.room.title = data.title.trim();
    state.room.mode = data.mode;
    state.room.password = data.mode === "비번 입장" ? data.password.trim() : "";
    state.room.intro = data.intro.trim();
    const recruit = state.recruits.find((item) => item.id === state.room.recruitId);
    if (recruit && recruit.owner === displayName()) {
      recruit.title = state.room.title;
      recruit.mode = state.room.mode;
      recruit.password = state.room.password;
      recruit.intro = state.room.intro;
    }
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
      recruit.requests = recruit.requests.filter((request) => request.nickname !== displayName());
    }
    state.currentRoomId = "";
    state.room = { ...clone(initialState.room), participants: [displayName()] };
    renderAll();
    showToast("방에서 나갔습니다.");
    setView("recruit");
  });

  $("#roomForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#roomInput").value.trim();
    if (!text) return;
    state.room.messages.push({ from: "me", text });
    $("#roomInput").value = "";
    renderRoom();
    saveState();
  });

  $("#clearSafety").addEventListener("click", () => {
    if (!confirm("신고 및 차단 기록을 모두 정리할까요?")) return;
    state.blocked = [];
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
