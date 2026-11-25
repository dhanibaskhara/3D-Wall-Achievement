// Shared application configuration for the Pasar Festival 3D Wall.
export const SUPABASE_URL = 'https://hutbxsmmwuyprxeilcfr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_fvKp7rX5jdGRFCuiMbb6lg_e8oSZfIQ';

export const THREE_CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
    'https://unpkg.com/three@0.128.0/build/three.min.js'
];

export const SUPABASE_CDNS = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
    'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js'
];

// Geometri dua bidang dinding Pasar Festival Kuningan.
export const WALL_WIDTH = 3.0;
export const LEFT_CENTER_X = -1.65;
export const RIGHT_CENTER_X = 1.65;
export const WALL_HEIGHT = 19.3;

// Profil dinding [ketinggian, kedalaman permukaan].
export const leftProfile = [
    [0.0, 0.00],
    [(5 / 14) * WALL_HEIGHT, 0.00],
    [(11 / 14) * WALL_HEIGHT, -0.52],
    [WALL_HEIGHT, -0.52]
];

export const rightProfile = [
    [0.0, 0.22],
    [3.2, 0.58],
    [6.4, 1.24],
    [9.8, 2.22],
    [13.2, 3.45],
    [16.2, 4.46],
    [19.3, 5.28]
];
