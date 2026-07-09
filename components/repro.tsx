"use client"

/**
 * WebKit WebGPU Frame Nightmare — a minimal, pixel-provable repro of iOS
 * Safari presenting WebGPU canvas frames OUT OF ORDER.
 *
 * The trigger (discovered hunting a "ball travels back" bug in a game):
 * when the main thread stalls (iOS does this on every tap, ~40ms), WebKit
 * fires the queued rAF callbacks as a rapid catch-up burst — deltas of
 * 0–6ms. A render loop that renders on EVERY callback (i.e. every render
 * loop ever written) then submits several drawables inside one vsync
 * window, and WebKit's WebGPU swapchain has been caught on video presenting
 * that queue out of order: frame N+3, then N+2 — the whole scene visibly
 * steps backward for one frame. The WebGL2 canvas path composites through
 * the page's layer-tree transaction and never reorders.
 *
 * This demo makes it undeniable:
 *  - renders every rAF callback, deliberately unthrottled
 *  - busy-waits ~45ms on every tap (mirroring iOS's own tap-time stall —
 *    the jank ONLY happens around taps, so the trigger is the tap)
 *  - burns the frame number INTO the canvas (big digits, steady colors —
 *    no strobing) — atomic with the frame's content, so a screen recording
 *    frame-stepped in QuickTime is proof, not perception
 *  - a single circle sweeps left↔right at constant speed as the eye's
 *    smooth-pursuit target: a reordered frame reads as the circle jumping
 *    backward
 *  - the DOM shows its own counter — on iOS it drifts out of sync with the
 *    canvas (independent compositor layers), which is its own little show
 *
 * Reading it: record the screen, frame-step. The in-canvas number must
 * never decrease. When it does, that frame is the bug.
 *
 * `?backend=webgl` forces the WebGL2 backend (refresh to apply) — the
 * control group. `?backend=webgpu` is the default explicit form.
 */
import { useEffect, useRef, useState } from "react"
import * as THREE from "three/webgpu"

const STALL_MS = 45
const CIRCLE_SPEED = 7 // world units/s — fast enough for smooth pursuit

type Backend = "pending" | "webgpu" | "webgl2"

export function Repro() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const domCounterRef = useRef<HTMLSpanElement>(null)
  const stallFlashRef = useRef<HTMLSpanElement>(null)
  const [backend, setBackend] = useState<Backend>("pending")
  const [requested, setRequested] = useState<string>("webgpu")

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const params = new URLSearchParams(window.location.search)
    const wantWebGL = params.get("backend") === "webgl"
    queueMicrotask(() => {
      setRequested(wantWebGL ? "webgl" : "webgpu")
    })

    const renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: wantWebGL,
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // --- scene: ortho view, scrolling bars, in-canvas frame beacon --------
    const scene = new THREE.Scene()
    scene.background = new THREE.Color("#141221")
    const camera = new THREE.OrthographicCamera(-1, 1, 5, -5, 0.1, 100)
    camera.position.z = 10

    // Smooth-pursuit target: one circle sweeping left↔right at constant
    // speed (triangle wave — constant velocity, so any backward jump
    // mid-sweep is the bug, not the motion design).
    const circle = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 48),
      new THREE.MeshBasicMaterial({ color: "#e23d3d" }),
    )
    circle.position.y = -1.2
    scene.add(circle)

    // The in-canvas frame number: 2D canvas → texture, redrawn per frame.
    const label = document.createElement("canvas")
    label.width = 1024
    label.height = 256
    const labelCtx = label.getContext("2d")!
    const labelTex = new THREE.CanvasTexture(label)
    const labelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2),
      new THREE.MeshBasicMaterial({ map: labelTex }),
    )
    labelPlane.position.y = 3.4
    scene.add(labelPlane)

    let frame = 0
    let travel = 0
    let last = 0
    let raf = 0
    let disposed = false

    // The stall: a deliberate main-thread block, fired ON TAP only — the
    // bug is tap-correlated in the wild because iOS's own gesture handling
    // produces exactly this stall on every touch.
    const stall = () => {
      // Stays rendered until the next stall replaces it — the frame stamp
      // is the recency indicator, and it names the trace row to inspect.
      const flash = stallFlashRef.current
      if (flash) {
        flash.textContent = `⏸ ${STALL_MS}ms stall @ ${frame}`
        flash.style.opacity = "1"
      }
      const end = performance.now() + STALL_MS
      while (performance.now() < end) {
        // busy-wait: simulating WebKit's tap-time main-thread stall
      }
    }
    const onPointerDown = () => stall()

    // Steady colors on purpose: the number alone is the proof, and a
    // per-frame color flip would strobe at refresh rate (photosensitivity
    // hazard).
    const drawLabel = () => {
      labelCtx.fillStyle = "#1d1a2e"
      labelCtx.fillRect(0, 0, label.width, label.height)
      labelCtx.fillStyle = "#ffffff"
      labelCtx.font = "700 190px ui-monospace, Menlo, monospace"
      labelCtx.textAlign = "center"
      labelCtx.textBaseline = "middle"
      labelCtx.fillText(String(frame), label.width / 2, label.height / 2 + 8)
      labelTex.needsUpdate = true
    }

    const tick = (now: number) => {
      if (disposed) return
      raf = requestAnimationFrame(tick)

      const dt = last ? (now - last) / 1000 : 0
      last = now
      frame++

      // Advance by raw dt — honest motion, nothing smoothed. Triangle-wave
      // ping-pong keeps velocity constant except at the edges.
      travel += dt * CIRCLE_SPEED
      const half = Math.max(camera.right - 1.2, 1)
      const span = half * 2
      const phase = travel % (span * 2)
      circle.position.x = phase < span ? phase - half : half - (phase - span)

      drawLabel()

      const dom = domCounterRef.current
      if (dom) dom.textContent = String(frame)

      // THE TRIGGER: render every rAF callback, no one-drawable-per-vsync
      // guard. During a stall's catch-up burst this submits several
      // drawables inside one vsync window — the queue WebKit reorders.
      renderer.render(scene, camera)
    }

    const setSize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      renderer.setSize(w, h, false)
      const aspect = w / h
      camera.left = -5 * aspect
      camera.right = 5 * aspect
      camera.updateProjectionMatrix()
    }

    const init = renderer.init().then(() => {
      if (disposed) return
      const negotiated =
        (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ===
        true
          ? "webgpu"
          : "webgl2"
      setBackend(negotiated)
      setSize()
      window.addEventListener("resize", setSize)
      window.addEventListener("pointerdown", onPointerDown)
      raf = requestAnimationFrame(tick)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", setSize)
      window.removeEventListener("pointerdown", onPointerDown)
      labelTex.dispose()
      for (const obj of scene.children as THREE.Mesh[]) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
      init.finally(() => renderer.dispose())
    }
  }, [])

  const other = requested === "webgl" ? "webgpu" : "webgl"

  return (
    <div className="fixed inset-0 h-dvh w-full touch-none select-none overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />

      {/* DOM overlay — a SEPARATE compositor layer, on purpose: on iOS it
          visibly drifts out of sync with the canvas beacon. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-3 pt-2 font-mono text-xs">
        <span
          className={`rounded px-2 py-0.5 font-bold uppercase tracking-widest ${
            backend === "webgpu"
              ? "bg-red-500 text-white"
              : backend === "webgl2"
                ? "bg-emerald-400 text-black"
                : "bg-white/20 text-white"
          }`}
        >
          {backend === "pending" ? "negotiating…" : backend}
        </span>
        <span className="text-white/60">
          DOM counter: <span ref={domCounterRef}>0</span>
        </span>
        <span ref={stallFlashRef} className="text-amber-300 opacity-0" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex flex-col items-center gap-2 px-6 text-center font-mono text-xs text-white/70">
        <p className="max-w-md">
          <b className="text-white">TAP THE SCREEN</b> — the bug only happens
          around taps. Each tap blocks the main thread 45ms (mimicking
          iOS&apos;s own tap-time stall) → WebKit fires a rAF catch-up burst →
          this page renders every callback, unthrottled. Watch the circle
          jump backward on the tap. To prove it: record the screen, tap a
          few times, frame-step the video — the number painted in the canvas
          must never decrease. On iOS + WebGPU, it does.
        </p>
        <a
          href={`?backend=${other}`}
          className="pointer-events-auto rounded border border-white/30 px-3 py-1.5 text-white underline-offset-4 hover:underline"
        >
          switch to {other} →
        </a>
      </div>
    </div>
  )
}
