# AGENTS.md

Guidelines for agentic coding in this SnapTick repository.

## Project Structure
```
Frontend/           React 19 + Vite + Tailwind (ES modules)
  src/Components/   UI components (PascalCase folder)
  src/App.jsx       Routes and top-level nav
  src/main.jsx      App bootstrap and router
  src/index.css     Tailwind entrypoint
Backend/            Node.js + Express + MongoDB (CommonJS)
  routes/           API routes (enroll.js, attendance.js)
  models/           Mongoose models (Student, Attendance)
  db.js             Mongo connection (reads MONGO_URI from .env)
  uploads/          Saved images served at /uploads
  face-models/      face-api.js model weights loaded from disk
```

## Commands

### Frontend
```bash
cd Frontend && npm install    # Install deps
npm run dev                   # Dev server (port 5173)
npm run build                 # Production build
npm run lint                  # ESLint
```

### Backend
```bash
cd Backend && npm install     # Install deps
npm run dev                   # nodemon (port 5000)
npm start                     # Without auto-reload
```

### Testing
- No test framework configured; `npm test` in Backend exits with error.
- If adding tests, use Jest or Vitest. Single test: `npm test -- --testPathPattern="filename"`
- Root package.json has deps but no scripts; run commands in Frontend/ or Backend/.

## Code Style

### General
- 2-space indentation; preserve existing whitespace
- Double quotes and semicolons
- Keep changes minimal; do not auto-format unrelated code
- No Prettier config; avoid reformatting whole files. Never edit node_modules/

### JavaScript / React (Frontend)
- ES modules (`"type": "module"` in package.json)
- Functional components with hooks only; no class components
- Default exports for components
- PascalCase for component files (`EnrollForm.jsx`)
- Imports omit file extensions; path casing must match disk
- Check `res.ok` before using fetch response data
- Use inline `style` objects or Tailwind classes consistently

### Node / Express (Backend)
- CommonJS (`require`, `module.exports`)
- Import order: built-ins, third-party, local modules
- All route handlers must be `async` with `try/catch`
- Return JSON errors with appropriate status codes (400/404/500)
- Log errors with context; existing logs use check/cross markers (✅/❌)
- Use `path.join(__dirname, ...)` for filesystem paths
- Clean up uploaded files on request failure

## Naming Conventions
- Components and files: PascalCase (`EnrollForm.jsx`)
- Variables and functions: camelCase
- Mongoose models: PascalCase (`Student`, `Attendance`)
- Route files: lowercase (`enroll.js`, `attendance.js`)

## Imports and Paths
- Frontend components in `Frontend/src/Components/` (capital C)
- Keep import casing consistent with disk paths
- Prefer relative imports; avoid deep `../../..` chains
- Backend uses relative paths from route files (`../models/...`)

## Error Handling
- Backend: `res.status(code).json({ error: "message" })`
- Log server errors with route context and error message
- Client: set user-facing messages and log to console
- Clean up temporary files (uploads) when throwing errors in routes

## API Conventions
Base URL: `http://localhost:5000`

| Endpoint | Method | Description |
|----------|--------|-------------|
| /enroll | POST | Create student (multipart form) |
| /enroll/:id | PUT | Update student / add photo |
| /enroll | GET | List all students |
| /enroll/:id | DELETE | Remove student |
| /enroll/descriptors | GET | Get face descriptors for matching |
| /attendance/upload | POST | Upload image for attendance |
| /attendance | GET | Get attendance records |
| /attendance/mark | POST | Mark attendance manually |
| /attendance/unmark | DELETE | Remove attendance record |
| /attendance/register.xlsx | GET | Excel attendance register (university format) |
| /attendance/alerts | GET | Students below the class threshold |
| /attendance/alerts/send | POST | Email low-attendance alerts (optionally guardians) |
| /attendance/audit | GET | Activity log for a classroom |
| /enroll/import-roster | POST | Bulk add students from CSV text |
| /enroll/import-photos | POST | Bulk add face photos from a ZIP named by roll number |
| /classroom/:id/settings | PUT | Timetable, subject code, threshold, live-camera-only |
| /classroom/:id/purge-biometrics | POST | Delete all face data and photos of a class |
| /auth/forgot-password, /auth/reset-password | POST | Teacher password reset by emailed code |
| /requests | GET | Student correction requests for the teacher |
| /requests/:id/decide | POST | Approve or reject a request |
| /portal/register, /portal/login | POST | Student portal accounts |
| /portal/me | GET | Student's attendance in every subject |
| /portal/requests | GET/POST | Student's correction requests |
| /admin/overview | GET | Department totals, teachers, classrooms, defaulters (admin) |
| /admin/teachers/:id | PUT | Activate/deactivate, role, department (admin) |
| /admin/classrooms/:id/unlock | POST | Re-open a locked day for 24 hours (admin) |
| /admin/holidays | GET/POST/DELETE | Holiday calendar |
| /admin/summary/send, /admin/summary/cron | POST/GET | Weekly HOD summary email |

- Success: `{ success: true, ... }` or `{ message: "..." }`
- Error: `{ error: "..." }` with status code
- Use cache-busting query params for image reloads (`?t=${Date.now()}`)

## Data Models
- **Student**: `name` (required), `rollNumber` (required, unique), `image` (filename),
  `faceDescriptors` ([[Number]], preferred), `faceDescriptor` ([Number], legacy), `descriptorCount`, `dateAdded`
- **Attendance**: `studentName`, `rollNo`, `date`

## Backend Patterns
- face-api.js models load once at module init via async IIFE
- `canvas` is monkey-patched into face-api.js in route modules
- Never reload models per request; reuse loaded nets
- Attendance matching uses roll numbers as labels
- multer stores uploads under `Backend/uploads/`

## Frontend Patterns
- Routing via `react-router-dom` with `<Routes>` in App.jsx
- Use `useEffect` cleanup for camera streams, intervals, listeners
- Stop media tracks on unmount to prevent camera lockups
- API URLs are hardcoded; keep consistent or centralize if refactoring

## Linting
- Frontend ESLint config: `Frontend/eslint.config.js`
- Uses flat config format with react-hooks and react-refresh plugins
- Rule: `no-unused-vars` ignores variables starting with uppercase or underscore
- Backend has no lint script; preserve existing formatting

## Environment
- Backend reads `MONGO_URI` from `Backend/.env`
- Uploaded images stored in `Backend/uploads/`, served at `/uploads`
- Face models for backend in `Backend/face-models/`
- Frontend face detection expects models under `/models` at runtime

## Cursor and Copilot Rules
- No `.cursor/rules/`, `.cursorrules`, or `.github/copilot-instructions.md` present.

## Agent Tips
- Scope changes to frontend or backend as needed
- When changing API behavior, update both server routes and client fetch logic
- Never commit secrets; keep `.env` local
- Run frontend lint after React changes
- If adding new routes, document them in this file
- See `GEMINI.md` for high-level project overview
