import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

// ================== CONSTANTS ==================
const GRAVITY = -30;
const PLAYER_HEIGHT = 1.5;
const MOVE_SPEED = 8;
const SPRINT_MULT = 2.25;
const JUMP_POWER = 10;
const DOOR_DISTANCE = 2.2;

// Navigation points
const NAV_TARGETS = [
  { label: "Gate", position: new THREE.Vector3(5, 0, 10) },
  { label: "Parking Area", position: new THREE.Vector3(-8, 0, 4) },
  { label: "Cafeteria", position: new THREE.Vector3(12, 0, -6) },
  { label: "Security Office", position: new THREE.Vector3(-12, 0, -3) },
  { label: "Emergency Exit", position: new THREE.Vector3(0, 0, -15) },
];

// Clean mesh names
const formatName = (name) =>
  name.replace(/[_\-]/g, " ").replace(/\d+/g, "").replace(/\s+/g, " ").trim();

export default function ThreeDViewer({ modelUrl = "input.glb" }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navTargets, setNavTargets] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [mobileMode, setMobileMode] = useState(false);

  const activeTargetRef = useRef(null);
  const dummyPointRef = useRef(null);
  const targetWorldPosRef = useRef(new THREE.Vector3());

  const joystickRef = useRef({ active: false, startX: 0, startY: 0, x: 0, y: 0 });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ================= SCENE =================
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20232a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    // ================= LIGHTS =================
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // ================= CONTROLS =================
    const controls = new PointerLockControls(camera, renderer.domElement);
    const player = { velocity: new THREE.Vector3(), onGround: false };

    // ================= RAYCASTER =================
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const groundMeshes = [];
    const doors = [];

    const checkGround = () => {
      raycaster.set(camera.position, down);
      const hits = raycaster.intersectObjects(groundMeshes, false);
      const hit = hits.find((h) => h.distance <= PLAYER_HEIGHT + 0.35);
      if (hit) {
        player.onGround = true;
        player.velocity.y = Math.max(0, player.velocity.y);
        camera.position.y = hit.point.y + PLAYER_HEIGHT;
      } else {
        player.onGround = false;
      }
    };

    const checkDoors = () => {
      doors.forEach((d) => {
        d.userData.near =
          d.position.distanceTo(camera.position) < DOOR_DISTANCE &&
          !d.userData.opened;
      });
    };

    // ================= LOADER =================
    const manager = new THREE.LoadingManager();
    manager.onError = (url) => {
      console.error("Failed to load:", url);
      setError("Model failed to load. Check network or file path.");
      setLoading(false);
    };

    const loader = new GLTFLoader(manager);
    const draco = new DRACOLoader();
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    loader.setDRACOLoader(draco);

    loader.load(
      import.meta.env.BASE_URL + modelUrl,
      (gltf) => {
        gltf.scene.traverse((obj) => {
          if (obj.isMesh) {
            obj.frustumCulled = true;
            obj.geometry.computeBoundingSphere();
          }
        });

        scene.add(gltf.scene);

        const detectedTargets = [];
        const addedNames = new Set();

        let groundLevel = Infinity;

        gltf.scene.traverse((child) => {
          if (!child.isMesh) return;
          groundMeshes.push(child);

          const box = new THREE.Box3().setFromObject(child);
          if (box.min.y < groundLevel) groundLevel = box.min.y;

          if (child.name.toLowerCase().includes("door")) {
            child.userData.opened = false;
            child.userData.near = false;
            doors.push(child);
          }

          if (child.name && child.name.length > 2) {
            const label = formatName(child.name);
            if (!addedNames.has(label)) {
              detectedTargets.push({ label, type: "mesh", ref: child });
              addedNames.add(label);
            }
          }
        });

        setNavTargets([...detectedTargets, ...NAV_TARGETS.map(t => ({
          label: t.label,
          type: "point",
          position: t.position
        }))]);

        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        camera.position.set(center.x, groundLevel + PLAYER_HEIGHT, center.z + box.getSize(new THREE.Vector3()).z * 0.3);
        camera.lookAt(center);

        setLoading(false);
      },
      undefined,
      (err) => {
        console.error("GLTF load error:", err);
        setError("Model failed to load. Check network or file path.");
        setLoading(false);
      }
    );

    // ================= INPUT =================
    const keys = {};
    const downHandler = (e) => {
      if (!mobileMode) {
        keys[e.code] = true;
        if (e.code === "Space" && player.onGround) player.velocity.y = JUMP_POWER;
        if (e.code === "KeyE")
          doors.forEach((d) => {
            if (d.userData.near) {
              d.rotation.y -= Math.PI / 2;
              d.userData.opened = true;
            }
          });
      }
    };
    const upHandler = (e) => { if (!mobileMode) keys[e.code] = false; };
    document.addEventListener("keydown", downHandler);
    document.addEventListener("keyup", upHandler);
    renderer.domElement.addEventListener("click", () => { if (!mobileMode) controls.lock(); });

    // ================= NAV LINE =================
    const navGeometry = new THREE.BufferGeometry();
    navGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const navLine = new THREE.Line(navGeometry, new THREE.LineBasicMaterial({ color: 0xff4444, depthTest: false }));
    navLine.renderOrder = 999;
    scene.add(navLine);

    // ================= HUD =================
    const indicator = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.24, 32),
      new THREE.MeshBasicMaterial({ color: 0x00e0ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    ring.rotation.x = Math.PI / 2;

    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    arrow.position.z = 0.18;
    arrow.rotation.x = -Math.PI / 2;

    indicator.add(ring, arrow);
    indicator.visible = false;
    scene.add(indicator);

    // ================= MOBILE JOYSTICK =================
    const mobileInput = { forward: 0, right: 0 };
    const joystickOuter = document.createElement("div");
    const joystickInner = document.createElement("div");

    joystickOuter.style.position = "absolute";
    joystickOuter.style.width = "100px";
    joystickOuter.style.height = "100px";
    joystickOuter.style.borderRadius = "50%";
    joystickOuter.style.background = "rgba(0,0,0,0.25)";
    joystickOuter.style.left = "40px";
    joystickOuter.style.bottom = "40px";
    joystickOuter.style.zIndex = 100;
    joystickOuter.style.touchAction = "none";

    joystickInner.style.position = "absolute";
    joystickInner.style.width = "50px";
    joystickInner.style.height = "50px";
    joystickInner.style.borderRadius = "50%";
    joystickInner.style.background = "rgba(255,255,255,0.75)";
    joystickInner.style.left = "25px";
    joystickInner.style.top = "25px";
    joystickInner.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";

    joystickOuter.appendChild(joystickInner);
    mount.appendChild(joystickOuter);
    joystickOuter.style.display = mobileMode ? "block" : "none";

    let joystickStart = null;
    let joystickActive = false;

    const joystickMove = (touch) => {
      if (!joystickActive) return;
      const dx = touch.clientX - joystickStart.x;
      const dy = touch.clientY - joystickStart.y;
      const maxDist = 40;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, maxDist);
      joystickInner.style.transform = `translate(${clampedDist*Math.cos(angle)}px, ${clampedDist*Math.sin(angle)}px)`;
      mobileInput.right = clampedDist * Math.cos(angle)/maxDist;
      mobileInput.forward = clampedDist * Math.sin(angle)/maxDist; // ✅ fixed inversion
    };

    joystickOuter.addEventListener("touchstart", (e) => {
      joystickActive = true;
      const rect = joystickOuter.getBoundingClientRect();
      joystickStart = { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
      joystickMove(e.touches[0]);
    });

    window.addEventListener("touchmove", (e) => {
      if (!joystickActive) return;
      joystickMove(e.touches[0]);
    });

    window.addEventListener("touchend", (e) => {
      joystickActive = false;
      joystickInner.style.transform = "translate(0px,0px)";
      mobileInput.forward = 0;
      mobileInput.right = 0;
    });

    // ================= CAMERA ROTATE =================
    let rotateActive = false;
    let rotateStart = { x: 0, y: 0 };

    window.addEventListener("touchstart", (e) => {
      if (!mobileMode) return;
      if (e.target !== joystickInner && e.target !== joystickOuter) {
        if (e.touches.length === 1) {
          rotateActive = true;
          rotateStart.x = e.touches[0].clientX;
          rotateStart.y = e.touches[0].clientY;
        }
      }
    });

    window.addEventListener("touchmove", (e) => {
      if (!rotateActive) return;
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - rotateStart.x;
      const dy = e.touches[0].clientY - rotateStart.y;
      camera.rotation.y -= dx * 0.005;
      camera.rotation.x -= dy * 0.005;
      camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
      rotateStart.x = e.touches[0].clientX;
      rotateStart.y = e.touches[0].clientY;
    });

    window.addEventListener("touchend", () => rotateActive = false);

    // ================= ANIMATION LOOP =================
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (mobileMode) {
        const dir = new THREE.Vector3(mobileInput.right, 0, mobileInput.forward).applyEuler(camera.rotation);
        camera.position.addScaledVector(dir, MOVE_SPEED * delta);
      }
      player.velocity.y += GRAVITY * delta;
      checkGround();
      camera.position.y += player.velocity.y * delta;
      if (player.onGround) player.velocity.y = Math.max(0, player.velocity.y);

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", downHandler);
      document.removeEventListener("keyup", upHandler);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      scene.clear();
    };
  }, [modelUrl, mobileMode]);

  const handleSelect = (e) => {
    const value = e.target.value;
    setSelectedTarget(value);
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }} ref={mountRef}>
      {loading && <div style={overlayStyle}>Loading Building…</div>}
      {error && <div style={{ ...overlayStyle, color: "red" }}>{error}</div>}
      <select value={selectedTarget} onChange={handleSelect} style={selectStyle}>
        <option value="">Select Destination</option>
        {navTargets.map((t) => (
          <option key={t.label} value={t.label}>{t.label}</option>
        ))}
      </select>
      <button style={modeButtonStyle} onClick={() => setMobileMode(prev => !prev)}>
        {mobileMode ? "Switch to Desktop" : "Switch to Mobile"}
      </button>
      {mobileMode && (
        <button style={jumpButtonStyle} onClick={() => window.dispatchEvent(new Event('mobileJump'))}>Jump</button>
      )}
    </div>
  );
}

// ================= STYLES =================
const overlayStyle = {
  position: "absolute", inset: 0, background: "#000", color: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "42px", zIndex: 10
};
const selectStyle = {
  position: "absolute", top: "20px", left: "50%", transform: "translateX(-50%)",
  padding: "10px 14px", fontSize: "16px", borderRadius: "8px", border: "none", outline: "none", zIndex: 20
};
const modeButtonStyle = {
  position: "absolute", top: "60px", left: "50%", transform: "translateX(-50%)",
  padding: "10px 14px", fontSize: "16px", borderRadius: "8px", border: "none", zIndex: 20
};
const jumpButtonStyle = {
  position: "absolute", bottom: "40px", right: "40px", padding: "12px 16px",
  fontSize: "16px", borderRadius: "50%", background: "#00e0ff", color: "#000", border: "none", zIndex: 20
};
