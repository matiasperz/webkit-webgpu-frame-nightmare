# WebKit WebGPU Frame Nightmare

A minimal, pixel-provable repro of **iOS Safari presenting WebGPU canvas
frames out of order**, found while hunting a "the ball travels back" bug in
a JOYCO Jam mini-game.

## The bug

When the main thread stalls (iOS does this on every tap, ~40ms), WebKit
fires the queued `requestAnimationFrame` callbacks as a rapid catch-up
burst — deltas of 0–6ms. A render loop that renders on every callback (i.e.
every render loop ever written) then submits several drawables inside one
vsync window, and WebKit's WebGPU swapchain presents that queue **out of
order**: frame N+3, then N+2. The whole scene visibly steps backward for
one frame. The WebGL2 canvas path composites through the page's layer-tree
transaction and never reorders (one frame more latency, in lockstep with
DOM).

## What this page does

- Renders every rAF callback, deliberately unthrottled — the trigger.
- Blocks the main thread 45ms **on every tap** — mirroring iOS's own
  tap-time stall, because the bug only happens around taps.
- Paints the frame number **into the canvas** (big digits, steady colors —
  no strobing) — atomic with the frame's content, immune to the
  DOM-vs-canvas compositor-layer skew that fools DOM-based counters.
- Sweeps a single circle left↔right at constant velocity so the reorder is
  visible to the naked eye as the circle jumping backward on a tap.
- Shows the **negotiated** backend (three falls back silently) and
  `navigator.gpu` availability.

## How to prove it

1. Open on an iPhone (Safari 26+, where WebGPU is on by default).
2. Record the screen, tap a handful of times, stop.
3. Frame-step the video (QuickTime, ←/→). **The number painted in the
   canvas must never decrease.** On iOS + WebGPU, it does.
4. Add `?backend=webgl` and refresh — same page, WebGL2 backend: the number
   never goes backward. That's the control group.

## The workaround (for real apps)

Never submit more than one drawable per vsync: skip the *render* (never the
sim) for rAF callbacks arriving <6ms after the previous one. A burst frame
can't get its own display slot anyway — queuing it is what gets reordered.

## Run

```bash
npm install
npm run dev
```
