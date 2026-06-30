// Tiny Web-Audio SFX for the play loop — moved out of the game-engine page (stage 5a).
// No assets: sounds are synthesized on demand. The AudioContext is created lazily on
// the first call (a key press = a user gesture, so autoplay policy is satisfied) and
// reused thereafter. SSR-safe: `window` is only touched inside the call (guarded), and
// the whole thing is wrapped so a missing/blocked audio stack stays silent.

let swooshCtx: AudioContext | null = null

/** A short synthesized "swoosh" for a melee swing — decaying noise through a bandpass that
 *  sweeps down. Lazily creates the AudioContext on the first swing; no-op during SSR. */
export function playSwoosh(): void {
  if (typeof window === 'undefined') return
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    swooshCtx = swooshCtx ?? new Ctor()
    const ctx = swooshCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const dur = 0.16
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) // decaying noise
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.1
    bp.frequency.setValueAtTime(1900, ctx.currentTime)
    bp.frequency.exponentialRampToValueAtTime(550, ctx.currentTime + dur) // sweep down = swoosh
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.22, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start()
  } catch {
    /* audio unavailable — stay silent */
  }
}
