'use strict';

/*
 * Plays the alert tone for a watched price change. This document exists only
 * because a service worker cannot use the audio API; it is created on demand
 * and closed by the browser when it idles.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'ptc-offscreen' || message.type !== 'ptc:sound') return;
  try {
    const AudioCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const start = ctx.currentTime;
    [880, 1180].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + index * 0.18;
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
    setTimeout(() => { try { ctx.close(); } catch (error) { /* closed */ } }, 900);
  } catch (error) {
    /* audio unavailable: the desktop notification still shows */
  }
});
