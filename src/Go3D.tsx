import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Go3D – Minimal 3D Go board for React + Three.js (no react-three-fiber)
 * - 19/13/9 grid, star points, wood block
 * - Click to place stones (snap-to-intersections)
 * - Turn handling + basic captures + no-suicide rule
 */
export default function Go3D() {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const uiStatusRef = useRef<HTMLDivElement | null>(null)
  const uiScoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!mountRef.current) return

    // ===== Settings =====
    const SETTINGS = {
      N: 19, // initial board size (9, 13, 19)
      BOARD_WORLD: 18,
      BOARD_THICKNESS: 0.6,
      GRID_ELEVATION: 0.002,
      STONE_SCALE_Y: 0.55,
      ENABLE_CAPTURES: true,
    } as const

    // ===== Scene basics =====
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0f14)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mountRef.current.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(
      50,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      100
    )
    camera.position.set(10, 14, 14)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.target.set(0, 0, 0)
    controls.maxPolarAngle = Math.PI * 0.49

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334466, 0.3)
    hemi.position.set(0, 1, 0)
    scene.add(hemi)

    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.position.set(7, 12, 8)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.near = 1
    dir.shadow.camera.far = 40
    dir.shadow.camera.left = -15
    dir.shadow.camera.right = 15
    dir.shadow.camera.top = 15
    dir.shadow.camera.bottom = -15
    scene.add(dir)

    // Soft ground for shadows
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.2 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -SETTINGS.BOARD_THICKNESS - 0.001
    ground.receiveShadow = true
    scene.add(ground)

    // ===== Game state =====
    const gridRoot = new THREE.Group() // board + grid + stars
    const stoneRoot = new THREE.Group() // stones
    scene.add(gridRoot, stoneRoot)

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) // y=0

    let N: number = SETTINGS.N
    let spacing = SETTINGS.BOARD_WORLD / (N - 1)
    let half = SETTINGS.BOARD_WORLD / 2

    let turn = 1 // 1=Black, 2=White
    let board: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
    let stoneMeshes: (THREE.Mesh | null)[][] = Array.from({ length: N }, () => Array(N).fill(null))
    let captures: Record<1 | 2, number> = { 1: 0, 2: 0 }

    // Materials & geometry (reused)
    const stoneGeomBase = new THREE.SphereGeometry(0.48, 40, 28)
    const blackMat = new THREE.MeshPhysicalMaterial({
      color: 0x111111,
      roughness: 0.25,
      metalness: 0.0,
      reflectivity: 0.2,
      clearcoat: 0.6,
      clearcoatRoughness: 0.3,
    })
    const whiteMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5f7fb,
      roughness: 0.15,
      metalness: 0.0,
      reflectivity: 0.25,
      clearcoat: 0.8,
      clearcoatRoughness: 0.25,
    })

    // ===== Build / Rebuild helpers =====
    function clearGroup(group: THREE.Group) {
      while (group.children.length) {
        const child = group.children.pop()!
        child.traverse((obj: any) => {
          if (obj.geometry) obj.geometry.dispose()
          // DO NOT dispose shared materials here
        })
      }
    }

    function buildBoard() {
      clearGroup(gridRoot)

      // Board block (top at y=0)
      const boardBlock = new THREE.Mesh(
        new THREE.BoxGeometry(
          SETTINGS.BOARD_WORLD + spacing * 1.2,
          SETTINGS.BOARD_THICKNESS,
          SETTINGS.BOARD_WORLD + spacing * 1.2
        ),
        new THREE.MeshPhysicalMaterial({ color: 0xc89f6b, roughness: 0.6, clearcoat: 0.1 })
      )
      boardBlock.position.y = -SETTINGS.BOARD_THICKNESS / 2
      boardBlock.receiveShadow = true
      gridRoot.add(boardBlock)

      // Grid lines
      const positions: number[] = []
      const y = SETTINGS.GRID_ELEVATION
      for (let i = 0; i < N; i++) {
        const t = -half + i * spacing
        positions.push(-half, y, t, half, y, t) // horizontal
        positions.push(t, y, -half, t, y, half) // vertical
      }
      const lineGeo = new THREE.BufferGeometry()
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const lineMat = new THREE.LineBasicMaterial({ color: 0x111111 })
      const grid = new THREE.LineSegments(lineGeo, lineMat)
      gridRoot.add(grid)

      // Star points
      const starsBySize: Record<number, number[]> = { 19: [3, 9, 15], 13: [3, 6, 9], 9: [2, 4, 6] }
      const idxs = starsBySize[N] || []
      const starGeom = new THREE.CylinderGeometry(0.06 * (19 / N), 0.06 * (19 / N), 0.02, 24)
      const starMat = new THREE.MeshBasicMaterial({ color: 0x111111 })
      for (const a of idxs) {
        for (const b of idxs) {
          const s = new THREE.Mesh(starGeom, starMat)
          s.position.set(-half + a * spacing, y + 0.01, -half + b * spacing)
          gridRoot.add(s)
        }
      }

      // Intersection labels
      const letters = 'ABCDEFGHJKLMNOPQRST'
      const labels = new THREE.Group()
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 128
          const ctx = canvas.getContext('2d')!
          ctx.font = '64px sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = '#111'
          const col = letters[i] || String(i + 1)
          const row = String(N - j)
          ctx.fillText(`${col}${row}`, 64, 64)
          const texture = new THREE.CanvasTexture(canvas)
          const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          })
          const sprite = new THREE.Sprite(material)
          sprite.scale.set(spacing * 0.45, spacing * 0.45, 1)
          const { x, z } = gridToWorld(i, j)
          sprite.position.set(x, y + 0.02, z)
          labels.add(sprite)
        }
      }
      gridRoot.add(labels)
    }

    function setupBoardSize(nextN: number) {
      N = nextN
      spacing = SETTINGS.BOARD_WORLD / (N - 1)
      half = SETTINGS.BOARD_WORLD / 2

      board = Array.from({ length: N }, () => Array(N).fill(0))
      stoneMeshes = Array.from({ length: N }, () => Array(N).fill(null))
      turn = 1
      captures = { 1: 0, 2: 0 }

      clearGroup(stoneRoot)
      buildBoard()
      updateStatus()
      updateScoreboard()
    }

    buildBoard()

    // Periodically sync board state from the Express API so that
    // stones placed by external scripts (e.g. Python client) appear.
    async function syncFromServer() {
      try {
        const res = await fetch('http://localhost:3000/api/board')
        const data = await res.json()
        const srv: number[][] = data.board
        for (let y = 0; y < srv.length; y++) {
          for (let x = 0; x < srv[y].length; x++) {
            const val = srv[y][x]
            if (board[x][y] !== val) {
              const existing = stoneMeshes[x][y]
              if (existing) {
                stoneRoot.remove(existing)
                stoneMeshes[x][y] = null
              }
              if (val === 1 || val === 2) {
                const { x: wx, z: wz } = gridToWorld(x, y)
                const s = createStoneMesh(val)
                s.position.set(wx, s.scale.y + 0.003, wz)
                stoneRoot.add(s)
                stoneMeshes[x][y] = s
              }
              board[x][y] = val
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('sync failed', err)
      }
    }

    const syncInterval = window.setInterval(syncFromServer, 1000)
    syncFromServer()

    // ===== Rules helpers =====
    function neighbors(i: number, j: number) {
      const out: [number, number][] = []
      if (i > 0) out.push([i - 1, j])
      if (i < N - 1) out.push([i + 1, j])
      if (j > 0) out.push([i, j - 1])
      if (j < N - 1) out.push([i, j + 1])
      return out
    }

    function collectGroupAndLiberties(i: number, j: number, boardOverrideEmpty: Set<string> | null = null) {
      const color = board[i][j]
      if (!color) return { cells: new Set<string>(), liberties: new Set<string>() }
      const key = (a: number, b: number) => `${a},${b}`
      const cells = new Set<string>()
      const liberties = new Set<string>()
      const stack: [number, number][] = [[i, j]]
      cells.add(key(i, j))

      while (stack.length) {
        const [ci, cj] = stack.pop()!
        for (const [ni, nj] of neighbors(ci, cj)) {
          const k = key(ni, nj)
          const treatedEmpty = boardOverrideEmpty && boardOverrideEmpty.has(k)
          const val = treatedEmpty ? 0 : board[ni][nj]
          if (val === 0) liberties.add(k)
          else if (val === color && !cells.has(k)) {
            cells.add(k)
            stack.push([ni, nj])
          }
        }
      }
      return { cells, liberties }
    }

    function gridToWorld(i: number, j: number) {
      const x = -half + i * spacing
      const z = -half + j * spacing
      return { x, z }
    }

    function createStoneMesh(color: 1 | 2) {
      const mesh = new THREE.Mesh(stoneGeomBase, color === 1 ? blackMat : whiteMat)
      mesh.scale.set(0.5 * spacing, 0.5 * spacing * SETTINGS.STONE_SCALE_Y, 0.5 * spacing)
      mesh.castShadow = true
      return mesh
    }

    function updateStatus(text?: string) {
      if (!uiStatusRef.current) return
      const who = turn === 1 ? 'Black' : 'White'
      uiStatusRef.current.textContent = text ?? `${who} to play`
    }

    function flashStatus(msg: string) {
      const who = turn === 1 ? 'Black' : 'White'
      updateStatus(msg)
      setTimeout(() => updateStatus(`${who} to play`), 900)
    }

    function countTerritory() {
      const out: Record<1 | 2, number> = { 1: 0, 2: 0 }
      const visited = Array.from({ length: N }, () => Array(N).fill(false))
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (board[i][j] !== 0 || visited[i][j]) continue
          const stack: [number, number][] = [[i, j]]
          visited[i][j] = true
          let size = 0
          const borders = new Set<number>()
          while (stack.length) {
            const [x, y] = stack.pop()!
            size++
            for (const [nx, ny] of neighbors(x, y)) {
              const cell = board[nx][ny]
              if (cell === 0 && !visited[nx][ny]) {
                visited[nx][ny] = true
                stack.push([nx, ny])
              } else if (cell !== 0) {
                borders.add(cell)
              }
            }
          }
          if (borders.size === 1) {
            const color = borders.values().next().value as 1 | 2
            out[color] += size
          }
        }
      }
      return out
    }

    function updateScoreboard() {
      if (!uiScoreRef.current) return
      const terr = countTerritory()
      uiScoreRef.current.textContent = `B Capt:${captures[1]} Terr:${terr[1]} | W Capt:${captures[2]} Terr:${terr[2]}`
    }

    function tryPlace(i: number, j: number) {
      if (board[i][j] !== 0) return // occupied
      const color = turn as 1 | 2
      const enemy = color === 1 ? 2 : 1

      // hypothetical place
      board[i][j] = color

      // enemy captures around
      const capturedSet = new Set<string>()
      for (const [ni, nj] of neighbors(i, j)) {
        if (board[ni][nj] === enemy) {
          const { cells, liberties } = collectGroupAndLiberties(ni, nj)
          if (liberties.size === 0) cells.forEach((k) => capturedSet.add(k))
        }
      }

      // suicide check (ignore liberties opened by captured stones)
      const placedGroup = collectGroupAndLiberties(i, j, capturedSet)
      const suicide = placedGroup.liberties.size === 0 && capturedSet.size === 0
      if (SETTINGS.ENABLE_CAPTURES && suicide) {
        board[i][j] = 0 // revert
        flashStatus('Illegal move (suicide).')
        return
      }

      // commit stone mesh
      const { x, z } = gridToWorld(i, j)
      const stone = createStoneMesh(color)
      stone.position.set(x, stone.scale.y + 0.003, z)
      stoneRoot.add(stone)
      stoneMeshes[i][j] = stone

      // remove captured stones
      if (SETTINGS.ENABLE_CAPTURES && capturedSet.size > 0) {
        capturedSet.forEach((k) => {
          const [ci, cj] = k.split(',').map(Number)
          const m = stoneMeshes[ci][cj]
          if (m) {
            stoneRoot.remove(m)
            // geometry is shared; do not dispose here
          }
          stoneMeshes[ci][cj] = null
          board[ci][cj] = 0
        })
        captures[color] += capturedSet.size
        flashStatus(`${capturedSet.size} stone${capturedSet.size > 1 ? 's' : ''} captured.`)
      }

      // next turn
      turn = turn === 1 ? 2 : 1
      updateStatus()
      updateScoreboard()
    }

    // ===== Interaction =====
    function onPointerDown(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      mouse.set(x, y)
      raycaster.setFromCamera(mouse, camera)
      const intersection = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, intersection)) return

      // Snap to grid
      const i = Math.round((intersection.x + half) / spacing)
      const j = Math.round((intersection.z + half) / spacing)
      if (i < 0 || i >= N || j < 0 || j >= N) return
      tryPlace(i, j)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)

    // ===== UI callbacks (wired via DOM dataset hooks below) =====
    function resetGame() {
      clearGroup(stoneRoot)
      for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) board[a][b] = 0, (stoneMeshes[a][b] = null)
      turn = 1
      captures = { 1: 0, 2: 0 }
      updateStatus()
      updateScoreboard()
      // keep server in sync if it's running
      fetch('http://localhost:3000/api/reset', { method: 'POST' }).catch(() => {})
    }

    function cycleBoard() {
      const sizes = [19, 13, 9]
      const idx = sizes.indexOf(N)
      const next = sizes[(idx + 1) % sizes.length]
      setupBoardSize(next)
      const btn = mountRef.current?.querySelector<HTMLButtonElement>('[data-go-size]')
      if (btn) btn.textContent = `Board Size: ${next}×${next}`
    }

    // ===== Render loop =====
    let stop = false
    const loop = () => {
      if (stop) return
      requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    // ===== Resize handling =====
    function onResize() {
      if (!mountRef.current) return
      const w = mountRef.current.clientWidth
      const h = mountRef.current.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // Initialize status text
    updateStatus()
    updateScoreboard()

    // Hook buttons
    const resetBtn = mountRef.current.querySelector<HTMLButtonElement>('[data-go-reset]')
    const sizeBtn = mountRef.current.querySelector<HTMLButtonElement>('[data-go-size]')
    resetBtn?.addEventListener('click', resetGame)
    sizeBtn?.addEventListener('click', cycleBoard)

    // Cleanup
    return () => {
      stop = true
      resetBtn?.removeEventListener('click', resetGame)
      sizeBtn?.removeEventListener('click', cycleBoard)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onResize)
      clearInterval(syncInterval)
      controls.dispose()
      renderer.dispose()
      mountRef.current?.removeChild(renderer.domElement)
      clearGroup(stoneRoot)
      clearGroup(gridRoot)
      stoneGeomBase.dispose()
      // materials are GC'd with scene teardown
    }
  }, [])

  return (
    <div className="relative w-full h-[min(78vh,800px)] bg-[#0b0f14] rounded-2xl overflow-hidden shadow-xl border border-white/10">
      {/* UI Overlay */}
      <div className="absolute left-4 top-4 z-10 select-none">
        <div className="text-xs font-semibold text-white/80">3D Go – Draft</div>
        <div ref={uiStatusRef} className="text-[13px] text-white/80" />
        <div ref={uiScoreRef} className="text-[13px] text-white/80 mb-2" />
        <div className="flex gap-2">
          <button
            data-go-reset
            className="px-3 py-1.5 text-[13px] rounded-lg border border-white/15 bg-white/5 text-white/90 hover:bg-white/10"
          >
            Reset
          </button>
          <button
            data-go-size
            className="px-3 py-1.5 text-[13px] rounded-lg border border-white/15 bg-white/5 text-white/90 hover:bg-white/10"
          >
            Board Size: 19×19
          </button>
        </div>
      </div>

      {/* Hint */}
      <div className="absolute right-4 bottom-4 z-10 text-[12px] text-white/70 select-none">
        Left‑drag orbit • Right‑drag pan • Wheel zoom • Click to place
      </div>

      {/* Three canvas mount */}
      <div ref={mountRef} className="w-full h-full" />
    </div>
  )
}