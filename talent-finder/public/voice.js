// voice.js — a small wrapper around the browser's built-in speech features.
//
//   speak(text)  -> the bot talks (speechSynthesis). Returns a Promise that
//                   resolves when it finishes talking.
//   listen(opts) -> the mic listens (SpeechRecognition). Returns a Promise that
//                   resolves with what the user said, or rejects with an error
//                   code such as "no-speech" or "not-allowed".
//
// PRIVACY NOTE: in Chrome and Edge, speech recognition sends audio to the
// browser maker's servers to turn it into text. Safari uses Apple's service.
// The app itself never stores or uploads the audio.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const support = {
  listen: Boolean(Recognition),
  speak: "speechSynthesis" in window,
};

// ---------- Speaking (text-to-speech) ----------

let chosenVoice = null;

// Voices load asynchronously in some browsers, so pick one once they arrive.
// We prefer natural-sounding English voices when the device has them.
function pickVoice() {
  if (!support.speak) return;
  const voices = speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
  chosenVoice =
    english.find((v) => /natural|aria|jenny|samantha|google us english/i.test(v.name)) ||
    english.find((v) => v.default) ||
    english[0] ||
    null;
}
if (support.speak) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

/** Say `text` out loud. Resolves when finished (or immediately if unsupported). */
export function speak(text) {
  return new Promise((resolve) => {
    if (!support.speak) return resolve();

    stopSpeaking(); // never talk over ourselves
    const utterance = new SpeechSynthesisUtterance(text);
    if (chosenVoice) utterance.voice = chosenVoice;
    utterance.rate = 0.97; // a touch slower feels calmer

    // Some browsers occasionally never fire "end". This safety timer makes
    // sure the app never gets stuck waiting.
    const safety = setTimeout(done, 2000 + text.length * 90);
    function done() {
      clearTimeout(safety);
      resolve();
    }
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  if (support.speak) speechSynthesis.cancel();
}

// ---------- Listening (speech-to-text) ----------

let active = null; // the recognition session currently running, if any

/**
 * Listen for one answer.
 *  - Keeps listening while the person talks, so short pauses don't cut them off.
 *  - Finishes after `endSilenceMs` of quiet once they've said something.
 *  - Rejects with "no-speech" if they say nothing for `startSilenceMs`.
 *  - opts.onInterim(text) is called with live captions while they talk.
 */
export function listen({ onInterim = () => {}, endSilenceMs = 2500, startSilenceMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(errorWithCode("unsupported"));
    stopListening(); // only one session at a time

    const rec = new Recognition();
    rec.lang = "en-US";
    rec.continuous = true; // don't stop at the first short pause
    rec.interimResults = true; // gives us live captions

    let finalText = "";
    let settled = false;
    let silenceTimer = setTimeout(() => finish("no-speech"), startSilenceMs);

    function finish(errorCode) {
      if (settled) return;
      settled = true;
      clearTimeout(silenceTimer);
      try { rec.abort(); } catch { /* already stopped */ }
      if (active === rec) active = null;
      const text = finalText.trim();
      // "aborted" means the app cancelled on purpose, so discard partial text.
      if (errorCode === "aborted" || (errorCode && !text)) reject(errorWithCode(errorCode));
      else resolve(text);
    }

    rec.onresult = (event) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece + " ";
        else interim += piece;
      }
      onInterim((finalText + interim).trim());

      // They're talking: restart the "are they done?" timer.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish(null), endSilenceMs);
    };

    rec.onerror = (event) => finish(event.error || "unknown");
    // The browser may end the session on its own (e.g. after a long time).
    rec.onend = () => finish("no-speech");

    // Lets the app say "I'm done" or cancel from outside.
    rec._finish = finish;
    active = rec;

    try {
      rec.start();
    } catch {
      finish("start-failed");
    }
  });
}

/** Stop listening and keep whatever was heard so far ("I'm done" button). */
export function finishListening() {
  if (active) active._finish(null);
}

/** Stop listening and throw away the current session (e.g. user started typing). */
export function stopListening() {
  if (active) active._finish("aborted");
}

export function isListening() {
  return active !== null;
}

function errorWithCode(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}
