// Orbit, pan, pinch and keyboard controls for the 3D wall camera.
export function createCameraControls(appState, deps) {
        function resetCamera() {
            appState.targetLookAt.set(0.15, 9.6, 1.35);
            appState.targetSpherical.set(25.5, Math.PI * 0.44, 0.34);
        }

        function zoomCamera(factor) {
            appState.targetSpherical.radius = Math.max(5.5, Math.min(42, appState.targetSpherical.radius * factor));
        }

        function setPanMode(enabled) {
            appState.isPanMode = !!enabled;
            const btn = document.getElementById('btn-toggle-pan');
            if (btn) {
                btn.classList.toggle('btn-icon-active', appState.isPanMode);
                btn.setAttribute('aria-pressed', appState.isPanMode ? 'true' : 'false');
            }
            if (appState.renderer && appState.renderer.domElement) {
                appState.renderer.domElement.style.cursor = appState.isPanMode ? 'grab' : 'default';
            }
        }

        function panCameraByPixels(dx, dy) {
            if (!appState.camera || !appState.renderer || !appState.targetLookAt || !appState.targetSpherical) return;
            const viewH = Math.max(1, appState.renderer.domElement.clientHeight || window.innerHeight);
            const halfFovRad = (appState.camera.fov * 0.5) * (Math.PI / 180);
            const worldPerPixel = (2 * appState.targetSpherical.radius * Math.tan(halfFovRad)) / viewH;

            const screenRight = new deps.THREE.Vector3().setFromMatrixColumn(appState.camera.matrixWorld, 0);
            screenRight.y = 0;
            if (screenRight.lengthSq() < 0.0001) {
                screenRight.set(Math.cos(appState.camSpherical.theta), 0, -Math.sin(appState.camSpherical.theta));
            }
            screenRight.normalize();

            appState.targetLookAt.addScaledVector(screenRight, -dx * worldPerPixel);
            appState.targetLookAt.y += dy * worldPerPixel;

            appState.targetLookAt.x = Math.max(-7.5, Math.min(8.5, appState.targetLookAt.x));
            appState.targetLookAt.y = Math.max(0.5, Math.min(19.5, appState.targetLookAt.y));
            appState.targetLookAt.z = Math.max(-3.5, Math.min(9.5, appState.targetLookAt.z));
        }

        function setupCameraControls(domElement) {
            const onPointerDown = (e) => {
                appState.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (appState.activePointers.size === 1) {
                    appState.isDragging = true;
                    appState.isPinching = false;
                    appState.hadMultiTouch = false;
                    appState.pointerDownPos = { x: e.clientX, y: e.clientY };
                    appState.lastPointerPos = { x: e.clientX, y: e.clientY };
                    if (appState.isPanMode || e.button === 2 || e.button === 1 || e.shiftKey) {
                        domElement.style.cursor = 'grabbing';
                    }
                } else if (appState.activePointers.size === 2) {
                    appState.isDragging = false;
                    appState.isPinching = true;
                    appState.hadMultiTouch = true;
                    const pts = Array.from(appState.activePointers.values());
                    appState.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                    appState.lastPointerPos = {
                        x: (pts[0].x + pts[1].x) / 2,
                        y: (pts[0].y + pts[1].y) / 2
                    };
                }
            };

            const onPointerMove = (e) => {
                if (!appState.activePointers.has(e.pointerId)) return;
                appState.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

                if (appState.isPinching && appState.activePointers.size === 2) {
                    const pts = Array.from(appState.activePointers.values());
                    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                    if (appState.lastPinchDist > 0) {
                        const scale = appState.lastPinchDist / Math.max(10, dist);
                        appState.targetSpherical.radius = Math.max(5.5, Math.min(42, appState.targetSpherical.radius * scale));
                    }
                    appState.lastPinchDist = dist;

                    const midX = (pts[0].x + pts[1].x) / 2;
                    const midY = (pts[0].y + pts[1].y) / 2;
                    const dx = midX - appState.lastPointerPos.x;
                    const dy = midY - appState.lastPointerPos.y;
                    panCameraByPixels(dx, dy);
                    appState.lastPointerPos = { x: midX, y: midY };
                    return;
                }

                if (appState.isDragging && appState.activePointers.size === 1) {
                    const dx = e.clientX - appState.lastPointerPos.x;
                    const dy = e.clientY - appState.lastPointerPos.y;
                    appState.lastPointerPos = { x: e.clientX, y: e.clientY };

                    const usePan = appState.isPanMode || (e.buttons & 2) !== 0 || (e.buttons & 4) !== 0 || e.shiftKey;
                    if (usePan) {
                        panCameraByPixels(dx, dy);
                    } else {
                        appState.targetSpherical.theta -= dx * 0.0068;
                        appState.targetSpherical.phi = Math.max(0.22, Math.min(Math.PI * 0.495, appState.targetSpherical.phi - dy * 0.0055));
                    }
                }
            };

            const onPointerUp = (e) => {
                if (!appState.activePointers.has(e.pointerId)) return;
                const wasSingle = appState.activePointers.size === 1 && !appState.isPinching && !appState.hadMultiTouch;
                appState.activePointers.delete(e.pointerId);

                if (appState.activePointers.size === 1) {
                    const remaining = Array.from(appState.activePointers.values())[0];
                    appState.lastPointerPos = { x: remaining.x, y: remaining.y };
                    appState.isPinching = false;
                    appState.isDragging = true;
                } else if (appState.activePointers.size === 0) {
                    appState.isPinching = false;
                    appState.isDragging = false;
                    appState.hadMultiTouch = false;
                    domElement.style.cursor = appState.isPanMode ? 'grab' : 'default';
                }

                if (wasSingle) {
                    const moved = Math.hypot(e.clientX - appState.pointerDownPos.x, e.clientY - appState.pointerDownPos.y);
                    if (moved < 9) {
                        deps.handleCanvasTap(e.clientX, e.clientY);
                    }
                }
            };

            const onWheel = (e) => {
                e.preventDefault();
                if (e.shiftKey) {
                    panCameraByPixels(-e.deltaX, -e.deltaY);
                } else {
                    const factor = e.deltaY > 0 ? 1.09 : 0.92;
                    zoomCamera(factor);
                }
            };

            const onKeyDown = (e) => {
                const tag = document.activeElement && document.activeElement.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                const stepPx = 42;
                if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                    e.preventDefault();
                    panCameraByPixels(0, stepPx);
                } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    panCameraByPixels(0, -stepPx);
                } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                    e.preventDefault();
                    panCameraByPixels(stepPx, 0);
                } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                    e.preventDefault();
                    panCameraByPixels(-stepPx, 0);
                }
            };

            domElement.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerUp);
            domElement.addEventListener('wheel', onWheel, { passive: false });
            domElement.addEventListener('contextmenu', (e) => e.preventDefault());
            window.addEventListener('keydown', onKeyDown);
        }


    return { resetCamera, zoomCamera, setPanMode, panCameraByPixels, setupCameraControls };
}
