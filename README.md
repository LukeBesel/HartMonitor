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
# Install all dependencies
npm install --workspace=backend
npm install --workspace=frontend

# Development (separate terminals)
cd backend && npm run dev     # API on :3001
cd frontend && npm run dev    # UI on :5173 (proxies /api to :3001)

# Production
./start.sh                    # Builds frontend, serves everything on :3001
```

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

On first start the system seeds:
- 1 published "Widget Assembly Process" app (4 steps, 13 widgets)
- 2 stations
- 30 days of synthetic completion history (~5-11/day, 93% pass rate)
- 1 "Part Inventory" data table with 5 sample records
