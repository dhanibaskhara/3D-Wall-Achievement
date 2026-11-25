// Application composition root. Feature logic lives in focused modules.
import {
    SUPABASE_URL,
    SUPABASE_KEY,
    THREE_CDNS,
    SUPABASE_CDNS,
    WALL_WIDTH,
    LEFT_CENTER_X,
    RIGHT_CENTER_X,
    WALL_HEIGHT,
    leftProfile,
    rightProfile
} from './app-config.js';
import { createAppState, createAppStateViews } from './app-state.js';
import { createAppUtilities } from './app-utils.js';
import { generateUuidV4, formatDateIndo } from './utils.js';
import { createSupabaseService } from './supabase.js';
import { createCameraControls } from './camera-controls.js';
import { createMarkerRenderer } from './markers.js';
import { createScene3D } from './scene3d.js';
import { createWallInteraction } from './wall-interaction.js';
import { createUIController } from './ui-controller.js';
import { createAppRuntime } from './app-runtime.js';

const state = createAppState();
const stateViews = createAppStateViews(state);
const utilities = createAppUtilities(state);

const sceneService = createScene3D(stateViews.scene, {
    get THREE() { return window.THREE; },
    WALL_WIDTH,
    LEFT_CENTER_X,
    RIGHT_CENTER_X,
    WALL_HEIGHT,
    leftProfile,
    rightProfile,
    showToast: utilities.showToast
});

const markerService = createMarkerRenderer(stateViews.markers, {
    get THREE() { return window.THREE; },
    snapPointToWallSurface: sceneService.snapPointToWallSurface
});

let closeMarkerPopup = () => {};
const supabaseService = createSupabaseService(stateViews.supabase, {
    SUPABASE_URL,
    SUPABASE_KEY,
    createResilientStorage: utilities.createResilientStorage,
    formatDateIndo,
    generateUuidV4,
    showToast: utilities.showToast,
    rebuildMarkers3D: markerService.rebuildMarkers3D,
    closeMarkerPopup: (...args) => closeMarkerPopup(...args)
});

let wallInteraction = null;
const cameraControls = createCameraControls(stateViews.camera, {
    get THREE() { return window.THREE; },
    handleCanvasTap: (...args) => {
        if (wallInteraction) wallInteraction.handleCanvasTap(...args);
    }
});

const uiController = createUIController(state, {
    markerService,
    cameraControls,
    sceneService,
    supabaseService,
    showToast: utilities.showToast,
    loadFirstAvailable: utilities.loadFirstAvailable,
    SUPABASE_CDNS
});
closeMarkerPopup = uiController.closeMarkerPopup;

wallInteraction = createWallInteraction(state, {
    sceneService,
    markerService,
    uiController,
    showToast: utilities.showToast
});

const runtime = createAppRuntime(state, {
    THREE_CDNS,
    SUPABASE_CDNS,
    WALL_WIDTH,
    LEFT_CENTER_X,
    RIGHT_CENTER_X,
    WALL_HEIGHT,
    leftProfile,
    rightProfile
}, {
    uiController,
    sceneService,
    markerService,
    cameraControls,
    supabaseService,
    loadFirstAvailable: utilities.loadFirstAvailable,
    showFatalError: utilities.showFatalError
});

runtime.start();
