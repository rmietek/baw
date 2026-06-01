<script>
  // Animowane tło 3D (Three.js) — symulacja lotów rakiet i przechwytników.
  // Rakiety (pomarańczowe) lecą po krzywej Beziera od dołu ku górze.
  // Przechwytniki (niebieskie) startują z dołu i gonią wybrane rakiety.
  // Kolizja w odległości < 22 px → wybuch z efektem cząsteczkowym.
  // Komponent renderuje się na canvasie za całą resztą UI (z-index: -1).
  import { onMount } from 'svelte';
  import * as THREE from 'three';

  let canvas;  // referencja do <canvas> — przekazywana do WebGLRenderer

  const TRAIL_LEN = 45;        // długość śladu (liczba zapamiętanych pozycji)
  const BG_COLOR  = 0x07090e;  // kolor tła: granatowa czerń
  const rand      = (a, b) => a + Math.random() * (b - a);  // losowa liczba z [a, b)

  // Tworzy rakietę: głowica (pomarańczowy krąg), poświata i ślad.
  // Trajektoria = krzywa kwadratowa Beziera. Parametr t (0→1) inkrementowany w pętli animate.
  // Po t>=1 rakieta wybucha w endPos.
  function spawnMissile(scene, W, H) {
    const sx = rand(-W * 0.45, W * 0.45);
    const sy = rand(H * 0.15,  H * 0.48);
    const ex = rand(-W * 0.4,  W * 0.4);
    const ey = rand(-H * 0.48, -H * 0.1);
    const cx = (sx + ex) / 2 + rand(-120, 120);
    const cy = Math.max(sy, ey) + rand(60, 200);

    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(sx, sy, 0),
      new THREE.Vector3(cx, cy, 0),
      new THREE.Vector3(ex, ey, 0),
    );

    const headGeo = new THREE.CircleGeometry(3, 8);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xff5522, blending: THREE.AdditiveBlending, transparent: true });
    const head    = new THREE.Mesh(headGeo, headMat);
    scene.add(head);

    const glowGeo = new THREE.CircleGeometry(10, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2200, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.18 });
    const glow    = new THREE.Mesh(glowGeo, glowMat);
    scene.add(glow);

    const trailPos = new Float32Array(TRAIL_LEN * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 1);
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
    const trail    = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    return {
      curve, head, glow, trail, trailGeo,
      history: [],
      t:            0,
      speed:        rand(0.0008, 0.0018),
      done:         false,
      explodeTimer: 0,
      endPos:       new THREE.Vector3(ex, ey, 0),
    };
  }

  // Tworzy przechwytnik (niebieski) śledzący konkretną rakietę (target).
  // Porusza się po linii prostej w kierunku bieżącej pozycji celu z własną prędkością.
  // Kolizja (dist < 22) → oba obiekty oznaczone done=true, wspólny wybuch.
  function spawnInterceptor(scene, W, H, target) {
    const sx = rand(-W * 0.35, W * 0.35);
    const sy = -H * 0.42;

    const headGeo = new THREE.CircleGeometry(2.5, 8);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x44ccff, blending: THREE.AdditiveBlending, transparent: true });
    const head    = new THREE.Mesh(headGeo, headMat);
    head.position.set(sx, sy, 0);
    scene.add(head);

    const glowGeo = new THREE.CircleGeometry(9, 12);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x2299ff, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.2 });
    const glow    = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(sx, sy, 0);
    scene.add(glow);

    const trailPos = new Float32Array(TRAIL_LEN * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 1);
    const trailMat = new THREE.LineBasicMaterial({ color: 0x33aaff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const trail    = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);

    return {
      head, glow, trail, trailGeo,
      history:  [],
      pos:      new THREE.Vector3(sx, sy, 0),
      speed:    rand(2.8, 4.5),
      target,
      done:         false,
      explodeTimer: 0,
    };
  }

  // Tworzy wybuch: 70 cząsteczek rozchodzących się we wszystkich kierunkach,
  // pierścień uderzeniowy (rozszerza się) i błysk (szybko zanika).
  // Prędkości cząsteczek zanikają o 6%/klatkę. Życie wybuchu = 90 klatek (~1.5 s @60fps).
  function spawnExplosion(scene, x, y, color = 0xff7733) {
    const count     = 70;
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
      const angle = Math.random() * Math.PI * 2;
      const spd   = rand(0.6, 5);
      velocities.push({ vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 3, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    const ringGeo = new THREE.RingGeometry(1, 3, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, y, 0);
    scene.add(ring);

    const flashGeo = new THREE.CircleGeometry(8, 16);
    const flashMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const flash    = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, y, 0);
    scene.add(flash);

    return { points, geo, mat, ring, ringGeo, ringMat, flash, flashGeo, flashMat, velocities, life: 0, maxLife: 90 };
  }

  // Aktualizuje bufor śladu: wstawia nową pozycję na początek historii, usuwa najstarszą.
  // needsUpdate=true informuje Three.js że bufor GPU wymaga ponownego przesłania w tej klatce.
  function updateTrail(obj, px, py) {
    obj.history.unshift({ x: px, y: py });
    if (obj.history.length > TRAIL_LEN) obj.history.pop();
    const attr = obj.trailGeo.attributes.position;
    for (let j = 0; j < TRAIL_LEN; j++) {
      const h = obj.history[j] || { x: px, y: py };
      attr.setXYZ(j, h.x, h.y, 0);
    }
    attr.needsUpdate = true;
    obj.trailGeo.setDrawRange(0, obj.history.length);
  }

  // Usuwa obiekt rakiety/przechwytnika ze sceny i zwalnia pamięć GPU.
  // Three.js nie zwalnia geometrii automatycznie — dispose() jest wymagane.
  function removeMissile(scene, m) {
    scene.remove(m.head, m.glow, m.trail);
    m.head.geometry.dispose();
    m.glow.geometry.dispose();
    m.trailGeo.dispose();
  }

  onMount(() => {
    let W = window.innerWidth;
    let H = window.innerHeight;

    // Inicjalizacja renderera WebGL z antyaliasingiem, limit pixelRatio=2 dla Retina
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(BG_COLOR);

    // Scena 2D: kamera ortograficzna — jednostki = piksele, środek = centrum ekranu
    const scene  = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, 0.1, 100);
    camera.position.z = 10;

    // 250 losowych gwiazd w tle (ciemnoniebieskie punkty)
    const STAR_N  = 250;
    const starPos = new Float32Array(STAR_N * 3);
    for (let i = 0; i < STAR_N; i++) {
      starPos[i*3] = rand(-W/2, W/2); starPos[i*3+1] = rand(-H/2, H/2); starPos[i*3+2] = 0;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x2a3a4a, size: 1.2 })));

    // 30 losowych "budynków" na horyzoncie — ciemne prostokąty przy dolnej krawędzi
    for (let i = 0; i < 30; i++) {
      const bw = rand(18, 65), bh = rand(15, 110);
      const geo = new THREE.PlaneGeometry(bw, bh);
      const m   = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0d1420 }));
      m.position.set(rand(-W/2, W/2), -H/2 + bh/2, -1);
      scene.add(m);
    }

    const missiles      = [];
    const interceptors  = [];
    const explosions    = [];
    let animId, frame = 0;

    // Spawn 6 pierwszych rakiet z losowym opóźnieniem (0–5.3 s) dla efektu rozłożenia
    for (let i = 0; i < 6; i++) {
      setTimeout(() => missiles.push(spawnMissile(scene, W, H)), i * 800 + rand(0, 500));
    }

    const animate = () => {
      animId = requestAnimationFrame(animate);
      frame++;

      // Nowa rakieta co ~160 klatek (~2.7 s @60fps)
      if (frame % 160 === 0) missiles.push(spawnMissile(scene, W, H));

      // Nowy przechwytnik co ~200 klatek — wybiera losową aktywną rakietę w połowie lotu
      // Sprawdzenie alreadyTargeted zapobiega wysyłaniu wielu przechwytników na tę samą rakietę
      if (frame % 200 === 0) {
        const alive = missiles.filter(m => !m.done && m.t > 0.05 && m.t < 0.85);
        if (alive.length > 0) {
          const target = alive[Math.floor(Math.random() * alive.length)];
          const alreadyTargeted = interceptors.some(i => i.target === target && !i.done);
          if (!alreadyTargeted) interceptors.push(spawnInterceptor(scene, W, H, target));
        }
      }

      // Aktualizacja rakiet — iteracja od końca tablicy umożliwia bezpieczne splice()
      for (let i = missiles.length - 1; i >= 0; i--) {
        const m = missiles[i];
        if (m.done) {
          // Po wybuchu odczekaj 20 klatek (flash zanim obiekt zniknie)
          m.explodeTimer++;
          if (m.explodeTimer > 20) { removeMissile(scene, m); missiles.splice(i, 1); }
          continue;
        }
        m.t += m.speed;  // przesuń parametr krzywej Beziera
        if (m.t >= 1) {
          m.done = true; m.head.visible = m.glow.visible = false;
          explosions.push(spawnExplosion(scene, m.endPos.x, m.endPos.y, 0xff6622));
          continue;
        }
        const pos = m.curve.getPoint(m.t);
        m.head.position.copy(pos); m.glow.position.copy(pos);
        updateTrail(m, pos.x, pos.y);
      }

      // Aktualizacja przechwytników — naprowadzanie na cel metodą proportional pursuit
      for (let i = interceptors.length - 1; i >= 0; i--) {
        const intc = interceptors[i];
        if (intc.done) {
          intc.explodeTimer++;
          if (intc.explodeTimer > 20) { removeMissile(scene, intc); interceptors.splice(i, 1); }
          continue;
        }
        // Jeśli cel już zniszczony — przechwytnik znika bez wybuchu
        if (intc.target.done) { intc.done = true; intc.head.visible = intc.glow.visible = false; continue; }
        const tp  = intc.target.head.position;
        const dx  = tp.x - intc.pos.x, dy = tp.y - intc.pos.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        // Kolizja: oba obiekty zniszczone, eksplozja w punkcie spotkania (niebieska)
        if (dist < 22) {
          const ix = (intc.pos.x + tp.x) / 2, iy = (intc.pos.y + tp.y) / 2;
          intc.done = intc.target.done = true;
          intc.head.visible = intc.glow.visible = false;
          intc.target.head.visible = intc.target.glow.visible = false;
          explosions.push(spawnExplosion(scene, ix, iy, 0x55ddff));
          continue;
        }
        const spd = intc.speed / dist;
        intc.pos.x += dx * spd; intc.pos.y += dy * spd;
        intc.head.position.copy(intc.pos); intc.glow.position.copy(intc.pos);
        updateTrail(intc, intc.pos.x, intc.pos.y);
      }

      // Aktualizacja eksplozji — cząsteczki rozchodzą się i zwalniają (tarcie 0.94)
      for (let i = explosions.length - 1; i >= 0; i--) {
        const e = explosions[i];
        e.life++;
        const t = e.life / e.maxLife;  // t: 0 = świeży wybuch, 1 = koniec życia
        // Zanikanie przezroczystości cząsteczek, błysku i pierścienia
        e.mat.opacity      = Math.max(0, 1 - t * 1.2);
        e.flashMat.opacity = Math.max(0, 0.7 - t * 5);
        e.ringMat.opacity  = Math.max(0, 0.85 - t * 1.5);
        // Skalowanie pierścienia i błysku (rozszerzanie)
        const rs = 1 + t * 40; e.ring.scale.set(rs, rs, 1);
        const fs = 1 + t * 14; e.flash.scale.set(fs, fs, 1);
        const attr = e.geo.attributes.position;
        for (let j = 0; j < e.velocities.length; j++) {
          const v = e.velocities[j];
          attr.setX(j, attr.getX(j) + v.vx);
          attr.setY(j, attr.getY(j) + v.vy);
          v.vx *= 0.94; v.vy *= 0.94;  // stopniowe hamowanie cząsteczek
        }
        attr.needsUpdate = true;
        // Po maxLife klatkach — usuń ze sceny i zwolnij pamięć GPU
        if (e.life >= e.maxLife) {
          scene.remove(e.points, e.ring, e.flash);
          e.geo.dispose(); e.mat.dispose();
          e.ringGeo.dispose(); e.ringMat.dispose();
          e.flashGeo.dispose(); e.flashMat.dispose();
          explosions.splice(i, 1);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup: zatrzymaj pętlę animacji i zwolnij renderer gdy komponent zniknie z DOM
    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  });
</script>

<canvas
  bind:this={canvas}
  style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1"
/>
