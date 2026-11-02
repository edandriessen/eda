// app.js — screens, the interview loop, and the text fallback.
//
// Step 2 (MVP): three hardcoded questions. Step 3 replaces QUESTIONS with
// Claude choosing each next question and follow-up.
//
// Everything the user says is kept ONLY in the `state` object below (memory
// in this tab). Nothing is saved or sent anywhere in this step.

import * as voice from "./voice.js";

// ---------- Script ----------

const GREETING =
  "Hi, I'm Talent Finder. I'm really glad you're here.";

const EXPLAIN =
  "I'll ask a few questions about your experience, then point out skills you might not realize you have. " +
  "This test version has just three questions. You can skip any question, or say \"repeat\" or \"pause\" anytime.";

const QUESTIONS = [
  "To start, tell me about a job or role you've had. What did a typical day look like?",
  "What's something from that work you're proud of?",
  "What did coworkers or friends usually come to you for help with?",
];

const ACKS = ["Thank you.", "Got it, thanks.", "That's helpful."];

const CLOSING = "That's all for this test. Thank you for sharing! Your answers are on the screen.";

// ---------- State (memory only) ----------

const state = {
  mode: "voice", // "voice" or "text"
  qIndex: 0, // which question we're on
  answers: [], // { question, answer } — answer is null if skipped
  paused: false,
  turnId: 0, // increases every time we ask; lets us ignore stale mic results
  noSpeechCount: 0,
};

// ---------- Element shortcuts ----------

const $ = (id) => document.getElementById(id);
const el = {
  welcome: $("screen-welcome"),
  interview: $("screen-interview"),
  done: $("screen-done"),
  supportMsg: $("support-msg"),
  status: $("status"),
  transcript: $("transcript"),
  caption: $("caption"),
  btnMic: $("btn-mic"),
  btnDone: $("btn-done"),
  btnRepeat: $("btn-repeat"),
  btnSkip: $("btn-skip"),
  btnPause: $("btn-pause"),
  form: $("text-form"),
  input: $("text-input"),
  answers: $("answers"),
};

// ---------- Startup: check browser support ----------

if (!voice.support.listen) {
  el.supportMsg.hidden = false;
  el.supportMsg.textContent =
    "Your browser can't listen to speech, so we'll use typing instead. (For voice, try Chrome, Edge, or Safari.)";
  $("btn-start-voice").disabled = true;
}

$("btn-start-voice").addEventListener("click", () => start("voice"));
$("btn-start-text").addEventListener("click", () => start("text"));
$("btn-restart").addEventListener("click", () => location.reload());

el.btnMic.addEventListener("click", () => startListening());
el.btnDone.addEventListener("click", () => voice.finishListening());
el.btnRepeat.addEventListener("click", () => handleCommand("repeat"));
el.btnSkip.addEventListener("click", () => handleCommand("skip"));
el.btnPause.addEventListener("click", () =>
  handleCommand(state.paused ? "resume" : "pause"),
);

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  el.input.value = "";
  handleUserInput(text);
});

// Enter sends; Shift+Enter makes a new line.
el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el.form.requestSubmit();
  }
});

// Typing while the bot is listening or talking means "I'll type this one".
el.input.addEventListener("input", () => {
  if (voice.isListening()) {
    voice.stopListening();
    setStatus("Typing your answer. Press Enter to send.");
  }
});

// ---------- Flow ----------

async function start(mode) {
  state.mode = mode;
  show(el.interview);

  const turn = state.turnId;
  await botSays(GREETING);
  await botSays(EXPLAIN);
  // If they skipped/paused/typed during the intro, that already moved us on.
  if (turn === state.turnId && !state.paused) askCurrent();
}

/** Ask the current question, then (in voice mode) listen for the answer. */
async function askCurrent() {
  const turn = ++state.turnId;
  state.noSpeechCount = 0;
  await botSays(QUESTIONS[state.qIndex]);

  // If the user typed, skipped, or paused while we were talking, stop here.
  if (turn !== state.turnId || state.paused) return;

  if (state.mode === "voice") startListening();
  else {
    setStatus("Type your answer below and press Enter.");
    el.input.focus();
  }
}

/** Turn the mic on and wait for one answer. */
async function startListening() {
  const turn = state.turnId;
  voice.stopSpeaking();
  setListeningUI(true);
  setStatus("Listening… take your time.");

  try {
    const text = await voice.listen({ onInterim: showCaption });
    if (turn !== state.turnId) return; // a newer turn started; ignore
    setListeningUI(false);
    if (text) handleUserInput(text);
    else waitForMic("I didn't catch that. Tap the mic to try again, or type below.");
  } catch (err) {
    if (turn !== state.turnId) return;
    setListeningUI(false);
    handleListenError(err.code);
  }
}

/** Everything the user says or types comes through here. */
function handleUserInput(text) {
  voice.stopListening();
  voice.stopSpeaking();
  addMessage("user", text);

  const command = detectCommand(text);
  // "resume"-type words only count as a command while paused.
  if (command && (command !== "resume" || state.paused)) return handleCommand(command);

  if (state.paused) {
    // They typed/said something while paused: treat it as resuming.
    state.paused = false;
    el.btnPause.textContent = "Pause";
  }

  state.answers.push({ question: QUESTIONS[state.qIndex], answer: text });
  nextQuestion();
}

/**
 * Only treat a reply as a command if it's short. That way "I had to pause the
 * production line" is an answer, not a pause request.
 */
function detectCommand(text) {
  const t = text.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (t.split(/\s+/).length > 4) return null;
  if (/\b(repeat|say that again|again)\b/.test(t)) return "repeat";
  if (/\b(pause|hold on|wait)\b/.test(t)) return "pause";
  if (/\b(resume|continue|im back|ready)\b/.test(t)) return "resume";
  if (/\b(skip|next|pass)\b/.test(t)) return "skip";
  return null;
}

function handleCommand(command) {
  voice.stopListening();
  voice.stopSpeaking();
  state.turnId++; // cancel anything in progress

  switch (command) {
    case "repeat":
      state.paused = false;
      el.btnPause.textContent = "Pause";
      askCurrent();
      break;

    case "skip":
      state.paused = false;
      el.btnPause.textContent = "Pause";
      state.answers.push({ question: QUESTIONS[state.qIndex], answer: null });
      afterSaying("No problem, we'll skip that one.", () => nextQuestion({ ack: false }));
      break;

    case "pause":
      state.paused = true;
      el.btnPause.textContent = "Resume";
      setListeningUI(false);
      el.btnMic.hidden = true;
      botSays("Sure, take a break. Press Resume when you're ready.");
      setStatus("Paused. Press Resume (or type \"resume\") when you're ready.");
      break;

    case "resume":
      state.paused = false;
      el.btnPause.textContent = "Pause";
      askCurrent(); // re-ask so they don't have to remember the question
      break;
  }
}

function nextQuestion({ ack = true } = {}) {
  state.qIndex++;
  if (state.qIndex >= QUESTIONS.length) return finish();

  if (!ack) return askCurrent();
  afterSaying(ACKS[(state.qIndex - 1) % ACKS.length], askCurrent);
}

/** Say something, then run `next` — unless the user paused/skipped meanwhile. */
async function afterSaying(text, next) {
  const turn = state.turnId;
  await botSays(text);
  if (turn === state.turnId && !state.paused) next();
}

async function finish() {
  state.turnId++;
  setListeningUI(false);
  el.btnMic.hidden = true;
  await botSays(CLOSING);

  el.answers.innerHTML = "";
  for (const { question, answer } of state.answers) {
    const li = document.createElement("li");
    const q = document.createElement("strong");
    q.textContent = question;
    const a = document.createElement("p");
    a.textContent = answer ?? "(skipped)";
    li.append(q, a);
    el.answers.append(li);
  }
  show(el.done);
}

// ---------- Errors and silence ----------

function handleListenError(code) {
  switch (code) {
    case "aborted":
      return; // we cancelled on purpose (user typed, paused, etc.)

    case "no-speech":
      state.noSpeechCount++;
      if (state.noSpeechCount === 1) {
        // One gentle nudge out loud, then wait quietly for them.
        botSays("Take your time. Tap the mic when you're ready, or type your answer.");
      }
      waitForMic("Tap the mic when you're ready, or type below.");
      return;

    case "not-allowed":
    case "service-not-allowed":
      switchToText(
        "Microphone access is blocked, so let's continue by typing. (You can allow the mic in your browser's address bar and reload.)",
      );
      return;

    case "audio-capture":
      switchToText("No microphone was found, so let's continue by typing.");
      return;

    case "network":
      waitForMic("Voice needs an internet connection. Check it and tap the mic, or type below.");
      return;

    default:
      waitForMic("Something went wrong with the mic. Tap to try again, or type below.");
  }
}

function waitForMic(message) {
  setStatus(message);
  el.btnMic.hidden = state.mode !== "voice";
}

function switchToText(message) {
  state.mode = "text";
  el.btnMic.hidden = true;
  addMessage("bot", message);
  setStatus("Type your answer below and press Enter.");
  el.input.focus();
}

// ---------- UI helpers ----------

/** Show a bot message in the transcript and, in voice mode, say it aloud. */
async function botSays(text) {
  addMessage("bot", text);
  if (state.mode === "voice") {
    setStatus("Talent Finder is speaking…");
    await voice.speak(text);
  }
}

function addMessage(who, text) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  const label = document.createElement("span");
  label.className = "who";
  label.textContent = who === "bot" ? "Talent Finder" : "You";
  const body = document.createElement("span");
  body.textContent = text; // textContent (not innerHTML) keeps user text safe
  div.append(label, body);
  el.transcript.append(div);
  el.transcript.scrollTop = el.transcript.scrollHeight;
  hideCaption();
}

function setListeningUI(on) {
  el.btnMic.hidden = on || state.mode !== "voice";
  el.btnDone.hidden = !on;
  if (!on) hideCaption();
}

function showCaption(text) {
  el.caption.hidden = !text;
  el.caption.textContent = text ? `You're saying: ${text}` : "";
}

function hideCaption() {
  el.caption.hidden = true;
  el.caption.textContent = "";
}

function setStatus(text) {
  el.status.textContent = text;
}

function show(screen) {
  for (const s of [el.welcome, el.interview, el.done]) s.hidden = s !== screen;
}
