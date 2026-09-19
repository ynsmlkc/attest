// Draggable 3D TEE chip, ported from a plain three.js reference build into
// a self-contained React component. Purely decorative (no claims about the
// real Phala Cloud hardware's physical shape) — the canvas texture only
// prints facts already proven live elsewhere in this project (README).
import { useEffect, useRef } from "react";
import * as THREE from "three";

export function TeeChip() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    camera.position.set(0, 0, 17.5);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const dirLight1 = new THREE.DirectionalLight(0xdfa94f, 3.2);
    dirLight1.position.set(12, 16, 10);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 2.2);
    dirLight2.position.set(-12, -10, 14);
    scene.add(dirLight2);
    const pointLight = new THREE.PointLight(0x2dd4bf, 3.2, 50);
    pointLight.position.set(0, 2, 7);
    scene.add(pointLight);

    const cpuGroup = new THREE.Group();
    scene.add(cpuGroup);

    const pcbMat = new THREE.MeshPhongMaterial({ color: 0x0d1512, shininess: 90 });
    const heatSpreaderMat = new THREE.MeshPhongMaterial({ color: 0x1a2420, shininess: 120, specular: 0x666666 });
    const goldMat = new THREE.MeshPhongMaterial({ color: 0xdfa94f, shininess: 160, specular: 0xf0c77e });
    const tealMat = new THREE.MeshPhongMaterial({ color: 0x2dd4bf, shininess: 110, specular: 0x7ee8dc });
    const silverDieMat = new THREE.MeshPhongMaterial({ color: 0x2a3a33, shininess: 140, specular: 0x999999 });

    const pcb = new THREE.Mesh(new THREE.BoxGeometry(8.2, 8.2, 0.35), pcbMat);
    cpuGroup.add(pcb);

    for (let i = -3.7; i <= 3.7; i += 0.48) {
      const pinTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.38), goldMat);
      pinTop.position.set(i, 4.1, 0);
      cpuGroup.add(pinTop);
      const pinBottom = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.38), goldMat);
      pinBottom.position.set(i, -4.1, 0);
      cpuGroup.add(pinBottom);
      const pinLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.38), goldMat);
      pinLeft.position.set(-4.1, i, 0);
      cpuGroup.add(pinLeft);
      const pinRight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.38), goldMat);
      pinRight.position.set(4.1, i, 0);
      cpuGroup.add(pinRight);
    }

    const ihsBase = new THREE.Mesh(new THREE.BoxGeometry(6.4, 6.4, 0.45), heatSpreaderMat);
    ihsBase.position.z = 0.35;
    cpuGroup.add(ihsBase);
    const ihsCap = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.6, 0.28), silverDieMat);
    ihsCap.position.z = 0.65;
    cpuGroup.add(ihsCap);

    const core = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 3.6, 0.15),
      new THREE.MeshPhongMaterial({ color: 0x09090b, shininess: 180, specular: 0x2dd4bf }),
    );
    core.position.z = 0.85;
    cpuGroup.add(core);

    const borderMesh = new THREE.Mesh(new THREE.BoxGeometry(3.8, 3.8, 0.08), tealMat);
    borderMesh.position.z = 0.82;
    cpuGroup.add(borderMesh);

    // Laser-etched label on the die — real, verifiable facts only.
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "#dfa94f";
    ctx.lineWidth = 5;
    ctx.strokeRect(30, 30, 452, 452);
    ctx.strokeStyle = "rgba(45, 212, 191, 0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(30, 120); ctx.lineTo(120, 120); ctx.lineTo(160, 80);
    ctx.moveTo(30, 390); ctx.lineTo(120, 390); ctx.lineTo(160, 430);
    ctx.moveTo(482, 120); ctx.lineTo(392, 120); ctx.lineTo(352, 80);
    ctx.moveTo(482, 390); ctx.lineTo(392, 390); ctx.lineTo(352, 430);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 58px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ATTEST // TEE", 256, 205);
    ctx.fillStyle = "#dfa94f";
    ctx.font = "bold 26px monospace";
    ctx.fillText("SECURE ENCLAVE", 256, 255);
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "20px monospace";
    ctx.fillText("INTEL TDX v4 · DSTACK", 256, 300);
    ctx.fillText("VERIFIED ON SOROBAN", 256, 335);

    const texture = new THREE.CanvasTexture(canvas);
    const labelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 3.3),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    labelPlane.position.z = 0.94;
    cpuGroup.add(labelPlane);

    for (let x = -3.0; x <= 3.0; x += 0.8) {
      for (let y = -3.0; y <= 3.0; y += 0.8) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), goldMat);
        ball.position.set(x, y, -0.22);
        cpuGroup.add(ball);
      }
    }

    cpuGroup.rotation.x = 0.35;
    cpuGroup.rotation.y = -0.55;

    let isDragging = false;
    let prev = { x: 0, y: 0 };
    const spin = { x: 0.004, y: 0.01 };

    const pointerDown = (x: number, y: number) => {
      isDragging = true;
      prev = { x, y };
    };
    const pointerMove = (x: number, y: number) => {
      if (!isDragging) return;
      const dx = x - prev.x;
      const dy = y - prev.y;
      cpuGroup.rotation.y += dx * 0.01;
      cpuGroup.rotation.x += dy * 0.01;
      spin.y = dx * 0.006;
      spin.x = dy * 0.006;
      prev = { x, y };
    };
    const pointerUp = () => {
      isDragging = false;
    };

    const onMouseDown = (e: MouseEvent) => pointerDown(e.clientX, e.clientY);
    const onMouseMove = (e: MouseEvent) => pointerMove(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) pointerDown(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) pointerMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", pointerUp);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", pointerUp);

    const clock = new THREE.Clock();
    let frameId: number;

    function animate() {
      frameId = requestAnimationFrame(animate);
      if (!isDragging) {
        cpuGroup.rotation.y += spin.y;
        cpuGroup.rotation.x += spin.x;
        spin.y += (0.007 - spin.y) * 0.025;
        spin.x += (Math.sin(clock.getElapsedTime() * 0.7) * 0.002 - spin.x) * 0.025;
      }
      cpuGroup.position.y = Math.sin(clock.getElapsedTime() * 1.6) * 0.3;
      renderer.render(scene, camera);
    }
    animate();

    const handleResize = () => {
      const w = container.clientWidth || 400;
      const h = container.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", pointerUp);
      container.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", pointerUp);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative z-10 flex h-[380px] w-full max-w-[500px] cursor-grab items-center justify-center select-none active:cursor-grabbing sm:h-[440px]"
    />
  );
}
