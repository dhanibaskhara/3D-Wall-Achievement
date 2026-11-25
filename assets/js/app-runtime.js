// Three.js startup, scene assembly, render loop and browser lifecycle.
export function createAppRuntime(state, config, deps) {
    function onWindowResize() {
        if (!state.camera || !state.renderer) return;

        const width = window.innerWidth || 1;
        const height = window.innerHeight || 1;
        state.camera.aspect = width / height;
        state.camera.updateProjectionMatrix();
        state.renderer.setSize(width, height);
    }

    function animate(time) {
        state.animFrameId = requestAnimationFrame(animate);
        if (document.hidden || !state.renderer || !state.scene || !state.camera) return;

        state.camSpherical.radius += (state.targetSpherical.radius - state.camSpherical.radius) * 0.12;
        state.camSpherical.phi += (state.targetSpherical.phi - state.camSpherical.phi) * 0.14;
        state.camSpherical.theta += (state.targetSpherical.theta - state.camSpherical.theta) * 0.14;
        state.camTarget.lerp(state.targetLookAt, 0.14);

        const offset = new window.THREE.Vector3().setFromSpherical(state.camSpherical);
        state.camera.position.copy(state.camTarget).add(offset);
        state.camera.lookAt(state.camTarget);

        deps.markerService.rebuildMarkers3D(false);

        const pulseTime = (time || 0) * 0.0028;
        for (const entry of state.renderedPawEntries) {
            const pulse = entry.baseScale * (1 + Math.sin(pulseTime + entry.phase) * 0.10);
            entry.glow.scale.set(pulse, pulse, 1);
        }

        if (state.previewGroup && state.previewGroup.userData.previewGlow) {
            const previewPulse = 0.55 * (1 + Math.sin(pulseTime * 1.8) * 0.16);
            state.previewGroup.userData.previewGlow.scale.set(previewPulse, previewPulse, 1);
        }

        deps.sceneService.updateLivingActivities((time || 0) * 0.001);
        state.renderer.render(state.scene, state.camera);
    }

    function createSafeRenderer(container) {
        const configs = [
            { antialias: true, powerPreference: 'high-performance', alpha: false },
            { antialias: false, powerPreference: 'default', alpha: false },
            { antialias: false }
        ];
        let lastError = null;

        for (const options of configs) {
            try {
                const renderer = new window.THREE.WebGLRenderer(options);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                renderer.setSize(window.innerWidth, window.innerHeight);
                renderer.outputEncoding = window.THREE.sRGBEncoding;
                renderer.shadowMap.enabled = true;
                renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
                container.appendChild(renderer.domElement);
                return renderer;
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Perangkat/browser tidak mendukung WebGL.');
    }

    async function init() {
        deps.uiController.bindUIEvents(onWindowResize);
        const loadingSubtitle = document.getElementById('loading-sub');

        try {
            if (loadingSubtitle) loadingSubtitle.textContent = 'Memuat engine 3D Three.js...';
            const threeLoaded = await deps.loadFirstAvailable(
                config.THREE_CDNS,
                () => typeof window.THREE !== 'undefined'
            );
            if (!threeLoaded) {
                throw new Error('Pustaka Three.js gagal dimuat dari seluruh CDN. Periksa koneksi internet.');
            }

            const THREE = window.THREE;
            const container = document.getElementById('canvas-container');
            if (!container) throw new Error('Kontainer tampilan 3D tidak ditemukan.');

            state.scene = new THREE.Scene();
            state.camera = new THREE.PerspectiveCamera(
                45,
                window.innerWidth / Math.max(1, window.innerHeight),
                0.2,
                160
            );
            state.renderer = createSafeRenderer(container);

            state.raycaster = new THREE.Raycaster();
            state.pointerVec = new THREE.Vector2();
            state.camTarget = new THREE.Vector3(0.15, 9.6, 1.35);
            state.targetLookAt = state.camTarget.clone();
            state.camSpherical = new THREE.Spherical(25.5, Math.PI * 0.44, 0.34);
            state.targetSpherical = state.camSpherical.clone();

            state.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.6);
            state.scene.add(state.hemiLight);

            state.dirLight = new THREE.DirectionalLight(0xfef3c7, 0.8);
            state.dirLight.position.set(10, 26, 18);
            state.dirLight.castShadow = true;
            state.dirLight.shadow.mapSize.set(1024, 1024);
            state.dirLight.shadow.camera.near = 2;
            state.dirLight.shadow.camera.far = 60;
            state.dirLight.shadow.camera.left = -12;
            state.dirLight.shadow.camera.right = 12;
            state.dirLight.shadow.camera.top = 24;
            state.dirLight.shadow.camera.bottom = -2;
            state.scene.add(state.dirLight);

            state.spotLeft = new THREE.PointLight(0xfff1d6, 1.15, 36);
            state.spotLeft.position.set(-4.2, 10.5, 9.5);
            state.scene.add(state.spotLeft);

            state.spotRight = new THREE.PointLight(0xe0f2fe, 1.25, 36);
            state.spotRight.position.set(4.5, 13.0, 11.5);
            state.scene.add(state.spotRight);

            deps.sceneService.applyLightingMode();

            const leftFrontMaterial = new THREE.MeshStandardMaterial({
                map: deps.sceneService.createWallTexture(false),
                roughness: 0.88,
                metalness: 0.05
            });
            const rightFrontMaterial = new THREE.MeshStandardMaterial({
                map: deps.sceneService.createWallTexture(true),
                roughness: 0.84,
                metalness: 0.05
            });
            const darkSideMaterial = new THREE.MeshStandardMaterial({
                color: 0x334155,
                roughness: 0.85,
                metalness: 0.2
            });

            state.scene.add(deps.sceneService.buildWallTowerMesh(
                config.LEFT_CENTER_X,
                config.WALL_WIDTH,
                config.leftProfile,
                0.24,
                leftFrontMaterial,
                darkSideMaterial
            ));
            state.scene.add(deps.sceneService.buildWallTowerMesh(
                config.RIGHT_CENTER_X,
                config.WALL_WIDTH,
                config.rightProfile,
                0.24,
                rightFrontMaterial,
                darkSideMaterial
            ));

            deps.sceneService.buildSteelTrussAndCanopy();
            deps.sceneService.buildHoldsAndVolumes();
            deps.sceneService.buildEnvironment();
            deps.sceneService.buildLivingCommunityActivities();

            state.pinsGroup = new THREE.Group();
            state.previewGroup = new THREE.Group();
            state.scene.add(state.pinsGroup);
            state.scene.add(state.previewGroup);

            deps.cameraControls.setupCameraControls(state.renderer.domElement);
            animate(0);

            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) {
                loadingOverlay.style.opacity = '0';
                setTimeout(() => loadingOverlay.classList.add('hidden'), 320);
            }

            await deps.loadFirstAvailable(
                config.SUPABASE_CDNS,
                () => !!(window.supabase && window.supabase.createClient)
            );
            await deps.supabaseService.syncFromSupabase(false);
        } catch (error) {
            console.error('Init 3D error:', error);
            deps.showFatalError(error && error.message ? error.message : String(error));
        }
    }

    function start() {
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }

    return { start, init, onWindowResize, animate };
}
