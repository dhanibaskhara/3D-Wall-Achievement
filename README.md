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
│       ├── app.js               # Application bootstrap and scene composition
│       ├── camera-controls.js   # Orbit, pan, pinch and keyboard controls
│       ├── markers.js           # 3D paw markers, previews and clustering
│       ├── supabase.js          # Authentication, database and Realtime
│       └── utils.js             # Pure shared helpers
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

The application is loaded as an ES module. Shared mutable application state is passed to feature factories through explicit getter/setter objects. The scene geometry and environment remain in `app.js` for now because they are tightly coupled to the original scene construction. They can be extracted in a later, behavior-tested refactor.
