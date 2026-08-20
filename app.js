let sentences = [];
let currentIndex = 0;

let mediaRecorder = null;
let recordedChunks = [];
let studentAudioUrl = null;
let isRecording = false;
let cachedStream = null;

const sentenceText1El = document.getElementById("sentence-text-1");
const sentenceText2El = document.getElementById("sentence-text-2");
const tipsListEl = document.getElementById("tips-list");
const progressEl = document.getElementById("progress");
const playTeacherBtn = document.getElementById("play-teacher");
const teacherPlayStatusEl = document.getElementById("teacher-play-status");
const recordBtn = document.getElementById("record-btn");
const recStatusEl = document.getElementById("rec-status");
const prevBtn = document.getElementById("prev-btn");
const nextBtn = document.getElementById("next-btn");

const teacherTrack = document.getElementById("teacher-track");
const studentTrack = document.getElementById("student-track");

// Step 1 用獨立的 Audio 物件示範播放，跟 Step 3 的比較用播放軸互不干擾
const teacherDemoAudio = new Audio();
teacherDemoAudio.preload = "auto";

const NBSP = String.fromCharCode(160);

init();

async function init() {
  const res = await fetch("sentences.json");
  sentences = await res.json();
  renderCurrentSentence();

  playTeacherBtn.addEventListener("click", playTeacher);
  recordBtn.addEventListener("click", toggleRecording);
  prevBtn.addEventListener("click", () => goTo(currentIndex - 1));
  nextBtn.addEventListener("click", () => goTo(currentIndex + 1));

  teacherDemoAudio.addEventListener("play", () => {
    teacherPlayStatusEl.textContent = "🔊 播放中...";
  });
  teacherDemoAudio.addEventListener("pause", () => {
    teacherPlayStatusEl.textContent = "";
  });
  teacherDemoAudio.addEventListener("ended", () => {
    teacherPlayStatusEl.textContent = "";
  });

  // 麥克風串流改成只在使用者點擊「開始錄音」時才要（見 startRecording）。
  // 原本想在載入時就先暖機，但 Safari 對非使用者手勢觸發的
  // getUserMedia 會給一個表面正常、實際不收音的串流，錄出來永遠是空的。
}

function formatSentenceForWrap(text) {
  const words = text.split(" ");
  const breakIdx = words.findIndex(
    (w, i) => i > 0 && w.toLowerCase() === "the"
  );
  if (breakIdx === -1) return text;
  return words
    .map((w, i) => {
      if (i === 0) return w;
      const sep = i === breakIdx ? " " : NBSP;
      return sep + w;
    })
    .join("");
}

function renderCurrentSentence() {
  const s = sentences[currentIndex];
  const displayText = formatSentenceForWrap(s.text);
  sentenceText1El.textContent = displayText;
  sentenceText2El.textContent = displayText;
  progressEl.textContent = `句子 ${currentIndex + 1} / ${sentences.length}`;

  tipsListEl.innerHTML = "";
  (s.tips || []).forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    tipsListEl.appendChild(li);
  });

  teacherDemoAudio.src = s.audio;
  teacherDemoAudio.load();
  teacherTrack.src = s.audio;

  resetStudentRecording();
  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === sentences.length - 1;
}

function goTo(index) {
  if (index < 0 || index >= sentences.length) return;
  currentIndex = index;
  renderCurrentSentence();
}

function playTeacher() {
  const restartAndPlay = () => {
    teacherDemoAudio.currentTime = 0;
    teacherDemoAudio.play().catch(() => {
      alert("找不到老師的錄音檔，請確認 audio 資料夾裡有對應的 mp3。");
    });
  };

  // readyState >= 2 (HAVE_CURRENT_DATA) 代表音檔真的可以從頭播放了，
  // 太早設 currentTime/play 在 Safari 上會造成第一次沒聲音、第二次少字
  if (teacherDemoAudio.readyState >= 2) {
    restartAndPlay();
  } else {
    teacherDemoAudio.addEventListener("canplay", restartAndPlay, { once: true });
    teacherDemoAudio.load();
  }
}

function resetStudentRecording() {
  if (studentAudioUrl) {
    URL.revokeObjectURL(studentAudioUrl);
    studentAudioUrl = null;
  }
  recordedChunks = [];
  studentTrack.removeAttribute("src");
  recStatusEl.textContent = "";
}

async function toggleRecording() {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
}

function pickSupportedMimeType() {
  const candidates = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg",
    "audio/aac",
  ];
  return candidates.find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );
}

async function getMicStream() {
  if (!cachedStream) {
    // Safari 對自訂音訊約束（echoCancellation/noiseSuppression/autoGainControl）
    // 處理有問題，會給一個表面正常但完全無聲的音軌，改成不加任何約束
    cachedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  return cachedStream;
}

async function startRecording() {
  try {
    // 麥克風串流只跟系統要一次、重複使用，之後每次錄音才不用重新協商，
    // 不然啟動延遲會讓開口說的第一個字被吃掉
    const stream = await getMicStream();
    recordedChunks = [];
    const mimeType = pickSupportedMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const actualType = mediaRecorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: actualType });

      if (studentAudioUrl) URL.revokeObjectURL(studentAudioUrl);
      studentAudioUrl = URL.createObjectURL(blob);
      studentTrack.src = studentAudioUrl;
      studentTrack.load();
      const kb = (blob.size / 1024).toFixed(1);
      const track = stream.getAudioTracks()[0];
      const trackInfo = track
        ? `track: muted=${track.muted} enabled=${track.enabled} readyState=${track.readyState}`
        : "no audio track";
      recStatusEl.textContent = `已完成（${actualType}, ${kb}KB, ${trackInfo}），往下滑到 Step 3 比較`;
    };

    // Safari 的 MediaRecorder 如果不給 timeslice，錄出來的 audio/mp4 常常
    // moov 資訊不完整，導致該瀏覽器自己讀回時顯示無聲或時長跑掉，
    // 定期切塊可以強迫寫入正確的時長/軌道資訊
    mediaRecorder.start(250);
    isRecording = true;

    // 錄音其實已經開始跑了，但故意晚 0.3 秒才顯示「請開始說話」，
    // 讓錄音管線有時間暖機，確保使用者開口時一定已經在錄了
    recordBtn.disabled = true;
    recordBtn.textContent = "準備中...";
    recStatusEl.textContent = "";
    setTimeout(() => {
      if (!isRecording) return;
      recordBtn.disabled = false;
      recordBtn.textContent = "⏹ 停止錄音";
      recordBtn.classList.add("recording");
      recStatusEl.textContent = "🔴 錄音中，請開始說話";
    }, 300);
  } catch (err) {
    alert("無法取得麥克風權限，請確認瀏覽器已允許麥克風存取，並透過 http://localhost 開啟本頁。");
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.textContent = "🎙 開始錄音";
    recordBtn.classList.remove("recording");
  }
}

