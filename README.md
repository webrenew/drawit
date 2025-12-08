# Drawit - AI-Powered Collaborative Whiteboard

A real-time collaborative drawing and diagramming application with AI-powered diagram generation. Built with Next.js 16, React 19, and the Vercel AI SDK.

## Features

### Canvas Tools
- **Selection & Pan** - Select shapes or pan around the infinite canvas
- **Shapes** - Rectangle, ellipse, diamond, arrow, line, freehand drawing
- **Text** - Add text labels with customizable fonts and alignment
- **Images** - Upload and place images on the canvas
- **Smart Connectors** - Connect shapes with automatic routing (bezier, smoothstep, straight)
- **Eraser** - Remove elements from the canvas

### AI-Powered Diagram Generation
Chat with the AI assistant to create complex diagrams:

- **Flowcharts** - Process flows, decision trees, swimlane diagrams
- **Workflows** - n8n-style automation diagrams with triggers, actions, conditions
- **Mind Maps** - Brainstorming and idea organization
- **Org Charts** - Team hierarchy and organizational structures
- **ER Diagrams** - Database entity-relationship diagrams
- **Network Diagrams** - Infrastructure topology (tree, circular, grid layouts)
- **Molecular Structures** - Chemical formulas (H2O, CO2, CH4, etc.)

### Customization
- **Dark/Light Theme** - Toggle between themes
- **Style Properties** - Stroke color, fill color, width, style (solid/dashed/dotted)
- **Roughness** - Adjust hand-drawn appearance (architect, artist, cartoonist)
- **Opacity** - Control transparency of elements

### Cloud Storage
- **User Authentication** - Sign in with Google
- **Auto-save** - Diagrams automatically save to Supabase
- **Cross-device sync** - Access your diagrams from anywhere

### Export
- Export diagrams as PNG or SVG
- Copy to clipboard

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **AI**: Vercel AI SDK v5 with Claude via AI Gateway
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (Google OAuth)
- **Storage**: Supabase Storage for images
- **State Management**: Zustand with auto-save
- **Drawing**: Custom SVG-based canvas with smart connectors

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm
- Supabase account (free tier works)

### 1. Clone & Install

```bash
git clone https://github.com/WebRenew/drawit.git
cd drawit
pnpm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the migration:
   ```bash
   # Copy contents of supabase/migrations/001_initial_schema.sql
   # Paste into SQL Editor and run
   ```
3. Set up Google OAuth:
   - Go to **Authentication** → **Providers** → **Google**
   - Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Add redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
   - Add Client ID and Secret to Supabase

4. Run the storage migration:
   ```bash
   # Copy contents of supabase/migrations/002_temp_images_storage.sql
   # Paste into SQL Editor and run
   ```
   This creates:
   - `temp-images` bucket for AI chat image uploads
   - `temp_images` table for tracking uploads
   - Cleanup policies for expired images

   Or manually create the bucket:
   - Go to **Storage** → **New Bucket**
   - Name: `temp-images`
   - Public: Yes
   - File size limit: 5MB
   - Allowed types: image/png, image/jpeg, image/gif, image/webp

### 3. Environment Variables

Create `.env.local`:

```bash
# Supabase (required)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# AI Gateway (required for AI features)
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
```

### 4. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to start drawing.

## Database Schema

```
┌─────────────────┐     ┌─────────────────┐
│    profiles     │     │    diagrams     │
├─────────────────┤     ├─────────────────┤
│ id (PK, FK)     │◄────│ user_id (FK)    │
│ email           │     │ id (PK)         │
│ full_name       │     │ title           │
│ avatar_url      │     │ elements (JSON) │
│ created_at      │     │ connections     │
│ updated_at      │     │ viewport        │
└─────────────────┘     │ is_public       │
        ▲               │ created_at      │
        │               │ updated_at      │
        │               └─────────────────┘
        │                       │
        │               ┌───────┴───────┐
        │               ▼               │
┌─────────────────┐     ┌─────────────────┐
│  chat_sessions  │     │  chat_messages  │
├─────────────────┤     ├─────────────────┤
│ id (PK)         │◄────│ session_id (FK) │
│ user_id (FK)    │     │ id (PK)         │
│ diagram_id (FK) │     │ role            │
│ title           │     │ content         │
│ model           │     │ parts (JSON)    │
│ created_at      │     │ tool_calls      │
│ updated_at      │     │ tool_results    │
└─────────────────┘     │ created_at      │
                        └─────────────────┘
```

### Row Level Security (RLS)

All tables have RLS enabled. Users can only access their own data:
- `profiles`: Own profile only
- `diagrams`: Own diagrams + public diagrams
- `chat_sessions`: Own sessions only
- `chat_messages`: Messages in own sessions only

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── ai-chat/        # AI chat endpoint with tool definitions
│   │   └── upload/         # Image upload to Supabase Storage
│   ├── auth/
│   │   └── callback/       # OAuth callback handler
│   ├── workflow/           # Workflow builder page
│   └── page.tsx            # Main canvas page
├── components/
│   ├── auth/               # Login button & auth components
│   ├── editor/             # Canvas and toolbar components
│   ├── workflow/           # Workflow builder components
│   └── ui/                 # shadcn/ui components
├── lib/
│   ├── ai-chat/
│   │   └── tool-handlers/  # AI tool execution handlers
│   ├── services/           # Supabase service classes
│   ├── supabase/           # Supabase client setup
│   ├── *-layouts.ts        # Layout algorithms for diagrams
│   ├── store.ts            # Zustand state with auto-save
│   └── types.ts            # TypeScript type definitions
└── supabase/
    └── migrations/         # Database schema SQL
```

## AI Tools

The AI assistant supports the following tools:

| Tool | Description |
|------|-------------|
| `getCanvasState` | Get current canvas elements and connections |
| `createFlowchart` | Create flowcharts with connected nodes |
| `createWorkflow` | Create n8n-style workflow automations |
| `createMindMap` | Create mind maps for brainstorming |
| `createOrgChart` | Create organizational hierarchy charts |
| `createERDiagram` | Create database ER diagrams |
| `createNetworkDiagram` | Create network infrastructure diagrams |
| `createMolecule` | Create molecular structure diagrams |
| `createShape` | Create basic shapes (rectangle, circle, etc.) |
| `updateShape` | Modify existing shape properties |
| `placeImage` | Place an image on the canvas |
| `clearCanvas` | Clear all canvas content |
| `analyzeDiagram` | Analyze and provide insights on current diagram |
| `beautifyDiagram` | Auto-arrange diagram layout |

## Usage Examples

### Create a Flowchart
```
"Create a user authentication flowchart with login, validation, and success/failure paths"
```

### Create an Org Chart
```
"Create an org chart with John as CEO, with 3 VPs reporting to him"
```

### Recreate from Image
Upload an image of a diagram and ask:
```
"Recreate this diagram on the canvas"
```

### Create a Molecular Structure
```
"Draw a water molecule (H2O)"
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Set up your own Supabase project using the migration
4. Make your changes
5. Submit a pull request

## License

MIT
