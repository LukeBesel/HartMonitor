# Claude MES — Composable Manufacturing Execution System

A full-stack MES platform similar to Tulip Interfaces, built for tracking and guiding manual manufacturing processes.

## Features

### App Builder
- Visual drag-and-drop step editor
- 13 widget types: Text, Instruction, Image, Button, Text Input, Number Input, Dropdown, Checkbox, Timer, Counter, Pass/Fail, Separator, Signature
- Multi-step app creation with step navigation tabs
- Widget property inspector (label, config, colors, variable names)
- Draft → Published workflow

### App Player (Operator Interface)
- Dark-themed, touch-friendly full-screen operator UI
- Step-by-step guided workflows
- Real-time timer and counter widgets
- Pass/Fail quality capture
- Automatic cycle time tracking per step
- Completion records with all captured data

### Data Tables
- Create custom tables with typed fields (text, number, boolean, date, select)
- Inline record editing
- Add/remove fields at any time

### Analytics Dashboard
- Daily throughput (area chart, last N days)
- Cycle time trends (min/avg/max line chart)
- Quality pass/fail stacked bar chart
- Pass rate donut chart
- Operator performance leaderboard
- App performance comparison

### Stations
- Manage physical workstations
- Assign published apps to stations
- Track completion counts per station
- Status management (active / inactive / maintenance)

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, SQLite (better-sqlite3) |
| Frontend | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Drag & Drop | @dnd-kit |
| Icons | Lucide React |
| Routing | React Router v6 |

## Quick Start

```bash
# Install all dependencies (root + both workspaces)
npm run install:all

# Development — runs API (:3001) + UI (:5173) together
npm run dev

# Run the production build locally (serves everything on :3001)
npm run build && npm start

# Run the test suite (auth, tenant isolation, rate limiting, health)
npm test
```

Open **http://localhost:5173** in dev. Locally, demo data is seeded and you can
log in with **admin@hartmonitor.demo** / **Admin123!**, or create a fresh
workspace via **Get started**.

> Demo accounts are only created when `SEED_DEMO_DATA=true` (set in
> `backend/.env` for local dev). Production databases start empty and secure —
> the first real signup becomes the owner.

## Deploying & Selling

See **[HOSTING.md](./HOSTING.md)** for the full launch guide: putting it online
(Railway / Render / Docker), turning on Stripe payments, onboarding customers,
custom domains, backups, and the subscription/upgrade model.

## Project Structure

```
Claude-MES/
├── backend/
│   ├── src/
│   │   ├── index.js          # Express server
│   │   ├── db.js             # SQLite setup + seed data
│   │   └── routes/
│   │       ├── apps.js       # CRUD + publish
│   │       ├── completions.js
│   │       ├── tables.js     # Tables + records
│   │       ├── stations.js
│   │       └── analytics.js  # Aggregated metrics
│   └── mes.db                # SQLite database (auto-created)
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── AppsLibrary.tsx
        │   ├── AppBuilder.tsx   # Visual app builder
        │   ├── AppPlayer.tsx    # Operator runtime
        │   ├── Tables.tsx
        │   ├── TableDetail.tsx
        │   ├── Analytics.tsx
        │   └── Stations.tsx
        ├── api/client.ts        # API client
        ├── types.ts             # TypeScript types
        └── utils/uuid.ts
```

## Demo Data

When `SEED_DEMO_DATA=true` (local development only), the system seeds a demo
company with sample login accounts, a published "Widget Assembly Process" app,
stations, ~30 days of synthetic completion history, inventory, vendors, purchase
orders, and NCRs. In production this is disabled — new databases start empty, and
each customer's workspace is created (and isolated) at signup. Customers can load
their own sample data anytime from the onboarding wizard.
