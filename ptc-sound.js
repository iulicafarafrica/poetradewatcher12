/*
 * Page-side watch alert.
 *
 * Chrome plays the two tones in an offscreen document, because a service
 * worker has no audio. Firefox has no offscreen API, so the worker asks
 * whichever extension page is open - the sidebar or a trade tab - to play it
 * through this file instead. Both browsers load it; only Firefox needs it.
 */
(function (root) {
  'use strict';

  let context = null;

  function tone(startAt, frequency, duration) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.09, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function play() {
    try {
      const AudioCtor = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtor) return;
      if (!context) context = new AudioCtor();
      /* A page that has not been touched yet starts suspended; asking to
         resume is all that can be done without a gesture. */
      if (context.state === 'suspended' && typeof context.resume === 'function') context.resume();
      const now = context.currentTime;
      tone(now, 880, 0.12);
      tone(now + 0.16, 1180, 0.14);
    } catch (error) {
      /* the sound is a nicety; never let it break the page */
    }
  }

  root.PTC_SOUND = { play: play };

  if (!root.chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.target !== 'ptc-sound-page' || message.type !== 'ptc:sound') return;
    play();
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
