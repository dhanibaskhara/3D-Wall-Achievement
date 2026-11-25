# 3D Wall Achievement

Standalone Three.js experience for the Iyalagi.Manjat community.

## Project structure

```text
.
├── index.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   └── js/
│       ├── app.js               # Application bootstrap and UI wiring
│       ├── camera-controls.js   # Orbit, pan, pinch and keyboard controls
│       ├── markers.js           # 3D paw markers, previews and clustering
│       ├── scene3d.js           # Wall geometry, holds, environment and actors
│       ├── supabase.js          # Anonymous auth, database and Realtime
│       └── utils.js             # UUID, date formatting and seeded RNG
└── README.md
```

## Deployment

Static site. Configure Vercel with the repository root as the project root. No build command or output directory override is required; the entry point is `index.html`.

## Runtime dependencies

- Tailwind CSS CDN
- Three.js r128 (CDN fallback list is configured in the application)
- Supabase JS v2 (CDN fallback list is configured in the application)

The browser uses a Supabase publishable key. Database access must remain protected by Row Level Security and server-side RPC validation. Never put a Supabase service-role key in frontend code.

## Architecture notes

The application entry point is loaded as an ES module. Feature factories receive shared mutable state through explicit getter/setter objects. The scene geometry, environment, climbing holds and living 3D actors are isolated in `scene3d.js`; marker rendering/clustering, camera controls and Supabase integration each have their own module.

The next refactor should focus on reducing coupling between the application shell and scene state, then add browser-level regression tests for the marker, camera, and cloud-sync flows.
