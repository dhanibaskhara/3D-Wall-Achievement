// Centralized mutable state and live state views for feature services.
export function createAppState() {
    return {
        scene: null,
        camera: null,
        renderer: null,
        wallInteractMeshes: [],
        pinsGroup: null,
        previewGroup: null,
        raycaster: null,
        pointerVec: null,
        dirLight: null,
        hemiLight: null,
        spotLeft: null,
        spotRight: null,
        canopyLight: null,
        livingActors: null,
        isNightMode: true,
        animFrameId: null,

        camTarget: null,
        camSpherical: null,
        targetSpherical: null,
        targetLookAt: null,
        isDragging: false,
        isPinching: false,
        pointerDownPos: { x: 0, y: 0 },
        lastPointerPos: { x: 0, y: 0 },
        lastPinchDist: 0,
        activePointers: new Map(),
        isPanMode: false,
        hadMultiTouch: false,

        supabaseClient: null,
        realtimeChannel: null,
        pollTimer: null,
        currentUserId: null,
        activeWeekStartDate: null,
        markers: [],
        renderedPawEntries: [],
        hitTargets: [],
        isAddMode: false,
        pendingPlacement: null,
        selectedMarker: null,
        lastClusterDistBucket: -1,
        toastTimer: null,
        lastCloudDiag: {
            state: 'connecting',
            label: 'Menghubungkan...',
            isAnonDisabled: false,
            raw: '',
            hint: ''
        },
        sharedPawAssets: null
    };
}

function createStateView(state, keys) {
    const view = {};
    for (const key of keys) {
        Object.defineProperty(view, key, {
            enumerable: true,
            get: () => state[key],
            set: (value) => { state[key] = value; }
        });
    }
    return view;
}

export function createAppStateViews(state) {
    return {
        scene: createStateView(state, [
            'scene', 'wallInteractMeshes', 'dirLight', 'hemiLight',
            'spotLeft', 'spotRight', 'canopyLight', 'livingActors', 'isNightMode'
        ]),
        markers: createStateView(state, [
            'pinsGroup', 'camSpherical', 'previewGroup', 'markers',
            'renderedPawEntries', 'hitTargets', 'lastClusterDistBucket',
            'activeWeekStartDate', 'sharedPawAssets'
        ]),
        supabase: createStateView(state, [
            'supabaseClient', 'realtimeChannel', 'pollTimer', 'currentUserId',
            'activeWeekStartDate', 'markers', 'selectedMarker', 'lastCloudDiag'
        ]),
        camera: createStateView(state, [
            'camera', 'renderer', 'camSpherical', 'targetSpherical',
            'targetLookAt', 'isDragging', 'isPinching', 'pointerDownPos',
            'lastPointerPos', 'lastPinchDist', 'activePointers', 'isPanMode',
            'hadMultiTouch'
        ])
    };
}
